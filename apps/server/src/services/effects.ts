/**
 * Post-commit side effects (socket fan-out, room joins/leaves, domain events).
 *
 * Pattern (docs "Fan-out rules": emit only after commit, in matrix order):
 *
 *   const result = await transact(async (tx, fx) => {
 *     const access = await requireActiveMember(tx, me, chatId);
 *     const { message } = await createMessage(tx, fx, { ... });   // registers its fan-out in fx
 *     fx.chatUpdated(chatId, { ... });                              // more steps, in order
 *     return message;
 *   });
 *   // here: committed, then every registered step emitted in registration order
 *
 * Three phases:
 * 1. REGISTER (inside the tx): services and handlers call `fx.*` in the exact order of the
 *    mutation → event matrix. Nothing is emitted yet.
 * 2. PREPARE (end of the tx callback, `fx.prepare(tx)`, done by `transact`): every payload
 *    that needs the database (ChatSummary per user, Message, watermarks, unread counts,
 *    admin lists…) is serialized in a fixed number of batched queries through `tx`, so it
 *    reflects exactly the committed state and no global `db` is touched inside the tx.
 * 3. FLUSH (right after commit, `fx.flush()`): all steps run SYNCHRONOUSLY in registration
 *    order (no awaits between emits, so a later transaction on the same chat — which had to
 *    wait for our chat lock — can never overtake our events), then domain events fire.
 *
 * If the transaction throws, nothing is emitted. A failing step is logged and skipped.
 * Outside `transact` (you manage the tx yourself): `await fx.prepare(tx)` as the LAST
 * statement of the tx callback, then `fx.flush()` after `db.transaction` resolved. Without a
 * transaction: `await fx.commit()` (prepares with the global db, then flushes).
 */
import type {
  ChatInfoChanges,
  ChatSummary,
  ID,
  Message,
  ServerToClientEvents,
} from '@enbox/shared';
import { db, type DbOrTx, type Tx } from '../db/index.js';
import type { ChatRow, MessageRow } from '../db/schema.js';
import { logger } from '../lib/logger.js';
import {
  clearChatRoom,
  emitToChat,
  emitToUser,
  emitToUsers,
  joinUserToChat,
  removeUserFromChat,
  type ChatEmitOptions,
} from '../realtime/emit.js';
import { adminIds, activeMemberCount, hiddenPinsByMember } from './chats.js';
import { domainEvents, type DomainEventMap, type DomainEventName } from './events.js';
import { pinnedMessageIds, messageUpdatedPayloads, toMessages } from './messages.js';
import { pairKey } from './sql.js';
import { chatSummariesForPairs } from './summaries.js';
import { diffWatermarks, readStates, type ReadState, type WatermarkDelta } from './watermarks.js';

type ServerEvent = keyof ServerToClientEvents;
type Payload<E extends ServerEvent> = Parameters<ServerToClientEvents[E]>[0];

interface Step {
  run: () => void;
}

export class Effects {
  private readonly steps: Step[] = [];
  private readonly domainSteps: Array<() => void> = [];
  private readonly prepares: Array<(dbx: DbOrTx) => Promise<void>> = [];
  private state: 'open' | 'prepared' | 'flushed' = 'open';

  // Batched payloads, filled by prepare().
  private readonly upserts: { userId: ID; chatId: ID }[] = [];
  private upsertOut = new Map<string, ChatSummary>();
  private readonly newMessages: MessageRow[] = [];
  private newMessageOut = new Map<ID, Message>();
  private readonly updatedIds: ID[] = [];
  private updatedOut = new Map<ID, { chatId: ID; message: Message; exceptUserIds: ID[] }>();
  private readonly watermarkDeltas: WatermarkDelta[] = [];
  private readonly lastWatermarkStep = new Map<ID, number>();
  private watermarkOut = new Map<ID, { userId: ID; payload: Payload<'chat:watermarks'> }[]>();
  private readonly reads: { userId: ID; chatId: ID }[] = [];
  private readOut = new Map<string, ReadState>();

  /** True when nothing was registered. */
  get isEmpty(): boolean {
    return this.steps.length === 0 && this.domainSteps.length === 0;
  }

