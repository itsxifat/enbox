/**
 * Reports (docs/design/discord-parity.md W7-F; contracts in @enbox/shared safety.ts).
 *
 * - `POST /reports`: a message I can see, a user, or a Space I'm a member of (else 404).
 *   The row keeps an evidence snapshot (message text and file URLs, author, chat, time; the
 *   user's name; the Space's name) that later edits and deletes don't touch. `space_id` is
 *   set for messages in Space channels and for Space targets: that Space's moderators see
 *   them. Ten an hour per user. `alsoBlock` blocks the reported user (or the message's
 *   author) exactly like `PUT /blocks/:userId`.
 * - Moderators (MANAGE_MESSAGES, KICK_MEMBERS, BAN_MEMBERS or MODERATE_MEMBERS) list their
 *   Space's reports newest first (keyset paging, by status) and set the status; each change
 *   is written to the Space's audit log. Reports of messages in channels the moderator can't
 *   see are left out. The reporter is never part of what they get.
 * - Operators list every report with `scripts/reports.ts` (`listReports`).
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  PERM,
  REPORT_STATUSES,
  directChatKey,
  hasAnyPerm,
  hasPerm,
  isSpaceAdmin,
  isSpaceChatType,
  type CreateReportRequest,
  type ID,
  type ReportEvidence,
  type ReportStatus,
  type ReportTarget,
  type SpaceChannelType,
  type SpaceReport,
  type SpaceReportPage,
} from '@enbox/shared';
import { db, type DbOrTx, type Tx } from '../../db/index.js';
import { blocks, chats, reports, spaces } from '../../db/schema.js';
import { badRequest, forbidden, notFound } from '../../lib/errors.js';
import { assertUserLimit } from '../../lib/userLimit.js';
import { getChatAccess, lockChats } from '../../services/chats.js';
import { transact, type Effects } from '../../services/effects.js';
import { loadVisibleMessage, toMessages } from '../../services/messages.js';
import {
  channelBits,
  loadChannelOverwrites,
  requireSpaceMember,
  type SpaceAccess,
} from '../../services/spaceAccess.js';
import { audit } from '../../services/spaces.js';
import { uniq } from '../../services/sql.js';
import { getUserRow, requireUser } from '../../services/users.js';
import { dropFriendRequests } from '../friends/service.js';
import { reevaluatePresence } from '../users/presence.js';

export type ReportRow = typeof reports.$inferSelect;

/** `POST /reports` per user. */
export const REPORT_RATE_LIMIT = { limit: 10, windowMs: 60 * 60_000 };

/** Any of these Space-wide bits opens Space Settings ▸ Reports. */
export const REPORT_MODERATOR_BITS =
  PERM.MANAGE_MESSAGES | PERM.KICK_MEMBERS | PERM.BAN_MEMBERS | PERM.MODERATE_MEMBERS;

const AUDIT_ACTIONS: Record<ReportStatus, string> = {
  open: 'report.reopen',
  resolved: 'report.resolve',
  dismissed: 'report.dismiss',
};

// ---------------------------------------------------------------------------
// Creating
// ---------------------------------------------------------------------------

interface ResolvedTarget {
  spaceId: ID | null;
  evidence: ReportEvidence;
  /** Files kept for the evidence (media GC skips them). */
  mediaIds?: ID[];
  /** Who `alsoBlock` blocks (the user, the message's author); null for a Space. */
  userId: ID | null;
}

const userEvidence = (u: { id: ID; username: string; displayName: string }) => ({
  id: u.id,
  username: u.username,
  displayName: u.displayName,
});

async function spaceEvidence(dbx: DbOrTx, spaceId: ID): Promise<ReportEvidence['space']> {
  const [s] = await dbx
    .select({ id: spaces.id, name: spaces.name })
    .from(spaces)
    .where(eq(spaces.id, spaceId))
    .limit(1);
  return s ? { id: s.id, name: s.name } : undefined;
}

