/**
 * Microphone processing for calls — device prefs, set in Settings → Voice and video and in
 * the voice menu of the call screen (a change during a call swaps the microphone live):
 *
 * - Noise cancellation, echo cancellation, automatic gain: the browser's own WebRTC audio
 *   processing (getUserMedia constraints).
 * - Voice isolation: RNNoise, a small neural network trained to tell speech from noise
 *   (WebAssembly in an AudioWorklet), between the microphone and the call. It removes the
 *   typing, traffic, music and other background sounds that plain noise suppression lets
 *   through. Browsers with a native voice isolation mode (the `voiceIsolation` constraint)
 *   use it as well. Loaded on first use; where it cannot run, the call goes on with the
 *   plain microphone.
 *
 *   const mic = await getCallMicrophone();   // the track to send (isolated or not)
 *   voiceIsolationAvailable()                 // false: the switch is disabled
 */
import { useUi, type DevicePrefs } from '@/stores/ui';
import { getMicrophoneStream } from './engine/media';

export const VOICE_PREF_KEYS = [
  'voiceIsolation',
  'noiseCancellation',
  'echoCancellation',
  'autoGainControl',
] as const satisfies readonly (keyof DevicePrefs)[];

export type VoicePrefs = Pick<DevicePrefs, (typeof VOICE_PREF_KEYS)[number]>;

export function voicePrefs(): VoicePrefs {
  const p = useUi.getState().prefs;
  return {
    voiceIsolation: p.voiceIsolation,
    noiseCancellation: p.noiseCancellation,
    echoCancellation: p.echoCancellation,
    autoGainControl: p.autoGainControl,
  };
}

/** Whether this browser can run the voice isolation filter. */
export function voiceIsolationAvailable(): boolean {
  return typeof AudioWorkletNode !== 'undefined' && typeof WebAssembly === 'object';
}

function nativeVoiceIsolation(): boolean {
  try {
    const supported = navigator.mediaDevices?.getSupportedConstraints?.() as
      Record<string, boolean | undefined> | undefined;
    return !!supported?.voiceIsolation;
  } catch {
    return false;
  }
}

export function micConstraints(p: VoicePrefs): MediaTrackConstraints {
  const c: MediaTrackConstraints & { voiceIsolation?: boolean } = {
    echoCancellation: p.echoCancellation,
    noiseSuppression: p.noiseCancellation,
    autoGainControl: p.autoGainControl,
  };
  if (nativeVoiceIsolation()) c.voiceIsolation = p.voiceIsolation;
  return c;
}

let rnnoiseWasm: Promise<ArrayBuffer> | null = null;

/**
 * `mic` through RNNoise. Stopping the returned track (the engine stops the track it sends
 * when it is replaced or the call ends) also stops `mic` and closes the audio graph.
 */
async function isolateVoice(mic: MediaStreamTrack): Promise<MediaStreamTrack> {
  const [{ RnnoiseWorkletNode, loadRnnoise }, worklet, wasm, simd] = await Promise.all([
    import('@sapphi-red/web-noise-suppressor'),
    import('@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url'),
    import('@sapphi-red/web-noise-suppressor/rnnoise.wasm?url'),
    import('@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url'),
  ]);
  rnnoiseWasm ??= loadRnnoise({ url: wasm.default, simdUrl: simd.default }).catch((e) => {
    rnnoiseWasm = null;
    throw e;
  });
  const wasmBinary = await rnnoiseWasm;
  // RNNoise works on 48 kHz frames.
  const ctx = new AudioContext({ sampleRate: 48_000 });
  try {
    await ctx.audioWorklet.addModule(worklet.default);
    const source = ctx.createMediaStreamSource(new MediaStream([mic]));
    const rnnoise = new RnnoiseWorkletNode(ctx, { wasmBinary, maxChannels: 1 });
    const out = ctx.createMediaStreamDestination();
    source.connect(rnnoise).connect(out);
    if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined);
    const track = out.stream.getAudioTracks()[0];
    if (!track) throw new Error('No processed audio track');
    const stopTrack = track.stop.bind(track);
    track.stop = () => {
      stopTrack();
      mic.stop();
      source.disconnect();
      rnnoise.destroy();
      void ctx.close();
    };
    return track;
  } catch (e) {
    void ctx.close();
    throw e;
  }
}

/** The microphone track a call sends, with the current voice settings applied. */
export async function getCallMicrophone(): Promise<MediaStreamTrack> {
  const prefs = voicePrefs();
  const mic = (await getMicrophoneStream(micConstraints(prefs))).getAudioTracks()[0]!;
  if (!prefs.voiceIsolation || !voiceIsolationAvailable()) return mic;
  try {
    return await isolateVoice(mic);
  } catch (err) {
    console.warn('Voice isolation is unavailable; using the plain microphone', err);
    return mic;
  }
}
