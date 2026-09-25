/**
 * Calls job (docs "Jobs"): the first run (process boot, `runOnStart`) is crash recovery —
 * calls left ringing/ongoing by a previous process are closed and their chat messages
 * updated. Later runs (every 5 s) are a safety net for the in-memory ring-timeout and
 * reconnect-grace timers (modules/calls/state.ts): overdue rings → missed, expired
 * reconnect windows → left, then the end rules.
 */
import { recoverCalls, sweepCalls } from '../modules/calls/service.js';
import { registerJob } from './index.js';

let recovered = false;

registerJob({
  name: 'calls',
  intervalMs: 5_000,
  runOnStart: true,
  run: async () => {
    if (!recovered) {
      recovered = true;
      await recoverCalls();
      return;
    }
    await sweepCalls();
  },
});
