/**
 * Custom Space emoji (docs/design/discord-parity.md W6-B): rows → wire, the per-Space list
 * and its `space:emojis` fan-out, and the send-time rule for emoji of other Spaces.
 *
 * Tokens are `<:name:id>` / `<a:name:id>` (shared social.ts). Any member reads a Space's
 * emoji; every Space I am in lends me its emoji everywhere (free). In a Space channel,
 * emoji of other Spaces need USE_EXTERNAL_EMOJI there (implicit for every member unless a
 * channel overwrite denies it, permissions.ts): without it they are sent as `:name:` text
 * rather than refused — the message still goes out, like a Discord client that cannot use
 * an emoji. Unknown ids (deleted emoji, typed tokens) count as external.
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import {
  CUSTOM_EMOJI_TOKEN_RE,
  PERM,
  hasPerm,
  rooms,
  type SpaceEmoji,
} from '@enbox/shared';
import type { DbOrTx } from '../db/index.js';
import { media, spaceEmojis } from '../db/schema.js';
import { emitToRooms } from '../realtime/emit.js';
import type { ChatAccess } from './chats.js';
import type { Effects } from './effects.js';
import { mediaUrl } from './media.js';
import { uniq } from './sql.js';

export type SpaceEmojiRow = typeof spaceEmojis.$inferSelect;

/** A fresh copy of the shared global token regex (its `lastIndex` is never shared state). */
const tokenRe = () => new RegExp(CUSTOM_EMOJI_TOKEN_RE.source, 'g');

/** Image types an emoji may be (the `image` upload kind allows exactly these). */
export const EMOJI_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;

export function toSpaceEmoji(row: SpaceEmojiRow, storageKey: string): SpaceEmoji {
  return {
    id: row.id,
    spaceId: row.spaceId,
    name: row.name,
    url: mediaUrl(storageKey),
    animated: row.animated,
    createdBy: row.createdBy,
  };
}

/** Emoji with their image key, in upload order (one query for any number of Spaces). */
export async function loadEmojiRows(
  dbx: DbOrTx,
  spaceIds: readonly string[],
): Promise<{ emoji: SpaceEmojiRow; storageKey: string }[]> {
  if (spaceIds.length === 0) return [];
  return dbx
    .select({ emoji: spaceEmojis, storageKey: media.storageKey })
    .from(spaceEmojis)
    .innerJoin(media, eq(media.id, spaceEmojis.mediaId))
    .where(inArray(spaceEmojis.spaceId, [...spaceIds]))
    .orderBy(asc(spaceEmojis.createdAt), asc(spaceEmojis.id));
}

/** A Space's emoji, in upload order. */
export async function loadSpaceEmojis(dbx: DbOrTx, spaceId: string): Promise<SpaceEmoji[]> {
  return (await loadEmojiRows(dbx, [spaceId])).map((r) => toSpaceEmoji(r.emoji, r.storageKey));
}

/** The list as of the end of the transaction → `space:emojis` to the Space room. */
export function fxSpaceEmojisChanged(fx: Effects, spaceId: string): void {
  let emojis: SpaceEmoji[] = [];
  fx.add(
    () => emitToRooms([rooms.space(spaceId)], 'space:emojis', { spaceId, emojis }),
    async (dbx) => {
      emojis = await loadSpaceEmojis(dbx, spaceId);
    },
  );
}

/**
 * The text to store for a send or edit in a Space channel: tokens of other Spaces' emoji
 * become `:name:` unless the sender has USE_EXTERNAL_EMOJI in the channel. Tokens of the
 * channel's own Space always stay. Elsewhere (DMs, groups) the text is returned as is. At
 * most one indexed query, and none without the bit missing and a token present.
 */
export async function gateExternalEmoji(
  dbx: DbOrTx,
  access: ChatAccess,
  text: string,
): Promise<string> {
  const s = access.space;
  if (!s || hasPerm(s.bits, PERM.USE_EXTERNAL_EMOJI) || !text.includes('<')) return text;
  const ids = uniq(Array.from(text.matchAll(tokenRe()), (m) => m[3]!));
  if (ids.length === 0) return text;
  const local = new Set(
    (
      await dbx
        .select({ id: spaceEmojis.id })
        .from(spaceEmojis)
        .where(and(eq(spaceEmojis.spaceId, s.ctx.spaceId), inArray(spaceEmojis.id, ids)))
    ).map((r) => r.id),
  );
  if (local.size === ids.length) return text;
  return text.replace(tokenRe(), (token, _a: string, name: string, id: string) =>
    local.has(id) ? token : `:${name}:`,
  );
}
