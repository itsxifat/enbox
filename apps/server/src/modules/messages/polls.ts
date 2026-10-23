/**
 * Polls with an end (docs/design/discord-parity.md W5-D): durations, End Poll Now, the poll
 * closer and the result message. Paths are relative to /api (see ApiRoutes in @enbox/shared);
 * mounted behind requireAuth.
 *
 *   POST /messages/:messageId/poll/end   Message: close the poll now (its sender, or
 *                                        MANAGE_MESSAGES in a Space channel); posts the result
 *
 * A poll sent with `durationHours` stores `poll_ends_at`; votes are refused (410 expired) once
 * it passed or the poll was closed (./service.ts `vote`). Closing — End Poll Now, or the
 * leader job jobs/pollClose.ts once the time ran out — sets `poll_closed_at`, sends the
 * poll's `message:updated` and posts a `poll_result` system message in the same chat, with
 * the answers that got the most votes (ties: several; no votes: none).
 */
import { Router } from 'express';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { z } from 'zod';
import {
  PERM,
  hasPerm,
  idParamSchema,
  reactionEmojiSchema,
  type Message,
  type SystemEvent,
  type pollInputSchema,
} from '@enbox/shared';
import { db, type Tx } from '../../db/index.js';
import { chatMembers, chats, messages, type ChatRow, type MessageRow } from '../../db/schema.js';
import type { PollDefinition } from '../../db/types.js';
import { authUserId } from '../../http/auth.js';
import { badRequest, forbidden } from '../../lib/errors.js';
import { parse } from '../../lib/validate.js';
import { requireActiveMember, type ChatAccess } from '../../services/chats.js';
import { transact, type Effects } from '../../services/effects.js';
import {
  buildPollDefinition,
  createMessage,
  loadVisibleMessage,
  toMessages,
} from '../../services/messages.js';
import { gateExternalEmoji } from '../../services/spaceEmojis.js';
import { rawRows, uniq, uuidArray } from '../../services/sql.js';
import { blockersOf } from '../../services/users.js';

export const router = Router();

const messageParams = idParamSchema('messageId');

/** Poll closer: polls per transaction. */
export const POLL_CLOSE_BATCH = 50;

type PollInput = z.output<typeof pollInputSchema>;
type PollResult = Extract<SystemEvent, { kind: 'poll_result' }>;

/** Votes per answer and distinct voters of one poll. */
interface Tally {
  counts: Map<string, number>;
  voters: number;
}

/** Whether voting is over: closed, or its end time passed (the closer may not have run yet). */
export function pollHasEnded(
  row: Pick<MessageRow, 'pollEndsAt' | 'pollClosedAt'>,
  now = Date.now(),
): boolean {
  return !!row.pollClosedAt || (!!row.pollEndsAt && row.pollEndsAt.getTime() <= now);
}

/**
 * The poll of a send (./service.ts `sendMessage`): its definition with fresh option ids and
 * each answer's emoji — one unicode emoji or a custom token (400 otherwise); in a Space
 * channel another Space's custom emoji needs USE_EXTERNAL_EMOJI, else that answer has none —
 * and when voting closes: `durationHours` from now (absent = never, for older clients).
 */
export async function pollSendFields(
  tx: Tx,
  access: ChatAccess,
  poll: PollInput,
): Promise<{ definition: PollDefinition; endsAt: Date | null }> {
  const list = (poll.emojis ?? []).map((e) => e || null);
  if (list.length > poll.options.length) throw badRequest('emojis: At most one per answer');
  if (list.some((e) => e !== null && !reactionEmojiSchema.safeParse(e).success))
    throw badRequest('emojis: Use one emoji per answer');
  // One gate for all of them: a refused token comes back as `:name:`.
  const gated = list.some((e) => e?.startsWith('<'))
    ? (await gateExternalEmoji(tx, access, list.map((e) => e ?? '').join('\n'))).split('\n')
    : list;
  const emojis = list.map((e, i) => (e && gated[i] === e ? e : null));
  return {
    definition: buildPollDefinition({ ...poll, emojis }),
    endsAt: poll.durationHours ? new Date(Date.now() + poll.durationHours * 60 * 60_000) : null,
  };
}

// ---------------------------------------------------------------------------
// Closing
// ---------------------------------------------------------------------------

/** Tallies of polls by message id: two grouped queries for a whole batch. */
async function tallies(tx: Tx, pollIds: string[]): Promise<Map<string, Tally>> {
  const out = new Map<string, Tally>();
  if (pollIds.length === 0) return out;
  const ids = uuidArray(pollIds);
  const tallyOf = (id: string) => {
    const t = out.get(id) ?? { counts: new Map<string, number>(), voters: 0 };
    out.set(id, t);
    return t;
  };
  const counts = await rawRows<{ message_id: string; option_id: string; n: number }>(
    tx,
    sql`select message_id, option_id, count(*)::int as n from poll_votes
        where message_id = any(${ids}) group by message_id, option_id`,
  );
  for (const c of counts) tallyOf(c.message_id).counts.set(c.option_id, Number(c.n));
  const voters = await rawRows<{ message_id: string; n: number }>(
    tx,
    sql`select message_id, count(distinct user_id)::int as n from poll_votes
        where message_id = any(${ids}) group by message_id`,
  );
  for (const v of voters) tallyOf(v.message_id).voters = Number(v.n);
  return out;
}

