import {
  callIdSchema,
  callInviteSchema,
  callJoinSchema,
  callMediaStateSchema,
  callSignalSchema,
  callStartSchema,
} from '@enbox/shared';
import { logger } from '../../lib/logger.js';
import { socketHandler, type SocketCtx } from '../../realtime/handler.js';
import { onAfterReady } from '../../realtime/hooks.js';
import type { SocketRegistrar } from '../../realtime/types.js';
import { domainEvents } from '../../services/events.js';
import { registerAccountDeletionHook, registerChatDeletionHook } from '../../services/hooks.js';
import {
  declineCall,
  endChatCallsTx,
  forceLeaveAllCallsTx,
  forceLeaveChatCall,
  forceLeaveDirectCall,
  inviteToCall,
  joinCall,
  leaveCall,
  markRinging,
  onSocketDisconnect,
  reemitIncoming,
  rejoinCall,
  relaySignal,
  startCall,
  updateMediaState,
  type Actor,
} from './service.js';
import { isCallSocket } from './state.js';

const actor = (ctx: SocketCtx): Actor => ({ socket: ctx.socket, userId: ctx.userId, sessionId: ctx.sessionId });

// Late devices: after `ready`, re-emit `call:incoming` for live calls still ringing me.
onAfterReady((socket) => reemitIncoming(socket));

// Forced leave when a user stops being an active member of the call's chat.
domainEvents.on('member.left', ({ chatId, userId }) => forceLeaveChatCall(chatId, userId));

// A block between direct-chat peers ends their live 1:1 call (docs: blocks matrix row).
domainEvents.on('user.blocked', ({ blockerId, blockedId }) => forceLeaveDirectCall(blockerId, blockedId));

// Account deletion (docs step 1): forced leave of any live call, inside the deletion tx.
registerAccountDeletionHook('calls', (tx, fx, userId) => forceLeaveAllCallsTx(tx, fx, userId));

// A chat being deleted (community deactivation → its announcement group) ends its live call.
registerChatDeletionHook('calls', (tx, fx, chatIds) => endChatCallsTx(tx, fx, chatIds));

/** calls socket handlers (see ClientToServerEvents in @enbox/shared and docs "Calls"). */
export const registerCallsSocket: SocketRegistrar = (_io, socket) => {
  // `call:leave` packets are noted by a middleware, which runs synchronously on receipt:
  // listeners are dispatched on the next tick and DROPPED when the socket disconnected
  // meanwhile (hang up + close the tab / log out in the same read). A leave dropped that way
  // is honoured by the disconnect handler, queued before the disconnect's own bookkeeping
  // (which would otherwise only start the reconnect grace). callId → was this socket the
  // call socket when the leave arrived.
  const pendingLeaves = new Map<string, boolean>();
  socket.use((packet, next) => {
    if (packet[0] === 'call:leave') {
      const parsed = callIdSchema.safeParse(packet[1]);
      if (parsed.success) pendingLeaves.set(parsed.data.callId, isCallSocket(socket, parsed.data.callId, socket.data.userId));
    }
    next();
  });

  socket.on(
    'call:start',
    socketHandler(socket, callStartSchema, (p, ctx) => startCall(actor(ctx), p)),
  );
  socket.on(
    'call:ringing',
    socketHandler(socket, callIdSchema, (p, ctx) => markRinging(ctx.userId, p.callId)),
  );
  socket.on(
    'call:accept',
    socketHandler(socket, callJoinSchema, (p, ctx) => joinCall(actor(ctx), p)),
  );
  socket.on(
    'call:decline',
    socketHandler(socket, callIdSchema, (p, ctx) => declineCall(ctx.userId, p.callId)),
  );
  socket.on(
    'call:join',
    socketHandler(socket, callJoinSchema, (p, ctx) => joinCall(actor(ctx), p)),
  );
  socket.on(
    'call:rejoin',
    socketHandler(socket, callJoinSchema, (p, ctx) => rejoinCall(actor(ctx), p)),
  );
  socket.on(
    'call:leave',
    socketHandler(socket, callIdSchema, (p, ctx) => {
      const wasCallSocket = pendingLeaves.get(p.callId);
      pendingLeaves.delete(p.callId);
      return leaveCall(actor(ctx), p.callId, { wasCallSocket });
    }),
  );
  socket.on(
    'call:invite',
    socketHandler(socket, callInviteSchema, (p, ctx) => inviteToCall(ctx.userId, p)),
  );
  socket.on(
    'call:signal',
    socketHandler(socket, callSignalSchema, (p, ctx) => relaySignal(actor(ctx), p)),
  );
  socket.on(
    'call:media',
    socketHandler(socket, callMediaStateSchema, (p, ctx) => updateMediaState(actor(ctx), p)),
  );
  socket.on('disconnect', () => {
    const me: Actor = { socket, userId: socket.data.userId, sessionId: socket.data.sessionId };
    for (const [callId, wasCallSocket] of pendingLeaves) {
      leaveCall(me, callId, { wasCallSocket }).catch((err) => logger.error({ err, callId }, 'calls: leave on disconnect failed'));
    }
    pendingLeaves.clear();
    try {
      onSocketDisconnect(socket);
    } catch (err) {
      logger.error({ err }, 'calls: disconnect handling failed');
    }
  });
};
