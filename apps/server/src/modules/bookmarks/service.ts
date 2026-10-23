/**
 * Bookmarks and reminders (docs/design/discord-parity.md W5-D, everyday.ts): messages I saved,
 * each optionally with a time to remind me ("Remind Me").
 *
 * - Saving needs a message I can see, as `GET /messages/:messageId` decides (my membership
 *   window, hidden rows, expiry, then the chat itself: no row deleted for me, computed
 *   VIEW_CHANNEL in Spaces); system and deleted messages cannot be saved (400). At most
 *   MAX_BOOKMARKS (409 limit_reached; a per-user advisory lock makes the cap hold). Saving
 *   again keeps the bookmark's place in my list; a `remindAt` (a future time, or null)
 *   replaces the reminder and clears `remindedAt`, so a new time fires again.
 * - Lists are keyset-paged: `all` newest first by (created_at, message_id); `reminders` the
 *   upcoming ones by (remind_at, message_id), then the done ones, last fired first. Messages
 *   are hydrated for me (`toMessages`), null once deleted or no longer visible to me; the
 *   users they reference are side-loaded.
 * - The reminder job (`sendDueReminders`, leader only) takes due rows FOR UPDATE SKIP LOCKED in
 *   batches and sets `reminded_at` in the same transaction, so each reminder fires once; then
 *   `reminder:due` reaches the user's devices and, after commit, the push
 *   (push/reminderNotifications.ts).
 * - Events go to my devices only: `bookmark:changed`, `bookmark:removed`, `reminder:due`.
 * - Deleting my account drops my bookmarks.
 */
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import {
  MAX_BOOKMARKS,
  PERM,
  hasPerm,
  isSpaceChatType,
  referencedUserIds,
  type Bookmark,
  type BookmarkRequest,
  type BookmarksPage,
  type Message,
  type SpaceChannelType,
  type bookmarksQuerySchema,
} from '@enbox/shared';
import { db, type DbOrTx, type Tx } from '../../db/index.js';
import { chatMembers, chats, messageBookmarks, messageHidden, messages } from '../../db/schema.js';
import { badRequest, limitReached, notFound } from '../../lib/errors.js';
import { storableDate } from '../../lib/validate.js';
import { getChatAccess } from '../../services/chats.js';
import { transact } from '../../services/effects.js';
import { registerAccountDeletionHook } from '../../services/hooks.js';
import { loadVisibleMessage, toMessages } from '../../services/messages.js';
import {
  channelBits,
  loadChannelOverwrites,
  loadSpaceMembers,
  loadSpacePermCtx,
} from '../../services/spaceAccess.js';
import { rawRows, uniq, uuidArray } from '../../services/sql.js';
import { toUserPublics } from '../../services/users.js';
import { pushReminder } from '../push/reminderNotifications.js';
import { trackPush } from '../push/sender.js';

type BookmarkRow = typeof messageBookmarks.$inferSelect;
export type BookmarksQuery = z.output<typeof bookmarksQuerySchema>;

/** Reminders fired per transaction by the job. */
export const REMINDER_BATCH = 100;

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

function toBookmark(row: BookmarkRow, message: Message | null): Bookmark {
  return {
    messageId: row.messageId,
    chatId: row.chatId,
    createdAt: row.createdAt.toISOString(),
    remindAt: row.remindAt?.toISOString() ?? null,
    remindedAt: row.remindedAt?.toISOString() ?? null,
    message,
  };
}

/**
 * The Space channels and threads among `list` that `me` can see: computed VIEW_CHANNEL
 * (threads take their parent's overwrites), one overwrites query plus the roles and my member
 * row per Space involved.
 */
async function viewableSpaceChats(
  dbx: DbOrTx,
  me: string,
  list: { id: string; type: SpaceChannelType; spaceId: string }[],
): Promise<Set<string>> {
  const out = new Set<string>();
  if (list.length === 0) return out;
  const overwrites = await loadChannelOverwrites(dbx, uniq(list.map((c) => c.id)));
  for (const spaceId of uniq(list.map((c) => c.spaceId))) {
    const ctx = await loadSpacePermCtx(dbx, spaceId);
    const member = ctx ? (await loadSpaceMembers(dbx, spaceId, [me])).get(me) : undefined;
    if (!ctx || !member) continue;
    for (const c of list) {
      if (c.spaceId !== spaceId) continue;
      const bits = channelBits(ctx, me, member, c.type, overwrites.get(c.id) ?? []);
      if (hasPerm(bits, PERM.VIEW_CHANNEL)) out.add(c.id);
    }
  }
  return out;
}