/** The target as I can see it now, with its evidence (404 when I can't). */
async function resolveTarget(
  tx: Tx,
  me: ID,
  targetType: ReportTarget,
  targetId: ID,
): Promise<ResolvedTarget> {
  if (targetType === 'user') {
    if (targetId === me) throw badRequest("You can't report yourself");
    const user = await requireUser(tx, targetId);
    return { spaceId: null, evidence: { user: userEvidence(user) }, userId: user.id };
  }
  if (targetType === 'space') {
    await requireSpaceMember(tx, targetId, me);
    return {
      spaceId: targetId,
      evidence: { space: await spaceEvidence(tx, targetId) },
      userId: null,
    };
  }
  const { message, chat } = await loadVisibleMessage(tx, me, targetId);
  // Space channels: my read row may outlive my access (roles change), so check it now.
  if (isSpaceChatType(chat.type)) await getChatAccess(tx, me, chat.id);
  if (message.type === 'system' || message.type === 'call' || message.deletedAt)
    throw badRequest("This message can't be reported");
  if (message.senderId === me) throw badRequest("You can't report your own message");
  const [wire] = await toMessages(tx, me, [message]);
  const files = wire?.attachments?.length ? wire.attachments : wire?.media ? [wire.media] : [];
  const evidence: ReportEvidence = {
    message: {
      id: message.id,
      chatId: message.chatId,
      senderId: message.senderId,
      text: wire?.text ?? wire?.poll?.question ?? null,
      mediaUrls: files.map((f) => f.url),
      createdAt: message.createdAt.toISOString(),
    },
  };
  const author = message.senderId ? await getUserRow(tx, message.senderId) : null;
  if (author) evidence.user = userEvidence(author);
  if (chat.spaceId) evidence.space = await spaceEvidence(tx, chat.spaceId);
  return {
    spaceId: chat.spaceId ?? null,
    evidence,
    mediaIds: files.map((f) => f.id),
    userId: author?.id ?? null,
  };
}

/**
 * Block `userId` with the steps and events of `PUT /blocks/:userId` (users/routes.ts):
 * our direct chat locked first, `blocks:changed` → me, `chat:upsert` (that chat) → me,
 * `user:changed {me}` → them, presence re-evaluated both ways, pending friend requests
 * dropped, domain `user.blocked`. Already blocked, or a deleted account: nothing happens.
 */
async function blockUser(tx: Tx, fx: Effects, me: ID, userId: ID): Promise<void> {
  if (userId === me) return;
  const user = await getUserRow(tx, userId);
  if (!user || user.deletedAt) return;
  const [direct] = await tx
    .select({ id: chats.id })
    .from(chats)
    .where(eq(chats.directKey, directChatKey(me, userId)))
    .limit(1);
  if (direct) await lockChats(tx, [direct.id]);
  const inserted = await tx
    .insert(blocks)
    .values({ blockerId: me, blockedId: userId })
    .onConflictDoNothing()
    .returning({ id: blocks.blockedId });
  if (inserted.length === 0) return;
  fx.toUser(me, 'blocks:changed', {});
  if (direct) fx.chatUpsert(me, direct.id);
  fx.toUser(userId, 'user:changed', { userId: me });
  fx.add(() => {
    void reevaluatePresence(me);
    void reevaluatePresence(userId);
  });
  await dropFriendRequests(tx, fx, me, userId);
  fx.domain('user.blocked', { blockerId: me, blockedId: userId });
}

/** `POST /reports` (the body is parsed by the route). */
export async function createReport(me: ID, body: CreateReportRequest): Promise<{ id: ID }> {
  assertUserLimit(me, 'report', REPORT_RATE_LIMIT);
  return transact(async (tx, fx) => {
    const target = await resolveTarget(tx, me, body.targetType, body.targetId);
    if (body.alsoBlock && target.userId) await blockUser(tx, fx, me, target.userId);
    const [row] = await tx
      .insert(reports)
      .values({
        reporterId: me,
        targetType: body.targetType,
        targetId: body.targetId,
        spaceId: target.spaceId,
        category: body.category,
        details: body.details?.trim() || null,
        evidence: target.evidence,
        mediaIds: target.mediaIds ?? [],
      })
      .returning({ id: reports.id });
    return { id: row!.id };
  });
}

// ---------------------------------------------------------------------------
// Moderators
// ---------------------------------------------------------------------------

/** 404 unless a member of the Space, 403 without any moderator bit. */
async function requireReportModerator(dbx: DbOrTx, spaceId: ID, me: ID): Promise<SpaceAccess> {
  const access = await requireSpaceMember(dbx, spaceId, me);
  if (!hasAnyPerm(access.base, REPORT_MODERATOR_BITS))
    throw forbidden('You do not have permission to review reports in this Space');
  return access;
}

/** The rows the moderator may see: message reports only from channels they can view. */
async function visibleToModerator(
  dbx: DbOrTx,
  access: SpaceAccess,
  me: ID,
  rows: ReportRow[],
): Promise<ReportRow[]> {
  if (isSpaceAdmin(access.base)) return rows;
  const chatOf = (r: ReportRow) =>
    r.targetType === 'message' ? (r.evidence.message?.chatId ?? null) : null;
  const chatIds = uniq(rows.map(chatOf).filter((id): id is ID => !!id));
  if (chatIds.length === 0) return rows;
  const [types, overwrites] = await Promise.all([
    dbx.select({ id: chats.id, type: chats.type }).from(chats).where(inArray(chats.id, chatIds)),
    loadChannelOverwrites(dbx, chatIds),
  ]);
  const typeOf = new Map(types.map((c) => [c.id, c.type]));
  const canView = new Map<ID, boolean>();
  for (const id of chatIds) {
    const type = typeOf.get(id);
    // A deleted channel: judged by the Space-wide bits.
    const channelType: SpaceChannelType = type && isSpaceChatType(type) ? type : 'space_text';
    const bits = channelBits(
      access.ctx,
      me,
      access.me,
      channelType,
      overwrites.get(id) ?? [],
      access.base,
    );
    canView.set(id, hasPerm(bits, PERM.VIEW_CHANNEL));
  }
  return rows.filter((r) => {
    const chatId = chatOf(r);
    return !chatId || canView.get(chatId) === true;
  });
}

