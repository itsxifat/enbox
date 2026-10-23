/**
 * The voice activity gate of a manual input sensitivity (Settings → Voice & Video): the mic
 * opens the moment my level reaches the threshold and closes only after it stayed more than
 * GATE_HYSTERESIS_DB under it for GATE_HOLD_MS. The gap keeps a level hovering at the
 * threshold from fluttering; the hold keeps the quiet ends of words.
 *
 *   let gate = GATE_CLOSED;
 *   gate = stepGate(gate, levelDb, thresholdDb, performance.now());   // on every level report
 */
export const GATE_HYSTERESIS_DB = 6;
export const GATE_HOLD_MS = 400;

export interface GateState {
  open: boolean;
  /** Open, but under the closing line since this time (ms); null while the voice is there. */
  quietSince: number | null;
}

export const GATE_CLOSED: GateState = { open: false, quietSince: null };
const OPEN: GateState = { open: true, quietSince: null };

/** The gate after one level report. Returns `state` itself when nothing changed. */
export function stepGate(
  state: GateState,
  levelDb: number,
  thresholdDb: number,
  now: number,
  opts: { hysteresisDb?: number; holdMs?: number } = {},
): GateState {
  const closeBelow = thresholdDb - (opts.hysteresisDb ?? GATE_HYSTERESIS_DB);
  if (levelDb >= thresholdDb) return state.open && state.quietSince === null ? state : OPEN;
  // Closed: only the threshold opens it.
  if (!state.open) return state;
  // Open and still above the closing line: the voice is there.
  if (levelDb >= closeBelow) return state.quietSince === null ? state : OPEN;
  if (state.quietSince === null) return { open: true, quietSince: now };
  return now - state.quietSince >= (opts.holdMs ?? GATE_HOLD_MS) ? GATE_CLOSED : state;
}
