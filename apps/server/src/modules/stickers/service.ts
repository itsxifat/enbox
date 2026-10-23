/**
 * Stickers module service (docs/design/discord-parity.md W6-D): a Space's stickers, the picker
 * groups of `GET /me/stickers`, and the send-time rule of a sticker message.
 *
 * A sticker is a picture of a Space — PNG (APNG sniffs as PNG), WebP or GIF, at most
 * MAX_STICKER_BYTES, uploaded by whoever adds it — with a name unique in the Space ignoring
 * case (409 `conflict`), an optional related emoji (suggestions, screen readers) and a
 * description. Free: SPACE_STICKER_LIMIT per Space (400 once full). An animated one needs its
 * static poster (the `thumbnail` part), like custom emoji: renderers show it until it may
 * play, and old clients show it as the still of the image message. Mutations need
 * MANAGE_EMOJI, lock the Space row (so the cap and the name check hold), write an audit entry
 * and send the whole list as `space:stickers` to the Space room after commit.
 *
 * Any member reads the list and sends the Space's stickers anywhere: DMs, groups and every
 * Space channel — in a channel of another Space, USE_EXTERNAL_EMOJI there stands in for
 * "Use External Stickers" (403 without it). A sticker is not a file: no ATTACH_FILES. The
 * message is an `image` message whose media is the sticker's picture (old clients show it)
 * with `sticker_id` set; deleting the sticker nulls `sticker_id` and keeps the picture, so
 * old messages stay readable.
 */