/**
 * The messages among `ids` that `me` can see now, serialized for me: not deleted, hidden or
 * expired, inside my membership window, in a chat I can still open (`getChatAccess`'s rules:
 * my row there and not deleted for me; Space channels and threads by VIEW_CHANNEL, with or
 * without a read row). A fixed number of queries, plus a pair per Space involved.
 */
async function visibleMessages(
  dbx: DbOrTx,
  me: string,
  ids: string[],
): Promise<Map<string, Message>> {
  if (ids.length === 0) return new Map();
  const found = await dbx
    .select({ message: messages, member: chatMembers, type: chats.type, spaceId: chats.spaceId })
    .from(messages)
    .innerJoin(chats, eq(chats.id, messages.chatId))
    .leftJoin(chatMembers, and(eq(chatMembers.chatId, messages.chatId), eq(chatMembers.userId, me)))
    .where(
      and(
        inArray(messages.id, ids),
        isNull(messages.deletedAt),
        sql`(${messages.expiresAt} is null or ${messages.expiresAt} > now())`,
        sql`not exists (select 1 from ${messageHidden} where ${messageHidden.userId} = ${me} and ${messageHidden.messageId} = ${messages.id})`,
      ),
    );
  const inWindow = found.filter(({ message, member, type }) => {
    if (member) {
      const seq = Number(message.seq);
      if (seq <= Math.max(Number(member.joinedSeq), Number(member.clearedSeq))) return false;
      if (member.leftSeq != null && seq > Number(member.leftSeq)) return false;
    }
    // Space chats are checked below; elsewhere my row must exist and not be deleted for me.
    if (isSpaceChatType(type)) return true;
    return !!member && (!member.hidden || !!member.requestState);
  });
  const viewable = await viewableSpaceChats(
    dbx,
    me,
    inWindow.flatMap((f) =>
      isSpaceChatType(f.type) && f.spaceId
        ? [{ id: f.message.chatId, type: f.type, spaceId: f.spaceId }]
        : [],
    ),
  );
  const rows = inWindow
    .filter((f) => !isSpaceChatType(f.type) || viewable.has(f.message.chatId))
    .map((f) => f.message);
  const out = await toMessages(dbx, me, rows, {
    chatTypes: new Map(found.map((f) => [f.message.chatId, f.type])),
  });
  return new Map(out.map((m) => [m.id, m]));
}

/** Bookmark rows as `me` gets them (the message as I can see it now, else null). */
async function toBookmarks(dbx: DbOrTx, me: string, rows: BookmarkRow[]): Promise<Bookmark[]> {
  const visible = await visibleMessages(
    dbx,
    me,
    rows.map((r) => r.messageId),
  );
  return rows.map((r) => toBookmark(r, visible.get(r.messageId) ?? null));
}

// ---------------------------------------------------------------------------
// PUT / DELETE /messages/:messageId/bookmark
// ---------------------------------------------------------------------------

