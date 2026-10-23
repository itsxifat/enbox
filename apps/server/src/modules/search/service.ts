/**
 * Message search (docs/design/discord-parity.md W4-E): the header search of a Space (the
 * text channels and threads I can see) or of one DM / group (my visible window).
 *
 * - Words: every word of `q` must occur in the text or caption, case-insensitively
 *   (`ILIKE '%word%'`, LIKE wildcards escaped). Filters narrow further: author, channel,
 *   mentions, has (link / file / image / video / sound / poll; several = all of them),
 *   `after` (inclusive) / `before` (exclusive) on created_at, pinned.
 * - Never listed: deleted, expired or hidden-for-me messages, system and call messages.
 * - Space scope: VIEW_CHANNEL is computed per text channel from my roles and its overwrites
 *   (never from the lazy `chat_members` rows), threads follow their parent channel; where I
 *   do have a read row its window still applies (converted channels: joined_seq, cleared).
 * - Paging: SEARCH_PAGE_SIZE per page from `offset`; `total` counts at most SEARCH_TOTAL_CAP
 *   matches (`capped` when there are more).
 * - A fixed number of queries per call however many channels, authors and threads the page
 *   holds: access, page, count, the page's threads (when it has some), `toMessages`, users.
 */
import { and, asc, desc, eq, gte, inArray, isNull, lt, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import {
  PERM,
  RESERVED_PERMISSIONS,
  SEARCH_PAGE_SIZE,
  SEARCH_TOTAL_CAP,
  hasPerm,
  type ChatType,
  type MediaKind,
  type Message,
  type MessageSearchPage,
  type MessageSearchResult,
  type SearchHas,
  type messageSearchSchema,
} from '@enbox/shared';
import { db } from '../../db/index.js';
import {
  chatMembers,
  chatPins,
  chats,
  media,
  messageHidden,
  messages,
  type MessageRow,
} from '../../db/schema.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { getChatAccess, visibleTo } from '../../services/chats.js';
import { toMessages } from '../../services/messages.js';
import { channelBits, loadChannelOverwrites, requireSpaceMember } from '../../services/spaceAccess.js';
import { rawRows, uniq, uuidArray } from '../../services/sql.js';
import { toUserPublics } from '../../services/users.js';
import { toSearchResults } from '../chats/service.js';
import { escapeLike } from '../messages/service.js';

export type MessageSearchParams = z.output<typeof messageSearchSchema>;

/** Users sent with a page: every author, then mentioned users up to this many in all. */
const MAX_PAGE_USERS = 200;

const SOUND_KINDS: MediaKind[] = ['audio', 'voice'];

/**
 * What a channel needs to be searched: VIEW_CHANNEL, and READ_MESSAGE_HISTORY once that bit
 * is enforced (it is reserved, so no role can hold it yet).
 */
const SEARCH_BITS =
  (RESERVED_PERMISSIONS & PERM.READ_MESSAGE_HISTORY) !== 0
    ? PERM.VIEW_CHANNEL
    : PERM.VIEW_CHANNEL | PERM.READ_MESSAGE_HISTORY;

/** Whether the query looks for anything (words or at least one filter). */
export function hasCriteria(q: MessageSearchParams): boolean {
  return (
    !!q.q ||
    !!q.authorId ||
    !!q.channelId ||
    !!q.mentions ||
    q.has.length > 0 ||
    !!q.before ||
    !!q.after ||
    q.pinned !== undefined
  );
}

/** The words of `q`: split on whitespace, each once (case-insensitively). */
export function searchWords(q: string | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of (q ?? '').split(/\s+/)) {
    const key = w.toLowerCase();
    if (!w || seen.has(key)) continue;
    seen.add(key);
    out.push(w);
  }
  return out;
}

function hasCondition(h: SearchHas): SQL {
  if (h === 'link') return sql`${messages.text} ~* ${'https?://'}`;
  if (h === 'poll') return eq(messages.type, 'poll');
  const kinds: MediaKind[] = h === 'sound' ? SOUND_KINDS : [h];
  return sql`exists (select 1 from ${media} where ${media.id} = ${messages.mediaId} and ${inArray(media.kind, kinds)})`;
}

