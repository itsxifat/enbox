/**
 * Threads of Space text channels (Discord model; docs/design/discord-parity.md W10).
 *
 * A thread is a `chats` row of type `space_thread` under its parent text channel
 * (`parent_id`): seq, history, sends and the lazy read state work exactly like a Space
 * channel's. Access is the parent's (spaceAccess.ts `loadChannelOverwrites` resolves a thread
 * to its parent's overwrites) and its virtual room resolves to the parent's audience
 * (spaceRegistry.ts), so `message:new` & co. of a thread reach whoever can see the channel.
 *
 * This file holds what the serializer, the send transaction and the REST module share; the
 * routes and the archive job are in modules/threads. Fan-out: `thread:upsert` carries a
 * viewer-NEUTRAL summary (no read state, no permissions: clients recompute them from the
 * Space and the parent channel) and goes to the parent channel's room, the same audience as
 * the thread's. Creation, rename, archive, lock and revival emit at once; message count
 * changes are throttled (THREAD_UPSERT_THROTTLE_MS per thread and process).
 *
 * Forum posts are threads of a `space_forum` channel (modules/forums): the same rows, rooms
 * and events; the post's first message lives inside the thread (no starter message), and
 * `applied_tags` holds the forum tags it wears (`resolvePostTags`).
 */
import { eq, sql } from 'drizzle-orm';
import {
  DEFAULT_FORUM_SETTINGS,
  spaceChannelPermissions,
  type ChatSummary,
  type ChatType,
  type ForumInfo,
  type MessageThreadRef,
  type PermissionOverwrite,
  type SpaceChannelInfo,
  type ThreadInfo,
} from '@enbox/shared';
import { db, type DbOrTx } from '../db/index.js';
import { chats, spaces, type ChatRow, type MessageRow } from '../db/schema.js';
import { badRequest, forbidden } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { emitToChat } from '../realtime/emit.js';
import { threadOpened } from '../realtime/spaceRegistry.js';
import type { Effects } from './effects.js';
import { loadChannelOverwrites } from './spaceAccess.js';
import { uniq, uuidArray } from './sql.js';

/** Discord's default: archive after 3 days without messages. */
export const DEFAULT_THREAD_AUTO_ARCHIVE_MINUTES = 4320;
/** At most one count-only `thread:upsert` per thread in this window (per process). */
export const THREAD_UPSERT_THROTTLE_MS = 5_000;

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/**
 * `ChatSummary.thread` of a thread row (forum posts: the tags they wear, the pin), viewer-neutral:
 * `following` is the viewer's (spaceSummaries.ts adds it).
 */
export function toThreadInfo(row: ChatRow): ThreadInfo {
  return {
    parentId: row.parentId!,
    starterMessageId: row.threadStarterId,
    ownerId: row.createdBy,
    archived: !!row.threadArchivedAt,
    locked: row.threadLocked,
    autoArchiveMinutes: row.threadAutoArchiveMinutes ?? DEFAULT_THREAD_AUTO_ARCHIVE_MINUTES,
    messageCount: row.threadMessageCount,
    appliedTags: row.appliedTags ?? [],
    pinned: row.threadPinned,
  };
}

// ---------------------------------------------------------------------------
// Forum posts
// ---------------------------------------------------------------------------

/** `SpaceChannelInfo.forum` of a forum row: its tags, and its settings over the defaults. */
export function forumInfoOf(row: Pick<ChatRow, 'forumTags' | 'forumSettings'>): ForumInfo {
  return {
    tags: row.forumTags ?? [],
    settings: { ...DEFAULT_FORUM_SETTINGS, ...(row.forumSettings ?? {}) },
  };
}

/**
 * The tags a post may wear, for its creation or an edit by its author or a moderator (Discord
 * rules): tags of its forum only (400), duplicates dropped; a forum with `requireTag` needs one
 * (400); without MANAGE_MESSAGES no moderated tag may be added or removed (403, `previous` =
 * the post's tags before the edit). Returned in the forum's tag order.
 */
