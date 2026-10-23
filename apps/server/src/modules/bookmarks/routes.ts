import { Router } from 'express';
import { bookmarkSchema, bookmarksQuerySchema, idParamSchema } from '@enbox/shared';
import { authUserId } from '../../http/auth.js';
import { parse } from '../../lib/validate.js';
import { listBookmarks, removeBookmark, saveBookmark } from './service.js';

/**
 * Bookmarks and reminders. Paths are relative to /api (see ApiRoutes in @enbox/shared);
 * mounted behind requireAuth. Business rules: ./service.ts.
 *
 *   GET    /me/bookmarks                  BookmarksPage (all, or reminders)
 *   PUT    /messages/:messageId/bookmark  Bookmark: save it or change its reminder
 *   DELETE /messages/:messageId/bookmark  remove it
 */
export const router = Router();

/** Fire due reminders (leader job jobs/reminders.ts): reminder:due + a push. Returns how many. */
export { sendDueReminders } from './service.js';

const messageParams = idParamSchema('messageId');

// `before` = the previous page's `nextCursor`.
router.get('/me/bookmarks', async (req, res) => {
  const query = parse(bookmarksQuerySchema, req.query);
  res.json(await listBookmarks(authUserId(req), query));
});

router.put('/messages/:messageId/bookmark', async (req, res) => {
  const me = authUserId(req);
  const { messageId } = parse(messageParams, req.params);
  const body = parse(bookmarkSchema, req.body ?? {});
  res.json(await saveBookmark(me, messageId, body));
});

router.delete('/messages/:messageId/bookmark', async (req, res) => {
  const me = authUserId(req);
  const { messageId } = parse(messageParams, req.params);
  await removeBookmark(me, messageId);
  res.status(204).end();
});
