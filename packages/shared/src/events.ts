/**
 * Socket.IO realtime contract.
 *
 * Connection
 * - Connect to the API origin with `io(url, { auth: { token } })`. Invalid tokens are
 *   rejected with a connect_error whose `message` is `unauthorized`.
 * - After auth the server joins the socket to:
 *     `user:<userId>`   — every socket of the user (all devices)
 *     `chat:<chatId>`   — every chat where the user is an active member/follower
 *     `call:<callId>`   — only the one socket that accepted/joined a call
 *   and emits `ready`.
 * - After a (re)connect clients should refetch `GET /api/chats` (and any open chat's
 *   messages with `after=<last known seq>`) to catch up; the socket does not replay.
 *
 * Mutations go through REST (api.ts); the socket carries fan-out, receipts, typing,
 * presence and call signaling.
 */
import type { ApiErrorCode } from './api.js';
import type {
  Call,
  CallSignal,
  CallStatus,
  ChatSummary,
  Community,
  ID,
  Message,
  Presence,
  Status,
  StatusViewer,
  UserPublic,
  UserSelf,
} from './models.js';
import type {
  CallIdPayload,
  CallInvitePayload,
  CallMediaStatePayload,
  CallSignalPayload,
  CallStartPayload,
  PresenceSubscribePayload,
  ReceiptPayload,
  TypingPayload,
} from './schemas.js';

/** Acknowledgement envelope for client->server events that expect a reply. */
export type Ack<T> = { ok: true; data: T } | { ok: false; error: { code: ApiErrorCode; message: string } };
export type AckFn<T> = (res: Ack<T>) => void;

export type TypingState = TypingPayload['state'];

export interface IncomingCallPayload {
  call: Call;
  chat: Pick<ChatSummary, 'id' | 'type' | 'name' | 'avatarUrl' | 'peer' | 'memberCount'>;
  caller: UserPublic;
  /** True when the callee silences unknown callers: show in the log but do not ring. */
  silent: boolean;
}

export interface ServerToClientEvents {
  /** Sent once after the connection is authenticated. */
  ready: (payload: { userId: ID; sessionId: ID; serverTime: string }) => void;

  // --- Messages (room: chat:<chatId>, plus user:<id> of the sender's other devices) ---
  /**
   * New message in a chat. `chat` is included when the recipient may not know the chat
   * yet (first message of a new direct chat, recipient just added to a group).
   */
  'message:new': (payload: { message: Message; chat?: ChatSummary }) => void;
  /** Edit, delete-for-everyone (deletedAt set), reaction or poll vote changes. Viewer-neutral (no `starred`). */
  'message:updated': (payload: { message: Message }) => void;
  /** Messages disappeared for this user: delete-for-me (own devices) or disappearing-timer expiry. */
  'message:removed': (payload: { chatId: ID; messageIds: ID[] }) => void;

  // --- Chats ---
  /** Create or replace a chat in the user's list (viewer-specific; sent to user:<id>). */
  'chat:upsert': (payload: { chat: ChatSummary }) => void;
  /** Remove a chat from the user's list (deleted for me). */
  'chat:removed': (payload: { chatId: ID }) => void;
  /** History cleared on another of my devices. */
  'chat:cleared': (payload: { chatId: ID; clearedSeq: number }) => void;
  /** My own read position changed (read on another device). */
  'chat:read': (payload: { chatId: ID; lastReadSeq: number; unreadCount: number }) => void;
  /** Tick watermarks for my messages changed (sent to user:<id>). */
  'chat:watermarks': (payload: { chatId: ID; readWatermark: number; deliveredWatermark: number }) => void;
  'chat:typing': (payload: { chatId: ID; userId: ID; state: TypingState }) => void;
  /** Pinned messages changed (room). */
  'chat:pins': (payload: { chatId: ID; messageIds: ID[] }) => void;
  /** Membership/roles changed; refetch members if the info panel is open (room). */
  'chat:members-changed': (payload: { chatId: ID }) => void;