  private assertOpen(): void {
    if (this.state !== 'open') throw new Error(`Effects: cannot register after ${this.state}`);
  }

  // -------------------------------------------------------------------------
  // Generic steps
  // -------------------------------------------------------------------------

  /** Register a synchronous post-commit step (optionally with a prepare hook run inside the tx). */
  add(run: () => void, prepare?: (dbx: DbOrTx) => Promise<void>): this {
    this.assertOpen();
    this.steps.push({ run });
    if (prepare) this.prepares.push(prepare);
    return this;
  }

  /** `emitToUser` after commit (viewer-specific payloads go to users, never rooms). */
  toUser<E extends ServerEvent>(userId: ID, event: E, payload: Payload<E>): this {
    return this.add(() => emitToUser(userId, event, payload));
  }

  toUsers<E extends ServerEvent>(userIds: Iterable<ID>, event: E, payload: Payload<E>): this {
    const ids = [...userIds];
    return this.add(() => emitToUsers(ids, event, payload));
  }

  /** `emitToChat` after commit (viewer-neutral payloads only). */
  toChat<E extends ServerEvent>(
    chatId: ID,
    event: E,
    payload: Payload<E>,
    opts?: ChatEmitOptions,
  ): this {
    return this.add(() => emitToChat(chatId, event, payload, opts));
  }

  /** Domain event (services/events.ts), fired after ALL socket steps of this transaction. */
  domain<E extends DomainEventName>(event: E, payload: DomainEventMap[E]): this {
    this.assertOpen();
    this.domainSteps.push(() => domainEvents.emit(event, payload));
    return this;
  }

  // -------------------------------------------------------------------------
  // Rooms & chat list (fan-out rules 2, 3, 5)
  // -------------------------------------------------------------------------

  /** `joinUserToChat(u, c)`: subscribe all of u's sockets to the chat room. */
  joinRoom(userId: ID, chatId: ID): this {
    return this.add(() => joinUserToChat(userId, chatId));
  }

  /** `removeUserFromChat(u, c)`. */
  leaveRoom(userId: ID, chatId: ID): this {
    return this.add(() => removeUserFromChat(userId, chatId));
  }

  /** `clearChatRoom(c)` (chat deleted). */
  clearRoom(chatId: ID): this {
    return this.add(() => clearChatRoom(chatId));
  }

  /**
   * `chat:upsert` → user:<u> with u's ChatSummary as of the end of the transaction (batched:
   * one serializer call for all upserts of the tx). Skipped for users without a visible row.
   */
  chatUpsert(userIds: ID | Iterable<ID>, chatId: ID): this {
    const ids = typeof userIds === 'string' ? [userIds] : [...userIds];
    for (const userId of ids) {
      this.assertOpen();
      this.upserts.push({ userId, chatId });
      this.steps.push({
        run: () => {
          const chat = this.upsertOut.get(pairKey(chatId, userId));
          if (chat) emitToUser(userId, 'chat:upsert', { chat });
        },
      });
    }
    return this;
  }

  /** Rule 2 prefix "JOIN(u)": `joinUserToChat(u, c)` then `chat:upsert` → user:<u>. */
  join(userId: ID, chatId: ID): this {
    return this.joinRoom(userId, chatId).chatUpsert(userId, chatId);
  }

  /**
   * Rule 3 suffix "LEAVE(u)" (left/removed; the system message must already be registered):
   * `chat:upsert` (membership left/removed) → user:<u>, then `removeUserFromChat(u, c)`.
   */
  leave(userId: ID, chatId: ID): this {
    return this.chatUpsert(userId, chatId).leaveRoom(userId, chatId);
  }

  /** Chat gone from u's list (deleted for me, unfollowed, hidden announcement row): leave room, then `chat:removed` → user:<u>. */
  removeChat(userId: ID, chatId: ID): this {
    return this.leaveRoom(userId, chatId).toUser(userId, 'chat:removed', { chatId });
  }