/** Wire shape for moderators: never the reporter. */
export function toSpaceReport(row: ReportRow): SpaceReport {
  return {
    id: row.id,
    spaceId: row.spaceId!,
    targetType: row.targetType,
    targetId: row.targetId,
    category: row.category,
    details: row.details,
    evidence: row.evidence,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    resolvedBy: row.resolvedBy,
  };
}

/** Keyset cursor: `<created_at ms>_<id>` of the last row of the page. */
const cursorOf = (r: Pick<ReportRow, 'createdAt' | 'id'>) => `${r.createdAt.getTime()}_${r.id}`;

const CURSOR_RE = /^(\d{1,15})_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

function parseCursor(before: string): { at: string; id: ID } {
  const m = CURSOR_RE.exec(before);
  const at = m ? new Date(Number(m[1])) : null;
  if (!m || !at || Number.isNaN(at.getTime())) throw badRequest('Invalid cursor');
  return { at: at.toISOString(), id: m[2]! };
}

/** Newest first, `before` from a previous page; at most `limit` rows looked at per page. */
async function reportPage(
  dbx: DbOrTx,
  where: { spaceId?: ID; status?: ReportStatus; before?: string; limit: number },
): Promise<{ rows: ReportRow[]; nextCursor: string | null }> {
  const cursor = where.before ? parseCursor(where.before) : null;
  const rows = await dbx
    .select()
    .from(reports)
    .where(
      and(
        where.spaceId ? eq(reports.spaceId, where.spaceId) : undefined,
        where.status ? eq(reports.status, where.status) : undefined,
        cursor
          ? sql`(${reports.createdAt}, ${reports.id}) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)`
          : undefined,
      ),
    )
    .orderBy(desc(reports.createdAt), desc(reports.id))
    .limit(where.limit);
  const last = rows[rows.length - 1];
  return { rows, nextCursor: rows.length === where.limit && last ? cursorOf(last) : null };
}

/**
 * `GET /spaces/:spaceId/reports`. A page may hold fewer than `limit` reports (those from
 * channels I can't see are left out): keep paging while `nextCursor` is set.
 */
export async function listSpaceReports(
  me: ID,
  spaceId: ID,
  q: { status?: ReportStatus; before?: string; limit: number },
): Promise<SpaceReportPage> {
  const access = await requireReportModerator(db, spaceId, me);
  const page = await reportPage(db, { spaceId, ...q });
  const rows = await visibleToModerator(db, access, me, page.rows);
  return { reports: rows.map(toSpaceReport), nextCursor: page.nextCursor };
}

/**
 * `PATCH /spaces/:spaceId/reports/:reportId`: resolved / dismissed (records who and when) or
 * open again. Unchanged: returned as is, no audit entry.
 */
export async function updateSpaceReport(
  me: ID,
  spaceId: ID,
  reportId: ID,
  status: ReportStatus,
): Promise<SpaceReport> {
  return transact(async (tx) => {
    const access = await requireReportModerator(tx, spaceId, me);
    const [row] = await tx
      .select()
      .from(reports)
      .where(and(eq(reports.id, reportId), eq(reports.spaceId, spaceId)))
      .for('update');
    if (!row || (await visibleToModerator(tx, access, me, [row])).length === 0)
      throw notFound('Report');
    if (row.status === status) return toSpaceReport(row);
    const closed = status !== 'open';
    const [updated] = await tx
      .update(reports)
      .set({ status, resolvedAt: closed ? new Date() : null, resolvedBy: closed ? me : null })
      .where(eq(reports.id, reportId))
      .returning();
    await audit(tx, {
      spaceId,
      actorId: me,
      action: AUDIT_ACTIONS[status],
      targetId: reportId,
      changes: { status: [row.status, status], category: row.category },
    });
    return toSpaceReport(updated!);
  });
}

// ---------------------------------------------------------------------------
// Operators (scripts/reports.ts)
// ---------------------------------------------------------------------------

/** Every report (reporter included), newest first: the operator's review queue. */
export async function listReports(
  dbx: DbOrTx,
  opts: { status?: ReportStatus; before?: string; limit?: number } = {},
): Promise<{ rows: ReportRow[]; nextCursor: string | null }> {
  const status = opts.status && REPORT_STATUSES.includes(opts.status) ? opts.status : undefined;
  return reportPage(dbx, { status, before: opts.before, limit: opts.limit ?? 50 });
}