import { and, asc, count, eq, inArray, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { z } from 'zod';
import {
  MAX_STICKER_BYTES,
  PERM,
  SPACE_STICKER_LIMIT,
  formatBytes,
  hasPerm,
  rooms,
  type SpaceSticker,
  type SpaceStickerGroup,
  type createSpaceStickerSchema,
  type updateSpaceStickerSchema,
} from '@enbox/shared';
import { db, type DbOrTx } from '../../db/index.js';
import { media, spaceMembers, spaceStickers, spaces, type MediaRow } from '../../db/schema.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { assertUserLimit } from '../../lib/userLimit.js';
import { emitToRooms } from '../../realtime/emit.js';
import type { ChatAccess } from '../../services/chats.js';
import { transact, type Effects } from '../../services/effects.js';
import { mediaUrl, requireOwnedMedia, staticMediaUrl } from '../../services/media.js';
import {
  lockSpace,
  requireSpaceMember,
  requireSpacePermission,
} from '../../services/spaceAccess.js';
import { audit } from '../../services/spaces.js';
import { uniq } from '../../services/sql.js';

export type SpaceStickerRow = typeof spaceStickers.$inferSelect;
export type CreateStickerBody = z.output<typeof createSpaceStickerSchema>;
export type UpdateStickerBody = z.output<typeof updateSpaceStickerSchema>;

/** Picture types a sticker may be (APNG is sniffed as image/png). */
export const STICKER_MIME_TYPES = ['image/png', 'image/webp', 'image/gif'] as const;

/** Uploads, edits and deletes per user (server-side abuse limit; filling a Space fits). */
const STICKER_UPDATE_LIMIT = { limit: 200, windowMs: 60 * 60_000 };

/** The picture facts a sticker is served with. */
interface Picture {
  storageKey: string;
  animated: boolean;
}

export function toSpaceSticker(row: SpaceStickerRow, picture: Picture): SpaceSticker {
  return {
    id: row.id,
    spaceId: row.spaceId,
    name: row.name,
    description: row.description,
    emoji: row.emoji,
    url: mediaUrl(picture.storageKey),
    animated: picture.animated,
    createdBy: row.createdBy,
  };
}

/** Blank optional text is stored as null. */
const orNull = (v: string | null | undefined): string | null => (v ? v : null);

/** A Space's stickers with their picture, oldest first. */
export async function loadSpaceStickers(dbx: DbOrTx, spaceId: string): Promise<SpaceSticker[]> {
  const rows = await dbx
    .select({ sticker: spaceStickers, storageKey: media.storageKey, animated: media.animated })
    .from(spaceStickers)
    .innerJoin(media, eq(media.id, spaceStickers.mediaId))
    .where(eq(spaceStickers.spaceId, spaceId))
    .orderBy(asc(spaceStickers.createdAt), asc(spaceStickers.id));
  return rows.map((r) => toSpaceSticker(r.sticker, r));
}

/** The list as of the end of the transaction → `space:stickers` to the Space room. */
export function fxSpaceStickersChanged(fx: Effects, spaceId: string): void {
  let stickers: SpaceSticker[] = [];
  fx.add(
    () => emitToRooms([rooms.space(spaceId)], 'space:stickers', { spaceId, stickers }),
    async (dbx) => {
      stickers = await loadSpaceStickers(dbx, spaceId);
    },
  );
}

/** 409 when another sticker of the Space has this name (ignoring case). */
async function assertNameFree(dbx: DbOrTx, spaceId: string, name: string, exceptId?: string) {
  const [dup] = await dbx
    .select({ id: spaceStickers.id })
    .from(spaceStickers)
    .where(
      and(
        eq(spaceStickers.spaceId, spaceId),
        sql`lower(${spaceStickers.name}) = lower(${name})`,
        exceptId ? ne(spaceStickers.id, exceptId) : undefined,
      ),
    )
    .limit(1);
  if (dup) throw conflict(`This Space already has a sticker named “${name}”`);
}

async function requireSticker(
  dbx: DbOrTx,
  spaceId: string,
  stickerId: string,
): Promise<SpaceStickerRow> {
  const [row] = await dbx
    .select()
    .from(spaceStickers)
    .where(and(eq(spaceStickers.id, stickerId), eq(spaceStickers.spaceId, spaceId)))
    .limit(1);
  if (!row) throw notFound('Sticker');
  return row;
}

async function pictureOf(dbx: DbOrTx, mediaId: string): Promise<Picture> {
  const [m] = await dbx
    .select({ storageKey: media.storageKey, animated: media.animated })
    .from(media)
    .where(eq(media.id, mediaId))
    .limit(1);
  return m!;
}

/**
 * The picture of a new sticker: my upload (404 for anyone else's, `requireOwnedMedia`, which
 * also locks it against the media GC until commit), then 400s that say what is wrong.
 */
async function requireStickerPicture(dbx: DbOrTx, mediaId: string, me: string): Promise<MediaRow> {
  const row = await requireOwnedMedia(dbx, mediaId, me);
  if (row.kind !== 'image' || !(STICKER_MIME_TYPES as readonly string[]).includes(row.mimeType))
    throw badRequest('Stickers must be PNG, APNG, WebP or GIF images');
  if (Number(row.size) > MAX_STICKER_BYTES)
    throw badRequest(`Stickers can be at most ${formatBytes(MAX_STICKER_BYTES)}`);
  if (row.animated && !row.thumbnailKey) throw badRequest('Animated stickers need a static poster');
  return row;
}

/** `GET /spaces/:spaceId/stickers`: any member (404 otherwise), oldest first. */
export async function listStickers(me: string, spaceId: string): Promise<SpaceSticker[]> {
  await requireSpaceMember(db, spaceId, me);
  return loadSpaceStickers(db, spaceId);
}

/** `POST /spaces/:spaceId/stickers` (MANAGE_EMOJI) → the new sticker. */
export async function createSticker(
  me: string,
  spaceId: string,
  body: CreateStickerBody,
): Promise<SpaceSticker> {
  assertUserLimit(me, 'spaceStickerUpdate', STICKER_UPDATE_LIMIT);
  return transact(async (tx, fx) => {
    await lockSpace(tx, spaceId);
    await requireSpacePermission(tx, spaceId, me, PERM.MANAGE_EMOJI);
    const [n] = await tx
      .select({ n: count() })
      .from(spaceStickers)
      .where(eq(spaceStickers.spaceId, spaceId));
    if (Number(n?.n ?? 0) >= SPACE_STICKER_LIMIT)
      throw badRequest('This Space has no sticker slots left');
    const picture = await requireStickerPicture(tx, body.mediaId, me);
    await assertNameFree(tx, spaceId, body.name);
    const [row] = await tx
      .insert(spaceStickers)
      .values({
        spaceId,
        name: body.name,
        description: orNull(body.description),
        emoji: orNull(body.emoji),
        mediaId: picture.id,
        createdBy: me,
      })
      .returning();
    await audit(tx, {
      spaceId,
      actorId: me,
      action: 'sticker.create',
      targetId: row!.id,
      changes: { name: body.name, animated: picture.animated },
    });
    fxSpaceStickersChanged(fx, spaceId);
    return toSpaceSticker(row!, picture);
  });
}

/**
 * `PATCH /spaces/:spaceId/stickers/:stickerId` (MANAGE_EMOJI): name, description, related
 * emoji (blank clears the last two). Nothing changed → the sticker as is, nothing written.
 */
export async function updateSticker(
  me: string,
  spaceId: string,
  stickerId: string,
  body: UpdateStickerBody,
): Promise<SpaceSticker> {
  assertUserLimit(me, 'spaceStickerUpdate', STICKER_UPDATE_LIMIT);
  return transact(async (tx, fx) => {
    await lockSpace(tx, spaceId);
    await requireSpacePermission(tx, spaceId, me, PERM.MANAGE_EMOJI);
    const current = await requireSticker(tx, spaceId, stickerId);
    const next = {
      name: body.name ?? current.name,
      description: body.description === undefined ? current.description : orNull(body.description),
      emoji: body.emoji === undefined ? current.emoji : orNull(body.emoji),
    };
    const changes: Record<string, [string | null, string | null]> = {};
    for (const k of ['name', 'description', 'emoji'] as const)
      if (next[k] !== current[k]) changes[k] = [current[k], next[k]];
    const picture = await pictureOf(tx, current.mediaId);
    if (Object.keys(changes).length === 0) return toSpaceSticker(current, picture);
    if (changes.name) await assertNameFree(tx, spaceId, next.name, stickerId);
    const [row] = await tx
      .update(spaceStickers)
      .set(next)
      .where(eq(spaceStickers.id, stickerId))
      .returning();
    await audit(tx, {
      spaceId,
      actorId: me,
      action: 'sticker.update',
      targetId: stickerId,
      changes,
    });
    fxSpaceStickersChanged(fx, spaceId);
    return toSpaceSticker(row!, picture);
  });
}

/**
 * `DELETE /spaces/:spaceId/stickers/:stickerId` (MANAGE_EMOJI). Its messages keep the picture
 * (`media_id`); their `sticker_id` becomes null (FK), so they read as plain images.
 */
export async function deleteSticker(me: string, spaceId: string, stickerId: string): Promise<void> {
  assertUserLimit(me, 'spaceStickerUpdate', STICKER_UPDATE_LIMIT);
  await transact(async (tx, fx) => {
    await lockSpace(tx, spaceId);
    await requireSpacePermission(tx, spaceId, me, PERM.MANAGE_EMOJI);
    const current = await requireSticker(tx, spaceId, stickerId);
    await tx.delete(spaceStickers).where(eq(spaceStickers.id, stickerId));
    await audit(tx, {
      spaceId,
      actorId: me,
      action: 'sticker.delete',
      targetId: stickerId,
      changes: { name: current.name },
    });
    fxSpaceStickersChanged(fx, spaceId);
  });
}

/**
 * `GET /me/stickers`: one group per Space of mine that has stickers, in the order I joined
 * them, stickers oldest first (two queries).
 */
export async function myStickerGroups(me: string): Promise<SpaceStickerGroup[]> {
  const rows = await db
    .select({ sticker: spaceStickers, storageKey: media.storageKey, animated: media.animated })
    .from(spaceMembers)
    .innerJoin(spaceStickers, eq(spaceStickers.spaceId, spaceMembers.spaceId))
    .innerJoin(media, eq(media.id, spaceStickers.mediaId))
    .where(eq(spaceMembers.userId, me))
    .orderBy(
      asc(spaceMembers.joinedAt),
      asc(spaceMembers.spaceId),
      asc(spaceStickers.createdAt),
      asc(spaceStickers.id),
    );
  const spaceIds = uniq(rows.map((r) => r.sticker.spaceId));
  if (spaceIds.length === 0) return [];
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
  const groups = new Map<string, SpaceStickerGroup>();
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
      stickers: [],
    });
  }
  for (const r of rows) groups.get(r.sticker.spaceId)?.stickers.push(toSpaceSticker(r.sticker, r));
  return [...groups.values()];
}

