/**
 * 'reminders' (leader, every 30 s and when this process becomes the leader): send the
 * reminders that are due (modules/bookmarks/routes.ts).
 */
import { sendDueReminders } from '../modules/bookmarks/routes.js';
import { registerJob } from './index.js';

registerJob({
  name: 'reminders',
  intervalMs: 30_000,
  runOnStart: true,
  run: async () => {
    await sendDueReminders();
  },
});
