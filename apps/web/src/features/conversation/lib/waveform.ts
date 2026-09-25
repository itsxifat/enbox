/** Voice-note waveforms: 0..1 amplitudes, ≤ WAVEFORM_MAX_SAMPLES (unit-tested). */
import { WAVEFORM_MAX_SAMPLES } from '@enbox/shared';

/**
 * Reduce raw amplitude samples (any scale ≥ 0) to `n` bars: max per bucket, normalised to
 * the loudest bar, with a small floor so silence still draws a visible bar.
 */
export function downsampleWaveform(samples: number[], n = WAVEFORM_MAX_SAMPLES): number[] {
  const count = Math.min(n, WAVEFORM_MAX_SAMPLES);
  if (!samples.length) return [];
  const buckets = Math.min(count, samples.length);
  const out: number[] = [];
  for (let b = 0; b < buckets; b++) {
    const from = Math.floor((b * samples.length) / buckets);
    const to = Math.max(from + 1, Math.floor(((b + 1) * samples.length) / buckets));
    let peak = 0;
    for (let i = from; i < to; i++) peak = Math.max(peak, Math.abs(samples[i] ?? 0));
    out.push(peak);
  }
  const max = Math.max(...out);
  return out.map((v) => {
    const norm = max > 0 ? v / max : 0;
    return Math.round(Math.max(0.06, Math.min(1, norm)) * 100) / 100;
  });
}

/** Resample a stored waveform to `bars` for display (linear interpolation). */
export function resampleWaveform(waveform: number[], bars: number): number[] {
  if (!waveform.length) return [];
  if (waveform.length === bars) return waveform;
  const out: number[] = [];
  for (let i = 0; i < bars; i++) {
    const x = (i * (waveform.length - 1)) / Math.max(1, bars - 1);
    const lo = Math.floor(x);
    const hi = Math.min(waveform.length - 1, lo + 1);
    const t = x - lo;
    out.push(waveform[lo]! * (1 - t) + waveform[hi]! * t);
  }
  return out;
}

/** Deterministic pseudo-waveform for audio without one (seeded by the media id). */
export function fallbackWaveform(seed: string, bars = 40): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const out: number[] = [];
  for (let i = 0; i < bars; i++) {
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    const r = ((h >>> 0) % 1000) / 1000;
    out.push(0.2 + 0.6 * r * (0.6 + 0.4 * Math.sin(i / 3)));
  }
  return out;
}
