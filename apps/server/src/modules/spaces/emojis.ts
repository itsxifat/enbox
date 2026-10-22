/**
 * Spaces module, part 3: custom emoji (services/spaceEmojis.ts). Free for every Space: up to
 * SPACE_EMOJI_LIMIT each, usable by its members everywhere.
 *
 * - GET    /spaces/:spaceId/emojis            any member → SpaceEmoji[] (upload order)
 * - POST   /spaces/:spaceId/emojis            MANAGE_EMOJI → SpaceEmoji (201)
 * - PATCH  /spaces/:spaceId/emojis/:emojiId   MANAGE_EMOJI → SpaceEmoji (rename)
 * - DELETE /spaces/:spaceId/emojis/:emojiId   MANAGE_EMOJI → 204
 * - GET    /me/emojis                         the picker: SpaceEmojiGroup[] of my Spaces
 * - GET    /emojis/:emojiId  (publicRouter)   302 to the image, `?static=1` to the still
 *
 * The image is uploaded first (`POST /media`, kind image) and must be mine: PNG, JPEG, WebP
 * or GIF, at most MAX_EMOJI_BYTES; animated ones (GIF, WebP, APNG) need their static poster
 * (the `thumbnail` part), which renderers show until hovered. Names follow
 * CUSTOM_EMOJI_NAME_REGEX and are unique per Space ignoring case (409 `conflict`); a full
 * Space answers 409 `limit_reached`. Mutations lock the Space row (so the cap and the name
 * check hold), write an audit entry and send the whole list as `space:emojis` to the Space
 * room after commit.
 *
 * `GET /emojis/:emojiId` is public: `<img src>` cannot carry the bearer token, and the image
 * itself is already public under /uploads (an unguessable key) once posted — the id is only
 * known from a message, a reaction or a picker.
 */
import { Router } from 'express';
import { and, asc, count, eq, inArray, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  MAX_EMOJI_BYTES,
  PERM,
  SPACE_EMOJI_LIMIT,
  createSpaceEmojiSchema,
  idParamSchema,
  updateSpaceEmojiSchema,
  type SpaceEmoji,
  type SpaceEmojiGroup,
} from '@enbox/shared';
import { db, type DbOrTx } from '../../db/index.js';
import { media, spaceEmojis, spaceMembers, spaces } from '../../db/schema.js';
import { authUserId } from '../../http/auth.js';
import { badRequest, conflict, limitReached, notFound } from '../../lib/errors.js';
import { assertUserLimit } from '../../lib/userLimit.js';
import { parse } from '../../lib/validate.js';
import { transact } from '../../services/effects.js';
import { mediaUrl, requireOwnedMedia, staticMediaUrl } from '../../services/media.js';
import { lockSpace, requireSpaceMember, requireSpacePermission } from '../../services/spaceAccess.js';
import {
  EMOJI_MIME_TYPES,
  fxSpaceEmojisChanged,
  loadSpaceEmojis,
  toSpaceEmoji,
  type SpaceEmojiRow,
} from '../../services/spaceEmojis.js';
import { audit } from '../../services/spaces.js';
import { uniq } from '../../services/sql.js';

export const router = Router();
/** Mounted before `requireAuth` (modules/index.ts). */
export const publicRouter = Router();

const P = {
  space: idParamSchema('spaceId'),
  emoji: idParamSchema('spaceId', 'emojiId'),
  image: idParamSchema('emojiId'),
};

/** Uploads, renames and deletes per user (server-side abuse limit; bulk uploads fit). */
const EMOJI_UPDATE_LIMIT = { limit: 300, windowMs: 60 * 60_000 };
const IMAGE_CACHE = 'public, max-age=86400';

/** 409 when another emoji of the Space has this name (ignoring case). */
async function assertNameFree(tx: DbOrTx, spaceId: string, name: string, exceptId?: string) {
  const [dup] = await tx
    .select({ id: spaceEmojis.id })
    .from(spaceEmojis)
    .where(
      and(
        eq(spaceEmojis.spaceId, spaceId),
        sql`lower(${spaceEmojis.name}) = lower(${name})`,
        exceptId ? ne(spaceEmojis.id, exceptId) : undefined,
      ),
    )
    .limit(1);
  if (dup) throw conflict(`This Space already has an emoji named :${name}:`);
}