  /**
   * `chat:updated { chatId, changes }` → room (viewer-neutral metadata; rule 5).
   * `exceptUserIds`: members who must not hear about it (direct chats: a peer who blocked the actor).
   */
  chatUpdated(chatId: ID, changes: ChatInfoChanges, opts: { exceptUserIds?: ID[] } = {}): this {
    return this.toChat(
      chatId,
      'chat:updated',
      { chatId, changes },
      opts.exceptUserIds?.length ? { exceptUserIds: [...opts.exceptUserIds] } : undefined,
    );
  }

  /** `chat:updated { memberCount }` → room, with the count as of the end of the tx. */
  memberCountChanged(chatId: ID): this {
    let memberCount = 0;
    return this.add(
      () => emitToChat(chatId, 'chat:updated', { chatId, changes: { memberCount } }),
      async (dbx) => {
        memberCount = await activeMemberCount(dbx, chatId);
      },
    );
  }

  /**
   * `chat:members-changed` (rule 6): room for direct/group chats; only owner/admins (per
   * user) for channels and announcement groups.
   */
  membersChanged(chat: Pick<ChatRow, 'id' | 'type' | 'isAnnouncement'>): this {
    const adminsOnly = chat.type === 'channel' || chat.isAnnouncement;
    if (!adminsOnly) return this.toChat(chat.id, 'chat:members-changed', { chatId: chat.id });
    let admins: ID[] = [];
    return this.add(
      () => emitToUsers(admins, 'chat:members-changed', { chatId: chat.id }),
      async (dbx) => {
        admins = await adminIds(dbx, chat.id);
      },
    );
  }

  /**
   * `chat:pins { messageIds }` → room, with the pins as of the end of the tx. Members with a
   * `message_hidden` row on a pinned message (deleted for them, or withheld because they
   * blocked its sender) get their own list without it (→ user:<id>) instead of the room's.
   * `exceptUserIds`: members who must not hear about it at all (direct chats: a peer who
   * blocked the actor).
   */
  chatPins(chatId: ID, opts: { exceptUserIds?: ID[] } = {}): this {
    const except = [...new Set(opts.exceptUserIds ?? [])];
    let messageIds: ID[] = [];
    let hiddenFor = new Map<ID, Set<ID>>();
    return this.add(
      () => {
        emitToChat(
          chatId,
          'chat:pins',
          { chatId, messageIds },
          { exceptUserIds: [...except, ...hiddenFor.keys()] },
        );
        for (const [userId, hidden] of hiddenFor) {
          if (except.includes(userId)) continue;
          emitToUser(userId, 'chat:pins', {
            chatId,
            messageIds: messageIds.filter((id) => !hidden.has(id)),
          });
        }
      },
      async (dbx) => {
        messageIds = await pinnedMessageIds(dbx, chatId);
        hiddenFor = await hiddenPinsByMember(dbx, chatId, messageIds);
      },
    );
  }

  // -------------------------------------------------------------------------
  // Messages (rule 4)
  // -------------------------------------------------------------------------

  /** `message:new` → room once, except users who can't see it (withheld recipients, members who just left). */
  messageNew(row: MessageRow, opts: { exceptUserIds?: ID[] } = {}): this {
    this.assertOpen();
    this.newMessages.push(row);
    const except = [...new Set(opts.exceptUserIds ?? [])];
    this.steps.push({
      run: () => {
        const message = this.newMessageOut.get(row.id);
        if (message) emitToChat(row.chatId, 'message:new', { message }, { exceptUserIds: except });
      },
    });
    return this;
  }

  /**
   * `message:updated` → room except active members for whom the message is invisible (channels:
   * whole room) and `exceptUserIds` (direct chats: a peer who blocked the actor).
   */
  messageUpdated(messageId: ID, opts: { exceptUserIds?: ID[] } = {}): this {
    this.assertOpen();
    this.updatedIds.push(messageId);
    const extra = opts.exceptUserIds ?? [];
    this.steps.push({
      run: () => {
        const p = this.updatedOut.get(messageId);
        if (p)
          emitToChat(
            p.chatId,
            'message:updated',
            { message: p.message },
            { exceptUserIds: [...new Set([...p.exceptUserIds, ...extra])] },
          );
      },
    });
    return this;
  }

