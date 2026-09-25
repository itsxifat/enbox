/**
 * Calls: state machine, persistence and fan-out (docs/ARCHITECTURE.md "Calls").
 *
 * Every mutation of an existing call runs through `runCallOp(callId, op)`: queued per call
 * in-process (state.ts), then ONE transaction that locks the chat row and then the `calls`
 * row `FOR UPDATE` (lock order: chats → calls → everything else; the chat lock is needed
 * because status transitions rewrite the call message), applies `op`, evaluates the end
 * rules (`finalize`) and registers the fan-out in `Effects`, so acks and broadcasts reflect
 * the committed state. Post-commit, in order:
 *   ring-stops → participant-left → participant-joined (+ call-socket binding) →
 *   call:incoming → call:ended | call:updated → message:updated → domain events → timers.
 *
 * Visibility: a callee who blocked the caller has a participant row with `hidden_at` set at
 * creation: never rung, never notified, never listed to themselves (their log and
 * `/calls/active` exclude it); the call ends `missed` at the ring timeout. `hidden_at` on a
 * terminal call means "removed from my call log".
 */
import { and, asc, eq, inArray, isNull, lte } from 'drizzle-orm';
import {
  MAX_CALL_PARTICIPANTS,
  USER_RATE_LIMITS,
  directChatKey,
  rooms,
  type Call,
  type CallMessagePayload,
  type CallParticipantStatus,
  type CallSignal,
  type CallStatus,
  type CallType,
  type IncomingCallPayload,
  type RingStopReason,
} from '@enbox/shared';
import { db, type DbOrTx, type Tx } from '../../db/index.js';
import {
  callParticipants,
  calls,
  chats,
  messages,
  type CallParticipantRow,
  type CallRow,
  type ChatRow,
} from '../../db/schema.js';
import {
  HttpError,
  badRequest,
  blocked,
  conflict,
  expired,
  forbidden,
  limitReached,
  notFound,
  notMember,
} from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { SERVER_RATE_LIMITS, assertUserLimit } from '../../lib/userLimit.js';
import { emitToUser } from '../../realtime/emit.js';
import type { AppSocket } from '../../realtime/types.js';
import {
  activeMemberCount,
  activeMemberIds,
  getChatAccess,
  lockChat,
  requireActiveMember,
} from '../../services/chats.js';
import { transact, type Effects } from '../../services/effects.js';
import { loadMediaMap, mediaUrl } from '../../services/media.js';
import { createMessage } from '../../services/messages.js';
import { pairKey, uniq } from '../../services/sql.js';
import {
  blockedEitherWayIds,
  blockersOf,
  getUserRows,
  ownersWhoSaved,
  settingsOf,
  toUserPublicsForPairs,
} from '../../services/users.js';
import {
  bindCallSocket,
  boundSocketId,
  callTimings,
  clearCallTimers,
  clearGrace,
  clearRingCheck,
  emitToRoom,
  isCallSocket,
  isSocketConnected,
  releaseCall,
  releaseCallSocket,
  scheduleGrace,
  scheduleRingCheck,
  takeSocketBindings,
  withCallQueue,
} from './state.js';

export const LIVE_CALL_STATUSES: CallStatus[] = ['ringing', 'ongoing'];
const PENDING_STATUSES: CallParticipantStatus[] = ['invited', 'ringing'];

export const isLive = (status: CallStatus) => status === 'ringing' || status === 'ongoing';
const isPending = (status: CallParticipantStatus) => status === 'invited' || status === 'ringing';

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

function durationSecOf(call: Pick<CallRow, 'status' | 'answeredAt' | 'endedAt'>): number | null {
  if (call.status !== 'ended' || !call.answeredAt || !call.endedAt) return null;
  return Math.max(0, Math.round((call.endedAt.getTime() - call.answeredAt.getTime()) / 1000));
}

/**
 * Wire `Call`. Participants are the same for every viewer who may see the call (a hidden
 * participant never receives it), so the payload is viewer-neutral among them.
 */
export function toCall(call: CallRow, parts: CallParticipantRow[]): Call {
  const ordered = [...parts].sort((a, b) =>
    a.userId === call.initiatorId
      ? -1
      : b.userId === call.initiatorId
        ? 1
        : a.userId < b.userId
          ? -1
          : a.userId > b.userId
            ? 1
            : 0,
  );
  return {
    id: call.id,
    chatId: call.chatId,
    type: call.type,
    isGroup: call.isGroup,
    initiatorId: call.initiatorId,
    status: call.status,
    createdAt: call.createdAt.toISOString(),
    answeredAt: call.answeredAt?.toISOString() ?? null,
    endedAt: call.endedAt?.toISOString() ?? null,
    durationSec: durationSecOf(call),
    participants: ordered.map((p) => ({
      userId: p.userId,
      status: p.status,
      joinedAt: p.joinedAt?.toISOString() ?? null,
      leftAt: p.leftAt?.toISOString() ?? null,
      audioMuted: p.audioMuted,
      videoOff: p.videoOff,
      screenSharing: p.screenSharing,
    })),
  };
}

/** `metadata.call` of the call's chat message. */
export function callMessagePayload(call: CallRow): CallMessagePayload {
  return {
    callId: call.id,
    callType: call.type,
    isGroup: call.isGroup,
    initiatorId: call.initiatorId,
    status: call.status,
    durationSec: durationSecOf(call),
  };
}

/** Calls with their participants (2 queries), keyed by id. */
export async function loadCallRows(
  dbx: DbOrTx,
  callIds: Iterable<string>,
): Promise<Map<string, { call: CallRow; parts: CallParticipantRow[] }>> {
  const ids = uniq(callIds);
  const out = new Map<string, { call: CallRow; parts: CallParticipantRow[] }>();
  if (ids.length === 0) return out;
  const rows = await dbx.select().from(calls).where(inArray(calls.id, ids));
  for (const call of rows) out.set(call.id, { call, parts: [] });
  const parts = await dbx
    .select()
    .from(callParticipants)
    .where(inArray(callParticipants.callId, ids));
  for (const p of parts) out.get(p.callId)?.parts.push(p);
  return out;
}

