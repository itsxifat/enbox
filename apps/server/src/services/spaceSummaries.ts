/**
 * `ChatSummary` of space channels (docs/design/spaces-at-scale.md "Access, read state,
 * unread"). Viewers need no `chat_members` row: one is lazy read state. A fixed number of
 * queries per call, and every count is bounded:
 * - read position: the row's `last_read_seq`, else the last message before the member joined
 *   the Space among the newest SPACE_UNREAD_CAP + 1 (older history counts as read);
 * - unread and mention counts stop at SPACE_UNREAD_CAP (index range scans on (chat_id, seq),
 *   mentions through the partial `messages_mentions_idx`).
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  PERM,
  SPACE_UNREAD_CAP,
  hasPerm,
  isSpaceChatType,
  type ChatSummary,
  type Message,
  type SpaceChannelInfo,
} from '@enbox/shared';
import type { DbOrTx } from '../db/index.js';
import {
  chatMembers,
  chats,
  messages,
  spaceCategories,
  spaces,
  type ChatMemberRow,
  type ChatRow,
  type MessageRow,
} from '../db/schema.js';
import { loadMediaMap, toChatWallpaper } from './media.js';
import { toMessages } from './messages.js';
import {
  channelBits,
  loadChannelOverwrites,
  loadSpaceMembers,
  loadSpacePermCtx,
  spaceChatPermissions,
  type MemberCtx,
  type SpacePermCtx,
} from './spaceAccess.js';
import { num, pairKey, rawRows, uniq, uuidArray } from './sql.js';
import { forumInfoOf, toThreadInfo } from './threads.js';

/** Viewer-neutral `ChatSummary.space` of a channel row (forums: their tags and options). */
export function toSpaceChannelInfo(
  chat: ChatRow,
  overwrites: SpaceChannelInfo['overwrites'],
): SpaceChannelInfo {
  return {
    spaceId: chat.spaceId!,
    categoryId: chat.categoryId,
    position: chat.position ?? 0,
    topic: chat.topic,
    slowmodeSeconds: chat.slowmodeSeconds,
    nsfw: chat.nsfw,
    userLimit: chat.userLimit,
    bitrate: chat.bitrate,
    permissionsSynced: chat.permissionsSynced,
    ...(chat.type === 'space_forum' ? { forum: forumInfoOf(chat) } : {}),
    ...(chat.type === 'space_text' ? { isNews: chat.isNews } : {}),
    ...(chat.type !== 'space_thread' && chat.optIn ? { optIn: true } : {}),
    ...(chat.type === 'space_voice' || chat.type === 'space_stage'
      ? { voiceStatus: chat.voiceStatus }
      : {}),
    overwrites,
  };
}

interface PairStats {
  read_seq: number | null;
  last_id: string | null;
  unread: number;
  mentions: number;
}

/**
 * Summaries of space channels for (chat, viewer) pairs, keyed by `pairKey(chatId, userId)`.
 * Pairs whose viewer is not a member or cannot see the channel are absent.
 */
