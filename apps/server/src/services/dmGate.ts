/**
 * The DM gate and message requests (docs/design/discord-parity.md W7-C; contracts in
 * @enbox/shared safety.ts). Who may start a direct chat with whom, and what lands in the
 * recipient's Message Requests instead of their chat list.
 *
 * A request is a direct chat whose recipient row has `request_state` (`pending` until they
 * accept or reply, `ignored` once they decline). The row stays `hidden`, so `GET /chats` (and
 * the APK, which reads it) never lists it, nobody joins its room and nothing counts or pushes
 * (push/notifications.ts skips request rows). Its recipient hears of it through
 * `chat:request { chat }` only; delivered and read receipts don't move while it waits, so the
 * sender can't tell it was seen.
 *
 * The gate runs when a new direct chat is opened (only to refuse) and on the first message
 * into a chat its recipient never accepted: a new chat, one opened but never written in, or a
 * request. Chats with history either way (WhatsApp-era conversations) and self chats are
 * exempt. Blocks never change its answer: a blocked sender is refused or let in exactly like
 * anyone else, and the message is then withheld as before, so a block is never revealed.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import { directChatKey, type ChatSummary, type ID, type MessageType } from '@enbox/shared';
import { config } from '../config.js';
import type { DbOrTx } from '../db/index.js';
import { chatMembers, contacts, users } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { emitToUser } from '../realtime/emit.js';
import type { Effects } from './effects.js';
import { pairKey, rawRows } from './sql.js';
import { chatSummariesForPairs } from './summaries.js';
import { settingsOf } from './users.js';

export const DM_NOT_ALLOWED_MESSAGE = "You can't send messages to this person";
/** Calls need a chat they accepted (or one that needs no accepting). */
export const CALL_NOT_ALLOWED_MESSAGE = "You can't call this person";

export const dmNotAllowed = (message = DM_NOT_ALLOWED_MESSAGE) =>
  new HttpError(403, 'dm_not_allowed', message);

/**
 * `open`: an ordinary chat. `request`: it waits in their Message Requests. `refused`: their
 * "Who can send you direct messages" doesn't allow me (403 dm_not_allowed).
 */
export type DmGate = 'open' | 'request' | 'refused';

/**
 * We share a Space where `recipientId` allows DMs from its members (`space_members.allow_dms`)
 * and whose moderators haven't paused DMs (security actions: `spaces.dms_paused_until`).
 */
async function sharesDmSpace(dbx: DbOrTx, senderId: ID, recipientId: ID): Promise<boolean> {
  const rows = await rawRows<{ x: number }>(
    dbx,
    sql`select 1 as x from space_members r
        join space_members s on s.space_id = r.space_id and s.user_id = ${senderId}
        join spaces sp on sp.id = r.space_id
        where r.user_id = ${recipientId} and r.allow_dms
          and (sp.dms_paused_until is null or sp.dms_paused_until <= now())
        limit 1`,
  );
  return rows.length > 0;
}

/**
 * May `senderId` start a direct chat with `recipientId`, and how does it land?
 * - myself, a deleted account, or someone who saved me as a contact (friends are contacts
 *   both ways): `open`;
 * - their `whoCanDm` refuses me: `refused` — `friends` lets in no one else, `spaces` only
 *   members of a Space we share where they allow DMs (and DMs aren't paused), `everyone` anyone;
 * - else `request` when their `messageRequests` is on (and the server's), `open` when off.
 * Two queries at most; blocks are not looked at (see the file comment).
 */
export async function dmGate(dbx: DbOrTx, senderId: ID, recipientId: ID): Promise<DmGate> {
  if (senderId === recipientId) return 'open';
  const [row] = await dbx
    .select({
      settings: users.settings,
      deletedAt: users.deletedAt,
      saved: sql<boolean>`exists (select 1 from ${contacts} where ${contacts.ownerId} = ${users.id} and ${contacts.contactId} = ${senderId})`,
    })
    .from(users)
    .where(eq(users.id, recipientId))
    .limit(1);
  if (!row || row.deletedAt || row.saved) return 'open';
  const { whoCanDm, messageRequests } = settingsOf(row);
  if (whoCanDm === 'friends') return 'refused';
  if (whoCanDm === 'spaces' && !(await sharesDmSpace(dbx, senderId, recipientId))) return 'refused';
  return messageRequests && config.messageRequests ? 'request' : 'open';
}

// ---------------------------------------------------------------------------
// Messages (insertMessage)
// ---------------------------------------------------------------------------

/** What a direct-chat message does to message requests (`gateDirectMessage`). */
export interface DirectGate {
  /** Requests answered by this message: they unhide with it (JOIN), then chat:request-removed. */
  accepted: readonly ID[];
  /** Recipients whose row stays hidden, with no delivered receipt (a request, or a new chat). */
  held: readonly ID[];
  /** Recipients told through `chat:request` (pending requests the message reached). */
  notify: readonly ID[];
}

export const NO_DIRECT_GATE: DirectGate = Object.freeze({ accepted: [], held: [], notify: [] });

/** A message either of us can see in the chat (system messages don't count). */
async function hasHistory(dbx: DbOrTx, chatId: ID, recipientId: ID): Promise<boolean> {
  const rows = await rawRows<{ x: number }>(
    dbx,
    sql`select 1 as x from messages m
        where m.chat_id = ${chatId} and m.type <> 'system'
          and not exists (select 1 from message_hidden mh where mh.user_id = ${recipientId} and mh.message_id = m.id)
        limit 1`,
  );
  return rows.length > 0;
}

