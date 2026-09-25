/**
 * Status visibility primitives shared by the status module and message sending
 * (status replies). Feed/audience logic belongs to modules/status.
 */
import { and, eq, gt, inArray } from 'drizzle-orm';
import type { StatusReplyPayload } from '@enbox/shared';
import type { DbOrTx } from '../db/index.js';
import type { StoredStatusReply } from '../db/types.js';
import { chatMembers, media, statuses, type ChatRow, type MediaRow, type StatusRow } from '../db/schema.js';
import { badRequest, notFound } from '../lib/errors.js';
import { blockedEitherWay } from './users.js';
import { mediaUrl } from './media.js';
import { uniq } from './sql.js';

/**
 * `requireVisibleStatus` (docs "Status updates"): the status is live and the viewer is its
 * author, or in its audience with no block either way — else 404. `lock: true` (writes that
 * reference the status, e.g. a view) takes `FOR KEY SHARE`: a concurrent delete (author or
 * expiry purge) is waited for and then yields 404 instead of a foreign-key error.
 */
export async function requireVisibleStatus(dbx: DbOrTx, viewerId: string, statusId: string, opts: { lock?: boolean } = {}): Promise<StatusRow> {
  let q = dbx
    .select()
    .from(statuses)
    .where(and(eq(statuses.id, statusId), gt(statuses.expiresAt, new Date())))
    .limit(1)
    .$dynamic();
  if (opts.lock) q = q.for('key share');
  const [row] = await q;
  if (!row) throw notFound('Status');
  if (row.userId === viewerId) return row;
  if (!row.audience.includes(viewerId) || (await blockedEitherWay(dbx, viewerId, row.userId))) throw notFound('Status');
  return row;
}

/**
 * Validate a status reply (docs "Send"): the status is live and visible to the sender, the
 * chat is the direct chat with its author, and the sender is not the author. Returns the
 * reference stored in `messages.metadata.statusReply`.
 */
export async function resolveStatusReply(
  dbx: DbOrTx,
  input: { senderId: string; chat: Pick<ChatRow, 'id' | 'type'>; statusId: string },
): Promise<StoredStatusReply> {
  const status = await requireVisibleStatus(dbx, input.senderId, input.statusId);
  if (status.userId === input.senderId) throw badRequest('You cannot reply to your own status');
  if (input.chat.type !== 'direct') throw badRequest('Reply to a status in the direct chat with its author');
  const [author] = await dbx
    .select({ userId: chatMembers.userId })
    .from(chatMembers)
    .where(and(eq(chatMembers.chatId, input.chat.id), eq(chatMembers.userId, status.userId)))
    .limit(1);
  if (!author) throw badRequest('Reply to a status in the direct chat with its author');
  return { statusId: status.id, authorId: status.userId, type: status.type };
}

/** Statuses (with media) referenced by status replies, keyed by id; deleted ones are absent. */
export async function loadStatusesForReplies(dbx: DbOrTx, ids: Iterable<string>): Promise<Map<string, { status: StatusRow; media: MediaRow | null }>> {
  const list = uniq(ids);
  const out = new Map<string, { status: StatusRow; media: MediaRow | null }>();
  if (list.length === 0) return out;
  const rows = await dbx.select({ status: statuses, media }).from(statuses).leftJoin(media, eq(media.id, statuses.mediaId)).where(inArray(statuses.id, list));
  for (const r of rows) out.set(r.status.id, { status: r.status, media: r.media });
  return out;
}

/** Read-time `StatusReplyPayload`: `available: false` (content null) once the status is deleted or expired. */
export function toStatusReplyPayload(
  stored: StoredStatusReply,
  found: { status: StatusRow; media: MediaRow | null } | undefined,
  now: number = Date.now(),
): StatusReplyPayload {
  if (!found || found.status.expiresAt.getTime() <= now) {
    return { ...stored, available: false, text: null, backgroundColor: null, font: null, mediaUrl: null };
  }
  const m = found.media;
  return {
    statusId: stored.statusId,
    authorId: stored.authorId,
    type: stored.type,
    available: true,
    text: found.status.text,
    backgroundColor: found.status.backgroundColor,
    font: found.status.font,
    mediaUrl: m ? mediaUrl(m.thumbnailKey ?? m.storageKey) : null,
  };
}