export function resolvePostTags(
  forum: ForumInfo,
  wanted: readonly string[],
  opts: { moderator: boolean; previous?: readonly string[] },
): string[] {
  const known = new Set(forum.tags.map((t) => t.id));
  const picked = new Set(wanted);
  for (const id of picked) if (!known.has(id)) throw badRequest('appliedTags: unknown tag');
  if (forum.settings.requireTag && picked.size === 0)
    throw badRequest('This forum requires at least one tag');
  if (!opts.moderator) {
    const before = new Set(opts.previous ?? []);
    for (const t of forum.tags)
      if (t.moderated && picked.has(t.id) !== before.has(t.id))
        throw forbidden(`Only moderators can add or remove the tag ${t.name}`);
  }
  return forum.tags.filter((t) => picked.has(t.id)).map((t) => t.id);
}

type RefRow = Pick<
  ChatRow,
  'id' | 'name' | 'threadMessageCount' | 'lastMessageAt' | 'threadArchivedAt'
>;

/** `Message.thread` of a starter message. */
export function toThreadRef(row: RefRow): MessageThreadRef {
  return {
    id: row.id,
    name: row.name ?? 'Thread',
    messageCount: row.threadMessageCount,
    lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
    archived: !!row.threadArchivedAt,
  };
}

/**
 * The threads started from these messages (`Message.thread`), keyed by message id: one
 * lookup on the unique starter index, only for messages of Space text channels.
 */
export async function loadThreadRefs(
  dbx: DbOrTx,
  rows: readonly Pick<MessageRow, 'id' | 'chatId'>[],
  chatTypes: ReadonlyMap<string, ChatType>,
): Promise<Map<string, MessageThreadRef>> {
  const out = new Map<string, MessageThreadRef>();
  const ids = uniq(rows.filter((r) => chatTypes.get(r.chatId) === 'space_text').map((r) => r.id));
  if (ids.length === 0) return out;
  const threads = await dbx
    .select({
      starterId: chats.threadStarterId,
      id: chats.id,
      name: chats.name,
      threadMessageCount: chats.threadMessageCount,
      lastMessageAt: chats.lastMessageAt,
      threadArchivedAt: chats.threadArchivedAt,
    })
    .from(chats)
    .where(sql`${chats.threadStarterId} = any(${uuidArray(ids)})`);
  for (const t of threads) if (t.starterId) out.set(t.starterId, toThreadRef(t));
  return out;
}

/** The viewer-neutral `ChatSummary.space` of a thread (its parent's overwrites). */
function threadSpaceInfo(row: ChatRow, overwrites: PermissionOverwrite[]): SpaceChannelInfo {
  return {
    spaceId: row.spaceId!,
    categoryId: null,
    position: 0,
    topic: null,
    slowmodeSeconds: row.slowmodeSeconds,
    nsfw: row.nsfw,
    userLimit: null,
    bitrate: null,
    permissionsSynced: true,
    overwrites,
  };
}

/**
 * Viewer-neutral summaries of threads (room broadcasts): read as of their last message,
 * no preview, permissions empty (`spacePermissions: 0`) — clients recompute them.
 */
export async function neutralThreadSummaries(
  dbx: DbOrTx,
  rows: readonly ChatRow[],
): Promise<ChatSummary[]> {
  const threads = rows.filter((r) => r.type === 'space_thread' && r.parentId && r.spaceId);
  if (threads.length === 0) return [];
  const overwrites = await loadChannelOverwrites(
    dbx,
    threads.map((t) => t.id),
  );
  const counts = new Map(
    (
      await dbx
        .select({ id: spaces.id, n: spaces.memberCount })
        .from(spaces)
        .where(sql`${spaces.id} = any(${uuidArray(uniq(threads.map((t) => t.spaceId!)))})`)
    ).map((r) => [r.id, r.n]),
  );
  return threads.map((t) => {
    const lastSeq = Number(t.lastSeq);
    return {
      id: t.id,
      type: t.type,
      name: t.name,
      description: null,
      avatarUrl: null,
      peer: null,
      communityId: null,
      isAnnouncement: false,
      memberCount: counts.get(t.spaceId!) ?? 0,
      groupSettings: null,
      channelSettings: null,
      myRole: 'member',
      membership: 'active',
      permissions: spaceChannelPermissions(0, 'space_text'),
      inviteCode: null,
      disappearingSeconds: null,
      sharedTheme: t.theme,
      lastMessage: null,
      lastSeq,
      lastReadSeq: lastSeq,
      unreadCount: 0,
      unreadMentionCount: 0,
      readWatermark: 0,
      deliveredWatermark: 0,
      isPinned: false,
      isArchived: false,
      mutedUntil: null,
      markedUnread: false,
      theme: null,
      wallpaper: null,
      createdAt: t.createdAt.toISOString(),
      createdBy: t.createdBy,
      lastActivityAt: (t.lastMessageAt ?? t.createdAt).toISOString(),
      space: threadSpaceInfo(t, overwrites.get(t.id) ?? []),
      spacePermissions: 0,
      notifyLevel: null,
      thread: toThreadInfo(t),
    } satisfies ChatSummary;
  });
}

