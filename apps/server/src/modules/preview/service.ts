/**
 * Space preview, "lurking" before joining (docs/design/discord-parity.md W12-C): a Space
 * listed in discovery as a fresh member with no roles would see it, for any signed-in user it
 * hasn't banned. Read-only by construction: no read rows, no membership rows and no realtime
 * rooms are created.
 *
 * - Which Spaces: listed ones (`isListed`); any other Space is 404, even to someone who holds
 *   its id.
 * - Which channels: text and announcement channels that @everyone can VIEW_CHANNEL, computed
 *   from the @everyone role and each channel's @everyone overwrite only — role and member
 *   overwrites only ever open a channel to someone in particular. Voice, Stage and forum
 *   channels, threads and age-restricted channels (a preview has no age gate) are left out.
 * - Messages: the latest PREVIEW_MESSAGE_LIMIT of one such channel, serialised viewer-neutral
 *   (deleted messages are tombstones, reaction and poll voter lists are empty in Spaces).
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  PERM,
  computeBasePermissions,
  computeChannelPermissions,
  hasPerm,
  type PermissionOverwrite,
  type SpacePreview,
  type SpacePreviewMessages,
} from '@enbox/shared';
import type { DbOrTx } from '../../db/index.js';
import {
  chats,
  messages,
  spaceBans,
  spaceCategories,
  spaceMembers,
  spaces,
  type ChatRow,
  type MediaRow,
  type SpaceRow,
} from '../../db/schema.js';
import { notFound } from '../../lib/errors.js';
import { isOnline } from '../../realtime/presence.js';
import { PUBLIC_WINDOW, visibleTo } from '../../services/chats.js';
import { loadMediaMap, staticMediaUrl } from '../../services/media.js';
import { toMessages } from '../../services/messages.js';
import {
  loadChannelOverwrites,
  loadSpacePermCtx,
  type SpacePermCtx,
} from '../../services/spaceAccess.js';
import { isListed } from '../community/service.js';

/** Messages a preview shows of a channel (the newest ones). */
export const PREVIEW_MESSAGE_LIMIT = 50;

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

/** The Space to preview: 404 unless it exists, is listed and has not banned the viewer. */
export async function previewableSpace(
  dbx: DbOrTx,
  spaceId: string,
  viewerId: string,
): Promise<SpaceRow> {
  const [row] = await dbx
    .select({ space: spaces, banned: sql<boolean>`${spaceBans.userId} is not null` })
    .from(spaces)
    .leftJoin(spaceBans, and(eq(spaceBans.spaceId, spaces.id), eq(spaceBans.userId, viewerId)))
    .where(eq(spaces.id, spaceId))
    .limit(1);
  if (!row || row.banned || !isListed(row.space)) throw notFound('Space');
  return row.space;
}

/** A channel kind a preview reads: text channels (announcement ones too), not age-restricted. */
function previewable(c: Pick<ChatRow, 'type' | 'nsfw'>): boolean {
  return c.type === 'space_text' && !c.nsfw;
}

/**
 * VIEW_CHANNEL of a fresh member (no roles, not the owner) in a text channel, per channel's
 * overwrites: the @everyone role's bits, then the channel's @everyone overwrite. Any role or
 * member overwrite is dropped before evaluating.
 */
export function everyoneReader(
  ctx: SpacePermCtx,
): (overwrites: readonly PermissionOverwrite[]) => boolean {
  const everyone = {
    everyoneRoleId: ctx.everyoneRoleId,
    memberRoleIds: [] as string[],
    viewerId: '',
  };
  const base = computeBasePermissions({ ...everyone, ownerId: ctx.ownerId, roles: ctx.roles });
  return (overwrites) => {
    const bits = computeChannelPermissions(base, {
      ...everyone,
      channelType: 'space_text',
      overwrites: overwrites.filter(
        (o) => o.targetType === 'role' && o.targetId === ctx.everyoneRoleId,
      ),
      timedOut: false,
    });
    return hasPerm(bits, PERM.VIEW_CHANNEL);
  };
}

// ---------------------------------------------------------------------------
// The preview
// ---------------------------------------------------------------------------

/**
 * The channels a fresh member reads, in sidebar order: uncategorised first, then by category
 * (position), inside by position; ties by creation.
 */
