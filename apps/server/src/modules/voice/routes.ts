import { Router } from 'express';
import { USER_RATE_LIMITS, idSchema, voiceMoveSchema } from '@enbox/shared';
import { authUserId } from '../../http/auth.js';
import { assertUserLimit } from '../../lib/userLimit.js';
import { parse } from '../../lib/validate.js';
import { disconnectMember, listSpaceVoiceStates, moveMember } from './service.js';

export const router = Router();

// GET /spaces/:spaceId/voice-states → VoiceState[] (the voice channels I can see)
router.get('/spaces/:spaceId/voice-states', async (req, res) => {
  const spaceId = parse(idSchema, req.params.spaceId);
  res.json(await listSpaceVoiceStates(authUserId(req), spaceId));
});

// POST /spaces/:spaceId/voice-states/:userId/disconnect → 204 (MOVE_MEMBERS)
router.post('/spaces/:spaceId/voice-states/:userId/disconnect', async (req, res) => {
  const spaceId = parse(idSchema, req.params.spaceId);
  const userId = parse(idSchema, req.params.userId);
  await disconnectMember(authUserId(req), spaceId, userId);
  res.status(204).end();
});

// POST /spaces/:spaceId/voice-states/:userId/move { channelId } → 204 (MOVE_MEMBERS + CONNECT on
// the target). voice:moved → the member's voice socket; voice:state → both channels.
router.post('/spaces/:spaceId/voice-states/:userId/move', async (req, res) => {
  const spaceId = parse(idSchema, req.params.spaceId);
  const userId = parse(idSchema, req.params.userId);
  const { channelId } = parse(voiceMoveSchema, req.body ?? {});
  const me = authUserId(req);
  assertUserLimit(me, 'voice:move', USER_RATE_LIMITS.spaceMemberUpdate);
  await moveMember(me, spaceId, userId, channelId);
  res.status(204).end();
});
