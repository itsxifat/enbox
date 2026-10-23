import { Router } from 'express';
import { createForumPostSchema, forumPostsQuerySchema, idParamSchema } from '@enbox/shared';
import { authUserId } from '../../http/auth.js';
import { parse } from '../../lib/validate.js';
import { createPost, listPosts } from './service.js';

/**
 * Forums module — owns: /chats/:chatId/posts. Paths are relative to /api (see ApiRoutes in
 * @enbox/shared); mounted behind requireAuth. A post is a thread: its messages, reads and
 * edits use the chats/messages/threads routes with its id. Business rules: ./service.ts.
 */
export const router = Router();

const chatParams = idParamSchema('chatId');

router.get('/chats/:chatId/posts', async (req, res) => {
  const me = authUserId(req);
  const { chatId } = parse(chatParams, req.params);
  const query = parse(forumPostsQuerySchema, req.query);
  res.json(await listPosts(me, chatId, query));
});

// 201 = created; 200 = idempotent retry (same clientId) returning the original post.
router.post('/chats/:chatId/posts', async (req, res) => {
  const me = authUserId(req);
  const { chatId } = parse(chatParams, req.params);
  const body = parse(createForumPostSchema, req.body ?? {});
  const { post, created } = await createPost(me, chatId, body);
  res.status(created ? 201 : 200).json(post);
});
