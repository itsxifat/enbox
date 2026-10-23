/**
 * Message requests (docs/design/discord-parity.md W7-C): my Requests list, Accept and Ignore.
 * What lands here, the DM gate and the events of a message into a request are
 * services/dmGate.ts; replying accepts too (dmGate `gateDirectMessage`), and so does becoming
 * friends (`acceptRequestsBetween`).
 *
 * Events (my devices only; the sender is never told anything):
 * - accept: JOIN(me) (room + `chat:upsert`), `chat:request-removed`, `chat:read`, and the
 *   delivered receipt of what I now have (`chat:watermarks` → the sender);
 * - ignore: `chat:request-removed` (the chat stays hidden; later messages stay quiet).
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { ChatRequestState, ChatSummary, ID } from '@enbox/shared';
import { db, type DbOrTx } from '../../db/index.js';
import { chatMembers, chats, type ChatMemberRow, type ChatRow } from '../../db/schema.js';
import { notFound } from '../../lib/errors.js';
import { getMembership, lockChat } from '../../services/chats.js';
import { fxRequestRemoved } from '../../services/dmGate.js';
import { transact } from '../../services/effects.js';
import { toChatSummaries, toChatSummary } from '../../services/summaries.js';
import { advanceDelivered } from '../../services/watermarks.js';

/** How many requests a list holds at most (the newest; older ones come back with a new message). */
export const MAX_LISTED_REQUESTS = 200;

const requestNotFound = () => notFound('Message request');

/**
 * `GET /chats/requests[?state=ignored]`: my requests in that state, newest message first,
 * each with its `lastMessage`. Left out: requests with nothing I can see (withheld from me),
 * from someone I blocked, or from a deleted account.
 */
export async function listRequests(
  me: ID,
  state: ChatRequestState = 'pending',
): Promise<ChatSummary[]> {
  const rows = await db
    .select({ chatId: chatMembers.chatId })
    .from(chatMembers)
    .innerJoin(chats, eq(chats.id, chatMembers.chatId))
    .where(
      and(
        eq(chatMembers.userId, me),
        eq(chatMembers.requestState, state),
        isNull(chatMembers.leftAt),
        eq(chats.type, 'direct'),
      ),
    )
    .orderBy(sql`${chats.lastMessageAt} desc nulls last`, chats.id)
    .limit(MAX_LISTED_REQUESTS);
  const summaries = await toChatSummaries(
    db,
    me,
    rows.map((r) => r.chatId),
    { includeHidden: true },
  );
  return summaries
    .filter(
      (s) =>
        s.request === state &&
        !!s.lastMessage &&
        !!s.peer &&
        !s.peer.isBlocked &&
        !s.peer.isDeleted,
    )
    .sort((a, b) =>
      a.lastActivityAt < b.lastActivityAt ? 1 : a.lastActivityAt > b.lastActivityAt ? -1 : 0,
    );
}

/**
 * My row of a direct chat for a request route, under the chat lock. The unlocked pre-check
 * keeps anyone without a row off the chat's lock; every miss is the same 404.
 */
async function lockMyRequestRow(
  tx: DbOrTx,
  me: ID,
  chatId: ID,
): Promise<{ chat: ChatRow; member: ChatMemberRow }> {
  const pre = await getMembership(tx, chatId, me);
  if (!pre || pre.leftAt) throw requestNotFound();
  const chat = await lockChat(tx, chatId);
  const member = await getMembership(tx, chatId, me);
  if (chat.type !== 'direct' || !member || member.leftAt) throw requestNotFound();
  return { chat, member };
}

/**
 * `POST /chats/:chatId/request/accept` (pending or ignored): an ordinary chat from now on, in
 * my list. Accepting an accepted chat returns it unchanged (another device was first).
 */
export async function acceptRequest(me: ID, chatId: ID): Promise<ChatSummary> {
  await transact(async (tx, fx) => {
    const { chat, member } = await lockMyRequestRow(tx, me, chatId);
    if (!member.requestState) {
      if (member.hidden) throw requestNotFound();
      return;
    }
    await tx
      .update(chatMembers)
      .set({ requestState: null, hidden: false })
      .where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, me)));
    fx.join(me, chatId);
    fxRequestRemoved(fx, chatId, [me]);
    fx.chatRead(me, chatId);
    // My devices hold its messages now: they count as delivered.
    await advanceDelivered(tx, fx, { chatId, userId: me, seq: Number(chat.lastSeq) });
  });
  const summary = await toChatSummary(db, me, chatId);
  if (!summary) throw requestNotFound();
  return summary;
}

/**
 * `POST /chats/:chatId/request/ignore`: out of my Requests (into Ignored), still hidden, and
 * what they send later stays quiet. Idempotent; an ordinary chat is no request (404).
 */
export async function ignoreRequest(me: ID, chatId: ID): Promise<void> {
  await transact(async (tx, fx) => {
    const { member } = await lockMyRequestRow(tx, me, chatId);
    if (!member.requestState) throw requestNotFound();
    if (member.requestState === 'ignored') return;
    await tx
      .update(chatMembers)
      .set({ requestState: 'ignored' })
      .where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, me)));
    fxRequestRemoved(fx, chatId, [me]);
  });
}
