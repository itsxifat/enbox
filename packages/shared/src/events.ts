/**
 * Socket.IO realtime contract. The normative fan-out rules (which mutation emits what, to
 * whom, in which order) are in docs/ARCHITECTURE.md "Realtime"; this file summarises the
 * parts clients depend on.
 *
 * Connection
 * - Connect to the API origin with `io(url, { auth: { token } })`. Invalid tokens are
 *   rejected with a connect_error whose `message` is `unauthorized`.
 * - Server connect sequence: join `user:<userId>` + `session:<sessionId>` FIRST, then load
 *   active memberships and join their `chat:<chatId>` rooms, advance the user's delivered
 *   watermarks (server-driven delivered receipts), emit `ready`, then re-emit `call:incoming`
 *   for every live call still ringing this user.
 * - Rooms: `user:<id>` (all devices of a user), `session:<id>` (one device), `chat:<id>`
 *   (active, non-hidden members/followers), `call:<id>` + `call:<id>:<userId>` (only the call
 *   socket of each joined participant). Presence is NOT room-based (per-socket subscriptions).
 *
 * Reconnect (on every `ready`, not on `connect`; the first `ready` closes the gap before rooms were joined)
 * 1. Refetch `GET /api/chats` and replace the chat list (watermarks, unread, prefs).
 * 2. Discard ALL cached message pages; refetch the open chat's latest page (no cursor) and
 *    `GET /api/chats/:id/pins`. Other chats reload when opened. (Never catch up with
 *    `after=<seq>`: it misses edits, deletes, reactions, votes and call-status changes.)
 * 3. Re-send `presence:subscribe` for displayed users (subscriptions are per socket).
 * 4. Refetch `GET /api/calls/active` (a joined call → `call:rejoin`), clear typing indicators.
 *
 * Client rules
 * - `message:new` for an unknown chatId → `GET /api/chats/:chatId`, then apply the message.
 * - Unknown user ids in messages → `POST /api/users/batch` (batched), see `referencedUserIds()`.
 * - Message merges keep viewer-specific fields (models.ts header). ChatSummary: `chat:upsert`
 *   replaces; `chat:updated` shallow-merges `changes`, after which the client recomputes
 *   `permissions` with `computeChatPermissions()` (and treats `inviteCode` as null when
 *   `!permissions.canInvite`).
 * - Clients derive from `message:new`: lastMessage/lastSeq/lastActivityAt, and unreadCount
 *   (+1 when senderId ≠ me and type ≠ system and the chat is not open & focused),
 *   unreadMentionCount (+1 when mentions include me). After every send the server also emits
 *   `chat:read` to the sender's devices (sending reads the chat) — this also corrects channel
 *   posts, whose senderId is always null.
 *
 * Mutations go through REST (api.ts); the socket carries fan-out, read receipts, typing,
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
  CallJoinPayload,
  CallMediaStatePayload,
  CallSignalPayload,
  CallStartPayload,
  PresenceSubscribePayload,
  ReceiptPayload,
  TypingPayload,
} from './schemas.js';

/** Acknowledgement envelope for client->server events that expect a reply. */
export type Ack<T> = { ok: true; data: T } | { ok: false; error: { code: ApiErrorCode; message: string; details?: unknown } };
export type AckFn<T> = (res: Ack<T>) => void;

export type TypingState = TypingPayload['state'];

/** Viewer-neutral chat fields carried by `chat:updated`. */
export type ChatInfoChanges = Partial<
  Pick<
    ChatSummary,
    | 'name'
    | 'description'
    | 'avatarUrl'
    | 'groupSettings'
    | 'channelSettings'
    | 'disappearingSeconds'
    | 'memberCount'
    | 'communityId'
    | 'isAnnouncement'
  >
>;

export interface IncomingCallPayload {
  call: Call;
  chat: Pick<ChatSummary, 'id' | 'type' | 'name' | 'avatarUrl' | 'peer' | 'memberCount'>;
  caller: UserPublic;
  /** Callee silences unknown callers: log it, but never ring, emit `call:ringing` or play a ringtone. */
  silent: boolean;
}

/** Why a device must stop ringing. */
export type RingStopReason = 'answered_elsewhere' | 'declined_elsewhere' | 'timeout' | 'cancelled' | 'ended';

export interface ServerToClientEvents {
  /** Sent once per connection after rooms are joined and delivered watermarks advanced. */
  ready: (payload: { userId: ID; sessionId: ID; serverTime: string }) => void;