export async function spaceChannelSummariesForPairs(
  dbx: DbOrTx,
  pairs: readonly { chatId: string; userId: string }[],
): Promise<Map<string, ChatSummary>> {
  const out = new Map<string, ChatSummary>();
  if (pairs.length === 0) return out;
  const chatRows = await dbx
    .select()
    .from(chats)
    .where(inArray(chats.id, uniq(pairs.map((p) => p.chatId))));
  const chatById = new Map(chatRows.filter((c) => isSpaceChatType(c.type)).map((c) => [c.id, c]));
  const valid = pairs.filter((p) => chatById.has(p.chatId));
  if (valid.length === 0) return out;

  // Permission context per Space, members per (Space, viewer).
  const spaceIds = uniq([...chatById.values()].map((c) => c.spaceId!));
  const ctxs = new Map<string, SpacePermCtx>();
  const members = new Map<string, MemberCtx>();
  const memberCounts = new Map<string, number>();
  for (const spaceId of spaceIds) {
    const ctx = await loadSpacePermCtx(dbx, spaceId);
    if (!ctx) continue;
    ctxs.set(spaceId, ctx);
    const viewers = uniq(
      valid.filter((p) => chatById.get(p.chatId)!.spaceId === spaceId).map((p) => p.userId),
    );
    for (const [userId, m] of await loadSpaceMembers(dbx, spaceId, viewers))
      members.set(pairKey(spaceId, userId), m);
  }
  for (const r of await dbx
    .select({ id: spaces.id, n: spaces.memberCount })
    .from(spaces)
    .where(inArray(spaces.id, spaceIds)))
    memberCounts.set(r.id, r.n);

  const overwrites = await loadChannelOverwrites(dbx, [...chatById.keys()]);

  // Pairs the viewer can see, with their bits.
  const visible: { chat: ChatRow; userId: string; bits: number }[] = [];
  for (const p of valid) {
    const chat = chatById.get(p.chatId)!;
    const ctx = ctxs.get(chat.spaceId!);
    const m = members.get(pairKey(chat.spaceId!, p.userId));
    if (!ctx || !m) continue;
    const bits = channelBits(
      ctx,
      p.userId,
      m,
      chat.type as 'space_text',
      overwrites.get(chat.id) ?? [],
    );
    if (hasPerm(bits, PERM.VIEW_CHANNEL)) visible.push({ chat, userId: p.userId, bits });
  }
  if (visible.length === 0) return out;

  const pairC = uuidArray(visible.map((v) => v.chat.id));
  const pairU = uuidArray(visible.map((v) => v.userId));
  const rows = await dbx
    .select()
    .from(chatMembers)
    .where(
      and(
        inArray(chatMembers.chatId, uniq(visible.map((v) => v.chat.id))),
        inArray(chatMembers.userId, uniq(visible.map((v) => v.userId))),
      ),
    );
  const rowOf = new Map<string, ChatMemberRow>(rows.map((r) => [pairKey(r.chatId, r.userId), r]));

  const stats = await rawRows<PairStats & { chat_id: string; user_id: string }>(
    dbx,
    sql`select p.c as chat_id, p.u as user_id, rs.read_seq, lm.id as last_id, uc.n as unread, mc.n as mentions
        from unnest(${pairC}, ${pairU}) as p(c, u)
        join chats ch on ch.id = p.c
        join space_members sm on sm.space_id = ch.space_id and sm.user_id = p.u
        left join chat_members cm on cm.chat_id = p.c and cm.user_id = p.u
        cross join lateral (
          select case when cm.chat_id is not null then cm.last_read_seq else (
            select coalesce(max(t.seq) filter (where t.created_at <= sm.joined_at), min(t.seq) - 1)
            from (select m.seq, m.created_at from messages m where m.chat_id = p.c
                  order by m.seq desc limit ${SPACE_UNREAD_CAP + 1}) t
          ) end as read_seq
        ) rs
        left join lateral (
          select m.id from messages m
          where m.chat_id = p.c and m.seq > coalesce(cm.joined_seq, 0)
            and (m.expires_at is null or m.expires_at > now())
          order by m.seq desc limit 1
        ) lm on true
        cross join lateral (
          select count(*)::int as n from (
            select 1 from messages m
            where m.chat_id = p.c and m.seq > greatest(coalesce(rs.read_seq, 0), coalesce(cm.joined_seq, 0))
              and m.sender_id is distinct from p.u and m.type <> 'system'
              and (m.expires_at is null or m.expires_at > now())
            order by m.seq desc limit ${SPACE_UNREAD_CAP}
          ) x
        ) uc
        cross join lateral (
          select count(*)::int as n from (
            select 1 from messages m
            where m.chat_id = p.c and m.seq > greatest(coalesce(rs.read_seq, 0), coalesce(cm.joined_seq, 0))
              and (m.mention_everyone or m.mentions <> '{}'::uuid[] or m.mention_role_ids <> '{}'::uuid[])
              and m.sender_id is distinct from p.u and m.deleted_at is null
              and (p.u = any(m.mentions)
                   or (m.mention_everyone and not sm.suppress_everyone)
                   or (not sm.suppress_roles and m.mention_role_ids && coalesce(
                        (select array_agg(r.role_id) from space_member_roles r
                         where r.space_id = ch.space_id and r.user_id = p.u), '{}'::uuid[])))
            order by m.seq desc limit ${SPACE_UNREAD_CAP}
          ) x
        ) mc`,
  );
  const statOf = new Map(stats.map((s) => [pairKey(s.chat_id, s.user_id), s]));

  const lastIds = uniq(stats.map((s) => s.last_id).filter((x): x is string => !!x));
  const msgRows: MessageRow[] = lastIds.length
    ? await dbx.select().from(messages).where(inArray(messages.id, lastIds))
    : [];
  const serialized = await toMessages(dbx, null, msgRows, {
    chatTypes: new Map(visible.map((v) => [v.chat.id, v.chat.type])),
  });
  const messageById = new Map<string, Message>(serialized.map((m) => [m.id, m]));
  const wallpapers = await loadMediaMap(
    dbx,
    rows.map((r) => r.wallpaperMediaId),
  );

  for (const { chat, userId, bits } of visible) {
    const key = pairKey(chat.id, userId);
    const row = rowOf.get(key);
    const s = statOf.get(key);
    const m = members.get(pairKey(chat.spaceId!, userId))!;
    const lastSeq = Number(chat.lastSeq);
    const lastMessage = s?.last_id ? (messageById.get(s.last_id) ?? null) : null;
    const permissions = spaceChatPermissions(bits, chat);
    const thread = chat.type === 'space_thread';
    const wallpaper = row?.wallpaperMediaId ? wallpapers.get(row.wallpaperMediaId) : undefined;
    out.set(key, {
      id: chat.id,
      type: chat.type,
      name: chat.name,
      description: null,
      avatarUrl: null,
      peer: null,
      communityId: null,
      isAnnouncement: false,
      memberCount: memberCounts.get(chat.spaceId!) ?? 0,
      groupSettings: null,
      channelSettings: null,
      myRole: 'member',
      membership: 'active',
      permissions,
      inviteCode: null,
      disappearingSeconds: null,
      sharedTheme: chat.theme,
      lastMessage,
      lastSeq,
      lastReadSeq: Math.min(Math.max(0, num(s?.read_seq)), lastSeq),
      unreadCount: num(s?.unread),
      unreadMentionCount: num(s?.mentions),
      readWatermark: 0,
      deliveredWatermark: 0,
      isPinned: false,
      isArchived: false,
      mutedUntil: row?.mutedUntil?.toISOString() ?? null,
      markedUnread: row?.markedUnread ?? false,
      theme: row?.theme ?? null,
      wallpaper: wallpaper ? toChatWallpaper(wallpaper) : null,
      createdAt: chat.createdAt.toISOString(),
      createdBy: chat.createdBy,
      lastActivityAt: (lastMessage?.createdAt ??
        (thread
          ? (chat.lastMessageAt ?? chat.createdAt)
          : m.member.joinedAt
        ).toISOString()) as string,
      // Threads: the parent channel's overwrites (loadChannelOverwrites resolves them).
      space: toSpaceChannelInfo(chat, overwrites.get(chat.id) ?? []),
      spacePermissions: bits,
      notifyLevel: row?.notifyLevel ?? null,
      ...(thread ? { thread: toThreadInfo(chat) } : {}),
    });
  }
  return out;
}

