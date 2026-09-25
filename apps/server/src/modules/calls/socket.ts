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
import { registerAccountDeletionHook } from '../../services/hooks.js';
import {
  declineCall,
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

const actor = (ctx: SocketCtx): Actor => ({ socket: ctx.socket, userId: ctx.userId, sessionId: ctx.sessionId });

// Late devices: after `ready`, re-emit `call:incoming` for live calls still ringing me.
onAfterReady((socket) => reemitIncoming(socket));

// Forced leave when a user stops being an active member of the call's chat.
domainEvents.on('member.left', ({ chatId, userId }) => forceLeaveChatCall(chatId, userId));

// A block between direct-chat peers ends their live 1:1 call (docs: blocks matrix row).
domainEvents.on('user.blocked', ({ blockerId, blockedId }) => forceLeaveDirectCall(blockerId, blockedId));

// Account deletion (docs step 1): forced leave of any live call, inside the deletion tx.
registerAccountDeletionHook('calls', (tx, fx, userId) => forceLeaveAllCallsTx(tx, fx, userId));

/** calls socket handlers (see ClientToServerEvents in @enbox/shared and docs "Calls"). */
export const registerCallsSocket: SocketRegistrar = (_io, socket) => {
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
    socketHandler(socket, callIdSchema, (p, ctx) => leaveCall(actor(ctx), p.callId)),
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
    try {
      onSocketDisconnect(socket);
    } catch (err) {
      logger.error({ err }, 'calls: disconnect handling failed');
    }
  });
};
