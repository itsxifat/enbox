/**
 * 'poll-close' (leader, every 30 s and when this process becomes the leader): end the polls
 * whose time ran out and post their results (modules/messages/polls.ts).
 */
import { closeExpiredPolls } from '../modules/messages/polls.js';
import { registerJob } from './index.js';

registerJob({
  name: 'poll-close',
  intervalMs: 30_000,
  runOnStart: true,
  run: async () => {
    await closeExpiredPolls();
  },
});
