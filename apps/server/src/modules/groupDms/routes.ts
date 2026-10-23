import { Router } from 'express';
import { addGroupDmMembersSchema, createGroupDmSchema, idParamSchema } from '@enbox/shared';
import { authUserId } from '../../http/auth.js';
import { parse } from '../../lib/validate.js';
import { addGroupDmMembers, createGroupDm, removeGroupDmMember } from './service.js';

/**
 * Group DMs module — owns: /chats/group-dm, /chats/:chatId/group-dm/members/**. Paths are relative to /api (see ApiRoutes in @enbox/shared); mounted behind
 * requireAuth. Business rules: ./service.ts.
 *
 *   POST   /chats/group-dm                          { userIds, name? } → ChatSummary: a new
 *                                                   group DM (201), or one friend → our DM (200)
 *   POST   /chats/:chatId/group-dm/members          { userIds } → ChatSummary
 *   DELETE /chats/:chatId/group-dm/members/:userId  the owner removes; me = leave silently
 */
export const router = Router();

const chatParams = idParamSchema('chatId');
const memberParams = idParamSchema('chatId', 'userId');

router.post('/chats/group-dm', async (req, res) => {
  const body = parse(createGroupDmSchema, req.body ?? {});
  const { chat, created } = await createGroupDm(authUserId(req), body);
  res.status(created ? 201 : 200).json(chat);
});

router.post('/chats/:chatId/group-dm/members', async (req, res) => {
  const { chatId } = parse(chatParams, req.params);
  const { userIds } = parse(addGroupDmMembersSchema, req.body ?? {});
  res.json(await addGroupDmMembers(authUserId(req), chatId, userIds));
});

router.delete('/chats/:chatId/group-dm/members/:userId', async (req, res) => {
  const { chatId, userId } = parse(memberParams, req.params);
  await removeGroupDmMember(authUserId(req), chatId, userId);
  res.status(204).end();
});