export async function previewChannels(
  dbx: DbOrTx,
  spaceId: string,
  ctx: SpacePermCtx,
): Promise<SpacePreview['channels']> {
  const rows = await dbx
    .select({
      id: chats.id,
      type: chats.type,
      name: chats.name,
      topic: chats.topic,
      categoryId: chats.categoryId,
      position: chats.position,
      isNews: chats.isNews,
      nsfw: chats.nsfw,
      createdAt: chats.createdAt,
    })
    .from(chats)
    .where(and(eq(chats.spaceId, spaceId), eq(chats.type, 'space_text')));
  const candidates = rows.filter(previewable);
  if (candidates.length === 0) return [];
  const overwrites = await loadChannelOverwrites(
    dbx,
    candidates.map((c) => c.id),
  );
  const canRead = everyoneReader(ctx);
  const readable = candidates.filter((c) => canRead(overwrites.get(c.id) ?? []));
  if (readable.length === 0) return [];

  const categories = readable.some((c) => c.categoryId)
    ? await dbx
        .select({
          id: spaceCategories.id,
          name: spaceCategories.name,
          position: spaceCategories.position,
          createdAt: spaceCategories.createdAt,
        })
        .from(spaceCategories)
        .where(eq(spaceCategories.spaceId, spaceId))
    : [];
  /** By position, then creation (then id: a stable order). */
  const inOrder = (
    a: { position: number | null; createdAt: Date; id: string },
    b: { position: number | null; createdAt: Date; id: string },
  ) =>
    (a.position ?? 0) - (b.position ?? 0) ||
    a.createdAt.getTime() - b.createdAt.getTime() ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  categories.sort(inOrder);
  const rank = new Map(categories.map((c, i) => [c.id, i]));
  const nameOf = new Map(categories.map((c) => [c.id, c.name]));
  const group = (c: { categoryId: string | null }) =>
    c.categoryId ? (rank.get(c.categoryId) ?? -1) : -1;
  readable.sort((a, b) => group(a) - group(b) || inOrder(a, b));
  return readable.map((c) => ({
    id: c.id,
    name: c.name ?? 'channel',
    topic: c.topic,
    categoryName: c.categoryId ? (nameOf.get(c.categoryId) ?? null) : null,
    isNews: c.isNews,
  }));
}

/** Members looked at for the online estimate (a bigger Space counts among its first ones). */
const ONLINE_SAMPLE = 5_000;
/** One estimate per Space is reused this long. */
const ONLINE_TTL_MS = 30_000;
const ONLINE_CACHE_MAX = 1_000;
const onlineCache = new Map<string, { at: number; n: number }>();

/**
 * Members online right now, estimated like the invite preview: a bounded sample of member ids
 * against this node's view of the cluster's presence, cached per Space for ONLINE_TTL_MS.
 */
async function onlineEstimate(dbx: DbOrTx, spaceId: string): Promise<number> {
  const now = Date.now();
  const hit = onlineCache.get(spaceId);
  if (hit && now - hit.at < ONLINE_TTL_MS) return hit.n;
  const rows = await dbx
    .select({ userId: spaceMembers.userId })
    .from(spaceMembers)
    .where(eq(spaceMembers.spaceId, spaceId))
    .limit(ONLINE_SAMPLE);
  const n = rows.filter((r) => isOnline(r.userId)).length;
  onlineCache.delete(spaceId);
  if (onlineCache.size >= ONLINE_CACHE_MAX) onlineCache.delete(onlineCache.keys().next().value!);
  onlineCache.set(spaceId, { at: now, n });
  return n;
}

/** Forget the cached online estimates (tests). */
export function resetPreviewCaches(): void {
  onlineCache.clear();
}

/** `GET /spaces/:spaceId/preview`: the Space's header, counts and readable channels. */
export async function spacePreview(
  dbx: DbOrTx,
  viewerId: string,
  spaceId: string,
): Promise<SpacePreview> {
  const space = await previewableSpace(dbx, spaceId, viewerId);
  const ctx = await loadSpacePermCtx(dbx, spaceId);
  if (!ctx) throw notFound('Space');
  const media = await loadMediaMap(dbx, [space.iconMediaId, space.bannerMediaId]);
  const url = (id: string | null, m: ReadonlyMap<string, MediaRow>) => {
    const row = id ? m.get(id) : undefined;
    return row ? staticMediaUrl(row) : null;
  };
  return {
    id: space.id,
    name: space.name,
    description: space.description,
    iconUrl: url(space.iconMediaId, media),
    bannerUrl: url(space.bannerMediaId, media),
    memberCount: space.memberCount,
    onlineCount: await onlineEstimate(dbx, spaceId),
    channels: await previewChannels(dbx, spaceId, ctx),
  };
}

/**
 * `GET /spaces/:spaceId/preview/channels/:channelId/messages`: the newest messages of a channel
 * of the preview, oldest first. 404 for any other channel (private ones, threads, other kinds,
 * other Spaces').
 */
export async function previewMessages(
  dbx: DbOrTx,
  viewerId: string,
  spaceId: string,
  channelId: string,
): Promise<SpacePreviewMessages> {
  await previewableSpace(dbx, spaceId, viewerId);
  const ctx = await loadSpacePermCtx(dbx, spaceId);
  const [chat] = await dbx
    .select({ id: chats.id, type: chats.type, nsfw: chats.nsfw })
    .from(chats)
    .where(and(eq(chats.id, channelId), eq(chats.spaceId, spaceId)))
    .limit(1);
  if (!ctx || !chat || !previewable(chat)) throw notFound('Channel');
  const overwrites = (await loadChannelOverwrites(dbx, [chat.id])).get(chat.id) ?? [];
  if (!everyoneReader(ctx)(overwrites)) throw notFound('Channel');
  const rows = await dbx
    .select()
    .from(messages)
    .where(and(eq(messages.chatId, chat.id), visibleTo(PUBLIC_WINDOW)))
    .orderBy(desc(messages.seq))
    .limit(PREVIEW_MESSAGE_LIMIT);
  rows.reverse();
  return {
    messages: await toMessages(dbx, null, rows, { chatTypes: new Map([[chat.id, chat.type]]) }),
  };
}