  // --- Messages (room chat:<chatId>, only to members who can see the message) ---
  /**
   * New message. Emitted once to the chat room, after any `chat:upsert` that makes the chat
   * visible to a recipient (new direct chat, added/joined/rejoined, followed, unhidden).
   */
  'message:new': (payload: { message: Message }) => void;
  /**
   * Edit, delete-for-everyone (deletedAt set), reaction, poll vote, call status change, or a
   * quote/status-reply that changed. Viewer-neutral (no `starred`/`myReaction`/`myOptionIds`).
   * Only sent to members who can see the message. On `deletedAt`, clients also mark loaded
   * quotes of it (`replyTo.id === message.id`) as deleted.
   */
  'message:updated': (payload: { message: Message }) => void;
  /**
   * Messages disappeared: delete-for-me (user:<id>, my devices) or disappearing-timer purge
   * (room chat:<id>; ids a client doesn't have are ignored). Clients also hide messages
   * locally once `expiresAt` passes.
   */
  'message:removed': (payload: { chatId: ID; messageIds: ID[] }) => void;

  // --- Chats ---
  /** Create or replace a chat in the user's list (viewer-specific; user:<id>). */
  'chat:upsert': (payload: { chat: ChatSummary }) => void;
  /** Viewer-neutral chat metadata changed (room chat:<id>); shallow-merge `changes`. */
  'chat:updated': (payload: { chatId: ID; changes: ChatInfoChanges }) => void;
  /** Remove a chat from the user's list (deleted for me, unfollowed, channel/announcement group deleted). */
  'chat:removed': (payload: { chatId: ID }) => void;
  /** History cleared on another of my devices: drop messages with seq ≤ clearedSeq (deleting a chat sends `chat:removed`). */
  'chat:cleared': (payload: { chatId: ID; clearedSeq: number }) => void;
  /** My own read state changed (any device, REST or socket; user:<id>). */
  'chat:read': (payload: { chatId: ID; lastReadSeq: number; unreadCount: number; unreadMentionCount: number; markedUnread: boolean }) => void;
  /** Tick watermarks for my messages changed (user:<id>; never for channels). */
  'chat:watermarks': (payload: { chatId: ID; readWatermark: number; deliveredWatermark: number }) => void;
  /** Relayed to the room except the typist's sockets; never for channels. Expires after TYPING_TIMEOUT_MS. */
  'chat:typing': (payload: { chatId: ID; userId: ID; state: TypingState }) => void;
  /** Pinned messages changed (room). */
  'chat:pins': (payload: { chatId: ID; messageIds: ID[] }) => void;
  /**
   * Membership/roles changed; refetch members if the info panel is open. Room for groups;
   * admins only for channels and announcement groups.
   */
  'chat:members-changed': (payload: { chatId: ID }) => void;

  // --- Users ---
  /** Per-viewer presence of a subscribed user (hidden = online null). */
  'presence:update': (payload: Presence) => void;
  /** A user's public profile changed; refetch it (`POST /api/users/batch`) if cached. */
  'user:changed': (payload: { userId: ID }) => void;
  /** My own profile/settings changed on another device. */
  'me:updated': (payload: { user: UserSelf }) => void;
  'contacts:changed': (payload: Record<string, never>) => void;
  'blocks:changed': (payload: Record<string, never>) => void;
  /**
   * Sent to the revoked session's own room (session:<id>) right before its sockets are
   * disconnected. Clients log out only if `sessionId` is their own.
   */
  'session:revoked': (payload: { sessionId: ID }) => void;

  // --- Communities (user:<id>, viewer-specific) ---
  'community:upsert': (payload: { community: Community }) => void;
  'community:removed': (payload: { communityId: ID }) => void;

  // --- Status (user:<id> of the audience / author) ---
  'status:new': (payload: { status: Status; user: UserPublic }) => void;
  'status:deleted': (payload: { statusId: ID; userId: ID }) => void;
  /**
   * To the author: someone viewed (or reacted to) a status (not for viewers with read
   * receipts off). `firstView`: this event records a NEW view (a first view, or a reaction
   * without a prior view) — false when it only updates the reaction of an existing view, so
   * clients add the viewer on true and replace their entry on false. `viewCount`: the
   * status's current `Status.viewCount` (views counted by the read-receipts rule).
   */
  'status:viewed': (payload: { statusId: ID; viewer: StatusViewer; firstView: boolean; viewCount: number }) => void;