/** Conditions on `messages` shared by both scopes: what is never listed, then the filters. */
function filterConditions(query: MessageSearchParams): SQL[] {
  const conds: SQL[] = [isNull(messages.deletedAt), sql`${messages.type} not in ('system', 'call')`];
  for (const w of searchWords(query.q))
    conds.push(sql`${messages.text} ilike ${`%${escapeLike(w)}%`}`);
  if (query.authorId) conds.push(eq(messages.senderId, query.authorId));
  if (query.mentions) conds.push(sql`${messages.mentions} @> ${uuidArray([query.mentions])}`);
  for (const h of new Set(query.has)) conds.push(hasCondition(h));
  if (query.after) conds.push(gte(messages.createdAt, new Date(query.after)));
  if (query.before) conds.push(lt(messages.createdAt, new Date(query.before)));
  if (query.pinned !== undefined) {
    const pinned = sql`exists (select 1 from ${chatPins} where ${chatPins.chatId} = ${messages.chatId} and ${chatPins.messageId} = ${messages.id})`;
    conds.push(query.pinned ? pinned : sql`not ${pinned}`);
  }
  return conds;
}

function assertCriteria(query: MessageSearchParams): void {
  if (!hasCriteria(query)) throw badRequest('Type something to search for, or pick a filter');
}

/** `total` / `capped` from a count that stopped after SEARCH_TOTAL_CAP + 1 matches. */
function capped(n: number): Pick<MessageSearchPage, 'total' | 'capped'> {
  return { total: Math.min(n, SEARCH_TOTAL_CAP), capped: n > SEARCH_TOTAL_CAP };
}

/** Authors of the page, then the users they mention (bounded). */
function pageUserIds(list: readonly Message[]): string[] {
  const ids = new Set<string>();
  for (const m of list) if (m.senderId) ids.add(m.senderId);
  for (const m of list)
    for (const id of m.mentions) {
      if (ids.size >= MAX_PAGE_USERS) return [...ids];
      ids.add(id);
    }
  return [...ids];
}

const emptyPage = (): MessageSearchPage => ({ total: 0, capped: false, items: [], users: [] });

// ---------------------------------------------------------------------------
// Space scope
// ---------------------------------------------------------------------------

/**
 * `GET /spaces/:spaceId/messages/search`: 404 unless I am a member; `channelId` must be a text
 * channel I can see or a thread of one (404 otherwise, also for voice channels).
 */
