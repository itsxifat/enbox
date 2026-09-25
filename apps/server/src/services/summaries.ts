/**
 * `ChatSummary` batch serializer (viewer-specific; docs "Former members", "Watermarks",
 * "Unread and mentions", "Permissions matrix").
 *
 * One call serializes any set of (chat, viewer) pairs with a FIXED number of queries (≈ 15,
 * independent of the number of chats/viewers): member rows + chats, member counts, the two
 * smallest watermarks per chat, direct-chat peers (+ users, contacts, blocks), last visible
 * message per pair (lateral), unread/mention counts, and `toMessages` for the last messages.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { ChatInfoChanges, ChatSummary, Message, UserPublic } from '@enbox/shared';
import { db, type DbOrTx } from '../db/index.js';
import {
  chatMembers,
  chats,
  media,
  messages,
  type ChatMemberRow,
  type ChatRow,
  type MessageRow,
} from '../db/schema.js';
import { emitToChat, emitToUser } from '../realtime/emit.js';
import { computePermissions, memberVisibleSql, membershipOf, type PeerInfo } from './chats.js';
import { mediaUrl } from './media.js';
import { toMessages } from './messages.js';
import { num, pairKey, rawRows, uniq, uuidArray } from './sql.js';
import { getUserRows, settingsOf, toUserPublicsForPairs, type UserWithAvatar } from './users.js';
import { loadMarkAggregates, unreadCounts, viewerWatermarks } from './watermarks.js';

interface Entry {
  member: ChatMemberRow;
  chat: ChatRow;
  avatarKey: string | null;
}

/**
 * Summaries for (chat, user) pairs, keyed by `pairKey(chatId, userId)`. Pairs without a
 * membership row — or with a hidden row unless `includeHidden` — are absent.
 */
export async function chatSummariesForPairs(
  dbx: DbOrTx,
  pairs: { chatId: string; userId: string }[],
  opts: { includeHidden?: boolean } = {},
): Promise<Map<string, ChatSummary>> {
  if (pairs.length === 0) return new Map();
  const wanted = new Set(pairs.map((p) => pairKey(p.chatId, p.userId)));
  const rows = await dbx
    .select({ member: chatMembers, chat: chats, avatarKey: media.storageKey })
    .from(chatMembers)
    .innerJoin(chats, eq(chats.id, chatMembers.chatId))
    .leftJoin(media, eq(media.id, chats.avatarMediaId))
    .where(
      and(
        inArray(chatMembers.chatId, uniq(pairs.map((p) => p.chatId))),
        inArray(chatMembers.userId, uniq(pairs.map((p) => p.userId))),
        opts.includeHidden ? undefined : eq(chatMembers.hidden, false),
      ),
    );
  const entries = rows.filter((r) => wanted.has(pairKey(r.member.chatId, r.member.userId)));
  const list = await buildSummaries(dbx, entries);
  return new Map(list.map((s, i) => [pairKey(s.id, entries[i]!.member.userId), s]));
}

/**
 * `toChatSummaries(dbx, viewerId, chatIds?)` (docs): the viewer's chat list. Without
 * `chatIds`: every non-hidden membership (active and former, archived included), newest
 * activity first. With `chatIds`: those chats in input order (unknown/hidden omitted).
 */
export async function toChatSummaries(
  dbx: DbOrTx,
  viewerId: string,
  chatIds?: readonly string[],
  opts: { includeHidden?: boolean } = {},
): Promise<ChatSummary[]> {
  if (chatIds && chatIds.length === 0) return [];
  const rows = await dbx
    .select({ member: chatMembers, chat: chats, avatarKey: media.storageKey })
    .from(chatMembers)
    .innerJoin(chats, eq(chats.id, chatMembers.chatId))
    .leftJoin(media, eq(media.id, chats.avatarMediaId))
    .where(
      and(
        eq(chatMembers.userId, viewerId),
        chatIds ? inArray(chatMembers.chatId, [...chatIds]) : undefined,
        opts.includeHidden ? undefined : eq(chatMembers.hidden, false),
      ),
    );
  const summaries = await buildSummaries(dbx, rows);
  if (chatIds) {
    const byId = new Map(summaries.map((s) => [s.id, s]));
    return chatIds.map((id) => byId.get(id)).filter((s): s is ChatSummary => !!s);
  }
  return summaries.sort((a, b) =>
    a.lastActivityAt < b.lastActivityAt ? 1 : a.lastActivityAt > b.lastActivityAt ? -1 : 0,
  );
}

