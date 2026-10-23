/**
 * Settings → Voice & Video → Mic Test (Discord's "Let's Check"): my chosen microphone with my
 * voice settings (the browser's processing, voice isolation), its level on a meter, and my
 * voice played back through my chosen speaker at my output volume. Changing those settings
 * while it runs applies at once (input ones restart it). One test at a time; the page stops it
 * when it closes. Starting one also lets the browser reveal device names.
 *
 *   await startMicTest();   // throws a MediaAccessError (friendly message) when the mic fails
 *   useMicTest((s) => s.level);
 *   stopMicTest();
 */
import { create } from 'zustand';
import {
  getMicrophoneStream,
  outputSelectionSupported,
  stopStream,
} from '@/features/calls/engine/media';
import { micConstraints, voiceIsolationAvailable, voicePrefs } from '@/features/calls/voice';
import { useUi, type DevicePrefs } from '@/stores/ui';
import { createLevelMeter } from './input/meter';
import { RNNOISE_SAMPLE_RATE, createRnnoiseNode } from './rnnoise';
import { VOLUME_MAX } from './userAudio';

export interface MicTestState {
  running: boolean;
  starting: boolean;
  /** My level in dBFS while it runs. */
  level: number | null;
}

export const useMicTest = create<MicTestState>(() => ({
  running: false,
  starting: false,
  level: null,
}));

interface Session {
  stop(): void;
}

let session: Session | null = null;
/** Bumped by every start and stop: a start overtaken by a stop gives up. */
let generation = 0;

type SinkElement = HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };

/** The mic as my voice settings want it (the calls' constraints, my input device). */
export function micTestConstraints(prefs: DevicePrefs): MediaTrackConstraints {
  const c = micConstraints(voicePrefs());
  return prefs.audioInputDevice ? { ...c, deviceId: { exact: prefs.audioInputDevice } } : c;
}

export async function startMicTest(): Promise<void> {
  if (session || useMicTest.getState().starting) return;
  const mine = ++generation;
  useMicTest.setState({ starting: true, level: null });
  const prefs = useUi.getState().prefs;
  let stream: MediaStream | null = null;
  let ctx: AudioContext | null = null;
  try {
    stream = await getMicrophoneStream(micTestConstraints(prefs));
    let isolate = prefs.voiceIsolation && voiceIsolationAvailable();
    // RNNoise needs 48 kHz; Firefox cannot take a mic into a context of another rate, so the
    // test then runs at the device's rate, without voice isolation.
    ctx = new AudioContext(isolate ? { sampleRate: RNNOISE_SAMPLE_RATE } : {});
    let source: MediaStreamAudioSourceNode;
    try {
      source = ctx.createMediaStreamSource(stream);
    } catch (err) {
      if (!isolate) throw err;
      void ctx.close().catch(() => undefined);
      ctx = new AudioContext();
      source = ctx.createMediaStreamSource(stream);
      isolate = false;
    }
    let head: AudioNode = source;
    let rnnoise: { destroy(): void } | null = null;
    if (isolate) {
      try {
        const node = await createRnnoiseNode(ctx);
        rnnoise = node;
        head = source.connect(node);
      } catch (err) {
        console.warn('Voice isolation is unavailable; testing the plain microphone', err);
      }
    }
    const meter = await createLevelMeter(ctx, (db) => {
      if (mine === generation) useMicTest.setState({ level: db });
    });
    const volume = ctx.createGain();
    volume.gain.value = Math.min(VOLUME_MAX, Math.max(0, prefs.outputVolume));
    const out = ctx.createMediaStreamDestination();
    head.connect(meter.node).connect(volume).connect(out);
    const el: SinkElement = new Audio();
    el.srcObject = out.stream;
    const sink = (id: string) => {
      if (outputSelectionSupported()) void el.setSinkId?.(id || 'default').catch(() => undefined);
    };
    if (prefs.audioOutputDevice) sink(prefs.audioOutputDevice);
    if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined);
    if (mine !== generation) throw new Error('cancelled');
    void el.play().catch(() => undefined);

    // Output changes apply live; input changes test the new input.
    const off = useUi.subscribe((s, prev) => {
      const a = s.prefs;
      const b = prev.prefs;
      if (a === b) return;
      if (a.outputVolume !== b.outputVolume)
        volume.gain.value = Math.min(VOLUME_MAX, Math.max(0, a.outputVolume));
      if (a.audioOutputDevice !== b.audioOutputDevice) sink(a.audioOutputDevice);
      if (
        a.audioInputDevice !== b.audioInputDevice ||
        a.voiceIsolation !== b.voiceIsolation ||
        a.noiseCancellation !== b.noiseCancellation ||
        a.echoCancellation !== b.echoCancellation ||
        a.autoGainControl !== b.autoGainControl
      ) {
        stopMicTest();
        void startMicTest().catch(() => undefined);
      }
    });
    const s = stream;
    const c = ctx;
    session = {
      stop() {
        off();
        el.pause();
        el.srcObject = null;
        meter.stop();
        rnnoise?.destroy();
        stopStream(s);
        void c.close().catch(() => undefined);
      },
    };
    useMicTest.setState({ running: true, starting: false });
  } catch (e) {
    stopStream(stream);
    void ctx?.close().catch(() => undefined);
    if (mine !== generation) return;
    useMicTest.setState({ running: false, starting: false, level: null });
    throw e;
  }
}

export function stopMicTest(): void {
  generation += 1;
  session?.stop();
  session = null;
  useMicTest.setState({ running: false, starting: false, level: null });
}
