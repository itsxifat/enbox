/**
 * My voice channel microphone through Web Audio, as a LiveKit track processor (LiveKit sends
 * its output instead of the mic; device switches and restarts hand it the new mic, nothing is
 * captured twice):
 *
 *   mic → [voice isolation: RNNoise] → level meter → gate → sent
 *
 * - Voice isolation turns on and off live (`setIsolation`).
 * - The meter feeds the voice activity gate and the sensitivity meter in Settings (`onLevel`).
 * - The gate is a gain the engine opens while push to talk is held or my voice is loud enough
 *   (`setGateOpen`). Closed, it sends silence without telling the media server: nobody sees a
 *   mute flicker and the first word is not lost waiting for an unmute to arrive. My own mute
 *   stays LiveKit's (it silences the mic before it reaches this graph).
 *
 * The graph runs in its own 48 kHz context (RNNoise needs that rate). A context that starts
 * suspended (no user gesture yet) sends nothing: `suspended` says so and `resume()` (from a
 * click or key press) starts it.
 */
import type { AudioProcessorOptions, Track, TrackProcessor } from 'livekit-client';
import type { RnnoiseWorkletNode } from '@sapphi-red/web-noise-suppressor';
import { createLevelMeter, type LevelMeter } from './input/meter';
import { RNNOISE_SAMPLE_RATE, createRnnoiseNode } from './rnnoise';

export interface VoiceInputOptions {
  /** Start with voice isolation on. */
  isolation: boolean;
  /** Start with the gate open. */
  open: boolean;
  /** My level (dBFS) about every 20 ms. */
  onLevel?: (db: number) => void;
}

/** Opening is quick (no clipped word), closing a little softer (no click). */
const OPEN_TIME_CONSTANT = 0.004;
const CLOSE_TIME_CONSTANT = 0.03;

export class VoiceInputProcessor implements TrackProcessor<
  Track.Kind.Audio,
  AudioProcessorOptions
> {
  readonly name = 'enbox-voice-input';
  processedTrack?: MediaStreamTrack;

  private ctx: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private rnnoise: RnnoiseWorkletNode | null = null;
  private meter: LevelMeter | null = null;
  private gate: GainNode | null = null;
  private isolation: boolean;
  /** The graph could not run at RNNoise's rate: no voice isolation in it. */
  private isolationBlocked = false;
  private open: boolean;
  private readonly onLevel?: (db: number) => void;

  constructor(opts: VoiceInputOptions) {
    this.isolation = opts.isolation;
    this.open = opts.open;
    this.onLevel = opts.onLevel;
  }

  /** The graph's context waits for a user gesture: nothing is sent until `resume()`. */
  get suspended(): boolean {
    return this.ctx?.state === 'suspended';
  }

  async init({ track }: AudioProcessorOptions): Promise<void> {
    try {
      await this.build(track, RNNOISE_SAMPLE_RATE);
    } catch (err) {
      // Firefox cannot take a microphone into a context of another rate: the default rate
      // then, without voice isolation.
      console.warn('Voice processing runs without voice isolation', err);
      await this.destroy();
      this.isolation = false;
      this.isolationBlocked = true;
      try {
        await this.build(track);
      } catch (e) {
        await this.destroy();
        throw e;
      }
    }
    await this.resume();
  }

  async restart({ track }: AudioProcessorOptions): Promise<void> {
    try {
      this.connectSource(track);
    } catch (err) {
      console.warn('The new microphone did not reach voice processing', err);
    }
  }

  /** mic → (RNNoise) → meter → gate → out, at `sampleRate` (default: the device's rate). */
  private async build(track: MediaStreamTrack, sampleRate?: number): Promise<void> {
    const ctx = new AudioContext(sampleRate ? { latencyHint: 'interactive', sampleRate } : {});
    this.ctx = ctx;
    this.meter = await createLevelMeter(ctx, (db) => this.onLevel?.(db));
    this.gate = ctx.createGain();
    this.gate.gain.value = this.open ? 1 : 0;
    const out = ctx.createMediaStreamDestination();
    this.meter.node.connect(this.gate).connect(out);
    this.processedTrack = out.stream.getAudioTracks()[0];
    if (this.isolation) {
      try {
        await this.loadIsolation();
      } catch (err) {
        console.warn('Voice isolation is unavailable; using the plain microphone', err);
        this.isolation = false;
      }
    }
    this.connectSource(track);
  }

  async destroy(): Promise<void> {
    const ctx = this.ctx;
    this.ctx = null;
    this.source?.disconnect();
    this.source = null;
    this.rnnoise?.destroy();
    this.rnnoise = null;
    this.meter?.stop();
    this.meter = null;
    this.gate = null;
    this.processedTrack?.stop();
    if (ctx && ctx.state !== 'closed') await ctx.close().catch(() => undefined);
  }

  /** Start a suspended graph (call from a user gesture where possible). */
  async resume(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'suspended') return;
    // resume() may wait for a gesture forever: give it a moment, then go on suspended.
    const moment = new Promise((r) => setTimeout(r, 300));
    await Promise.race([ctx.resume().catch(() => undefined), moment]);
  }

  /** Voice isolation on or off, live. Off when RNNoise cannot run (the plain mic goes on). */
  async setIsolation(on: boolean): Promise<void> {
    if (on && this.isolationBlocked) return;
    if (this.isolation === on && (!on || this.rnnoise)) return;
    this.isolation = on;
    if (on) {
      try {
        await this.loadIsolation();
      } catch (err) {
        console.warn('Voice isolation is unavailable; using the plain microphone', err);
        this.isolation = false;
      }
    }
    this.wire();
  }

  setGateOpen(open: boolean): void {
    if (this.open === open) return;
    this.open = open;
    const ctx = this.ctx;
    if (!ctx || !this.gate) return;
    const gain = this.gate.gain;
    const now = ctx.currentTime;
    // Drop the ramp in flight (where the browser can hold its value; elsewhere the new ramp
    // simply takes over from where it is).
    gain.cancelAndHoldAtTime?.(now);
    gain.setTargetAtTime(open ? 1 : 0, now, open ? OPEN_TIME_CONSTANT : CLOSE_TIME_CONSTANT);
  }

  private async loadIsolation(): Promise<void> {
    const ctx = this.ctx;
    if (this.rnnoise || !ctx) return;
    const node = await createRnnoiseNode(ctx);
    // Destroyed meanwhile.
    if (this.ctx !== ctx) {
      node.destroy();
      return;
    }
    this.rnnoise = node;
  }

  private connectSource(track: MediaStreamTrack): void {
    if (!this.ctx) return;
    this.source?.disconnect();
    this.source = this.ctx.createMediaStreamSource(new MediaStream([track]));
    this.wire();
  }

  /** mic → (RNNoise) → meter. */
  private wire(): void {
    const { source, rnnoise, meter } = this;
    if (!source || !meter) return;
    source.disconnect();
    rnnoise?.disconnect();
    if (this.isolation && rnnoise) source.connect(rnnoise).connect(meter.node);
    else source.connect(meter.node);
  }
}