/** One chat for one viewer (null when the viewer has no non-hidden membership row). */
export async function toChatSummary(
  dbx: DbOrTx,
  viewerId: string,
  chatId: string,
  opts: { includeHidden?: boolean } = {},
): Promise<ChatSummary | null> {
  return (await toChatSummaries(dbx, viewerId, [chatId], opts))[0] ?? null;
}

async function buildSummaries(dbx: DbOrTx, entries: Entry[]): Promise<ChatSummary[]> {
  if (entries.length === 0) return [];
  const chatIds = uniq(entries.map((e) => e.chat.id));
  const channelIds = uniq(entries.filter((e) => e.chat.type === 'channel').map((e) => e.chat.id));
  const otherIds = chatIds.filter((id) => !channelIds.includes(id));
  const directIds = uniq(entries.filter((e) => e.chat.type === 'direct').map((e) => e.chat.id));
  const pairC = uuidArray(entries.map((e) => e.chat.id));
  const pairU = uuidArray(entries.map((e) => e.member.userId));

  // Member counts: from the watermark aggregate for non-channels, a count for channels.
  const aggregates = await loadMarkAggregates(dbx, otherIds);
  const channelCounts = new Map<string, number>();
  if (channelIds.length) {
    const rows = await dbx
      .select({ chatId: chatMembers.chatId, n: sql<number>`count(*)::int` })
      .from(chatMembers)
      .where(and(inArray(chatMembers.chatId, channelIds), sql`${chatMembers.leftAt} is null`))
      .groupBy(chatMembers.chatId);
    for (const r of rows) channelCounts.set(r.chatId, Number(r.n));
  }

  // Direct chats: all member rows (1–2 per chat) → peer per viewer.
  const directMembers = new Map<string, string[]>();
  if (directIds.length) {
    const rows = await dbx
      .select({ chatId: chatMembers.chatId, userId: chatMembers.userId })
      .from(chatMembers)
      .where(inArray(chatMembers.chatId, directIds));
    for (const r of rows)
      directMembers.set(r.chatId, [...(directMembers.get(r.chatId) ?? []), r.userId]);
  }
  const peerIdOf = (e: Entry) =>
    (directMembers.get(e.chat.id) ?? []).find((id) => id !== e.member.userId) ?? e.member.userId;
  const directEntries = entries.filter((e) => e.chat.type === 'direct');
  const userRows: Map<string, UserWithAvatar> = directEntries.length
    ? await getUserRows(dbx, [
        ...directEntries.map((e) => e.member.userId),
        ...directEntries.map(peerIdOf),
      ])
    : new Map();
  const peers = await toUserPublicsForPairs(
    dbx,
    directEntries.map((e) => ({ viewerId: e.member.userId, subjectId: peerIdOf(e) })),
    userRows,
  );

  // Last visible message per pair + unread counts.
  const lastRows = await rawRows<{ chat_id: string; user_id: string; id: string }>(
    dbx,
    sql`select p.c as chat_id, p.u as user_id, lm.id
        from unnest(${pairC}, ${pairU}) as p(c, u)
        join chat_members cm on cm.chat_id = p.c and cm.user_id = p.u
        cross join lateral (
          select m.id from messages m where m.chat_id = cm.chat_id and ${memberVisibleSql('m', 'cm')}
          order by m.seq desc limit 1
        ) lm`,
  );
  const lastIdOf = new Map(lastRows.map((r) => [pairKey(r.chat_id, r.user_id), r.id]));
  const lastIds = uniq(lastRows.map((r) => r.id));
  const msgRows: MessageRow[] = lastIds.length
    ? await dbx.select().from(messages).where(inArray(messages.id, lastIds))
    : [];
  const serialized = await toMessages(dbx, null, msgRows, {
    chatTypes: new Map(entries.map((e) => [e.chat.id, e.chat.type])),
  });
  const messageById = new Map<string, Message>(serialized.map((m) => [m.id, m]));
  const unread = await unreadCounts(
    dbx,
    entries.map((e) => ({ chatId: e.chat.id, userId: e.member.userId })),
  );

  return entries.map((e) => {
    const { chat, member } = e;
    const viewerId = member.userId;
    const key = pairKey(chat.id, viewerId);
    const membership = membershipOf(member);
    const active = membership === 'active';
    const lastSeq = member.leftSeq != null ? Number(member.leftSeq) : Number(chat.lastSeq);

    let peer: UserPublic | null = null;
    let peerInfo: PeerInfo | null = null;
    let readReceiptsOff = false;
    if (chat.type === 'direct') {
      const peerId = peerIdOf(e);
      peer = peers.get(pairKey(viewerId, peerId)) ?? null;
      peerInfo = {
        id: peerId,
        isBlocked: peer?.isBlocked ?? false,
        isDeleted: peer?.isDeleted ?? false,
      };
      if (peerId !== viewerId) {
        const me = userRows.get(viewerId);
        const them = userRows.get(peerId);
        readReceiptsOff =
          (!!me && !settingsOf(me).readReceipts) ||
          (!!them && !them.deletedAt && !settingsOf(them).readReceipts);
      }
    }
    const permissions = computePermissions(chat, member, peerInfo, viewerId);
    const w = viewerWatermarks(aggregates.get(chat.id), {
      chatType: chat.type,
      viewerId,
      viewerActive: active,
      lastSeq,
      readReceiptsOff,
    });
    const lastId = lastIdOf.get(key);
    const lastMessage = lastId ? (messageById.get(lastId) ?? null) : null;
    const counts = unread.get(key);
    const memberCount =
      chat.type === 'channel'
        ? (channelCounts.get(chat.id) ?? 0)
        : (aggregates.get(chat.id)?.n ?? 0);
    const lastRead = Number(member.lastReadSeq);

    const summary: ChatSummary = {
      id: chat.id,
      type: chat.type,
      name: chat.type === 'direct' ? null : chat.name,
      description: chat.type === 'direct' ? null : chat.description,
      avatarUrl: chat.type !== 'direct' && e.avatarKey ? mediaUrl(e.avatarKey) : null,
      peer,
      communityId: chat.communityId,
      isAnnouncement: chat.isAnnouncement,
      memberCount,
      groupSettings: chat.type === 'group' ? chat.groupSettings : null,
      channelSettings: chat.type === 'channel' ? chat.channelSettings : null,
      myRole: active ? member.role : 'member',
      membership,
      permissions,
      inviteCode: permissions.canInvite ? chat.inviteCode : null,
      disappearingSeconds: chat.disappearingSeconds,
      lastMessage,
      lastSeq,
      lastReadSeq: Math.min(lastRead, lastSeq),
      unreadCount: num(counts?.unread),
      unreadMentionCount: num(counts?.mentions),
      readWatermark: w.readWatermark,
      deliveredWatermark: w.deliveredWatermark,
      isPinned: member.isPinned,
      isArchived: member.isArchived,
      mutedUntil: member.mutedUntil?.toISOString() ?? null,
      markedUnread: member.markedUnread,
      createdAt: chat.createdAt.toISOString(),
      createdBy: chat.type === 'direct' ? null : chat.createdBy,
      lastActivityAt:
        lastMessage?.createdAt ??
        (active ? member.joinedAt : (member.leftAt ?? member.joinedAt)).toISOString(),
    };
    return summary;
  });
}

// ---------------------------------------------------------------------------
// Standalone publishers (post-commit only; prefer Effects inside transactions)
// ---------------------------------------------------------------------------

/** `chat:upsert` → user:<u> for each user, each with their own summary (one batched serialization). */
export async function publishChatUpsert(userIds: Iterable<string>, chatId: string): Promise<void> {
  const ids = uniq(userIds);
  const map = await chatSummariesForPairs(
    db,
    ids.map((userId) => ({ chatId, userId })),
  );
  for (const userId of ids) {
    const chat = map.get(pairKey(chatId, userId));
    if (chat) emitToUser(userId, 'chat:upsert', { chat });
  }
}

/** `chat:updated { chatId, changes }` → room (viewer-neutral metadata). */
export function publishChatUpdated(chatId: string, changes: ChatInfoChanges): void {
  emitToChat(chatId, 'chat:updated', { chatId, changes });
}