// ---------------------------------------------------------------------------
// Fan-out
// ---------------------------------------------------------------------------

const lastUpsertAt = new Map<string, number>();
const trailing = new Map<string, NodeJS.Timeout>();

function noteUpsert(threadId: string): void {
  lastUpsertAt.set(threadId, Date.now());
  if (lastUpsertAt.size > 10_000) {
    const old = Date.now() - THREAD_UPSERT_THROTTLE_MS;
    for (const [id, at] of lastUpsertAt) if (at < old && !trailing.has(id)) lastUpsertAt.delete(id);
  }
}

/**
 * `thread:upsert` → each thread's parent channel room, with the threads as of the end of the
 * transaction (prepared inside it in three queries however many, emitted after commit).
 */
export function fxThreadUpsert(fx: Effects, threadIds: string | readonly string[]): void {
  const ids = uniq(typeof threadIds === 'string' ? [threadIds] : threadIds);
  let threads: ChatSummary[] = [];
  fx.add(
    () => {
      for (const thread of threads) {
        if (!thread.thread) continue;
        noteUpsert(thread.id);
        emitToChat(thread.thread.parentId, 'thread:upsert', { thread });
      }
    },
    async (dbx) => {
      if (ids.length === 0) return;
      const rows = await dbx
        .select()
        .from(chats)
        .where(sql`${chats.id} = any(${uuidArray(ids)})`);
      threads = await neutralThreadSummaries(dbx, rows);
    },
  );
}

/** Post-commit `thread:upsert` with the committed row (the throttled count updates). */
async function publishThreadUpsert(threadId: string): Promise<void> {
  noteUpsert(threadId);
  const [row] = await db.select().from(chats).where(eq(chats.id, threadId)).limit(1);
  if (!row?.parentId) return;
  const [thread] = await neutralThreadSummaries(db, [row]);
  if (thread) emitToChat(row.parentId, 'thread:upsert', { thread });
}

/**
 * A message landed in the thread (after commit): `thread:upsert` now when none went out in
 * the last THREAD_UPSERT_THROTTLE_MS, else once at the end of that window. Busy threads cost
 * the parent's room one event per window, not one per message.
 */
export function threadActivity(threadId: string): void {
  if (trailing.has(threadId)) return;
  const run = () => {
    trailing.delete(threadId);
    void publishThreadUpsert(threadId).catch((err: unknown) =>
      logger.error({ err, threadId }, 'thread:upsert failed'),
    );
  };
  const wait = (lastUpsertAt.get(threadId) ?? 0) + THREAD_UPSERT_THROTTLE_MS - Date.now();
  if (wait <= 0) run();
  else trailing.set(threadId, setTimeout(run, wait).unref());
}

/**
 * The send transaction's thread step, registered BEFORE the message's `message:new`. A send
 * that revived an archived thread — or opened a new one (a forum post's first message) —
 * registers it in the room registry, announces it at once (`thread:upsert`, and the starter
 * message's new `thread` state); any other send counts towards the throttled `thread:upsert`.
 */
export function threadMessageFx(fx: Effects, thread: ChatRow, revived: boolean): void {
  if (!thread.parentId || !thread.spaceId) return;
  if (!revived) {
    fx.add(() => threadActivity(thread.id));
    return;
  }
  const { spaceId, parentId } = thread;
  fx.add(() => threadOpened(spaceId, thread.id, parentId));
  fxThreadUpsert(fx, thread.id);
  if (thread.threadStarterId) fx.messageUpdated(thread.threadStarterId);
}

/** Forget throttle state (tests). */
export function resetThreadFanout(): void {
  for (const t of trailing.values()) clearTimeout(t);
  trailing.clear();
  lastUpsertAt.clear();
}