export async function searchSpaceMessages(
  me: string,
  spaceId: string,
  query: MessageSearchParams,
): Promise<MessageSearchPage> {
  assertCriteria(query);
  const access = await requireSpaceMember(db, spaceId, me);
  // Text channels and forums (a forum holds no messages itself: its posts are threads).
  const channels = await db
    .select({ id: chats.id, name: chats.name, type: chats.type })
    .from(chats)
    .where(and(eq(chats.spaceId, spaceId), inArray(chats.type, ['space_text', 'space_forum'])));
  const overwrites = await loadChannelOverwrites(
    db,
    channels.map((c) => c.id),
  );
  // VIEW_CHANNEL from the computed bits, channel by channel.
  const visible = new Map(
    channels
      .filter((c) =>
        hasPerm(
          channelBits(
            access.ctx,
            me,
            access.me,
            c.type === 'space_forum' ? 'space_forum' : 'space_text',
            overwrites.get(c.id) ?? [],
            access.base,
          ),
          SEARCH_BITS,
        ),
      )
      .map((c) => [c.id, c.name]),
  );

  let scope: SQL;
  if (query.channelId) {
    if (!visible.has(query.channelId)) {
      // A thread takes its parent's permissions.
      const [thread] = await db
        .select({ type: chats.type, spaceId: chats.spaceId, parentId: chats.parentId })
        .from(chats)
        .where(eq(chats.id, query.channelId))
        .limit(1);
      if (
        thread?.type !== 'space_thread' ||
        thread.spaceId !== spaceId ||
        !thread.parentId ||
        !visible.has(thread.parentId)
      )
        throw notFound('Channel');
    }
    // in: a forum → its posts (the forum itself holds no messages).
    const forum = channels.some((c) => c.id === query.channelId && c.type === 'space_forum');
    scope = forum
      ? sql`${messages.chatId} in (select ${chats.id} from ${chats} where ${chats.parentId} = ${query.channelId}::uuid)`
      : eq(messages.chatId, query.channelId);
  } else {
    if (visible.size === 0) return emptyPage();
    const ids = uuidArray(visible.keys());
    scope = sql`${messages.chatId} in (select unnest(${ids}) union all select ${chats.id} from ${chats} where ${chats.parentId} = any(${ids}))`;
  }

  const where = and(
    scope,
    // My read row's window where I have one (no row: the whole history).
    sql`${messages.seq} > greatest(coalesce(${chatMembers.joinedSeq}, 0), coalesce(${chatMembers.clearedSeq}, 0))`,
    sql`(${messages.expiresAt} is null or ${messages.expiresAt} > now())`,
    sql`not exists (select 1 from ${messageHidden} where ${messageHidden.userId} = ${me} and ${messageHidden.messageId} = ${messages.id})`,
    ...filterConditions(query),
  )!;
  const myRow = and(eq(chatMembers.chatId, messages.chatId), eq(chatMembers.userId, me));
  const order =
    query.sort === 'oldest'
      ? [asc(messages.createdAt), asc(messages.id)]
      : [desc(messages.createdAt), desc(messages.id)];

  const rows: MessageRow[] = (
    await db
      .select({ m: messages })
      .from(messages)
      .leftJoin(chatMembers, myRow)
      .where(where)
      .orderBy(...order)
      .limit(SEARCH_PAGE_SIZE)
      .offset(query.offset)
  ).map((r) => r.m);
  const [count] = await rawRows<{ n: number }>(
    db,
    sql`select count(*)::int as n from (select 1 from ${messages} left join ${chatMembers} on ${myRow} where ${where} limit ${SEARCH_TOTAL_CAP + 1}) hits`,
  );

  // Threads among the results: their names and parent channels.
  const threadIds = uniq(rows.map((r) => r.chatId)).filter((id) => !visible.has(id));
  const threads = threadIds.length
    ? await db
        .select({ id: chats.id, name: chats.name, parentId: chats.parentId })
        .from(chats)
        .where(inArray(chats.id, threadIds))
    : [];
  const chatOf = new Map<string, MessageSearchResult['chat']>();
  for (const [id, name] of visible)
    chatOf.set(id, { id, type: 'space_text', name, avatarUrl: null, peer: null, spaceId, parentId: null, parentName: null });
  for (const t of threads)
    chatOf.set(t.id, {
      id: t.id,
      type: 'space_thread',
      name: t.name,
      avatarUrl: null,
      peer: null,
      spaceId,
      parentId: t.parentId,
      parentName: (t.parentId && visible.get(t.parentId)) ?? null,
    });

  const chatTypes = new Map<string, ChatType>([...chatOf.values()].map((c) => [c.id, c.type]));
  const list = await toMessages(db, me, rows, { chatTypes });
  const items = list
    .filter((m) => chatOf.has(m.chatId))
    .map((message) => ({ message, chat: chatOf.get(message.chatId)! }));
  const users = await toUserPublics(db, me, pageUserIds(list));
  return { ...capped(Number(count?.n ?? 0)), items, users };
}

// ---------------------------------------------------------------------------
// Chat scope
// ---------------------------------------------------------------------------

/**
 * `GET /chats/:chatId/messages/search`: a direct chat or group where I have a (non-hidden)
 * membership row, within my window (former members: up to `left_seq`; nothing cleared,
 * hidden or expired). Other chat types → 404; `channelId` other than this chat → 404.
 */
export async function searchChatMessages(
  me: string,
  chatId: string,
  query: MessageSearchParams,
): Promise<MessageSearchPage> {
  assertCriteria(query);
  const access = await getChatAccess(db, me, chatId);
  if (access.chat.type !== 'direct' && access.chat.type !== 'group') throw notFound('Chat');
  if (query.channelId && query.channelId !== chatId) throw notFound('Channel');
  const where = and(eq(messages.chatId, chatId), visibleTo(access.window), ...filterConditions(query))!;
  const rows = await db
    .select()
    .from(messages)
    .where(where)
    .orderBy(query.sort === 'oldest' ? asc(messages.seq) : desc(messages.seq))
    .limit(SEARCH_PAGE_SIZE)
    .offset(query.offset);
  const [count] = await rawRows<{ n: number }>(
    db,
    sql`select count(*)::int as n from (select 1 from ${messages} where ${where} limit ${SEARCH_TOTAL_CAP + 1}) hits`,
  );
  const items = await toSearchResults(db, me, rows);
  const users = await toUserPublics(
    db,
    me,
    pageUserIds(items.map((i) => i.message)),
  );
  return { ...capped(Number(count?.n ?? 0)), items, users };
}