  // --- Users ---
  'presence:update': (payload: Presence) => void;
  /** A user's public profile changed; refetch `GET /api/users/:id` if cached. */
  'user:changed': (payload: { userId: ID }) => void;
  /** My own profile/settings changed on another device. */
  'me:updated': (payload: { user: UserSelf }) => void;
  'contacts:changed': (payload: Record<string, never>) => void;
  'blocks:changed': (payload: Record<string, never>) => void;
  /** This session was revoked (logged out remotely). The client must drop its token. */
  'session:revoked': (payload: { sessionId: ID }) => void;

  // --- Communities ---
  'community:upsert': (payload: { community: Community }) => void;
  'community:removed': (payload: { communityId: ID }) => void;

  // --- Status ---
  'status:new': (payload: { status: Status; user: UserPublic }) => void;
  'status:deleted': (payload: { statusId: ID; userId: ID }) => void;
  /** To the author: someone viewed (or reacted to) a status. */
  'status:viewed': (payload: { statusId: ID; viewer: StatusViewer }) => void;

  // --- Calls ---
  /** Ring: sent to every device of each invited user. */
  'call:incoming': (payload: IncomingCallPayload) => void;
  /** Call state / participant list changed (to all participants' devices). */
  'call:updated': (payload: { call: Call }) => void;
  /** Someone joined: existing participants wait for the newcomer's offer. */
  'call:participant-joined': (payload: { callId: ID; userId: ID }) => void;
  'call:participant-left': (payload: { callId: ID; userId: ID }) => void;
  /** Relayed WebRTC signal from another participant (to the call socket only). */
  'call:signal': (payload: { callId: ID; fromUserId: ID; signal: CallSignal }) => void;
  'call:media': (payload: CallMediaStatePayload & { userId: ID }) => void;
  'call:ended': (payload: { callId: ID; status: CallStatus; call: Call }) => void;
  /** Another of my devices accepted or declined: stop ringing here. */
  'call:handled-elsewhere': (payload: { callId: ID }) => void;
}

export interface ClientToServerEvents {
  'chat:typing': (payload: TypingPayload) => void;
  /** I have read everything up to `seq`. */
  'chat:read': (payload: ReceiptPayload) => void;
  /** My device has received everything up to `seq`. */
  'chat:delivered': (payload: ReceiptPayload) => void;

  /** Subscribe to presence updates for these users (privacy-filtered); acks current presence. */
  'presence:subscribe': (payload: PresenceSubscribePayload, ack: AckFn<Presence[]>) => void;
  'presence:unsubscribe': (payload: PresenceSubscribePayload) => void;

  /** Start a call in a chat; this socket becomes the caller's call socket. */
  'call:start': (payload: CallStartPayload, ack: AckFn<{ call: Call }>) => void;
  /** This device is ringing (caller UI switches from "Calling" to "Ringing"). */
  'call:ringing': (payload: CallIdPayload) => void;
  /**
   * Accept a ringing call; this socket becomes the call socket. The ack contains the call
   * with participants; the newcomer creates an offer to every participant with status
   * `joined` (they wait for it).
   */
  'call:accept': (payload: CallIdPayload, ack: AckFn<{ call: Call }>) => void;
  'call:decline': (payload: CallIdPayload) => void;
  /** Join an ongoing group call without being rung (same semantics as accept). */
  'call:join': (payload: CallIdPayload, ack: AckFn<{ call: Call }>) => void;
  /** Leave (or cancel, if still ringing as caller). */
  'call:leave': (payload: CallIdPayload) => void;
  /** Ring additional members of the chat into an ongoing call. */
  'call:invite': (payload: CallInvitePayload, ack: AckFn<{ call: Call }>) => void;
  'call:signal': (payload: CallSignalPayload) => void;
  'call:media': (payload: CallMediaStatePayload) => void;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface InterServerEvents {}

export interface SocketData {
  userId: ID;
  sessionId: ID;
}

/** Room name helpers — use these instead of string literals. */
export const rooms = {
  user: (userId: ID) => `user:${userId}`,
  chat: (chatId: ID) => `chat:${chatId}`,
  call: (callId: ID) => `call:${callId}`,
  presence: (userId: ID) => `presence:${userId}`,
} as const;