async function lockMyBookmarks(tx: Tx, userId: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`enbox:bookmarks:${userId}`}, 0))`,
  );
}

/** A reminder time from the request: undefined = unchanged, null = none, else in the future (400). */
function reminderTime(remindAt: BookmarkRequest['remindAt']): Date | null | undefined {
  if (remindAt === undefined || remindAt === null) return remindAt;
  const at = storableDate(remindAt, 'remindAt');
  if (at.getTime() <= Date.now()) throw badRequest('remindAt: Pick a time in the future');
  return at;
}

/**
 * `PUT /messages/:messageId/bookmark`: save a message I can see (see the header), or change
 * its reminder. A new bookmark or a changed reminder → `bookmark:changed` to my devices.
 */
export async function saveBookmark(
  me: string,
  messageId: string,
  body: BookmarkRequest,
): Promise<Bookmark> {
  const remindAt = reminderTime(body.remindAt);
  return transact(async (tx, fx) => {
    await lockMyBookmarks(tx, me);
    const { message, chat } = await loadVisibleMessage(tx, me, messageId);
    await getChatAccess(tx, me, chat.id).catch(() => {
      throw notFound('Message');
    });
    if (message.type === 'system' || message.deletedAt)
      throw badRequest('This message cannot be bookmarked');
    const mine = and(eq(messageBookmarks.userId, me), eq(messageBookmarks.messageId, messageId));
    const [existing] = await tx.select().from(messageBookmarks).where(mine).limit(1);
    let row = existing;
    if (!existing) {
      const [n] = await tx
        .select({ n: count() })
        .from(messageBookmarks)
        .where(eq(messageBookmarks.userId, me));
      if ((n?.n ?? 0) >= MAX_BOOKMARKS)
        throw limitReached(`You can bookmark up to ${MAX_BOOKMARKS} messages`);
      [row] = await tx
        .insert(messageBookmarks)
        .values({ userId: me, messageId, chatId: chat.id, remindAt: remindAt ?? null })
        .returning();
    } else if (
      remindAt !== undefined &&
      (remindAt?.getTime() !== existing.remindAt?.getTime() || existing.remindedAt)
    ) {
      [row] = await tx
        .update(messageBookmarks)
        .set({ remindAt, remindedAt: null })
        .where(mine)
        .returning();
    }
    const [serialized] = await toMessages(tx, me, [message], {
      chatTypes: new Map([[chat.id, chat.type]]),
    });
    const bookmark = toBookmark(row!, serialized ?? null);
    if (row !== existing) fx.toUser(me, 'bookmark:changed', { bookmark });
    return bookmark;
  });
}

/**
 * `DELETE /messages/:messageId/bookmark`: remove mine (also once the message is gone for me).
 * Idempotent; a removed bookmark → `bookmark:removed` to my devices.
 */
export async function removeBookmark(me: string, messageId: string): Promise<void> {
  await transact(async (tx, fx) => {
    const gone = await tx
      .delete(messageBookmarks)
      .where(and(eq(messageBookmarks.userId, me), eq(messageBookmarks.messageId, messageId)))
      .returning({ messageId: messageBookmarks.messageId });
    if (gone.length) fx.toUser(me, 'bookmark:removed', { messageId });
  });
}

// ---------------------------------------------------------------------------
// GET /me/bookmarks
// ---------------------------------------------------------------------------

type Phase = 'all' | 'upcoming' | 'done';

interface Cursor {
  phase: Phase;
  at: Date;
  id: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PHASES: Record<string, Phase> = { u: 'upcoming', d: 'done' };

/**
 * `before` of a page: `createdAt|id` (all), `u|remindAt|id` (upcoming reminders) or
 * `d|remindedAt|id` (done ones), as `nextCursor` gives them. 400 when malformed.
 */
export function parseBookmarksCursor(
  before: string | undefined,
  filter: BookmarksQuery['filter'],
): Cursor | null {
  if (!before) return null;
  const invalid = () => badRequest('before: Invalid cursor');
  let phase: Phase = 'all';
  let rest = before;
  if (filter === 'reminders') {
    const p = before[1] === '|' ? PHASES[before[0]!] : undefined;
    if (!p) throw invalid();
    phase = p;
    rest = before.slice(2);
  }
  const bar = rest.lastIndexOf('|');
  const at = new Date(rest.slice(0, bar));
  const id = rest.slice(bar + 1).toLowerCase();
  if (bar <= 0 || Number.isNaN(at.getTime()) || !UUID_RE.test(id)) throw invalid();
  return { phase, at, id };
}

function cursorOf(row: BookmarkRow, filter: BookmarksQuery['filter']): string {
  if (filter === 'all') return `${row.createdAt.toISOString()}|${row.messageId}`;
  return row.remindedAt
    ? `d|${row.remindedAt.toISOString()}|${row.messageId}`
    : `u|${row.remindAt!.toISOString()}|${row.messageId}`;
}

/** `(column, message_id)` compared with a cursor (`<` newest-first pages, `>` oldest-first). */
function after(column: SQL, cursor: Cursor | null, op: '<' | '>'): SQL | undefined {
  if (!cursor) return undefined;
  return sql`(${column}, ${messageBookmarks.messageId}) ${sql.raw(op)} (${cursor.at.toISOString()}::timestamptz, ${cursor.id}::uuid)`;
}

async function pageRows(
  me: string,
  q: BookmarksQuery,
  cursor: Cursor | null,
): Promise<{ rows: BookmarkRow[]; more: boolean }> {
  const n = q.limit;
  const b = messageBookmarks;
  if (q.filter === 'all') {
    const rows = await db
      .select()
      .from(b)
      .where(and(eq(b.userId, me), after(sql`${b.createdAt}`, cursor, '<')))
      .orderBy(desc(b.createdAt), desc(b.messageId))
      .limit(n + 1);
    return { rows: rows.slice(0, n), more: rows.length > n };
  }
  let rows: BookmarkRow[] = [];
  if (!cursor || cursor.phase === 'upcoming') {
    rows = await db
      .select()
      .from(b)
      .where(
        and(
          eq(b.userId, me),
          isNotNull(b.remindAt),
          isNull(b.remindedAt),
          after(sql`${b.remindAt}`, cursor, '>'),
        ),
      )
      .orderBy(asc(b.remindAt), asc(b.messageId))
      .limit(n + 1);
    if (rows.length > n) return { rows: rows.slice(0, n), more: true };
  }
  const done = await db
    .select()
    .from(b)
    .where(
      and(
        eq(b.userId, me),
        isNotNull(b.remindedAt),
        after(sql`${b.remindedAt}`, cursor?.phase === 'done' ? cursor : null, '<'),
      ),
    )
    .orderBy(desc(b.remindedAt), desc(b.messageId))
    .limit(n + 1 - rows.length);
  const all = [...rows, ...done];
  return { rows: all.slice(0, n), more: all.length > n };
}

/** `GET /me/bookmarks?filter=&before=&limit=` → BookmarksPage (see the header). */
export async function listBookmarks(me: string, q: BookmarksQuery): Promise<BookmarksPage> {
  const cursor = parseBookmarksCursor(q.before, q.filter);
  const { rows, more } = await pageRows(me, q, cursor);
  const bookmarks = await toBookmarks(db, me, rows);
  const users = await toUserPublics(
    db,
    me,
    uniq(bookmarks.flatMap((b) => (b.message ? referencedUserIds(b.message) : []))),
  );
  const last = rows.at(-1);
  return { bookmarks, nextCursor: more && last ? cursorOf(last, q.filter) : null, users };
}

// ---------------------------------------------------------------------------
// Reminders (leader job jobs/reminders.ts)
// ---------------------------------------------------------------------------

/**
 * Fire the reminders that are due: batches of `batch` rows taken FOR UPDATE SKIP LOCKED (a
 * bookmark being changed right now is simply taken next time) through the partial index
 * `message_bookmarks_due_idx`, `reminded_at` set in the same transaction. Each one →
 * `reminder:due` to its user's devices, then a push while the message is still there for
 * them. Returns how many fired.
 */
export async function sendDueReminders(batch = REMINDER_BATCH): Promise<number> {
  let total = 0;
  for (;;) {
    const n = await transact(async (tx, fx) => {
      const due = await rawRows<{ user_id: string; message_id: string }>(
        tx,
        sql`select user_id, message_id from message_bookmarks
            where remind_at is not null and remind_at <= now() and reminded_at is null
            order by remind_at, user_id, message_id
            limit ${batch}
            for update skip locked`,
      );
      if (due.length === 0) return 0;
      const fired = await tx
        .update(messageBookmarks)
        .set({ remindedAt: new Date() })
        .where(
          sql`(${messageBookmarks.userId}, ${messageBookmarks.messageId}) in (
                select * from unnest(${uuidArray(due.map((d) => d.user_id))}, ${uuidArray(due.map((d) => d.message_id))}))`,
        )
        .returning();
      fired.sort(
        (a, b) =>
          a.remindAt!.getTime() - b.remindAt!.getTime() || (a.messageId < b.messageId ? -1 : 1),
      );
      const byUser = new Map<string, BookmarkRow[]>();
      for (const r of fired) byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r]);
      for (const [userId, rows] of byUser)
        for (const bookmark of await toBookmarks(tx, userId, rows)) {
          fx.toUser(userId, 'reminder:due', { bookmark });
          if (bookmark.message) fx.add(() => trackPush(pushReminder(userId, bookmark)));
        }
      return due.length;
    });
    total += n;
    if (n < batch) return total;
  }
}

registerAccountDeletionHook('bookmarks', async (tx, _fx, userId) => {
  await tx.delete(messageBookmarks).where(eq(messageBookmarks.userId, userId));
});
