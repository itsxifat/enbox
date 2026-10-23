import { Router } from 'express';

/**
 * Bookmarks and reminders (everyday wave, agent 6). Paths are relative to /api (see ApiRoutes
 * in @enbox/shared); mounted behind requireAuth.
 *
 *   GET    /me/bookmarks                  BookmarksPage (all, or reminders)
 *   PUT    /messages/:messageId/bookmark  Bookmark: save it or change its reminder
 *   DELETE /messages/:messageId/bookmark  remove it
 */
export const router = Router();

/** Fire due reminders (leader job jobs/reminders.ts): reminder:due + a push. Returns how many. */
export async function sendDueReminders(): Promise<number> {
  return 0;
}
