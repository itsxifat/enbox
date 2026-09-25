import { USER_RATE_LIMITS, receiptPayloadSchema, typingPayloadSchema, type TypingState } from '@enbox/shared';
import { db } from '../../db/index.js';
import { SERVER_RATE_LIMITS, assertUserLimit, limitUser } from '../../lib/userLimit.js';
import { emitToChat } from '../../realtime/emit.js';
import { socketHandler } from '../../realtime/handler.js';
import { onBeforeReady } from '../../realtime/hooks.js';
import type { SocketRegistrar } from '../../realtime/types.js';
import { getChatAccess } from '../../services/chats.js';
import { transact } from '../../services/effects.js';
import { blockedEitherWay } from '../../services/users.js';
import { advanceRead, markDeliveredOnConnect } from '../../services/watermarks.js';

// Server-driven delivered receipts (b): on every connect, before `ready`, advance my
// delivered watermarks to the latest visible seq of each active chat and emit
// `chat:watermarks` to the members whose ticks changed (docs "Watermarks").
onBeforeReady((socket) => markDeliveredOnConnect(socket.data.userId));

/**
 * Whether `userId`'s typing indicator may be relayed in `chatId` (docs "Typing"): not a
 * channel, an active (non-hidden) member with `canSend`, and in direct chats no block in
 * either direction.
 */
export async function canRelayTyping(userId: string, chatId: string): Promise<boolean> {
  const access = await getChatAccess(db, userId, chatId).catch(() => null);
  if (!access || access.chat.type === 'channel' || access.membership !== 'active' || !access.permissions.canSend) return false;
  if (access.chat.type === 'direct' && access.peer && access.peer.id !== userId) {
    if (await blockedEitherWay(db, userId, access.peer.id)) return false;
  }
  return true;
}

/**
 * Per-socket typing throttle (USER_RATE_LIMITS.typing per chat); excess is dropped silently.
 * The key includes the state so that the `idle` sent right after `typing` (on send/blur) is
 * never swallowed by the throttle — at most one event per state per second per chat.
 */
function allowTyping(socketId: string, chatId: string, state: TypingState): boolean {
  const { limit, windowMs } = USER_RATE_LIMITS.typing;
  // Also capped across chats: every distinct chat id costs an access check.
  const any = SERVER_RATE_LIMITS.typingAnyChat;
  return limitUser(socketId, `typing:${chatId}:${state}`, limit, windowMs) && limitUser(socketId, 'typing:*', any.limit, any.windowMs);
}

/** chats socket handlers (see ClientToServerEvents in @enbox/shared). */
export const registerChatsSocket: SocketRegistrar = (_io, socket) => {
  // chat:typing → relayed to the room except all of my sockets (never for channels).
  socket.on(
    'chat:typing',
    socketHandler(socket, typingPayloadSchema, async ({ chatId, state }, { userId }) => {
      if (!allowTyping(socket.id, chatId, state)) return;
      if (!(await canRelayTyping(userId, chatId))) return;
      emitToChat(chatId, 'chat:typing', { chatId, userId, state }, { exceptUserIds: [userId] });
    }),
  );

  // chat:read — identical to POST /api/chats/:chatId/read.
  socket.on(
    'chat:read',
    socketHandler(socket, receiptPayloadSchema, async ({ chatId, seq }, { userId }) => {
      assertUserLimit(socket.id, 'chat:read', SERVER_RATE_LIMITS.chatRead);
      await transact((tx, fx) => advanceRead(tx, fx, { chatId, userId, seq }));
    }),
  );
};
