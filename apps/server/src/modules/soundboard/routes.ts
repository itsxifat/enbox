import { Router } from 'express';
import {
  createSpaceSoundSchema,
  idParamSchema,
  updateSpaceSoundSchema,
  type UpdateSpaceSoundRequest,
} from '@enbox/shared';
import { authUserId } from '../../http/auth.js';
import { assertUserLimit } from '../../lib/userLimit.js';
import { parse } from '../../lib/validate.js';
import { createSound, deleteSound, listSounds, playSound, updateSound } from './service.js';

/**
 * Soundboard module — owns: /spaces/:spaceId/sounds/** (play included). Paths are relative to
 * /api (see ApiRoutes in @enbox/shared); mounted behind requireAuth. Business rules:
 * ./service.ts.
 *
 * - GET    /spaces/:spaceId/sounds                  any member → SpaceSound[] (upload order)
 * - POST   /spaces/:spaceId/sounds                  MANAGE_EMOJI → SpaceSound (201)
 * - PATCH  /spaces/:spaceId/sounds/:soundId         MANAGE_EMOJI → SpaceSound
 * - DELETE /spaces/:spaceId/sounds/:soundId         MANAGE_EMOJI → 204
 * - POST   /spaces/:spaceId/sounds/:soundId/play    a member in voice → 204 (voice:sound)
 *
 * Changes send `space:sounds` (the whole list) to the Space room.
 */
export const router = Router();

const P = {
  space: idParamSchema('spaceId'),
  sound: idParamSchema('spaceId', 'soundId'),
};

/** Uploads, edits and deletes per user (server-side abuse limit; bulk uploads fit). */
const SOUND_UPDATE_LIMIT = { limit: 300, windowMs: 60 * 60_000 };

// GET /spaces/:spaceId/sounds → SpaceSound[] (any member; 404 otherwise)
router.get('/spaces/:spaceId/sounds', async (req, res) => {
  const { spaceId } = parse(P.space, req.params);
  res.json(await listSounds(authUserId(req), spaceId));
});

// POST /spaces/:spaceId/sounds (MANAGE_EMOJI) → SpaceSound (201). space:sounds → Space room.
router.post('/spaces/:spaceId/sounds', async (req, res) => {
  const me = authUserId(req);
  const { spaceId } = parse(P.space, req.params);
  const body = parse(createSpaceSoundSchema, req.body ?? {});
  assertUserLimit(me, 'spaceSoundUpdate', SOUND_UPDATE_LIMIT);
  res.status(201).json(await createSound(me, spaceId, body));
});

// PATCH /spaces/:spaceId/sounds/:soundId (MANAGE_EMOJI) → SpaceSound: name, emoji, volume.
router.patch('/spaces/:spaceId/sounds/:soundId', async (req, res) => {
  const me = authUserId(req);
  const { spaceId, soundId } = parse(P.sound, req.params);
  // Only the fields sent change (the update schema has no defaults).
  const patch: UpdateSpaceSoundRequest = parse(updateSpaceSoundSchema, req.body ?? {});
  assertUserLimit(me, 'spaceSoundUpdate', SOUND_UPDATE_LIMIT);
  res.json(await updateSound(me, spaceId, soundId, patch));
});

// DELETE /spaces/:spaceId/sounds/:soundId (MANAGE_EMOJI) → 204. space:sounds → Space room.
router.delete('/spaces/:spaceId/sounds/:soundId', async (req, res) => {
  const me = authUserId(req);
  const { spaceId, soundId } = parse(P.sound, req.params);
  assertUserLimit(me, 'spaceSoundUpdate', SOUND_UPDATE_LIMIT);
  await deleteSound(me, spaceId, soundId);
  res.status(204).end();
});

// POST /spaces/:spaceId/sounds/:soundId/play → 204: into my voice channel (any Space), with
// SPEAK there, unmuted and undeafened, once per cooldown. voice:sound → that channel's room.
router.post('/spaces/:spaceId/sounds/:soundId/play', async (req, res) => {
  const { spaceId, soundId } = parse(P.sound, req.params);
  await playSound(authUserId(req), spaceId, soundId);
  res.status(204).end();
});
