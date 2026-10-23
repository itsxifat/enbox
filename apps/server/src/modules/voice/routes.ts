import { Router } from 'express';
import {
  USER_RATE_LIMITS,
  idSchema,
  stageRequestSchema,
  stageSpeakerSchema,
  voiceMoveSchema,
  voiceStatusSchema,
} from '@enbox/shared';
import { authUserId } from '../../http/auth.js';
import { assertUserLimit } from '../../lib/userLimit.js';
import { parse } from '../../lib/validate.js';
import {
  disconnectMember,
  listSpaceVoiceStates,
  moveMember,
  setStageRequest,
  setStageSpeaker,
} from './service.js';
import { VOICE_STATUS_RATE, setVoiceStatus } from './status.js';

export const router = Router();

// PUT /chats/:chatId/voice-status { status } → 204: the channel status of the voice or Stage
// channel I am connected to (SPEAK there); blank or null clears it. chat:updated { space } → R.
router.put('/chats/:chatId/voice-status', async (req, res) => {
  const chatId = parse(idSchema, req.params.chatId);
  const { status } = parse(voiceStatusSchema, req.body ?? {});
  const me = authUserId(req);
  assertUserLimit(me, 'voice:status', VOICE_STATUS_RATE);
  await setVoiceStatus(me, chatId, status);
  res.status(204).end();
});

// GET /spaces/:spaceId/voice-states → VoiceState[] (the voice channels I can see)
router.get('/spaces/:spaceId/voice-states', async (req, res) => {
  const spaceId = parse(idSchema, req.params.spaceId);
  res.json(await listSpaceVoiceStates(authUserId(req), spaceId));
});

// PATCH /spaces/:spaceId/voice-states/@me { requestToSpeak } → VoiceState: raise or lower my
// hand in my Stage channel there (400 when I am not in one). voice:state → the channel.
router.patch('/spaces/:spaceId/voice-states/@me', async (req, res) => {
  const spaceId = parse(idSchema, req.params.spaceId);
  const { requestToSpeak } = parse(stageRequestSchema, req.body ?? {});
  const me = authUserId(req);
  assertUserLimit(me, 'voice:stage-request', USER_RATE_LIMITS.voiceUpdate);
  res.json(await setStageRequest(me, spaceId, requestToSpeak));
});

// PATCH /spaces/:spaceId/voice-states/:userId/stage { suppressed } → VoiceState: Stage
// moderators invite people up and move speakers to the audience; anyone steps down, a
// moderator steps up. voice:state → the channel; the media grants follow live.
router.patch('/spaces/:spaceId/voice-states/:userId/stage', async (req, res) => {
  const spaceId = parse(idSchema, req.params.spaceId);
  const userId = parse(idSchema, req.params.userId);
  const { suppressed } = parse(stageSpeakerSchema, req.body ?? {});
  const me = authUserId(req);
  assertUserLimit(me, 'voice:stage', USER_RATE_LIMITS.spaceMemberUpdate);
  res.json(await setStageSpeaker(me, spaceId, userId, suppressed));
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