  /** `message:removed` → user:<userId> (delete for me) or → room (purge) when `userId` is omitted. */
  messagesRemoved(chatId: ID, messageIds: ID[], opts: { userId?: ID } = {}): this {
    if (messageIds.length === 0) return this;
    return opts.userId
      ? this.toUser(opts.userId, 'message:removed', { chatId, messageIds })
      : this.toChat(chatId, 'message:removed', { chatId, messageIds });
  }

  // -------------------------------------------------------------------------
  // Read state & watermarks
  // -------------------------------------------------------------------------

  /** `chat:read { lastReadSeq, unreadCount, unreadMentionCount, markedUnread }` → user:<u> (own devices). */
  chatRead(userId: ID, chatId: ID): this {
    this.assertOpen();
    this.reads.push({ userId, chatId });
    this.steps.push({
      run: () => {
        const s = this.readOut.get(pairKey(chatId, userId));
        if (s) emitToUser(userId, 'chat:read', { chatId, ...s });
      },
    });
    return this;
  }

  /**
   * `chat:watermarks` → user:<x> for every active member whose tick watermarks changed
   * because of the member-mark changes described by `delta` (never for channels; users who
   * just became active are skipped — their chat:upsert carries the watermarks).
   */
  watermarks(delta: WatermarkDelta): this {
    this.assertOpen();
    if (delta.members.length === 0 && delta.prevLastSeq === undefined && !delta.prevReadReceipts)
      return this;
    this.watermarkDeltas.push(delta);
    // Deltas of one chat are merged; the chat's emissions happen at its LAST registration
    // (e.g. after the last message:new of a multi-message forward).
    const index = this.steps.length;
    this.lastWatermarkStep.set(delta.chatId, index);
    this.steps.push({
      run: () => {
        if (this.lastWatermarkStep.get(delta.chatId) !== index) return;
        for (const w of this.watermarkOut.get(delta.chatId) ?? [])
          emitToUser(w.userId, 'chat:watermarks', w.payload);
      },
    });
    return this;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Serialize every pending payload through `dbx` (call as the LAST step inside the transaction). */
  async prepare(dbx: DbOrTx): Promise<void> {
    if (this.state !== 'open') throw new Error(`Effects.prepare(): already ${this.state}`);
    if (this.upserts.length) this.upsertOut = await chatSummariesForPairs(dbx, this.upserts);
    if (this.newMessages.length) {
      const out = await toMessages(dbx, null, this.newMessages, { fresh: true });
      this.newMessageOut = new Map(out.map((m) => [m.id, m]));
    }
    if (this.updatedIds.length)
      this.updatedOut = await messageUpdatedPayloads(dbx, this.updatedIds);
    if (this.reads.length) this.readOut = await readStates(dbx, this.reads);
    if (this.watermarkDeltas.length)
      this.watermarkOut = await diffWatermarks(dbx, this.watermarkDeltas);
    for (const p of this.prepares) await p(dbx);
    this.state = 'prepared';
  }

  /** Emit everything in registration order (synchronously), then fire domain events. */
  flush(): void {
    if (this.state === 'open')
      throw new Error('Effects.flush(): call prepare(tx) inside the transaction first');
    if (this.state === 'flushed') return;
    this.state = 'flushed';
    for (const step of this.steps) {
      try {
        step.run();
      } catch (err) {
        logger.error({ err }, 'post-commit effect failed');
      }
    }
    for (const fire of this.domainSteps) fire();
  }

  /** prepare(db) + flush() — for effects registered outside any transaction. */
  async commit(): Promise<void> {
    await this.prepare(db);
    this.flush();
  }
}

/**
 * Run `fn` in a transaction with an Effects collector: payloads are prepared at the end of
 * the transaction and flushed right after COMMIT. Returns `fn`'s result.
 */
export async function transact<T>(fn: (tx: Tx, fx: Effects) => Promise<T>): Promise<T> {
  const fx = new Effects();
  const result = await db.transaction(async (tx) => {
    const out = await fn(tx, fx);
    await fx.prepare(tx);
    return out;
  });
  fx.flush();
  return result;
}
