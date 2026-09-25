/**
 * Realtime fan-out helpers. All helpers are no-ops until the socket server is initialised
 * (e.g. in tests that only exercise REST). Emit only AFTER the DB transaction commits, in
 * the order given by the mutation → event matrix in docs/ARCHITECTURE.md.
 *
 * Never emit viewer-specific payloads (ChatSummary, UserPublic, Community...) to a chat
 * room — build them per viewer and use emitToUser. Room joins/leaves use
 * `io.in(...).socketsJoin/socketsLeave`, which also reach sockets on other nodes.
 */
import { rooms } from '@enbox/shared';
import type { IO, ServerEvent, ServerPayload } from './types.js';

let io: IO | undefined;

export function setIo(server: IO | undefined) {
  io = server;
}

export function getIo(): IO | undefined {
  return io;
}

type Emitter = { emit: (event: string, payload: unknown) => boolean };

function emit<E extends ServerEvent>(target: Emitter, event: E, payload: ServerPayload<E>) {
  target.emit(event, payload);
}

export function emitToUser<E extends ServerEvent>(
  userId: string,
  event: E,
  payload: ServerPayload<E>,
) {
  if (!io) return;
  emit(io.to(rooms.user(userId)) as unknown as Emitter, event, payload);
}

export function emitToUsers<E extends ServerEvent>(
  userIds: Iterable<string>,
  event: E,
  payload: ServerPayload<E>,
) {
  if (!io) return;
  const targets = [...new Set(userIds)].map(rooms.user);
  if (targets.length === 0) return;
  emit(io.to(targets) as unknown as Emitter, event, payload);
}

export interface ChatEmitOptions {
  /** Skip this socket (e.g. the typing user's own socket). */
  exceptSocketId?: string;
  /**
   * Skip all sockets of these users — e.g. `message:updated` must skip active members who
   * cannot see the message (joined after it, cleared/hid it, blocked recipient).
   */
  exceptUserIds?: string[];
}

/** Emit a viewer-neutral payload to every active member's sockets in a chat room. */
export function emitToChat<E extends ServerEvent>(
  chatId: string,
  event: E,
  payload: ServerPayload<E>,
  opts: ChatEmitOptions = {},
) {
  if (!io) return;
  let op = io.to(rooms.chat(chatId));
  if (opts.exceptSocketId) op = op.except(opts.exceptSocketId);
  if (opts.exceptUserIds?.length) op = op.except(opts.exceptUserIds.map(rooms.user));
  emit(op as unknown as Emitter, event, payload);
}

export function emitToSocket<E extends ServerEvent>(
  socketId: string,
  event: E,
  payload: ServerPayload<E>,
) {
  if (!io) return;
  emit(io.to(socketId) as unknown as Emitter, event, payload);
}

export function emitToSession<E extends ServerEvent>(
  sessionId: string,
  event: E,
  payload: ServerPayload<E>,
) {
  if (!io) return;
  emit(io.to(rooms.session(sessionId)) as unknown as Emitter, event, payload);
}

/** Subscribe all of a user's connected sockets to a chat room (after adding them as member/follower). */
export function joinUserToChat(userId: string, chatId: string) {
  io?.in(rooms.user(userId)).socketsJoin(rooms.chat(chatId));
}

export function joinUsersToChat(userIds: Iterable<string>, chatId: string) {
  const targets = [...new Set(userIds)].map(rooms.user);
  if (targets.length) io?.in(targets).socketsJoin(rooms.chat(chatId));
}

/** Unsubscribe all of a user's sockets from a chat room (after leaving/removal). */
export function removeUserFromChat(userId: string, chatId: string) {
  io?.in(rooms.user(userId)).socketsLeave(rooms.chat(chatId));
}

/** Remove every socket from a chat room (chat deleted). */
export function clearChatRoom(chatId: string) {
  io?.in(rooms.chat(chatId)).socketsLeave(rooms.chat(chatId));
}

/** Forcefully disconnect all sockets of a session (logout / revoke). */
export function disconnectSession(sessionId: string) {
  io?.in(rooms.session(sessionId)).disconnectSockets(true);
}

export function disconnectUser(userId: string) {
  io?.in(rooms.user(userId)).disconnectSockets(true);
}
