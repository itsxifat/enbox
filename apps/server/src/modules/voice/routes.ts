import { Router } from 'express';
import { idSchema } from '@enbox/shared';
import { authUserId } from '../../http/auth.js';
import { parse } from '../../lib/validate.js';
import { disconnectMember, listSpaceVoiceStates } from './service.js';

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
