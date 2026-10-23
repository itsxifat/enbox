/**
 * The manual-sensitivity gate: opens at the threshold, stays open within the hysteresis gap,
 * closes only after the hold under the closing line, and a closed gate ignores levels in the
 * gap.
 */
import { describe, expect, it } from 'vitest';
import { GATE_CLOSED, GATE_HOLD_MS, GATE_HYSTERESIS_DB, stepGate, type GateState } from './gate';

const T = -50;

/** Feed levels 20 ms apart from `start`; the states after each. */
function run(levels: number[], start: GateState = GATE_CLOSED, from = 0): GateState[] {
  const out: GateState[] = [];
  let s = start;
  levels.forEach((db, i) => {
    s = stepGate(s, db, T, from + i * 20);
    out.push(s);
  });
  return out;
}

describe('stepGate', () => {
  it('opens as soon as the level reaches the threshold', () => {
    expect(stepGate(GATE_CLOSED, T - 1, T, 0).open).toBe(false);
    expect(stepGate(GATE_CLOSED, T, T, 0)).toEqual({ open: true, quietSince: null });
    expect(stepGate(GATE_CLOSED, -10, T, 0).open).toBe(true);
  });

  it('closed, a level inside the gap does not open it (no flutter at the threshold)', () => {
    const states = run([T - 1, T - GATE_HYSTERESIS_DB + 1, T - 0.5]);
    expect(states.every((s) => !s.open)).toBe(true);
  });

  it('open, a level inside the gap keeps it open however long it lasts', () => {
    const open = stepGate(GATE_CLOSED, T, T, 0);
    const states = run(Array(100).fill(T - GATE_HYSTERESIS_DB + 1), open);
    expect(states.every((s) => s.open && s.quietSince === null)).toBe(true);
  });

  it('closes after staying under the closing line for the hold time', () => {
    const open = stepGate(GATE_CLOSED, T, T, 0);
    const quiet = T - GATE_HYSTERESIS_DB - 1;
    let s = stepGate(open, quiet, T, 1000);
    expect(s).toEqual({ open: true, quietSince: 1000 });
    s = stepGate(s, quiet, T, 1000 + GATE_HOLD_MS - 1);
    expect(s.open).toBe(true);
    s = stepGate(s, quiet, T, 1000 + GATE_HOLD_MS);
    expect(s).toBe(GATE_CLOSED);
  });

  it('a word coming back during the hold keeps it open and restarts the hold', () => {
    const open = stepGate(GATE_CLOSED, T, T, 0);
    const quiet = T - 20;
    let s = stepGate(open, quiet, T, 0);
    s = stepGate(s, T - 2, T, GATE_HOLD_MS - 50);
    expect(s).toEqual({ open: true, quietSince: null });
    s = stepGate(s, quiet, T, GATE_HOLD_MS);
    s = stepGate(s, quiet, T, GATE_HOLD_MS + GATE_HOLD_MS - 1);
    expect(s.open).toBe(true);
  });

  it('returns the same state when nothing changes; options override the gap and the hold', () => {
    const open = stepGate(GATE_CLOSED, T, T, 0);
    expect(stepGate(open, T + 5, T, 10)).toBe(open);
    expect(stepGate(GATE_CLOSED, -90, T, 10)).toBe(GATE_CLOSED);
    const s = stepGate(open, T - 3, T, 0, { hysteresisDb: 2, holdMs: 0 });
    expect(s).toEqual({ open: true, quietSince: 0 });
    expect(stepGate(s, T - 3, T, 0, { hysteresisDb: 2, holdMs: 0 })).toBe(GATE_CLOSED);
  });
});
