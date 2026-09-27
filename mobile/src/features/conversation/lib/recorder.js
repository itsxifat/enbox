/**
 * Voice-note recording (web lib/recorder.ts) on expo-audio: AAC in an .m4a container, live
 * levels for the recorder bar and a downsampled waveform for the bubble.
 *
 *   const rec = useVoiceRecorder();
 *   await rec.start();         // asks for the microphone the first time
 *   rec.elapsedMs / rec.levels // while recording
 *   const res = await rec.stop();  // { file, durationMs, waveform } | null
 *   rec.cancel();
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from 'expo-audio';
import { downsampleWaveform } from './waveform';

const OPTIONS = { ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true };

/** dBFS (-160..0) → 0..1 amplitude. */
function level(db) {
  if (typeof db !== 'number' || !Number.isFinite(db)) return 0;
  return Math.max(0, Math.min(1, (db + 60) / 60));
}

export function useVoiceRecorder() {
  const recorder = useAudioRecorder(OPTIONS);
  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsed] = useState(0);
  const [levels, setLevels] = useState([]);
  const samples = useRef([]);
  const startedAt = useRef(0);
  const timer = useRef(null);

  const clear = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };
  useEffect(() => () => clear(), []);

  const start = useCallback(async () => {
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) {
      const e = new Error('Microphone permission denied');
      e.name = 'NotAllowedError';
      throw e;
    }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    samples.current = [];
    startedAt.current = Date.now();
    setElapsed(0);
    setLevels([]);
    setRecording(true);
    clear();
    timer.current = setInterval(() => {
      const st = recorder.getStatus();
      const l = level(st.metering);
      samples.current.push(l);
      setElapsed(st.durationMillis || Date.now() - startedAt.current);
      setLevels((b) => [...b.slice(-41), l]);
    }, 100);
  }, [recorder]);

  const finish = useCallback(async () => {
    clear();
    setRecording(false);
    const durationMs = Date.now() - startedAt.current;
    try {
      await recorder.stop();
    } catch {
      /* not started */
    }
    await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
    return durationMs;
  }, [recorder]);

  const stop = useCallback(async () => {
    const durationMs = await finish();
    const uri = recorder.uri;
    if (!uri) return null;
    return {
      file: { uri, name: `voice-${Date.now()}.m4a`, type: 'audio/mp4' },
      fileName: `voice-${Date.now()}.m4a`,
      mimeType: 'audio/mp4',
      durationMs,
      waveform: downsampleWaveform(samples.current),
    };
  }, [finish, recorder]);

  const cancel = useCallback(() => {
    void finish();
  }, [finish]);

  return { start, stop, cancel, recording, elapsedMs, levels };
}