/**
 * The sticker of a `{ type: 'sticker' }` send (modules/messages): 404 unless it belongs to a
 * Space I am a member of; in a channel of another Space, 403 without USE_EXTERNAL_EMOJI there.
 * Locked FOR KEY SHARE until the message is in: a concurrent delete waits (then nulls the new
 * message's `sticker_id`), and the picture stays referenced, so the media GC never takes it.
 */
export async function resolveStickerForSend(
  dbx: DbOrTx,
  me: string,
  access: ChatAccess,
  stickerId: string,
): Promise<{ id: string; mediaId: string }> {
  const [sticker] = await dbx
    .select({
      id: spaceStickers.id,
      spaceId: spaceStickers.spaceId,
      mediaId: spaceStickers.mediaId,
    })
    .from(spaceStickers)
    .where(eq(spaceStickers.id, stickerId))
    .limit(1)
    .for('key share');
  if (!sticker) throw notFound('Sticker');
  const here = access.space;
  if (here?.ctx.spaceId === sticker.spaceId) return sticker;
  const [member] = await dbx
    .select({ userId: spaceMembers.userId })
    .from(spaceMembers)
    .where(and(eq(spaceMembers.spaceId, sticker.spaceId), eq(spaceMembers.userId, me)))
    .limit(1);
  if (!member) throw notFound('Sticker');
  if (here && !hasPerm(here.bits, PERM.USE_EXTERNAL_EMOJI))
    throw forbidden('You cannot use stickers from other Spaces in this channel');
  return sticker;
}
