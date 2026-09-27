/**
 * Renders the web client's UI sounds (apps/web/src/lib/notify.ts: WebAudio oscillators with
 * exponential envelopes) into small WAV files, so the app sounds exactly like the web.
 *
 *   node scripts/generate-sounds.mjs      # → assets/sounds/*.wav
 */
import fs from 'node:fs';
import path from 'node:path';

const RATE = 22050;
const OUT = path.join(import.meta.dirname, '../assets/sounds');

// Same specs as the web (SOUNDS / LOOPS in lib/notify.ts).
const SOUNDS = {
  message: {
    volume: 0.22,
    tones: [
      { freqs: [880], at: 0, dur: 0.09 },
      { freqs: [1318.5], at: 0.1, dur: 0.16 },
    ],
  },
  sent: {
    volume: 0.12,
    tones: [{ freqs: [620], glideTo: 980, at: 0, dur: 0.08, type: 'triangle' }],
  },
  notification: {
    volume: 0.2,
    tones: [
      { freqs: [1046.5], at: 0, dur: 0.12 },
      { freqs: [1568], at: 0.12, dur: 0.2 },
    ],
  },
  end: {
    volume: 0.2,
    tones: [
      { freqs: [660], at: 0, dur: 0.14 },
      { freqs: [440], at: 0.16, dur: 0.24 },
    ],
  },
  error: {
    volume: 0.18,
    tones: [{ freqs: [220, 233], at: 0, dur: 0.25, type: 'square', gain: 0.4 }],
  },
  // Loops: one period each (played with looping on).
  ringtone: {
    period: 2.4,
    volume: 0.3,
    tones: [
      { freqs: [659.3, 830.6], at: 0, dur: 0.35 },
      { freqs: [659.3, 830.6], at: 0.45, dur: 0.35 },
    ],
  },
  ringback: { period: 4, volume: 0.15, tones: [{ freqs: [440, 480], at: 0, dur: 1.4 }] },
};

const wave = {
  sine: (p) => Math.sin(2 * Math.PI * p),
  triangle: (p) => 1 - 4 * Math.abs(Math.round(p - 0.25) - (p - 0.25)),
  square: (p) => (p % 1 < 0.5 ? 1 : -1),
};

/** WebAudio `exponentialRampToValueAtTime` envelope: 0.0001 → peak (attack) → 0.0001. */
function envelope(t, dur, peak) {
  const attack = Math.min(0.015, dur / 4);
  const lo = 0.0001;
  if (t < 0 || t > dur) return 0;
  if (t < attack) return lo * Math.pow(peak / lo, t / attack);
  return peak * Math.pow(lo / peak, (t - attack) / (dur - attack));
}

function render({ tones, volume, period }) {
  const end = period ?? Math.max(...tones.map((t) => t.at + t.dur)) + 0.03;
  const n = Math.ceil(end * RATE);
  const out = new Float32Array(n);
  for (const tone of tones) {
    const start = 0.01 + tone.at;
    const osc = wave[tone.type ?? 'sine'];
    for (const [i, f0] of tone.freqs.entries()) {
      let phase = 0;
      for (let s = Math.floor(start * RATE); s < n; s++) {
        const t = s / RATE - start;
        if (t > tone.dur + 0.02) break;
        const f =
          i === 0 && tone.glideTo
            ? f0 * Math.pow(tone.glideTo / f0, Math.min(1, t / tone.dur))
            : f0;
        phase += f / RATE;
        out[s] += volume * envelope(t, tone.dur, tone.gain ?? 1) * osc(phase);
      }
    }
  }
  return out;
}

function wav(samples) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(RATE, 24);
  buf.writeUInt32LE(RATE * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((v, i) =>
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), 44 + i * 2),
  );
  return buf;
}

fs.mkdirSync(OUT, { recursive: true });
for (const [name, spec] of Object.entries(SOUNDS)) {
  fs.writeFileSync(path.join(OUT, `${name}.wav`), wav(render(spec)));
  console.log(`assets/sounds/${name}.wav`);
}
