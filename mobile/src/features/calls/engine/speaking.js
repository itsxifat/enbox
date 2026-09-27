/**
 * Voice activity for the active-speaker highlight: one WebAudio AnalyserNode per audio
 * track, polled a few times per second. Pure logic (`SpeakingTracker`) is separate from the
 * WebAudio plumbing (`AudioLevelMonitor`) so it can be unit-tested.
 */

/** RMS level (0..1) above which a participant counts as speaking. */
export const SPEAKING_THRESHOLD = 0.018;
/** Keep "speaking" this long after the level drops (avoids flicker between words). */
export const SPEAKING_HOLD_MS = 700;
/** The active speaker changes at most this often. */
export const ACTIVE_SPEAKER_MIN_MS = 1_500;

/** Turns raw levels into a debounced speaking set + active speaker. */
export class SpeakingTracker {
  lastLoud = new Map();
  levels = new Map();
  active = null;
  activeSince = 0;

  threshold;
  holdMs;
  minActiveMs;

  constructor(
    threshold = SPEAKING_THRESHOLD,
    holdMs = SPEAKING_HOLD_MS,
    minActiveMs = ACTIVE_SPEAKER_MIN_MS,
  ) {
    this.threshold = threshold;
    this.holdMs = holdMs;
    this.minActiveMs = minActiveMs;
  }

  /** Feed one sample per id; returns the resulting snapshot. `excludeFromActive` = my own id. */
  update(samples, now, excludeFromActive) {
    for (const [id, level] of samples) {
      this.levels.set(id, level);
      if (level >= this.threshold) this.lastLoud.set(id, now);
    }
    for (const id of [...this.lastLoud.keys()]) if (!samples.has(id)) this.forget(id);

    const speaking = [...this.lastLoud.entries()]
      .filter(([, at]) => now - at <= this.holdMs)
      .map(([id]) => id)
      .sort();

    const candidates = speaking.filter((id) => id !== excludeFromActive);
    const loudest = candidates.reduce(
      (best, id) =>
        best === null || (this.levels.get(id) ?? 0) > (this.levels.get(best) ?? 0) ? id : best,
      null,
    );
    if (loudest && loudest !== this.active) {
      const activeStillTalking = this.active !== null && candidates.includes(this.active);
      if (!activeStillTalking || now - this.activeSince >= this.minActiveMs) {
        this.active = loudest;
        this.activeSince = now;
      }
    }
    return { speaking, activeSpeakerId: this.active };
  }

  forget(id) {
    this.lastLoud.delete(id);
    this.levels.delete(id);
    if (this.active === id) this.active = null;
  }
}

/** Polls audio levels of the registered tracks and reports speaking changes. */
export class AudioLevelMonitor {
  ctx = null;
  probes = new Map();
  timer = null;
  tracker = new SpeakingTracker();
  last = '';

  onChange;
  selfId;
  intervalMs;

  constructor(onChange, selfId, intervalMs = 150) {
    this.onChange = onChange;
    this.selfId = selfId;
    this.intervalMs = intervalMs;
  }

  context() {
    if (this.ctx) return this.ctx;
    const Ctor =
      typeof window === 'undefined'
        ? undefined
        : (window.AudioContext ?? window.webkitAudioContext);
    if (!Ctor) return null;
    try {
      this.ctx = new Ctor();
    } catch {
      return null;
    }
    return this.ctx;
  }

  add(id, track) {
    const current = this.probes.get(id);
    if (current?.track === track) return;
    this.remove(id);
    if (!track || track.kind !== 'audio') return;
    const ctx = this.context();
    if (!ctx) return;
    try {
      if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
      const source = ctx.createMediaStreamSource(new MediaStream([track]));
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.3;
      source.connect(analyser);
      this.probes.set(id, {
        source,
        analyser,
        buffer: new Float32Array(analyser.fftSize),
        track,
      });
    } catch {
      return;
    }
    if (!this.timer) this.timer = setInterval(() => this.poll(), this.intervalMs);
  }

  remove(id) {
    const p = this.probes.get(id);
    if (!p) return;
    try {
      p.source.disconnect();
    } catch {
      /* ignore */
    }
    this.probes.delete(id);
    this.tracker.forget(id);
  }

  stop() {
    for (const id of [...this.probes.keys()]) this.remove(id);
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }

  poll() {
    if (this.ctx?.state === 'suspended') void this.ctx.resume().catch(() => undefined);
    const samples = new Map();
    for (const [id, p] of this.probes) {
      if (p.track.readyState === 'ended' || !p.track.enabled) {
        samples.set(id, 0);
        continue;
      }
      p.analyser.getFloatTimeDomainData(p.buffer);
      let sum = 0;
      for (let i = 0; i < p.buffer.length; i++) sum += p.buffer[i] * p.buffer[i];
      samples.set(id, Math.sqrt(sum / p.buffer.length));
    }
    const snap = this.tracker.update(samples, Date.now(), this.selfId);
    const key = `${snap.speaking.join(',')}|${snap.activeSpeakerId ?? ''}`;
    if (key !== this.last) {
      this.last = key;
      this.onChange(snap);
    }
  }
}
