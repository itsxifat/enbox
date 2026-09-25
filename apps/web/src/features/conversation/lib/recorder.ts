/**
 * Voice-note recording: MediaRecorder (Opus in WebM/Ogg, AAC in MP4 on Safari) plus an
 * AnalyserNode that samples the input level for the live meter and the stored waveform.
 */
import { WAVEFORM_MAX_SAMPLES } from '@enbox/shared';
import { downsampleWaveform } from './waveform';

const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/ogg;codecs=opus',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/webm',
];

export function pickRecorderMime(isSupported: (t: string) => boolean): string | undefined {
  return MIME_CANDIDATES.find((t) => {
    try {
      return isSupported(t);
    } catch {
      return false;
    }
  });
}

export function recordingSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof MediaRecorder !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

export interface RecordingResult {
  blob: Blob;
  mimeType: string;
  durationMs: number;
  waveform: number[];
  fileName: string;
}

export class VoiceRecording {
  private recorder: MediaRecorder;
  private stream: MediaStream;
  private chunks: Blob[] = [];
  private ctx: AudioContext | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private samples: number[] = [];
  private startedAt = performance.now();
  private pausedMs = 0;
  /** Latest input level 0..1 (for the live meter). */
  level = 0;
  onLevel?: (level: number, samples: number[]) => void;

  private constructor(stream: MediaStream, recorder: MediaRecorder) {
    this.stream = stream;
    this.recorder = recorder;
    recorder.ondataavailable = (e) => {
      if (e.data.size) this.chunks.push(e.data);
    };
  }

  static async start(): Promise<VoiceRecording> {
    if (!recordingSupported()) throw new Error('Voice recording is not supported in this browser');
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const mimeType = pickRecorderMime((t) => MediaRecorder.isTypeSupported(t));
    const recorder = new MediaRecorder(
      stream,
      mimeType ? { mimeType, audioBitsPerSecond: 48_000 } : undefined,
    );
    const rec = new VoiceRecording(stream, recorder);
    rec.meter();
    recorder.start(250);
    rec.startedAt = performance.now();
    return rec;
  }

  private meter(): void {
    try {
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctx();
      const src = this.ctx.createMediaStreamSource(this.stream);
      const analyser = this.ctx.createAnalyser();
      analyser.fftSize = 1024;
      src.connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      this.timer = setInterval(() => {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i]! * buf[i]!;
        const rms = Math.sqrt(sum / buf.length);
        this.level = Math.min(1, rms * 4);
        if (this.recorder.state === 'recording') this.samples.push(rms);
        this.onLevel?.(this.level, this.samples);
      }, 60);
    } catch {
      /* the meter is cosmetic */
    }
  }

  get elapsedMs(): number {
    return performance.now() - this.startedAt - this.pausedMs;
  }

  get mimeType(): string {
    return this.recorder.mimeType || 'audio/webm';
  }

  private cleanup(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const t of this.stream.getTracks()) t.stop();
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }

  stop(): Promise<RecordingResult> {
    const durationMs = Math.round(this.elapsedMs);
    return new Promise((resolve, reject) => {
      this.recorder.onstop = () => {
        this.cleanup();
        const mimeType = this.mimeType.split(';')[0] || 'audio/webm';
        const blob = new Blob(this.chunks, { type: mimeType });
        if (!blob.size) {
          reject(new Error('Nothing was recorded'));
          return;
        }
        const ext = mimeType.includes('mp4') ? 'm4a' : mimeType.includes('ogg') ? 'ogg' : 'webm';
        resolve({
          blob,
          mimeType,
          durationMs,
          waveform: downsampleWaveform(this.samples, WAVEFORM_MAX_SAMPLES),
          fileName: `voice-${new Date().toISOString().replace(/[:.]/g, '-')}.${ext}`,
        });
      };
      try {
        this.recorder.stop();
      } catch (e) {
        this.cleanup();
        reject(e instanceof Error ? e : new Error('Recording failed'));
      }
    });
  }

  cancel(): void {
    this.recorder.onstop = null;
    try {
      if (this.recorder.state !== 'inactive') this.recorder.stop();
    } catch {
      /* ignore */
    }
    this.cleanup();
  }
}
