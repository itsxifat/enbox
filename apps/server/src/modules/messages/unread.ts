/**
 * Mark Unread (Discord): `POST /chats/:chatId/unread { messageId }` moves my read position to
 * just before that message (its seq - 1, never before my visible window) and marks the chat
 * unread, so the NEW line and the unread badge come back — on every device.
 *
 * Rules: an active member (Space channels: anyone who can see the channel; their lazy read
 * row is created) — 404 when I can't see the chat or the message, 403 `not_member` for former
 * members. The position may move back (unlike reads, the one exception to the monotonic marks
 * of services/watermarks.ts) or forward (a message that was already unread: the messages
 * above it become read, delivered too). Moving back emits no `chat:watermarks`: tick
 * watermarks only move forward on clients, and Space channels have no receipts.
 *
 * Events: `chat:read` → my devices (the same payload reading emits), then `chat:upsert` → my
 * devices (clients drop a `chat:read` that goes backwards, the summary carries it).
 * Response: my read state (`ChatReadState`).
 */
import { Router } from 'express';
import { and, eq, sql } from 'drizzle-orm';
import { hasReceipts, idParamSchema, markUnreadSchema, type ChatReadState } from '@enbox/shared';
import { chatMembers } from '../../db/schema.js';
import { authUserId } from '../../http/auth.js';
import { parse } from '../../lib/validate.js';
import { requireActiveMember } from '../../services/chats.js';
import { transact } from '../../services/effects.js';
import { loadVisibleMessage } from '../../services/messages.js';
import { ensureSpaceReadRow } from '../../services/spaceAccess.js';
import { readState } from '../../services/watermarks.js';

export const router = Router();

const chatParams = idParamSchema('chatId');

router.post('/chats/:chatId/unread', async (req, res) => {
  const me = authUserId(req);
  const { chatId } = parse(chatParams, req.params);
  const { messageId } = parse(markUnreadSchema, req.body);
  res.json(await markUnread(me, chatId, messageId));
});

export async function markUnread(
  me: string,
  chatId: string,
  messageId: string,
): Promise<ChatReadState> {
  return transact(async (tx, fx) => {
    const access = await requireActiveMember(tx, me, chatId, { lock: true });
    // Space channels: the read state lives on a lazy row.
    if (access.space)
      await ensureSpaceReadRow(tx, access.chat, me, access.space.me.member.joinedAt);
    const { message, member } = await loadVisibleMessage(tx, me, messageId, { chatId });
    const prev = { read: Number(member.lastReadSeq), delivered: Number(member.lastDeliveredSeq) };
    const floor = Math.max(Number(member.joinedSeq), Number(member.clearedSeq));
    const lastReadSeq = Math.max(floor, Number(message.seq) - 1);
    const forward = lastReadSeq > prev.read;
    await tx
      .update(chatMembers)
      .set({
        lastReadSeq,
        markedUnread: true,
        // Reading raises delivered too (the read ≤ delivered invariant).
        ...(forward
          ? {
              lastReadAt: new Date(),
              lastDeliveredSeq: sql`greatest(${chatMembers.lastDeliveredSeq}, ${lastReadSeq}::bigint)`,
            }
          : {}),
      })
      .where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, me)));
    fx.chatRead(me, chatId).chatUpsert(me, chatId);
    if (forward && hasReceipts(access.chat.type))
      fx.watermarks({ chatId, members: [{ userId: me, prev }] });
    const state = await readState(tx, me, chatId);
    return {
      chatId,
      lastReadSeq: state?.lastReadSeq ?? lastReadSeq,
      unreadCount: state?.unreadCount ?? 0,
      unreadMentionCount: state?.unreadMentionCount ?? 0,
      markedUnread: state?.markedUnread ?? true,
    };
  });
}
