/**
 * Threads module service (Discord threads in Space text channels): create, list, edit and
 * delete, and the auto-archive sweep. The model, the room resolution and the fan-out are in
 * services/threads.ts; messages in a thread go through the ordinary message routes with
 * `chatId = threadId` (the parent's permissions; a send revives an archived thread).
 *
 * Permissions until they move to 64 bits (all 31 bits are in use): starting a thread is
 * SEND_MESSAGES in the channel (Discord's CREATE_PUBLIC_THREADS); MANAGE_MESSAGES stands in
 * for MANAGE_THREADS (lock, pin a forum post, edit anyone's thread, send in a locked one);
 * deleting takes MANAGE_MESSAGES or MANAGE_CHANNELS. The thread's creator may rename, archive
 * (a post: close and reopen) and change the auto-archive delay of their own thread while it is
 * not locked, and delete their own forum post.
 */
import { and, desc, eq, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import type { z } from 'zod';
import {
  PERM,
  hasAnyPerm,
  hasPerm,
  type ChatSummary,
  type ThreadsPage,
  type createThreadSchema,
  type threadsQuerySchema,
  type updateThreadSchema,
} from '@enbox/shared';
import { db, type Tx } from '../../db/index.js';
import { chats, messages, type ChatRow, type MessageRow } from '../../db/schema.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { assertUserLimit } from '../../lib/userLimit.js';
import { threadOpened } from '../../realtime/spaceRegistry.js';
import { getChatAccess, lockChat, requireActiveMember } from '../../services/chats.js';
import { transact } from '../../services/effects.js';
import { runChatDeletionHooks } from '../../services/hooks.js';
import { requireSpaceBit } from '../../services/spaceAccess.js';
import { assertSpaceVerification } from '../../services/spaceRules.js';
import { audit } from '../../services/spaces.js';
import { spaceChannelSummariesForPairs } from '../../services/spaceSummaries.js';
import { pairKey, rawRows, uuidArray } from '../../services/sql.js';
import {
  DEFAULT_THREAD_AUTO_ARCHIVE_MINUTES,
  forumInfoOf,
  fxThreadUpsert,
  resolvePostTags,
} from '../../services/threads.js';
import { autoFollowThread } from './follow.js';

export type CreateThreadBody = z.output<typeof createThreadSchema>;
export type UpdateThreadBody = z.output<typeof updateThreadSchema>;
export type ThreadsQueryOut = z.output<typeof threadsQuerySchema>;

/** Threads started per user (abuse protection; Discord has no public number). */
export const THREAD_CREATE_LIMIT = { limit: 30, windowMs: 10 * 60_000 } as const;
/** Auto-archive sweep: threads per transaction. */
export const THREAD_ARCHIVE_BATCH = 200;

/** The viewer's summary of a thread (404 when they cannot see it). */
async function threadSummaryFor(userId: string, threadId: string): Promise<ChatSummary> {
  const s = (await spaceChannelSummariesForPairs(db, [{ chatId: threadId, userId }])).get(
    pairKey(threadId, userId),
  );
  if (!s) throw notFound('Thread');
  return s;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/**
 * `POST /chats/:chatId/threads` → the thread's ChatSummary (201). A Space text channel where
 * I may send; `messageId` (a message of that channel, not a system/call/deleted one) starts
 * it from that message — one thread per message (409); I follow it. Events after commit: the
 * thread registers in the room registry, `thread:upsert` → the channel's room, the starter
 * message's `message:updated` (it now carries `thread`) and `thread:follow` → my devices. No
 * "started a thread" line: no system event kind fits yet.
 */
export async function createThread(
  me: string,
  parentId: string,
  body: CreateThreadBody,
): Promise<ChatSummary> {
  assertUserLimit(me, 'threadCreate', THREAD_CREATE_LIMIT);
  const threadId = await transact(async (tx, fx) => {
    const access = await requireActiveMember(tx, me, parentId, { lock: true });
    if (access.chat.type !== 'space_text' || !access.chat.spaceId)
      throw badRequest('Threads can only be started in text channels');
    requireSpaceBit(access, PERM.SEND_MESSAGES, 'You cannot start threads in this channel');
    await assertSpaceVerification(tx, access, me);

    let starter: MessageRow | null = null;
    if (body.messageId) {
      const [m] = await tx
        .select()
        .from(messages)
        .where(and(eq(messages.id, body.messageId), eq(messages.chatId, parentId)))
        .limit(1);
      const from = Math.max(access.window.joinedSeq, access.window.clearedSeq);
      if (!m || Number(m.seq) <= from || (m.expiresAt && m.expiresAt.getTime() <= Date.now()))
        throw notFound('Message');
      if (m.type === 'system' || m.type === 'call' || m.deletedAt)
        throw badRequest('A thread cannot be started from this message');
      // The channel row is locked: a concurrent start from the same message waits for us.
      const [taken] = await tx
        .select({ id: chats.id })
        .from(chats)
        .where(eq(chats.threadStarterId, m.id))
        .limit(1);
      if (taken) throw conflict('This message already has a thread');
      starter = m;
    }

    const [thread] = await tx
      .insert(chats)
      .values({
        type: 'space_thread',
        name: body.name,
        spaceId: access.chat.spaceId,
        parentId,
        threadStarterId: starter?.id ?? null,
        threadAutoArchiveMinutes: body.autoArchiveMinutes ?? DEFAULT_THREAD_AUTO_ARCHIVE_MINUTES,
        createdBy: me,
        // The archive clock starts now (and keyset paging needs a value).
        lastMessageAt: new Date(),
      })
      .returning();
    const spaceId = access.chat.spaceId;
    fx.add(() => threadOpened(spaceId, thread!.id, parentId));
    fxThreadUpsert(fx, thread!.id);
    if (starter) fx.messageUpdated(starter.id);
    await autoFollowThread(tx, thread!.id, me, fx);
    return thread!.id;
  });
  return threadSummaryFor(me, threadId);
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

function parseCursor(before: string | undefined): { at: string; id: string } | null {
  if (!before) return null;
  const [at, id] = before.split('|');
  const time = at ? Date.parse(at) : NaN;
  if (!id || Number.isNaN(time) || !/^[0-9a-f-]{36}$/i.test(id))
    throw badRequest('before: invalid cursor');
  return { at: new Date(time).toISOString(), id: id.toLowerCase() };
}

/**
 * `GET /chats/:chatId/threads?archived=&before=&limit=` (404 unless I can see the channel):
 * its active — or archived — threads, most recent activity first, keyset-paged on
 * (last_message_at, id). Every thread of a channel is visible to whoever sees the channel.
 */
export async function listThreads(
  me: string,
  parentId: string,
  q: ThreadsQueryOut,
): Promise<ThreadsPage> {
  const access = await getChatAccess(db, me, parentId);
  if (access.chat.type !== 'space_text') return { threads: [], nextCursor: null };
  const cursor = parseCursor(q.before);
  const rows = await db
    .select({ id: chats.id, lastMessageAt: chats.lastMessageAt, createdAt: chats.createdAt })
    .from(chats)
    .where(
      and(
        eq(chats.parentId, parentId),
        q.archived ? isNotNull(chats.threadArchivedAt) : isNull(chats.threadArchivedAt),
        cursor
          ? sql`(${chats.lastMessageAt}, ${chats.id}) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)`
          : undefined,
      ),
    )
    .orderBy(desc(chats.lastMessageAt), desc(chats.id))
    .limit(q.limit + 1);
  const page = rows.slice(0, q.limit);
  const map = await spaceChannelSummariesForPairs(
    db,
    page.map((r) => ({ chatId: r.id, userId: me })),
  );
  const threads = page
    .map((r) => map.get(pairKey(r.id, me)))
    .filter((s): s is ChatSummary => !!s);
  const last = page.at(-1);
  return {
    threads,
    nextCursor:
      rows.length > q.limit && last
        ? `${(last.lastMessageAt ?? last.createdAt).toISOString()}|${last.id}`
        : null,
  };
}

// ---------------------------------------------------------------------------
// Edit & delete
// ---------------------------------------------------------------------------

/**
 * `PATCH /threads/:threadId` → ChatSummary: rename, archive/unarchive (a post: close and
 * reopen), auto-archive delay and a forum post's tags (the creator while unlocked, or
 * MANAGE_MESSAGES; moderated tags MANAGE_MESSAGES only), lock/unlock and a forum post's pin
 * (MANAGE_MESSAGES). One pinned post per forum: pinning one unpins the other in the same
 * transaction, under the forum's row lock (taken first, like a post's creation). Events:
 * `thread:upsert` → the channel's room (both posts when the pin moves); a rename or
 * (un)archive also updates the starter message (`message:updated`); unarchiving registers the
 * thread in the room registry again.
 */
export async function updateThread(
  me: string,
  threadId: string,
  body: UpdateThreadBody,
): Promise<ChatSummary> {
  await transact(async (tx, fx) => {
    let parent: ChatRow | undefined;
    if (body.pinned !== undefined) {
      const [row] = await tx
        .select({ parentId: chats.parentId })
        .from(chats)
        .where(eq(chats.id, threadId))
        .limit(1);
      if (row?.parentId) parent = await lockChat(tx, row.parentId);
    }
    const access = await requireActiveMember(tx, me, threadId, { lock: true });
    const t = access.chat;
    if (t.type !== 'space_thread' || !t.parentId || !t.spaceId) throw notFound('Thread');
    const moderator = hasPerm(access.space!.bits, PERM.MANAGE_MESSAGES);
    if (!moderator && t.createdBy !== me)
      throw forbidden('Only the creator of the thread and moderators can edit it');
    if (!moderator && t.threadLocked) throw forbidden('This thread is locked');
    if (body.locked !== undefined && !moderator)
      throw forbidden('Only moderators can lock threads');
    if (body.pinned !== undefined && !moderator) throw forbidden('Only moderators can pin posts');
    // Tags are a forum post's: its forum (already locked above for a pin).
    if (!parent && body.appliedTags !== undefined)
      [parent] = await tx.select().from(chats).where(eq(chats.id, t.parentId)).limit(1);

    const patch: Partial<typeof chats.$inferInsert> = {};
    if (body.name !== undefined && body.name !== t.name) patch.name = body.name;
    if (
      body.autoArchiveMinutes !== undefined &&
      body.autoArchiveMinutes !== t.threadAutoArchiveMinutes
    )
      patch.threadAutoArchiveMinutes = body.autoArchiveMinutes;
    if (body.locked !== undefined && body.locked !== t.threadLocked) patch.threadLocked = body.locked;
    const revived = body.archived === false && !!t.threadArchivedAt;
    if (body.archived === true && !t.threadArchivedAt) patch.threadArchivedAt = new Date();
    if (revived) patch.threadArchivedAt = null;
    if (body.appliedTags !== undefined) {
      // Forum posts: tags of their forum (moderated ones are added or removed by moderators).
      if (parent?.type !== 'space_forum') throw badRequest('Only forum posts have tags');
      const tags = resolvePostTags(forumInfoOf(parent), body.appliedTags, {
        moderator,
        previous: t.appliedTags,
      });
      if (JSON.stringify(tags) !== JSON.stringify(t.appliedTags)) patch.appliedTags = tags;
    }
    let unpinned: string | null = null;
    if (body.pinned !== undefined && body.pinned !== t.threadPinned) {
      if (parent?.type !== 'space_forum') throw badRequest('Only forum posts can be pinned');
      if (body.pinned) {
        // chats_thread_pinned_uq: the forum's pinned post lets go first (archive clock restarts).
        const [prev] = await tx
          .update(chats)
          .set({ threadPinned: false, updatedAt: new Date() })
          .where(
            and(
              eq(chats.parentId, t.parentId),
              eq(chats.threadPinned, true),
              ne(chats.id, threadId),
            ),
          )
          .returning({ id: chats.id });
        unpinned = prev?.id ?? null;
      }
      patch.threadPinned = body.pinned;
    }
    if (Object.keys(patch).length === 0) return;

    // updated_at also restarts the archive clock of an unarchived thread (the sweep uses it).
    await tx
      .update(chats)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(chats.id, threadId));
    const { threadPinned: pinChange, ...edits } = patch;
    const entry = { spaceId: t.spaceId, actorId: me, targetType: 'channel' as const };
    if (
      Object.keys(edits).length > 0 &&
      (edits.threadLocked !== undefined || (moderator && t.createdBy !== me))
    )
      await audit(tx, {
        ...entry,
        action: 'thread.update',
        targetId: threadId,
        changes: edits as Record<string, unknown>,
      });
    if (unpinned) await audit(tx, { ...entry, action: 'thread.unpin', targetId: unpinned });
    if (pinChange !== undefined)
      await audit(tx, {
        ...entry,
        action: pinChange ? 'thread.pin' : 'thread.unpin',
        targetId: threadId,
      });
    const { spaceId, parentId } = t;
    if (revived) fx.add(() => threadOpened(spaceId, threadId, parentId));
    fxThreadUpsert(fx, unpinned ? [threadId, unpinned] : threadId);
    if (t.threadStarterId && (patch.name !== undefined || patch.threadArchivedAt !== undefined))
      fx.messageUpdated(t.threadStarterId);
  });
  return threadSummaryFor(me, threadId);
}

/** Whether `t` is a forum post `me` created (its author may delete it while it is unlocked). */
async function isOwnPost(tx: Tx, t: ChatRow, me: string): Promise<boolean> {
  if (t.createdBy !== me || !t.parentId) return false;
  const [parent] = await tx
    .select({ type: chats.type })
    .from(chats)
    .where(eq(chats.id, t.parentId))
    .limit(1);
  return parent?.type === 'space_forum';
}

/**
 * `DELETE /threads/:threadId` (MANAGE_MESSAGES or MANAGE_CHANNELS; a forum post's author while
 * it is not locked) → 204: the thread and its messages. Events: `thread:deleted { threadId,
 * parentId }` → the channel's room (clients drop the thread and the starter message's card).
 */
export async function deleteThread(me: string, threadId: string): Promise<void> {
  await transact(async (tx, fx) => {
    const access = await requireActiveMember(tx, me, threadId, { lock: true });
    const t = access.chat;
    if (t.type !== 'space_thread' || !t.parentId || !t.spaceId) throw notFound('Thread');
    if (!hasAnyPerm(access.space!.bits, PERM.MANAGE_MESSAGES | PERM.MANAGE_CHANNELS)) {
      if (!(await isOwnPost(tx, t, me))) throw forbidden('Only moderators can delete threads');
      if (t.threadLocked) throw forbidden('This post is locked');
    }
    await runChatDeletionHooks(tx, fx, [threadId]);
    await tx.delete(chats).where(eq(chats.id, threadId));
    await audit(tx, {
      spaceId: t.spaceId,
      actorId: me,
      action: 'thread.delete',
      targetType: 'channel',
      targetId: threadId,
      changes: { name: t.name },
    });
    fx.toChat(t.parentId, 'thread:deleted', { threadId, parentId: t.parentId });
  });
}

// ---------------------------------------------------------------------------
// Auto-archive (leader job, jobs/threads.ts)
// ---------------------------------------------------------------------------

/**
 * Archive the open threads idle for longer than their auto-archive delay (idle = since the
 * last message, or since they were unarchived): batches of THREAD_ARCHIVE_BATCH rows taken
 * `FOR UPDATE SKIP LOCKED` (a thread mid-send is simply taken next time), the partial index
 * `chats_thread_open_idx` bounding the scan. A pinned forum post stays open (it leads its
 * forum). Each archived thread: `thread:upsert` → its channel's room and the starter
 * message's `message:updated`. Returns how many were archived.
 */
export async function archiveIdleThreads(batch = THREAD_ARCHIVE_BATCH): Promise<number> {
  let total = 0;
  for (;;) {
    const n = await transact(async (tx, fx) => {
      const due = await rawRows<{ id: string }>(
        tx,
        sql`select id from chats
            where type = 'space_thread' and thread_archived_at is null and not thread_pinned
              and last_message_at < now() - interval '60 minutes'
              and greatest(last_message_at, updated_at)
                  + coalesce(thread_auto_archive_minutes, ${DEFAULT_THREAD_AUTO_ARCHIVE_MINUTES}) * interval '1 minute'
                  <= now()
            order by last_message_at
            limit ${batch}
            for update skip locked`,
      );
      if (due.length === 0) return 0;
      const archived = await tx
        .update(chats)
        .set({ threadArchivedAt: new Date(), updatedAt: new Date() })
        .where(sql`${chats.id} = any(${uuidArray(due.map((r) => r.id))})`)
        .returning();
      // One batched preparation for the whole batch (thread summaries and starter messages).
      fxThreadUpsert(
        fx,
        archived.map((t) => t.id),
      );
      for (const t of archived) if (t.threadStarterId) fx.messageUpdated(t.threadStarterId);
      return archived.length;
    });
    total += n;
    if (n < batch) return total;
  }
}