async function setRequestState(
  dbx: DbOrTx,
  chatId: ID,
  userId: ID,
  state: 'pending' | null,
): Promise<void> {
  await dbx
    .update(chatMembers)
    .set({ requestState: state })
    .where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, userId)));
}

/**
 * Message requests in the send transaction of a direct chat (`insertMessage`, under the chat
 * lock, before the insert). `actorId` is the sender, or the acting user of a system message:
 * - acting in a chat answers one's own request (replying, calling back, pinning…);
 * - the other member's row, when it is a request or has never been written to (hidden, no
 *   history either way), goes through the gate:
 *   - `open` (friends now, or they saved me): an ordinary chat — a request is accepted;
 *   - `refused`: 403 dm_not_allowed (system messages pass quietly, the row stays hidden);
 *   - `request`: it stays hidden; a new chat becomes `pending`; `pending` ones hear of it
 *     (`chat:request`), `ignored` ones never do;
 *   - calls need an accepted chat: 403 dm_not_allowed while it isn't `open`.
 * A recipient the message is withheld from (they blocked me) is answered the same way but
 * hears nothing, and a new chat stays as it is until a message reaches them.
 */
export async function gateDirectMessage(
  dbx: DbOrTx,
  input: { chatId: ID; actorId: ID; type: MessageType; withheld: readonly ID[] },
): Promise<DirectGate> {
  const { chatId, actorId } = input;
  const rows = await dbx
    .select({
      userId: chatMembers.userId,
      hidden: chatMembers.hidden,
      requestState: chatMembers.requestState,
    })
    .from(chatMembers)
    .where(and(eq(chatMembers.chatId, chatId), isNull(chatMembers.leftAt)));
  const accepted: ID[] = [];
  const mine = rows.find((r) => r.userId === actorId);
  if (mine?.requestState) {
    await setRequestState(dbx, chatId, actorId, null);
    accepted.push(actorId);
  }
  const peer = rows.find((r) => r.userId !== actorId);
  if (!peer) return { accepted, held: [], notify: [] };
  const state = peer.requestState;
  // Not a request, and accepted already (visible to them) or written in either way: ordinary.
  const fresh = !state && peer.hidden && !(await hasHistory(dbx, chatId, peer.userId));
  if (!state && !fresh) return { accepted, held: [], notify: [] };

  const gate = await dmGate(dbx, actorId, peer.userId);
  const withheld = input.withheld.includes(peer.userId);
  if (gate === 'open') {
    if (state && !withheld) {
      await setRequestState(dbx, chatId, peer.userId, null);
      accepted.push(peer.userId);
    }
    return { accepted, held: [], notify: [] };
  }
  const system = input.type === 'system';
  if (input.type === 'call') throw dmNotAllowed(CALL_NOT_ALLOWED_MESSAGE);
  if (!system && gate === 'refused') throw dmNotAllowed();
  const held = [peer.userId];
  if (system || withheld) return { accepted, held, notify: [] };
  if (!state) await setRequestState(dbx, chatId, peer.userId, 'pending');
  return { accepted, held, notify: state === 'ignored' ? [] : [peer.userId] };
}

// ---------------------------------------------------------------------------
// Friendship
// ---------------------------------------------------------------------------

/**
 * Becoming friends answers the message requests between a and b (either way, pending or
 * ignored): they become ordinary chats — JOIN (room + chat:upsert), then
 * chat:request-removed. Called under the friends pair lock, which never waits for a chat
 * lock: it takes row locks only.
 */
export async function acceptRequestsBetween(dbx: DbOrTx, fx: Effects, a: ID, b: ID): Promise<void> {
  if (a === b) return;
  const rows = await rawRows<{ chat_id: string; user_id: string }>(
    dbx,
    sql`update chat_members cm set request_state = null, hidden = false
        from chats c
        where c.direct_key = ${directChatKey(a, b)} and cm.chat_id = c.id
          and cm.request_state is not null and cm.left_at is null
        returning cm.chat_id, cm.user_id`,
  );
  for (const r of rows) {
    fx.join(r.user_id, r.chat_id);
    fxRequestRemoved(fx, r.chat_id, [r.user_id]);
  }
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/** `chat:request { chat }` → each user's devices, with their request as of the end of the tx. */
export function fxChatRequest(fx: Effects, chatId: ID, userIds: readonly ID[]): void {
  if (userIds.length === 0) return;
  let out = new Map<string, ChatSummary>();
  fx.add(
    () => {
      for (const userId of userIds) {
        const chat = out.get(pairKey(chatId, userId));
        if (chat?.request) emitToUser(userId, 'chat:request', { chat });
      }
    },
    async (dbx) => {
      out = await chatSummariesForPairs(
        dbx,
        userIds.map((userId) => ({ chatId, userId })),
        { includeHidden: true },
      );
    },
  );
}

/** `chat:request-removed { chatId }` → each user's devices (accepted or ignored). */
export function fxRequestRemoved(fx: Effects, chatId: ID, userIds: readonly ID[]): void {
  if (userIds.length) fx.toUsers(userIds, 'chat:request-removed', { chatId });
}