  // --- Calls ---
  /**
   * Ring: to every device of each rung invitee (user:<id>); re-emitted to a socket that
   * connects while the user is still `invited`/`ringing`. A device shows the incoming-call UI
   * iff my participant status ∈ {invited, ringing} and call.status ∈ {ringing, ongoing}.
   */
  'call:incoming': (payload: IncomingCallPayload) => void;
  /** Call or participant state changed (user:<id> of every visible participant). */
  'call:updated': (payload: { call: Call }) => void;
  /**
   * Someone joined (or rejoined) — room call:<id>. Existing participants wait for the
   * newcomer's offer; if they already have a connection with that user they close it first.
   */
  'call:participant-joined': (payload: { callId: ID; userId: ID }) => void;
  'call:participant-left': (payload: { callId: ID; userId: ID }) => void;
  /** Relayed WebRTC signal from another participant (to my call socket only). */
  'call:signal': (payload: { callId: ID; fromUserId: ID; signal: CallSignal }) => void;
  /** A participant's media state changed (room call:<id>). */
  'call:media': (payload: CallMediaStatePayload & { userId: ID }) => void;
  /** The call reached a terminal status (user:<id> of every visible participant). */
  'call:ended': (payload: { callId: ID; status: CallStatus; call: Call }) => void;
  /** Stop ringing on every device of this user (user:<id>), whatever the reason. */
  'call:ring-stop': (payload: { callId: ID; reason: RingStopReason }) => void;
}

/**
 * Call negotiation (full mesh, normative)
 * - Every RTCPeerConnection is created with BOTH an audio and a video transceiver
 *   (`addTransceiver('audio'|'video', { direction: 'sendrecv' })`), also for audio calls, so
 *   camera toggling and screen share use `sender.replaceTrack()` without renegotiation.
 *   `call:media` tells peers what is being sent.
 * - Initial offer: after the ack of call:start/accept/join/rejoin, the newcomer creates one
 *   connection per OTHER participant with status `joined` in the ack and sends each an
 *   `offer`. Everyone else waits and creates the connection when that offer arrives.
 * - Any later renegotiation or ICE restart uses "perfect negotiation": for a pair, the peer
 *   with the lexicographically SMALLER userId is polite (rolls back on glare).
 * - The server serializes accept/join/rejoin/leave/invite per call, so each ack's `joined`
 *   list is exact.
 */
export interface ClientToServerEvents {
  'chat:typing': (payload: TypingPayload) => void;
  /** I have read everything up to `seq` (same as `POST /api/chats/:chatId/read`). */
  'chat:read': (payload: ReceiptPayload) => void;

  /** Subscribe this socket to presence of these users; acks their current (per-viewer) presence. */
  'presence:subscribe': (payload: PresenceSubscribePayload, ack: AckFn<Presence[]>) => void;
  'presence:unsubscribe': (payload: PresenceSubscribePayload) => void;

  /**
   * Start a call; this socket becomes my call socket. If the chat already has a live call →
   * ack `{ ok: false, error: { code: 'conflict', details: { callId } } }` (then accept/join it).
   */
  'call:start': (payload: CallStartPayload, ack: AckFn<{ call: Call }>) => void;
  /** This device is ringing (caller UI switches from "Calling" to "Ringing"). Not for silent rings. */
  'call:ringing': (payload: CallIdPayload) => void;
  /** Accept a call ringing me; this socket becomes my call socket. Offer to every `joined` participant in the ack. */
  'call:accept': (payload: CallJoinPayload, ack: AckFn<{ call: Call }>) => void;
  /** Decline (from any of my devices). */
  'call:decline': (payload: CallIdPayload) => void;
  /** Join a live group call without being rung (same semantics as accept). */
  'call:join': (payload: CallJoinPayload, ack: AckFn<{ call: Call }>) => void;
  /**
   * Reclaim my call after a reconnect/reload (my participant is `joined` and its call socket
   * disconnected less than CALL_RECONNECT_GRACE_MS ago, or it is this same session). Only
   * once the previous call socket is gone: while it is still connected → ack `conflict`
   * (another device, or another tab sharing this session's token, can't take the call over;
   * a reloaded page retries until the server has seen its old socket close). From the call
   * socket itself: an idempotent no-op. Acts as a newcomer: peers get
   * `call:participant-joined`, I offer to everyone joined.
   */
  'call:rejoin': (payload: CallJoinPayload, ack: AckFn<{ call: Call }>) => void;
  /** Leave (or cancel, if I started it and it is still ringing). Call socket only. */
  'call:leave': (payload: CallIdPayload) => void;
  /** Ring more members of a group chat into the call (joined participants only). */
  'call:invite': (payload: CallInvitePayload, ack: AckFn<{ call: Call }>) => void;
  /** Call socket only; relayed to the target's call socket. */
  'call:signal': (payload: CallSignalPayload) => void;
  /** Call socket only; persisted and broadcast to the call room. */
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
  /** Every socket of a user (all devices). */
  user: (userId: ID) => `user:${userId}`,
  /** Every socket of one session (device). */
  session: (sessionId: ID) => `session:${sessionId}`,
  /** Active members/followers of a chat. */
  chat: (chatId: ID) => `chat:${chatId}`,
  /** Call sockets of all joined participants. */
  call: (callId: ID) => `call:${callId}`,
  /** The call socket of one participant (signal relay target). */
  callMember: (callId: ID, userId: ID) => `call:${callId}:${userId}`,
} as const;