/** Callees who ring silently: they silence unknown callers and did not save the caller. */
async function silentUserIds(
  dbx: DbOrTx,
  calleeIds: string[],
  callerId: string,
): Promise<Set<string>> {
  if (calleeIds.length === 0) return new Set();
  const [rows, saved] = await Promise.all([
    getUserRows(dbx, calleeIds),
    ownersWhoSaved(dbx, callerId, calleeIds),
  ]);
  return new Set(
    calleeIds.filter((id) => {
      const row = rows.get(id);
      return !!row && settingsOf(row).silenceUnknownCallers && !saved.has(id);
    }),
  );
}

/** `call:incoming` payloads per callee (viewer-specific caller/peer). */
async function buildIncomingPayloads(
  dbx: DbOrTx,
  chat: ChatRow,
  call: Call,
  calleeIds: string[],
  silent: ReadonlySet<string>,
): Promise<Map<string, IncomingCallPayload>> {
  const out = new Map<string, IncomingCallPayload>();
  if (calleeIds.length === 0) return out;
  const callers = await toUserPublicsForPairs(
    dbx,
    calleeIds.map((viewerId) => ({ viewerId, subjectId: call.initiatorId })),
  );
  const memberCount = await activeMemberCount(dbx, chat.id);
  let avatarUrl: string | null = null;
  if (chat.type !== 'direct' && chat.avatarMediaId) {
    const m = (await loadMediaMap(dbx, [chat.avatarMediaId])).get(chat.avatarMediaId);
    avatarUrl = m ? mediaUrl(m.storageKey) : null;
  }
  for (const viewerId of calleeIds) {
    const caller = callers.get(pairKey(viewerId, call.initiatorId));
    if (!caller) continue;
    out.set(viewerId, {
      call,
      chat: {
        id: chat.id,
        type: chat.type,
        name: chat.type === 'direct' ? null : chat.name,
        avatarUrl,
        peer: chat.type === 'direct' ? caller : null,
        memberCount,
      },
      caller,
      silent: silent.has(viewerId),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Operation context
// ---------------------------------------------------------------------------

interface JoinedSocket {
  userId: string;
  socket: AppSocket | null;
  /** Emit `call:participant-joined` to the call room (not for the initiator at start). */
  announce: boolean;
}

export interface CallCtx {
  tx: Tx;
  fx: Effects;
  chat: ChatRow;
  call: CallRow;
  parts: CallParticipantRow[];
  /** Status when the operation started (a change rewrites the call message). */
  prevStatus: CallStatus;
  ringStops: { userId: string; reason: RingStopReason }[];
  joined: JoinedSocket[];
  left: string[];
  /** Newly rung users (`call:incoming`). */
  rung: string[];
  silent: Set<string>;
  /** Something visible changed → `call:updated`. */
  changed: boolean;
  ended: boolean;
  /** Extra post-commit steps (timers). */
  after: (() => void)[];
  /** The chat (and with it the call message) is deleted in this transaction: no message rewrite. */
  chatDeleted: boolean;
}

function newCtx(
  tx: Tx,
  fx: Effects,
  chat: ChatRow,
  call: CallRow,
  parts: CallParticipantRow[],
): CallCtx {
  return {
    tx,
    fx,
    chat,
    call,
    parts,
    prevStatus: call.status,
    ringStops: [],
    joined: [],
    left: [],
    rung: [],
    silent: new Set(),
    changed: false,
    ended: false,
    after: [],
    chatDeleted: false,
  };
}

function part(ctx: CallCtx, userId: string): CallParticipantRow | undefined {
  return ctx.parts.find((p) => p.userId === userId);
}

async function patchPart(
  ctx: CallCtx,
  userId: string,
  patch: Partial<typeof callParticipants.$inferInsert>,
): Promise<void> {
  const [row] = await ctx.tx
    .update(callParticipants)
    .set(patch)
    .where(and(eq(callParticipants.callId, ctx.call.id), eq(callParticipants.userId, userId)))
    .returning();
  if (row) ctx.parts = ctx.parts.map((p) => (p.userId === userId ? row : p));
}

async function insertParts(
  ctx: CallCtx,
  rows: (typeof callParticipants.$inferInsert)[],
): Promise<void> {
  if (rows.length === 0) return;
  ctx.parts.push(...(await ctx.tx.insert(callParticipants).values(rows).returning()));
}

async function patchCall(ctx: CallCtx, patch: Partial<typeof calls.$inferInsert>): Promise<void> {
  const [row] = await ctx.tx.update(calls).set(patch).where(eq(calls.id, ctx.call.id)).returning();
  ctx.call = row!;
}

/** Lock the call's chat, then the call row (`FOR UPDATE`), and load its participants. 404 when missing. */
async function lockCallCtx(tx: Tx, fx: Effects, callId: string): Promise<CallCtx> {
  const [ref] = await tx
    .select({ chatId: calls.chatId })
    .from(calls)
    .where(eq(calls.id, callId))
    .limit(1);
  if (!ref) throw notFound('Call');
  const chat = await lockChat(tx, ref.chatId);
  const [call] = await tx.select().from(calls).where(eq(calls.id, callId)).for('update');
  if (!call) throw notFound('Call');
  const parts = await tx
    .select()
    .from(callParticipants)
    .where(eq(callParticipants.callId, callId))
    .orderBy(asc(callParticipants.userId));
  return newCtx(tx, fx, chat, call, parts);
}

// ---------------------------------------------------------------------------
// End rules & fan-out
// ---------------------------------------------------------------------------

/**
 * Docs "State machine": a ringing call is `cancelled` when the initiator is no longer joined,
 * else ends when no invitee is invited/ringing/joined (`declined` if all declined, else
 * `missed`). Ongoing 1:1 → `ended` when fewer than 2 are joined; group → `ended` when fewer
 * than 2 are joined and nobody is ringing (or nobody is joined at all).
 */
function endVerdict(ctx: CallCtx): { status: CallStatus; reason: RingStopReason } | null {
  const { call } = ctx;
  const invitees = ctx.parts.filter((p) => p.userId !== call.initiatorId);
  const joined = ctx.parts.filter((p) => p.status === 'joined').length;
  const pending = ctx.parts.filter((p) => isPending(p.status)).length;
  if (call.status === 'ringing') {
    if (part(ctx, call.initiatorId)?.status !== 'joined')
      return { status: 'cancelled', reason: 'cancelled' };
    if (invitees.some((p) => p.status === 'joined' || isPending(p.status))) return null;
    const declined = invitees.length > 0 && invitees.every((p) => p.status === 'declined');
    return { status: declined ? 'declined' : 'missed', reason: 'ended' };
  }
  if (!call.isGroup) return joined < 2 ? { status: 'ended', reason: 'ended' } : null;
  if (joined === 0 || (joined < 2 && pending === 0)) return { status: 'ended', reason: 'ended' };
  return null;
}

/** Terminal transition: invited/ringing → missed (ring-stop `reason`), joined → left. */
async function endCall(ctx: CallCtx, status: CallStatus, reason: RingStopReason): Promise<void> {
  const now = new Date();
  for (const p of ctx.parts)
    if (isPending(p.status) && !p.hiddenAt) ctx.ringStops.push({ userId: p.userId, reason });
  await ctx.tx
    .update(callParticipants)
    .set({ status: 'missed' })
    .where(
      and(
        eq(callParticipants.callId, ctx.call.id),
        inArray(callParticipants.status, PENDING_STATUSES),
      ),
    );
  await ctx.tx
    .update(callParticipants)
    .set({ status: 'left', leftAt: now, disconnectedAt: null })
    .where(and(eq(callParticipants.callId, ctx.call.id), eq(callParticipants.status, 'joined')));
  ctx.parts = await ctx.tx
    .select()
    .from(callParticipants)
    .where(eq(callParticipants.callId, ctx.call.id))
    .orderBy(asc(callParticipants.userId));
  await patchCall(ctx, { status, endedAt: now });
  ctx.ended = true;
}

function nextRingDeadline(ctx: CallCtx): number | null {
  let next: number | null = null;
  for (const p of ctx.parts) {
    if (!isPending(p.status)) continue;
    const at = p.invitedAt.getTime() + callTimings.ringTimeoutMs;
    if (next === null || at < next) next = at;
  }
  return next;
}

/** End rules, call-message rewrite, then register the whole fan-out (see module doc). */
async function finalize(ctx: CallCtx): Promise<void> {
  if (isLive(ctx.call.status)) {
    const verdict = endVerdict(ctx);
    if (verdict) await endCall(ctx, verdict.status, verdict.reason);
  }
  const messageChanged =
    ctx.call.status !== ctx.prevStatus && !!ctx.call.messageId && !ctx.chatDeleted;
  if (messageChanged) {
    await ctx.tx
      .update(messages)
      .set({ metadata: { call: callMessagePayload(ctx.call) } })
      .where(eq(messages.id, ctx.call.messageId!));
  }

  const { fx } = ctx;
  const callId = ctx.call.id;
  const chatId = ctx.call.chatId;
  const call = toCall(ctx.call, ctx.parts);
  const visible = ctx.parts.filter((p) => !p.hiddenAt).map((p) => p.userId);
  const ended = ctx.ended;

  // 1. Ring stops (every device of the user).
  for (const rs of ctx.ringStops)
    fx.toUser(rs.userId, 'call:ring-stop', { callId, reason: rs.reason });

  // 2. Leavers: their call socket leaves the rooms, then peers learn about it.
  for (const userId of ctx.left) {
    fx.add(() => {
      clearGrace(callId, userId);
      releaseCallSocket(callId, userId);
      emitToRoom(rooms.call(callId), 'call:participant-left', { callId, userId });
    });
  }

  // 3. Newcomers (accept/join/rejoin): peers first, then the new call socket joins the rooms.
  if (!ended) {
    for (const j of ctx.joined) {
      fx.add(() => {
        clearGrace(callId, j.userId);
        releaseCallSocket(callId, j.userId);
        if (j.announce)
          emitToRoom(rooms.call(callId), 'call:participant-joined', { callId, userId: j.userId });
        if (!j.socket) return;
        if (j.socket.disconnected) {
          // Lost before we could bind it: treat like a call-socket disconnect.
          void callSocketGone(callId, j.userId);
          return;
        }
        bindCallSocket(callId, j.userId, j.socket);
      });
    }
  }

  // 4. Ring the newly invited (viewer-specific payloads, prepared inside the tx).
  const rung = ended ? [] : [...ctx.rung];
  if (rung.length) {
    let payloads = new Map<string, IncomingCallPayload>();
    const silent = new Set(ctx.silent);
    const chat = ctx.chat;
    fx.add(
      () => {
        for (const userId of rung) {
          const p = payloads.get(userId);
          if (p) emitToUser(userId, 'call:incoming', p);
        }
      },
      async (dbx) => {
        payloads = await buildIncomingPayloads(dbx, chat, call, rung, silent);
      },
    );
  }

  // 5. Call state to every visible participant.
  if (ended) {
    fx.toUsers(visible, 'call:ended', { callId, status: ctx.call.status, call });
    fx.add(() => {
      releaseCall(callId);
      clearCallTimers(callId);
    });
  } else if (ctx.changed) {
    const rungSet = new Set(rung);
    fx.toUsers(
      visible.filter((u) => !rungSet.has(u)),
      'call:updated',
      { call },
    );
  }

  // 6. The chat's call message.
  if (messageChanged) fx.messageUpdated(ctx.call.messageId!);

  // 7. Domain events (push), fired after all socket steps.
  if (rung.length) {
    fx.domain('call.ringing', {
      callId,
      chatId,
      callerId: ctx.call.initiatorId,
      callType: ctx.call.type,
      isGroup: ctx.call.isGroup,
      userIds: rung,
      silentUserIds: rung.filter((u) => ctx.silent.has(u)),
    });
  }
  for (const rs of ctx.ringStops) {
    fx.domain('call.ring-stopped', {
      callId,
      chatId,
      userId: rs.userId,
      reason: rs.reason,
      finalStatus: part(ctx, rs.userId)?.status ?? 'missed',
    });
  }
  if (ended)
    fx.domain('call.ended', { callId, chatId, status: ctx.call.status, participantIds: visible });

  // 8. Timers.
  for (const step of ctx.after) fx.add(step);
  if (!ended) {
    const next = nextRingDeadline(ctx);
    fx.add(() =>
      next === null
        ? clearRingCheck(callId)
        : scheduleRingCheck(callId, next, () => void expireRinging(callId)),
    );
  }
}

/** Lock + op + finalize inside the caller's transaction (account deletion hook). */
async function applyInTx<T>(
  tx: Tx,
  fx: Effects,
  callId: string,
  op: (ctx: CallCtx) => Promise<T>,
): Promise<{ result: T; call: Call }> {
  const ctx = await lockCallCtx(tx, fx, callId);
  const result = await op(ctx);
  await finalize(ctx);
  return { result, call: toCall(ctx.call, ctx.parts) };
}

function uniqueViolation(err: unknown): string | null {
  let e = err as { code?: string; constraint?: string; cause?: unknown } | undefined;
  for (let i = 0; e && i < 5; i++) {
    if (e.code === '23505') return e.constraint ?? '';
    e = e.cause as typeof e;
  }
  return null;
}

/** Map DB invariant violations (races) to API errors. */
async function mapDbErrors<T>(fn: () => Promise<T>, chatId?: string): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const constraint = uniqueViolation(err);
    if (constraint === null) throw err;
    if (constraint === 'calls_chat_live_uq' && chatId) {
      const [live] = await db
        .select({ id: calls.id })
        .from(calls)
        .where(and(eq(calls.chatId, chatId), inArray(calls.status, LIVE_CALL_STATUSES)))
        .limit(1);
      if (live) throw liveCallConflict(live.id);
    }
    if (constraint === 'call_participants_one_joined_uq')
      throw conflict('You are already in another call');
    throw conflict('The call changed, try again');
  }
}

/** Queue + transaction + lock + op + finalize. Resolves with the op result and the call as committed. */
export function runCallOp<T>(
  callId: string,
  op: (ctx: CallCtx) => Promise<T>,
): Promise<{ result: T; call: Call }> {
  return withCallQueue(callId, () =>
    mapDbErrors(() => transact((tx, fx) => applyInTx(tx, fx, callId, op))),
  );
}

function logOpError(err: unknown, what: string, callId: string): void {
  if (err instanceof HttpError && err.status < 500) return;
  logger.error({ err, callId }, `calls: ${what} failed`);
}

// ---------------------------------------------------------------------------
// Small queries
// ---------------------------------------------------------------------------

function liveCallConflict(callId: string): HttpError {
  return new HttpError(409, 'conflict', 'A call is already in progress in this chat', { callId });
}

/** The call a user is currently joined to, if any. */
async function joinedCallId(dbx: DbOrTx, userId: string): Promise<string | null> {
  const [row] = await dbx
    .select({ callId: callParticipants.callId })
    .from(callParticipants)
    .where(and(eq(callParticipants.userId, userId), eq(callParticipants.status, 'joined')))
    .limit(1);
  return row?.callId ?? null;
}

/** Those of `userIds` joined to some call ("busy"). */
async function joinedUserIds(dbx: DbOrTx, userIds: string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rows = await dbx
    .select({ userId: callParticipants.userId })
    .from(callParticipants)
    .where(and(inArray(callParticipants.userId, userIds), eq(callParticipants.status, 'joined')));
  return new Set(rows.map((r) => r.userId));
}

function initialMedia(type: CallType, input: { audioMuted?: boolean; videoOff?: boolean }) {
  return {
    audioMuted: input.audioMuted ?? false,
    videoOff: input.videoOff ?? type === 'audio',
    screenSharing: false,
  };
}

// ---------------------------------------------------------------------------
// Participant transitions used by several operations
// ---------------------------------------------------------------------------

async function leaveParticipant(ctx: CallCtx, userId: string): Promise<void> {
  await patchPart(ctx, userId, { status: 'left', leftAt: new Date(), disconnectedAt: null });
  ctx.left.push(userId);
  ctx.changed = true;
}

/** Forced leave (chat left/removed, block, revoked session, account deletion). */
async function forceLeave(ctx: CallCtx, userId: string): Promise<void> {
  if (!isLive(ctx.call.status)) return;
  const p = part(ctx, userId);
  if (!p) return;
  if (p.status === 'joined') {
    await leaveParticipant(ctx, userId);
  } else if (isPending(p.status)) {
    await patchPart(ctx, userId, { status: 'missed' });
    if (!p.hiddenAt) ctx.ringStops.push({ userId, reason: 'ended' });
    ctx.changed = true;
  }
}

// ---------------------------------------------------------------------------
// Socket operations
// ---------------------------------------------------------------------------

export interface Actor {
  socket: AppSocket;
  userId: string;
  sessionId: string;
}

/**
 * `call:start`: eligibility (canCall; direct: not blocked by me, peer not deleted, not self;
 * never channels), one live call per chat (409 conflict + details.callId), busy caller (409),
 * invitees (`userIds` ∩ active members, or all others ≤ MAX_CALL_PARTICIPANTS − 1; groups
 * skip blocks either way; a direct callee who blocked me is a hidden participant), busy
 * invitees (status busy, not rung), the call message, then rings. The socket becomes my
 * call socket.
 */
export async function startCall(
  actor: Actor,
  input: {
    chatId: string;
    type: CallType;
    userIds?: string[];
    audioMuted?: boolean;
    videoOff?: boolean;
  },
): Promise<{ call: Call }> {
  const { userId, sessionId, socket } = actor;
  assertUserLimit(userId, 'callStart', USER_RATE_LIMITS.callStart);
  const call = await mapDbErrors(
    () =>
      transact(async (tx, fx) => {
        const access = await getChatAccess(tx, userId, input.chatId, { lock: true });
        if (access.membership !== 'active') throw notMember();
        const chat = access.chat;
        if (chat.type === 'channel') throw forbidden('Calls are not available in channels');
        const peer = access.peer;
        if (chat.type === 'direct') {
          if (!peer || peer.id === userId) throw forbidden("You can't call yourself");
          if (peer.isBlocked) throw blocked('Unblock this contact to call them');
          if (peer.isDeleted) throw forbidden('This account was deleted');
        }
        if (!access.permissions.canCall)
          throw forbidden('Only admins can start calls in this group');

        const [live] = await tx
          .select({ id: calls.id })
          .from(calls)
          .where(and(eq(calls.chatId, chat.id), inArray(calls.status, LIVE_CALL_STATUSES)))
          .limit(1);
        if (live) throw liveCallConflict(live.id);
        if (await joinedCallId(tx, userId)) throw conflict('You are already in another call');

        let invitees: string[];
        if (chat.type === 'direct') {
          if (input.userIds && (input.userIds.length !== 1 || input.userIds[0] !== peer!.id)) {
            throw badRequest('userIds: only the other participant can be called in a direct chat');
          }
          invitees = [peer!.id];
        } else {
          const others = (await activeMemberIds(tx, chat.id)).filter((id) => id !== userId);
          if (input.userIds) {
            const members = new Set(others);
            invitees = input.userIds.filter((id) => members.has(id));
          } else {
            if (others.length > MAX_CALL_PARTICIPANTS - 1) {
              throw badRequest(
                `userIds: choose at most ${MAX_CALL_PARTICIPANTS - 1} members to call`,
              );
            }
            invitees = others;
          }
          const blockedIds = await blockedEitherWayIds(tx, userId, invitees);
          invitees = invitees.filter((id) => !blockedIds.has(id));
        }
        if (invitees.length === 0) throw badRequest('userIds: nobody to call');

        const hidden =
          chat.type === 'direct' ? await blockersOf(tx, userId, invitees) : new Set<string>();
        const busy = await joinedUserIds(
          tx,
          invitees.filter((id) => !hidden.has(id)),
        );
        const now = new Date();
        const [row] = await tx
          .insert(calls)
          .values({
            chatId: chat.id,
            initiatorId: userId,
            type: input.type,
            isGroup: chat.type === 'group',
            status: 'ringing',
            createdAt: now,
          })
          .returning();
        const parts = await tx
          .insert(callParticipants)
          .values([
            {
              callId: row!.id,
              userId,
              status: 'joined',
              invitedAt: now,
              joinedAt: now,
              sessionId,
              ...initialMedia(input.type, input),
            },
            ...invitees.map((id) => ({
              callId: row!.id,
              userId: id,
              status: (busy.has(id) ? 'busy' : 'invited') as CallParticipantStatus,
              invitedAt: now,
              hiddenAt: hidden.has(id) ? now : null,
            })),
          ])
          .returning();
        const { message } = await createMessage(tx, fx, {
          chatId: chat.id,
          senderId: userId,
          type: 'call',
          metadata: { call: callMessagePayload(row!) },
        });
        const [linked] = await tx
          .update(calls)
          .set({ messageId: message.id })
          .where(eq(calls.id, row!.id))
          .returning();

        const ctx = newCtx(tx, fx, chat, linked!, parts);
        ctx.rung = invitees.filter((id) => !hidden.has(id) && !busy.has(id));
        ctx.silent = await silentUserIds(tx, ctx.rung, userId);
        ctx.joined.push({ userId, socket, announce: false });
        ctx.changed = true;
        await finalize(ctx);
        return toCall(ctx.call, ctx.parts);
      }),
    input.chatId,
  );
  return { call };
}

/**
 * `call:accept` / `call:join` (same semantics): the socket becomes my call socket. Accept =
 * my participant is invited/ringing; join = any active member of a live GROUP call (a
 * declined/missed/left participant too). Busy → 409, full → 409 limit_reached,
 * ringing → ongoing on the first answer.
 */
export async function joinCall(
  actor: Actor,
  input: { callId: string; audioMuted?: boolean; videoOff?: boolean },
): Promise<{ call: Call }> {
  const { userId, sessionId, socket } = actor;
  const { call } = await runCallOp(input.callId, async (ctx) => {
    const mine = part(ctx, userId);
    if (mine?.hiddenAt) throw notFound('Call');
    await requireActiveMember(ctx.tx, userId, ctx.chat.id, { chat: ctx.chat, allowHidden: true });
    if (!isLive(ctx.call.status)) throw expired('This call has ended');
    if (mine?.status === 'joined') {
      if (boundSocketId(ctx.call.id, userId) === socket.id) return;
      throw conflict('You are already in this call on another device');
    }
    const ringingMe = !!mine && isPending(mine.status);
    if (!ctx.call.isGroup && !ringingMe) throw forbidden('This call is not ringing you');
    if (await joinedCallId(ctx.tx, userId)) throw conflict('You are already in another call');
    if (ctx.parts.filter((p) => p.status === 'joined').length >= MAX_CALL_PARTICIPANTS) {
      throw limitReached(`A call can have at most ${MAX_CALL_PARTICIPANTS} participants`);
    }
    const now = new Date();
    const media = initialMedia(ctx.call.type, input);
    if (mine) {
      await patchPart(ctx, userId, {
        status: 'joined',
        joinedAt: now,
        leftAt: null,
        sessionId,
        disconnectedAt: null,
        ...media,
      });
    } else {
      await insertParts(ctx, [
        {
          callId: ctx.call.id,
          userId,
          status: 'joined',
          invitedAt: now,
          joinedAt: now,
          sessionId,
          ...media,
        },
      ]);
    }
    if (ctx.call.status === 'ringing') await patchCall(ctx, { status: 'ongoing', answeredAt: now });
    if (ringingMe) ctx.ringStops.push({ userId, reason: 'answered_elsewhere' });
    ctx.joined.push({ userId, socket, announce: true });
    ctx.changed = true;
  });
  return { call };
}

/**
 * `call:rejoin`: reclaim my joined participant after a reconnect — within
 * CALL_RECONNECT_GRACE_MS of the call socket's disconnect, or from the same session — once
 * the previous call socket is gone: while it is still connected → 409 conflict (another
 * device, or another tab sharing this session's token, can't take the call over). Acts as a
 * newcomer (`call:participant-joined`).
 */
export async function rejoinCall(
  actor: Actor,
  input: { callId: string; audioMuted?: boolean; videoOff?: boolean },
): Promise<{ call: Call }> {
  const { userId, sessionId, socket } = actor;
  const { call } = await runCallOp(input.callId, async (ctx) => {
    const mine = part(ctx, userId);
    if (!mine || mine.hiddenAt) throw notFound('Call');
    if (!isLive(ctx.call.status)) throw expired('This call has ended');
    if (mine.status !== 'joined') throw conflict('You are no longer in this call');
    const bound = boundSocketId(ctx.call.id, userId);
    if (bound === socket.id) return;
    if (bound && isSocketConnected(bound))
      throw conflict('This call is active in another tab or on another device');
    const sameSession = mine.sessionId === sessionId;
    const inGrace =
      !!mine.disconnectedAt &&
      Date.now() - mine.disconnectedAt.getTime() <= callTimings.reconnectGraceMs;
    if (!sameSession && !inGrace) {
      if (!mine.disconnectedAt) throw conflict('This call is active on another device');
      throw expired('The reconnect window has passed');
    }
    await patchPart(ctx, userId, {
      sessionId,
      disconnectedAt: null,
      ...initialMedia(ctx.call.type, input),
    });
    ctx.joined.push({ userId, socket, announce: true });
    ctx.changed = true;
  });
  return { call };
}

/** `call:ringing`: a (non-silent) device of mine is ringing → participant `ringing`. */
export async function markRinging(userId: string, callId: string): Promise<void> {
  await runCallOp(callId, async (ctx) => {
    const mine = part(ctx, userId);
    if (!mine || mine.hiddenAt || mine.status !== 'invited' || !isLive(ctx.call.status)) return;
    if ((await silentUserIds(ctx.tx, [userId], ctx.call.initiatorId)).has(userId)) return;
    await patchPart(ctx, userId, { status: 'ringing' });
    ctx.changed = true;
  });
}

/** `call:decline` (any of my devices). */
export async function declineCall(userId: string, callId: string): Promise<void> {
  await runCallOp(callId, async (ctx) => {
    const mine = part(ctx, userId);
    if (!mine || mine.hiddenAt || !isPending(mine.status) || !isLive(ctx.call.status)) return;
    await patchPart(ctx, userId, { status: 'declined' });
    ctx.ringStops.push({ userId, reason: 'declined_elsewhere' });
    ctx.changed = true;
  });
}

/**
 * `call:leave` (call socket only): leave, or cancel when I started it and it is still ringing.
 * The call-socket rule is evaluated when the op runs: the socket bound then (an
 * accept/join/rejoin of this socket queued earlier has bound it), or — nothing bound any
 * more — the socket that WAS the call socket when the leave arrived (`wasCallSocket`, taken
 * by the calls socket middleware on packet receipt): it disconnected meanwhile, and the
 * leave still counts at once (no reconnect grace).
 */
export async function leaveCall(
  actor: Actor,
  callId: string,
  opts: { wasCallSocket?: boolean } = {},
): Promise<void> {
  const { userId, socket } = actor;
  const wasCallSocket = opts.wasCallSocket ?? isCallSocket(socket, callId, userId);
  const boundNow = boundSocketId(callId, userId);
  if (!wasCallSocket && boundNow && boundNow !== socket.id) return; // another device holds the call
  await runCallOp(callId, async (ctx) => {
    const mine = part(ctx, userId);
    if (!mine || mine.status !== 'joined' || !isLive(ctx.call.status)) return;
    const bound = boundSocketId(ctx.call.id, userId);
    if (bound ? bound !== socket.id : !wasCallSocket) return;
    await leaveParticipant(ctx, userId);
  });
}

/**
 * `call:invite` (group calls, joined participants with `canCall`): ring more active members. Re-inviting a
 * declined/missed/busy/left participant resets `invited_at`; users already joined or ringing
 * and users with a block either way with the inviter are skipped; busy ones get `busy`.
 */
export async function inviteToCall(
  userId: string,
  input: { callId: string; userIds: string[] },
): Promise<{ call: Call }> {
  const { call } = await runCallOp(input.callId, async (ctx) => {
    const mine = part(ctx, userId);
    if (!mine || mine.hiddenAt) throw notFound('Call');
    if (!isLive(ctx.call.status)) throw expired('This call has ended');
    if (!ctx.call.isGroup) throw forbidden('Only group calls can have more participants');
    if (mine.status !== 'joined') throw forbidden('Join the call to add people');
    // Ringing members is what `canCall` grants (announcement groups / admins-only groups: admins).
    const access = await requireActiveMember(ctx.tx, userId, ctx.chat.id, { chat: ctx.chat });
    if (!access.permissions.canCall) throw forbidden('Only admins can add people to this call');

    const members = new Set(await activeMemberIds(ctx.tx, ctx.chat.id));
    let targets = input.userIds.filter((id) => id !== userId && members.has(id));
    const blockedIds = await blockedEitherWayIds(ctx.tx, userId, targets);
    targets = targets.filter((id) => {
      if (blockedIds.has(id)) return false;
      const p = part(ctx, id);
      return !p || !(p.status === 'joined' || isPending(p.status));
    });
    if (targets.length === 0) return;
    const active = ctx.parts.filter((p) => p.status === 'joined' || isPending(p.status)).length;
    if (active + targets.length > MAX_CALL_PARTICIPANTS) {
      throw limitReached(`A call can have at most ${MAX_CALL_PARTICIPANTS} participants`);
    }
    const busy = await joinedUserIds(ctx.tx, targets);
    const now = new Date();
    const inserts: (typeof callParticipants.$inferInsert)[] = [];
    for (const id of targets) {
      const status: CallParticipantStatus = busy.has(id) ? 'busy' : 'invited';
      if (part(ctx, id)) await patchPart(ctx, id, { status, invitedAt: now });
      else inserts.push({ callId: ctx.call.id, userId: id, status, invitedAt: now });
    }
    await insertParts(ctx, inserts);
    ctx.rung = targets.filter((id) => !busy.has(id));
    ctx.silent = await silentUserIds(ctx.tx, ctx.rung, ctx.call.initiatorId);
    ctx.changed = true;
  });
  return { call };
}

/** `call:signal` (call socket only): relay to the target's call socket (joined participants only). */
export function relaySignal(
  actor: Actor,
  input: { callId: string; toUserId: string; signal: CallSignal },
): void {
  const { userId, socket } = actor;
  if (input.toUserId === userId || !isCallSocket(socket, input.callId, userId)) return;
  emitToRoom(rooms.callMember(input.callId, input.toUserId), 'call:signal', {
    callId: input.callId,
    fromUserId: userId,
    signal: input.signal,
  });
}

/** `call:media` (call socket only): persist my flags and broadcast them to the call room. */
export async function updateMediaState(
  actor: Actor,
  input: { callId: string; audioMuted: boolean; videoOff: boolean; screenSharing: boolean },
): Promise<void> {
  const { userId, socket } = actor;
  if (!isCallSocket(socket, input.callId, userId)) return;
  assertUserLimit(socket.id, 'call:media', SERVER_RATE_LIMITS.callMedia);
  const [row] = await db
    .update(callParticipants)
    .set({
      audioMuted: input.audioMuted,
      videoOff: input.videoOff,
      screenSharing: input.screenSharing,
    })
    .where(
      and(
        eq(callParticipants.callId, input.callId),
        eq(callParticipants.userId, userId),
        eq(callParticipants.status, 'joined'),
      ),
    )
    .returning({ userId: callParticipants.userId });
  if (!row) return;
  emitToRoom(rooms.call(input.callId), 'call:media', {
    callId: input.callId,
    audioMuted: input.audioMuted,
    videoOff: input.videoOff,
    screenSharing: input.screenSharing,
    userId,
  });
}

// ---------------------------------------------------------------------------
// Disconnects, timeouts, forced leaves
// ---------------------------------------------------------------------------

/**
 * The call socket of `userId` is gone. Session revoked (its `session_id` was nulled by the
 * FK) → leave now; otherwise set `disconnected_at` (emit nothing) and start the grace timer.
 */
export async function callSocketGone(callId: string, userId: string): Promise<void> {
  try {
    await runCallOp(callId, async (ctx) => {
      const p = part(ctx, userId);
      if (!isLive(ctx.call.status) || !p || p.status !== 'joined') return;
      if (boundSocketId(callId, userId)) return; // a new call socket was bound meanwhile
      if (!p.sessionId) {
        await leaveParticipant(ctx, userId);
        return;
      }
      if (p.disconnectedAt) return;
      await patchPart(ctx, userId, { disconnectedAt: new Date() });
      ctx.after.push(() =>
        scheduleGrace(
          callId,
          userId,
          callTimings.reconnectGraceMs,
          () => void expireGrace(callId, userId),
        ),
      );
    });
  } catch (err) {
    logOpError(err, 'disconnect', callId);
  }
}

/** Socket disconnect handler: every call this socket was the call socket of. */
export function onSocketDisconnect(socket: AppSocket): void {
  for (const { callId, userId } of takeSocketBindings(socket.id))
    void callSocketGone(callId, userId);
}

/** Reconnect grace over: the participant leaves (end rules apply). */
export async function expireGrace(callId: string, userId: string): Promise<void> {
  try {
    await runCallOp(callId, async (ctx) => {
      const p = part(ctx, userId);
      if (!isLive(ctx.call.status) || !p || p.status !== 'joined' || !p.disconnectedAt) return;
      if (boundSocketId(callId, userId)) return;
      const due = p.disconnectedAt.getTime() + callTimings.reconnectGraceMs;
      if (due > Date.now()) {
        ctx.after.push(() =>
          scheduleGrace(callId, userId, due - Date.now(), () => void expireGrace(callId, userId)),
        );
        return;
      }
      await leaveParticipant(ctx, userId);
    });
  } catch (err) {
    logOpError(err, 'grace expiry', callId);
  }
}

/** Ring timeout: invitees ringing for CALL_RING_TIMEOUT_MS since `invited_at` → missed. */
export async function expireRinging(callId: string): Promise<void> {
  try {
    await runCallOp(callId, async (ctx) => {
      if (!isLive(ctx.call.status)) return;
      const now = Date.now();
      for (const p of [...ctx.parts]) {
        if (!isPending(p.status) || p.invitedAt.getTime() + callTimings.ringTimeoutMs > now)
          continue;
        await patchPart(ctx, p.userId, { status: 'missed' });
        if (!p.hiddenAt) ctx.ringStops.push({ userId: p.userId, reason: 'timeout' });
        ctx.changed = true;
      }
    });
  } catch (err) {
    logOpError(err, 'ring timeout', callId);
  }
}

async function liveCallIdOfChat(dbx: DbOrTx, chatId: string): Promise<string | null> {
  const [row] = await dbx
    .select({ id: calls.id })
    .from(calls)
    .where(and(eq(calls.chatId, chatId), inArray(calls.status, LIVE_CALL_STATUSES)))
    .limit(1);
  return row?.id ?? null;
}

/** Forced leave of the chat's live call (the user left / was removed / unfollowed). */
export async function forceLeaveChatCall(chatId: string, userId: string): Promise<void> {
  const callId = await liveCallIdOfChat(db, chatId);
  if (!callId) return;
  try {
    await runCallOp(callId, (ctx) => forceLeave(ctx, userId));
  } catch (err) {
    logOpError(err, 'forced leave', callId);
  }
}

/**
 * A block between direct-chat peers (`PUT /blocks/:u`, after commit): the blocker is forced
 * out of their live 1:1 call, which ends it (ongoing → ended, ringing → cancelled/missed).
 */
export async function forceLeaveDirectCall(blockerId: string, blockedId: string): Promise<void> {
  const [chat] = await db
    .select({ id: chats.id })
    .from(chats)
    .where(eq(chats.directKey, directChatKey(blockerId, blockedId)))
    .limit(1);
  if (chat) await forceLeaveChatCall(chat.id, blockerId);
}

/**
 * Chat deletion (community deactivation deletes the announcement group; inside the deleting
 * transaction, the chats already locked): every live call of these chats ends — ongoing →
 * `ended`, ringing → `cancelled` — with the normal fan-out (ring-stops + `call_cancel`,
 * `call:ended` → visible participants, call sockets released, timers cleared). The call
 * message is not rewritten (it is deleted with the chat).
 */
export async function endChatCallsTx(tx: Tx, fx: Effects, chatIds: string[]): Promise<void> {
  const live = await tx
    .select({ id: calls.id })
    .from(calls)
    .where(and(inArray(calls.chatId, chatIds), inArray(calls.status, LIVE_CALL_STATUSES)))
    .orderBy(asc(calls.chatId));
  for (const { id } of live) {
    await applyInTx(tx, fx, id, async (ctx) => {
      ctx.chatDeleted = true;
      if (!isLive(ctx.call.status)) return;
      const ongoing = ctx.call.status === 'ongoing';
      await endCall(ctx, ongoing ? 'ended' : 'cancelled', ongoing ? 'ended' : 'cancelled');
    });
  }
}

/** Account deletion (inside the deletion transaction): forced leave of every live call. */
export async function forceLeaveAllCallsTx(tx: Tx, fx: Effects, userId: string): Promise<void> {
  const rows = await tx
    .select({ callId: callParticipants.callId, chatId: calls.chatId })
    .from(callParticipants)
    .innerJoin(calls, eq(calls.id, callParticipants.callId))
    .where(
      and(
        eq(callParticipants.userId, userId),
        inArray(callParticipants.status, ['joined', 'invited', 'ringing']),
        inArray(calls.status, LIVE_CALL_STATUSES),
      ),
    )
    .orderBy(asc(calls.chatId));
  for (const r of rows) await applyInTx(tx, fx, r.callId, (ctx) => forceLeave(ctx, userId));
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

/**
 * Crash recovery (boot): every ongoing call → ended, every ringing call → missed;
 * participants closed and call messages updated. v1 assumes a single instance.
 */
export async function recoverCalls(): Promise<number> {
  const live = await db
    .select({ id: calls.id })
    .from(calls)
    .where(inArray(calls.status, LIVE_CALL_STATUSES));
  let failed = 0;
  for (const { id } of live) {
    try {
      await runCallOp(id, async (ctx) => {
        if (!isLive(ctx.call.status)) return;
        await endCall(ctx, ctx.call.status === 'ongoing' ? 'ended' : 'missed', 'ended');
      });
    } catch (err) {
      failed += 1;
      logOpError(err, 'crash recovery', id);
    }
  }
  if (live.length)
    logger.info(
      { calls: live.length, failed },
      'calls: closed calls left open by a previous process',
    );
  // The calls job retries the whole recovery on its next run (it is idempotent).
  if (failed) throw new Error(`calls: crash recovery failed for ${failed} call(s)`);
  return live.length;
}

/**
 * Safety net for lost timers and lost disconnect bookkeeping: overdue rings, expired reconnect
 * windows, and joined participants without a call socket in this process whose disconnect was
 * never recorded (e.g. the disconnect transaction failed) — they enter the reconnect grace
 * now (`callSocketGone` re-checks the binding under the call queue). Relies on the documented
 * single-instance assumption (bindings are per process).
 */
export async function sweepCalls(): Promise<void> {
  const now = Date.now();
  const overdue = await db
    .selectDistinct({ callId: callParticipants.callId })
    .from(callParticipants)
    .innerJoin(calls, eq(calls.id, callParticipants.callId))
    .where(
      and(
        inArray(callParticipants.status, PENDING_STATUSES),
        lte(callParticipants.invitedAt, new Date(now - callTimings.ringTimeoutMs)),
        inArray(calls.status, LIVE_CALL_STATUSES),
      ),
    );
  for (const { callId } of overdue) await expireRinging(callId);
  const lost = await db
    .select({ callId: callParticipants.callId, userId: callParticipants.userId })
    .from(callParticipants)
    .innerJoin(calls, eq(calls.id, callParticipants.callId))
    .where(
      and(
        eq(callParticipants.status, 'joined'),
        lte(callParticipants.disconnectedAt, new Date(now - callTimings.reconnectGraceMs)),
        inArray(calls.status, LIVE_CALL_STATUSES),
      ),
    );
  for (const { callId, userId } of lost) await expireGrace(callId, userId);
  const unbound = await db
    .select({ callId: callParticipants.callId, userId: callParticipants.userId })
    .from(callParticipants)
    .innerJoin(calls, eq(calls.id, callParticipants.callId))
    .where(
      and(
        eq(callParticipants.status, 'joined'),
        isNull(callParticipants.disconnectedAt),
        inArray(calls.status, LIVE_CALL_STATUSES),
      ),
    );
  for (const { callId, userId } of unbound) {
    if (!boundSocketId(callId, userId)) await callSocketGone(callId, userId);
  }
}

// ---------------------------------------------------------------------------
// Late devices
// ---------------------------------------------------------------------------

/**
 * After `ready`: re-emit `call:incoming` to this socket for live calls still ringing me. Each
 * call's final check-and-emit runs in that call's queue (whose ops flush inside their slot),
 * so an accept/decline/timeout elsewhere is either fully before it (nothing is emitted) or
 * after it (its ring-stop follows the incoming) — never a stale incoming after a ring-stop.
 */
export async function reemitIncoming(socket: AppSocket): Promise<void> {
  const userId = socket.data.userId;
  const rows = await db
    .select({ callId: callParticipants.callId })
    .from(callParticipants)
    .innerJoin(calls, eq(calls.id, callParticipants.callId))
    .where(
      and(
        eq(callParticipants.userId, userId),
        inArray(callParticipants.status, PENDING_STATUSES),
        isNull(callParticipants.hiddenAt),
        inArray(calls.status, LIVE_CALL_STATUSES),
      ),
    );
  for (const callId of uniq(rows.map((r) => r.callId))) {
    if (socket.disconnected) return;
    try {
      await withCallQueue(callId, async () => {
        const loaded = (await loadCallRows(db, [callId])).get(callId);
        if (!loaded || !isLive(loaded.call.status)) return;
        const mine = loaded.parts.find((p) => p.userId === userId);
        if (!mine || mine.hiddenAt || !isPending(mine.status)) return;
        const [chat] = await db
          .select()
          .from(chats)
          .where(eq(chats.id, loaded.call.chatId))
          .limit(1);
        if (!chat) return;
        const silent = await silentUserIds(db, [userId], loaded.call.initiatorId);
        const payload = (
          await buildIncomingPayloads(db, chat, toCall(loaded.call, loaded.parts), [userId], silent)
        ).get(userId);
        if (payload && !socket.disconnected) socket.emit('call:incoming', payload);
      });
    } catch (err) {
      logOpError(err, 'late-device ring', callId);
    }
  }
}