/** The result message's event: the answers with the most votes, in answer order. */
function resultEvent(
  chat: ChatRow,
  poll: MessageRow,
  def: PollDefinition,
  tally?: Tally,
): PollResult {
  const votes = (optionId: string) => tally?.counts.get(optionId) ?? 0;
  const top = Math.max(0, ...def.options.map((o) => votes(o.id)));
  return {
    kind: 'poll_result',
    pollMessageId: poll.id,
    // Broadcast channels post as the channel: their admins stay anonymous.
    authorId: chat.type === 'channel' ? null : poll.senderId,
    question: def.question,
    totalVoters: tally?.voters ?? 0,
    winners:
      top === 0
        ? []
        : def.options
            .filter((o) => votes(o.id) === top)
            .map((o) => ({ optionId: o.id, text: o.text, emoji: o.emoji ?? null, votes: top })),
  };
}

/** Direct chats: the peer when they blocked the poll's sender (its events never reach them). */
async function blockersOfSender(tx: Tx, chat: ChatRow, senderId: string | null): Promise<string[]> {
  if (chat.type !== 'direct' || !senderId) return [];
  const members = await tx
    .select({ userId: chatMembers.userId })
    .from(chatMembers)
    .where(and(eq(chatMembers.chatId, chat.id), isNull(chatMembers.leftAt)));
  const ids = members.map((m) => m.userId);
  return [...(await blockersOf(tx, senderId, ids))];
}

/**
 * Close a poll whose chat and row the caller locked: `poll_closed_at`, the poll's
 * `message:updated` → room, then the `poll_result` message in its chat (`message:new`). A
 * deleted or expired poll closes silently. Direct chats: a peer who blocked the poll's sender
 * gets neither (the result is withheld like the poll).
 */
async function closePoll(
  tx: Tx,
  fx: Effects,
  chat: ChatRow,
  poll: MessageRow,
  tally: Tally | undefined,
): Promise<MessageRow> {
  const [closed] = await tx
    .update(messages)
    .set({ pollClosedAt: new Date() })
    .where(eq(messages.id, poll.id))
    .returning();
  const def = poll.metadata?.poll;
  const gone = !!poll.deletedAt || (!!poll.expiresAt && poll.expiresAt.getTime() <= Date.now());
  if (!def || gone) return closed!;
  fx.messageUpdated(poll.id, { exceptUserIds: await blockersOfSender(tx, chat, poll.senderId) });
  await createMessage(tx, fx, {
    chatId: chat.id,
    senderId: null,
    type: 'system',
    metadata: { system: resultEvent(chat, poll, def, tally) },
    actorId: poll.senderId,
  });
  return closed!;
}

/**
 * `POST /messages/:messageId/poll/end` (End Poll Now): a poll I can see (404) in a chat where
 * I am an active member (403 not_member); its sender — any admin who can post, for a
 * broadcast channel's polls — or MANAGE_MESSAGES in a Space channel (403 otherwise); deleted
 * messages and other types 400. Already closed → no-op. Locks the chat, then the poll's row
 * (the order of every write to messages). Returns the poll for me.
 */
export async function endPoll(me: string, messageId: string): Promise<Message> {
  const row = await transact(async (tx, fx) => {
    const first = await loadVisibleMessage(tx, me, messageId);
    const access = await requireActiveMember(tx, me, first.message.chatId, { lock: true });
    const { message } = await loadVisibleMessage(tx, me, messageId, {
      chatId: access.chat.id,
      lock: true,
    });
    if (message.type !== 'poll' || message.deletedAt || !message.metadata?.poll)
      throw badRequest('This message is not a poll');
    const moderator = !!access.space && hasPerm(access.space.bits, PERM.MANAGE_MESSAGES);
    const author =
      access.chat.type === 'channel' ? access.permissions.canSend : message.senderId === me;
    if (!author && !moderator) throw forbidden('You can only end your own polls');
    if (message.pollClosedAt) return message;
    const tally = (await tallies(tx, [message.id])).get(message.id);
    return closePoll(tx, fx, access.chat, message, tally);
  });
  const [out] = await toMessages(db, me, [row]);
  return out!;
}

/**
 * Close the polls whose end time passed (leader job jobs/pollClose.ts): batches of
 * POLL_CLOSE_BATCH taken `FOR UPDATE SKIP LOCKED` together with their chat rows (a chat busy
 * with a send, or a poll mid-vote, is simply taken next time), the partial index
 * `messages_poll_open_idx` bounding the scan. Each one is closed like End Poll Now. Returns
 * how many closed.
 */
export async function closeExpiredPolls(batch = POLL_CLOSE_BATCH): Promise<number> {
  let total = 0;
  for (;;) {
    const n = await transact(async (tx, fx) => {
      const due = await rawRows<{ id: string }>(
        tx,
        sql`select m.id from messages m join chats c on c.id = m.chat_id
            where m.poll_ends_at <= now() and m.poll_closed_at is null
            order by m.poll_ends_at, m.id
            limit ${batch}
            for update of m, c skip locked`,
      );
      if (due.length === 0) return 0;
      const ids = due.map((r) => r.id);
      const polls = await tx
        .select()
        .from(messages)
        .where(inArray(messages.id, ids))
        .orderBy(asc(messages.pollEndsAt), asc(messages.id));
      const chatRows = await tx
        .select()
        .from(chats)
        .where(inArray(chats.id, uniq(polls.map((p) => p.chatId))));
      const chatById = new Map(chatRows.map((c) => [c.id, c]));
      const tallied = await tallies(tx, ids);
      for (const poll of polls)
        await closePoll(tx, fx, chatById.get(poll.chatId)!, poll, tallied.get(poll.id));
      return due.length;
    });
    total += n;
    if (n < batch) return total;
  }
}

router.post('/messages/:messageId/poll/end', async (req, res) => {
  const me = authUserId(req);
  const { messageId } = parse(messageParams, req.params);
  res.json(await endPoll(me, messageId));
});
