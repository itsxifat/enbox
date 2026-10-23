/**
 * Input levels in dBFS (RMS; LEVEL_FLOOR_DB is silence), as the level meter reports them, and
 * the live level of my voice channel microphone (`useVoiceInputLevel`: set by the voice engine
 * while my mic runs through its processor, read by the sensitivity meter in Settings).
 */
import { create } from 'zustand';

export const LEVEL_FLOOR_DB = -100;

/** The dBFS of an RMS amplitude (0..1), floored at LEVEL_FLOOR_DB. */
export function rmsToDb(rms: number): number {
  return rms > 0 ? Math.max(LEVEL_FLOOR_DB, 20 * Math.log10(rms)) : LEVEL_FLOOR_DB;
}

/** Where a level sits on a meter running from LEVEL_FLOOR_DB to 0 dB: 0..100. */
export function levelPercent(db: number): number {
  return Math.min(100, Math.max(0, ((db - LEVEL_FLOOR_DB) / -LEVEL_FLOOR_DB) * 100));
}

/** My voice channel mic's level (null while it does not run through the processor). */
export const useVoiceInputLevel = create<{ db: number | null }>(() => ({ db: null }));
