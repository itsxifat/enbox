import { Router } from 'express';
import { createSpaceStickerSchema, idParamSchema, updateSpaceStickerSchema } from '@enbox/shared';
import { authUserId } from '../../http/auth.js';
import { parse } from '../../lib/validate.js';
import {
  createSticker,
  deleteSticker,
  listStickers,
  myStickerGroups,
  updateSticker,
} from './service.js';

/**
 * Stickers module — owns: /spaces/:spaceId/stickers/**, /me/stickers. Paths are relative to
 * /api (see ApiRoutes in @enbox/shared); mounted behind requireAuth. Business rules:
 * ./service.ts.
 *
 * - GET    /spaces/:spaceId/stickers              any member → SpaceSticker[] (oldest first)
 * - POST   /spaces/:spaceId/stickers              MANAGE_EMOJI → SpaceSticker (201)
 * - PATCH  /spaces/:spaceId/stickers/:stickerId   MANAGE_EMOJI → SpaceSticker (name, description, emoji)
 * - DELETE /spaces/:spaceId/stickers/:stickerId   MANAGE_EMOJI → 204
 * - GET    /me/stickers                           the picker: SpaceStickerGroup[] of my Spaces
 *
 * Every change sends `space:stickers` (the whole list) to the Space room. Sending one is
 * `POST /chats/:chatId/messages` `{ type: 'sticker', stickerId }` (modules/messages).
 */
export const router = Router();

const P = {
  space: idParamSchema('spaceId'),
  sticker: idParamSchema('spaceId', 'stickerId'),
};

router.get('/spaces/:spaceId/stickers', async (req, res) => {
  const { spaceId } = parse(P.space, req.params);
  res.json(await listStickers(authUserId(req), spaceId));
});

router.post('/spaces/:spaceId/stickers', async (req, res) => {
  const me = authUserId(req);
  const { spaceId } = parse(P.space, req.params);
  const body = parse(createSpaceStickerSchema, req.body ?? {});
  res.status(201).json(await createSticker(me, spaceId, body));
});

router.patch('/spaces/:spaceId/stickers/:stickerId', async (req, res) => {
  const me = authUserId(req);
  const { spaceId, stickerId } = parse(P.sticker, req.params);
  const body = parse(updateSpaceStickerSchema, req.body ?? {});
  res.json(await updateSticker(me, spaceId, stickerId, body));
});

router.delete('/spaces/:spaceId/stickers/:stickerId', async (req, res) => {
  const me = authUserId(req);
  const { spaceId, stickerId } = parse(P.sticker, req.params);
  await deleteSticker(me, spaceId, stickerId);
  res.status(204).end();
});

router.get('/me/stickers', async (req, res) => {
  res.json(await myStickerGroups(authUserId(req)));
});
