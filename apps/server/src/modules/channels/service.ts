/**
 * Channel operations shared by the channels and invites modules (docs "Channels").
 * Followers are `chat_members` rows (role member); owner/admins post. No system messages
 * except channel_created and the info changes; member lists and `chat:members-changed` are
 * admin-only (Effects.membersChanged handles that for channels).
 */
import { and, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import type { ChannelDirectoryEntry } from '@enbox/shared';
import type { DbOrTx, Tx } from '../../db/index.js';
import { chats, media, type ChatRow } from '../../db/schema.js';
import { conflict, notFound } from '../../lib/errors.js';
import {
  getChatAccess,
  getMembership,
  type ChatAccess,
  type ChatAccessOptions,
} from '../../services/chats.js';
import type { Effects } from '../../services/effects.js';
import { runChatDeletionHooks } from '../../services/hooks.js';
import { mediaUrl } from '../../services/media.js';
import { upsertMembership } from '../../services/membership.js';

/** Guard of `/channels/:chatId/*` for followers: 404 without a row or for non-channels. */
export async function requireChannelAccess(
  dbx: DbOrTx,
  viewerId: string,
  chatId: string,
  opts: ChatAccessOptions = {},
): Promise<ChatAccess> {
  const access = await getChatAccess(dbx, viewerId, chatId, opts);
  if (access.chat.type !== 'channel' || access.membership !== 'active') throw notFound('Channel');
  return access;
}

/**
 * Follow (matrix `PUT /channels/:c/follow`): JOIN(me) (joined_seq 0 — full history — with
 * read/delivered marks at the channel's last seq, so no unread backlog); `chat:updated
 * {memberCount}` → R; `chat:members-changed` → admins. `chat` must be locked. 409 when
 * already following.
 */
export async function followChannelTx(
  tx: Tx,
  fx: Effects,
  chat: ChatRow,
  userId: string,
): Promise<void> {
  const row = await getMembership(tx, chat.id, userId);
  if (row && !row.leftAt) throw conflict('You already follow this channel');
  await upsertMembership(tx, fx, {
    kind: 'activate',
    chatId: chat.id,
    userIds: [userId],
    role: 'member',
    addedBy: null,
  });
  fx.memberCountChanged(chat.id).membersChanged(chat);
}

/**
 * Delete a channel (matrix `DELETE /channels/:c`): `chat:removed` → R; `clearChatRoom(c)`;
 * then the row is deleted (messages, members, pins cascade). Chat-deletion hooks run first
 * (a guard: channels never have calls).
 */
export async function deleteChannelTx(tx: Tx, fx: Effects, chatId: string): Promise<void> {
  await runChatDeletionHooks(tx, fx, [chatId]);
  fx.toChat(chatId, 'chat:removed', { chatId }).clearRoom(chatId);
  await tx.delete(chats).where(eq(chats.id, chatId));
}

/** `LIKE` pattern for a case-insensitive substring search (%, _ and \ escaped). */
export function containsPattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * Channel directory entries (discovery and previews). `where` narrows the channels; public
 * filtering is the caller's. Sorted by follower count (desc), then newest.
 */
export async function channelEntries(
  dbx: DbOrTx,
  viewerId: string,
  where: SQL | undefined,
  limit?: number,
): Promise<ChannelDirectoryEntry[]> {
  const followers =
    sql<number>`(select count(*) from chat_members f where f.chat_id = ${chats.id} and f.left_at is null)`.mapWith(
      Number,
    );
  const following = sql<boolean>`exists (select 1 from chat_members f where f.chat_id = ${chats.id} and f.user_id = ${viewerId} and f.left_at is null)`;
  let q = dbx
    .select({ chat: chats, avatarKey: media.storageKey, followers, following })
    .from(chats)
    .leftJoin(media, eq(media.id, chats.avatarMediaId))
    .where(and(eq(chats.type, 'channel'), where))
    .orderBy(desc(followers), desc(chats.createdAt), desc(chats.id))
    .$dynamic();
  if (limit !== undefined) q = q.limit(limit);
  const rows = await q;
  return rows.map((r) => ({
    id: r.chat.id,
    name: r.chat.name ?? '',
    description: r.chat.description,
    avatarUrl: r.avatarKey ? mediaUrl(r.avatarKey) : null,
    followerCount: Number(r.followers),
    isFollowing: r.following === true,
    isPublic: r.chat.channelSettings?.isPublic ?? false,
    createdAt: r.chat.createdAt.toISOString(),
  }));
}

/** SQL: the channel is public. */
export const isPublicChannel = sql`coalesce((${chats.channelSettings}->>'isPublic')::boolean, false)`;

/** SQL: name or description contains `q` (case-insensitive). */
export function channelMatches(q: string): SQL | undefined {
  const p = containsPattern(q);
  return or(ilike(chats.name, p), ilike(chats.description, p));
}

/** The channel directory entry of one channel (null when it doesn't exist). */
export async function channelEntry(
  dbx: DbOrTx,
  viewerId: string,
  chatId: string,
): Promise<ChannelDirectoryEntry | null> {
  const [entry] = await channelEntries(dbx, viewerId, eq(chats.id, chatId), 1);
  return entry ?? null;
}

/** Existence-safe lookup for non-followers: the channel row when it exists and is a channel, else 404. */
export async function requireChannelRow(dbx: DbOrTx, chatId: string): Promise<ChatRow> {
  const [row] = await dbx.select().from(chats).where(eq(chats.id, chatId)).limit(1);
  if (!row || row.type !== 'channel') throw notFound('Channel');
  return row;
}