async function requireEmoji(tx: DbOrTx, spaceId: string, emojiId: string): Promise<SpaceEmojiRow> {
  const [row] = await tx
    .select()
    .from(spaceEmojis)
    .where(and(eq(spaceEmojis.id, emojiId), eq(spaceEmojis.spaceId, spaceId)))
    .limit(1);
  if (!row) throw notFound('Emoji');
  return row;
}

async function storageKeyOf(dbx: DbOrTx, mediaId: string): Promise<string> {
  const [m] = await dbx
    .select({ key: media.storageKey })
    .from(media)
    .where(eq(media.id, mediaId))
    .limit(1);
  return m!.key;
}

// GET /spaces/:spaceId/emojis → SpaceEmoji[] (any member)
router.get('/spaces/:spaceId/emojis', async (req, res) => {
  const me = authUserId(req);
  const { spaceId } = parse(P.space, req.params);
  await requireSpaceMember(db, spaceId, me);
  res.json(await loadSpaceEmojis(db, spaceId));
});

// POST /spaces/:spaceId/emojis (MANAGE_EMOJI) → SpaceEmoji (201). space:emojis → Space room.
router.post('/spaces/:spaceId/emojis', async (req, res) => {
  const me = authUserId(req);
  const { spaceId } = parse(P.space, req.params);
  const body = parse(createSpaceEmojiSchema, req.body ?? {});
  assertUserLimit(me, 'spaceEmojiUpdate', EMOJI_UPDATE_LIMIT);
  const out = await transact(async (tx, fx) => {
    await lockSpace(tx, spaceId);
    await requireSpacePermission(tx, spaceId, me, PERM.MANAGE_EMOJI);
    const [n] = await tx
      .select({ n: count() })
      .from(spaceEmojis)
      .where(eq(spaceEmojis.spaceId, spaceId));
    if (Number(n?.n ?? 0) >= SPACE_EMOJI_LIMIT)
      throw limitReached(`A Space can have at most ${SPACE_EMOJI_LIMIT} emoji`);
    const image = await requireOwnedMedia(tx, body.mediaId, me, {
      kinds: ['image'],
      mimeTypes: EMOJI_MIME_TYPES,
      maxBytes: MAX_EMOJI_BYTES,
    });
    if (image.animated && !image.thumbnailKey)
      throw badRequest('Animated emoji need a static poster');
    await assertNameFree(tx, spaceId, body.name);
    const [row] = await tx
      .insert(spaceEmojis)
      .values({
        spaceId,
        name: body.name,
        mediaId: image.id,
        animated: image.animated,
        createdBy: me,
      })
      .returning();
    await audit(tx, {
      spaceId,
      actorId: me,
      action: 'emoji.create',
      targetId: row!.id,
      changes: { name: body.name, animated: image.animated },
    });
    fxSpaceEmojisChanged(fx, spaceId);
    return toSpaceEmoji(row!, image.storageKey);
  });
  res.status(201).json(out);
});

// PATCH /spaces/:spaceId/emojis/:emojiId (MANAGE_EMOJI) → SpaceEmoji: rename.
router.patch('/spaces/:spaceId/emojis/:emojiId', async (req, res) => {
  const me = authUserId(req);
  const { spaceId, emojiId } = parse(P.emoji, req.params);
  const body = parse(updateSpaceEmojiSchema, req.body ?? {});
  assertUserLimit(me, 'spaceEmojiUpdate', EMOJI_UPDATE_LIMIT);
  const out = await transact(async (tx, fx) => {
    await lockSpace(tx, spaceId);
    await requireSpacePermission(tx, spaceId, me, PERM.MANAGE_EMOJI);
    const current = await requireEmoji(tx, spaceId, emojiId);
    if (current.name === body.name) return toSpaceEmoji(current, await storageKeyOf(tx, current.mediaId));
    await assertNameFree(tx, spaceId, body.name, emojiId);
    const [row] = await tx
      .update(spaceEmojis)
      .set({ name: body.name })
      .where(eq(spaceEmojis.id, emojiId))
      .returning();
    await audit(tx, {
      spaceId,
      actorId: me,
      action: 'emoji.update',
      targetId: emojiId,
      changes: { name: [current.name, body.name] },
    });
    fxSpaceEmojisChanged(fx, spaceId);
    return toSpaceEmoji(row!, await storageKeyOf(tx, row!.mediaId));
  });
  res.json(out);
});

