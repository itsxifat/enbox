/**
 * Calls job (docs "Jobs"): the first successful run (process boot, `runOnStart`; retried
 * every run until it succeeds) is crash recovery — calls left ringing/ongoing by a previous
 * process are closed and their chat messages updated. Later runs (every 5 s) are a safety
 * net for the in-memory ring-timeout and reconnect-grace timers (modules/calls/state.ts):
 * overdue rings → missed, expired reconnect windows → left, joined participants whose call
 * socket is gone without a recorded disconnect → reconnect grace; then the end rules.
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
      // The flag flips only on success: a failed recovery (e.g. the database was not ready
      // at boot) is retried on the next run instead of leaving stale calls live forever.
      await recoverCalls();
      recovered = true;
      return;
    }
    await sweepCalls();
  },
});