/**
 * The channels of a Space the viewer can see, in sidebar order (category, then position),
 * with its active threads (Discord's guild sync: archived threads are fetched per channel).
 */
export async function spaceChannelSummaries(
  dbx: DbOrTx,
  viewerId: string,
  spaceId: string,
): Promise<ChatSummary[]> {
  const rows = await dbx
    .select({ id: chats.id })
    .from(chats)
    .where(
      sql`${chats.spaceId} = ${spaceId} and (${chats.parentId} is null or ${chats.threadArchivedAt} is null)`,
    );
  const map = await spaceChannelSummariesForPairs(
    dbx,
    rows.map((r) => ({ chatId: r.id, userId: viewerId })),
  );
  // Discord order: uncategorised first, then by category; inside, text before voice, then position.
  const cats = new Map(
    (
      await dbx
        .select({ id: spaceCategories.id, position: spaceCategories.position })
        .from(spaceCategories)
        .where(eq(spaceCategories.spaceId, spaceId))
    ).map((c) => [c.id, c.position]),
  );
  const key = (c: ChatSummary) => [
    c.space!.categoryId ? (cats.get(c.space!.categoryId) ?? 0) : -1,
    c.type === 'space_voice' || c.type === 'space_stage' ? 1 : 0,
    c.space!.position,
  ];
  return [...map.values()].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i]! - kb[i]!;
    return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
  });
}