// DELETE /spaces/:spaceId/emojis/:emojiId (MANAGE_EMOJI) → 204. Messages keep the token (it
// renders as :name: once the image is gone); the image is collected by the media GC.
router.delete('/spaces/:spaceId/emojis/:emojiId', async (req, res) => {
  const me = authUserId(req);
  const { spaceId, emojiId } = parse(P.emoji, req.params);
  assertUserLimit(me, 'spaceEmojiUpdate', EMOJI_UPDATE_LIMIT);
  await transact(async (tx, fx) => {
    await lockSpace(tx, spaceId);
    await requireSpacePermission(tx, spaceId, me, PERM.MANAGE_EMOJI);
    const current = await requireEmoji(tx, spaceId, emojiId);
    await tx.delete(spaceEmojis).where(eq(spaceEmojis.id, emojiId));
    await audit(tx, {
      spaceId,
      actorId: me,
      action: 'emoji.delete',
      targetId: emojiId,
      changes: { name: current.name },
    });
    fxSpaceEmojisChanged(fx, spaceId);
  });
  res.status(204).end();
});

// GET /me/emojis → SpaceEmojiGroup[]: every Space I am in that has emoji, in the order I
// joined them (two queries).
router.get('/me/emojis', async (req, res) => {
  const me = authUserId(req);
  const rows = await db
    .select({ emoji: spaceEmojis, storageKey: media.storageKey })
    .from(spaceMembers)
    .innerJoin(spaceEmojis, eq(spaceEmojis.spaceId, spaceMembers.spaceId))
    .innerJoin(media, eq(media.id, spaceEmojis.mediaId))
    .where(eq(spaceMembers.userId, me))
    .orderBy(
      asc(spaceMembers.joinedAt),
      asc(spaceMembers.spaceId),
      asc(spaceEmojis.createdAt),
      asc(spaceEmojis.id),
    );
  const spaceIds = uniq(rows.map((r) => r.emoji.spaceId));
  if (spaceIds.length === 0) {
    res.json([]);
    return;
  }
  const icon = alias(media, 'icon');
  const heads = await db
    .select({
      id: spaces.id,
      name: spaces.name,
      storageKey: icon.storageKey,
      thumbnailKey: icon.thumbnailKey,
      animated: icon.animated,
    })
    .from(spaces)
    .leftJoin(icon, eq(icon.id, spaces.iconMediaId))
    .where(inArray(spaces.id, spaceIds));
  const byId = new Map(heads.map((h) => [h.id, h]));
  const groups = new Map<string, SpaceEmojiGroup>();
  for (const id of spaceIds) {
    const h = byId.get(id);
    if (!h) continue;
    groups.set(id, {
      spaceId: id,
      spaceName: h.name,
      iconUrl: h.storageKey
        ? staticMediaUrl({
            storageKey: h.storageKey,
            thumbnailKey: h.thumbnailKey,
            animated: h.animated ?? false,
          })
        : null,
      emojis: [] as SpaceEmoji[],
    });
  }
  for (const r of rows) groups.get(r.emoji.spaceId)?.emojis.push(toSpaceEmoji(r.emoji, r.storageKey));
  res.json([...groups.values()]);
});

// GET /emojis/:emojiId → 302 to the image (`?static=1`: the poster of an animated emoji).
// Cacheable for a day; 404 for unknown (or deleted) emoji.
publicRouter.get('/emojis/:emojiId', async (req, res) => {
  const { emojiId } = parse(P.image, req.params);
  const [row] = await db
    .select({ storageKey: media.storageKey, thumbnailKey: media.thumbnailKey })
    .from(spaceEmojis)
    .innerJoin(media, eq(media.id, spaceEmojis.mediaId))
    .where(eq(spaceEmojis.id, emojiId))
    .limit(1);
  if (!row) throw notFound('Emoji');
  const still = req.query.static === '1' || req.query.static === 'true';
  res.set('Cache-Control', IMAGE_CACHE);
  res.redirect(302, mediaUrl(still && row.thumbnailKey ? row.thumbnailKey : row.storageKey));
});
