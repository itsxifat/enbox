/**
 * Voice jobs (modules/voice/service.ts):
 * - 'voice' (leader, every 10 s and when this process becomes the leader): connections of dead
 *   processes, of people who left the Space, and of channels that are no longer voice channels.
 * - 'voice-local' (every process): connections bound to sockets of this process that are gone
 *   without a recorded disconnect.
 */
import { sweepLocalVoice, sweepVoice } from '../modules/voice/service.js';
import { registerJob } from './index.js';

registerJob({
  name: 'voice',
  intervalMs: 10_000,
  runOnStart: true,
  run: sweepVoice,
});

registerJob({
  name: 'voice-local',
  scope: 'node',
  intervalMs: 15_000,
  run: sweepLocalVoice,
});
