import { USER_RATE_LIMITS, voiceJoinSchema, voiceUpdateSchema } from '@enbox/shared';
import { z } from 'zod';
import { assertUserLimit, limitUser } from '../../lib/userLimit.js';
import { logger } from '../../lib/logger.js';
import { socketHandler } from '../../realtime/handler.js';
import type { SocketRegistrar } from '../../realtime/types.js';
import { joinVoice, leaveVoice, updateVoice } from './service.js';

/**
 * Voice socket handlers: `voice:join` (ack: LiveKit URL + token), `voice:leave`,
 * `voice:update` (my flags). A socket that disconnects leaves its voice channel; the client
 * rejoins after `ready` (the media connection survives short socket drops; a Stage speaker
 * gets the seat back, see `leaveVoice`). Stage hands and seats are REST (routes.ts).
 */
export const registerVoiceSocket: SocketRegistrar = (_io, socket) => {
  socket.on(
    'voice:join',
    socketHandler(socket, voiceJoinSchema, async ({ channelId, selfMute, selfDeaf }, { userId }) => {
      assertUserLimit(userId, 'voice:join', USER_RATE_LIMITS.voiceJoin);
      return joinVoice(userId, socket.id, channelId, { selfMute, selfDeaf });
    }),
  );

  socket.on(
    'voice:leave',
    socketHandler(socket, z.object({}).passthrough(), async (_p, { userId }) => {
      await leaveVoice(userId, socket.id);
      return null;
    }),
  );

  socket.on(
    'voice:update',
    socketHandler(socket, voiceUpdateSchema, async (patch, { userId }) => {
      const r = USER_RATE_LIMITS.voiceUpdate;
      if (!limitUser(socket.id, 'voice:update', r.limit, r.windowMs)) return;
      await updateVoice(userId, socket.id, patch);
    }),
  );

  socket.on('disconnect', () => {
    // Dropped, not left: a Stage speaker coming back soon keeps the seat.
    void leaveVoice(socket.data.userId, socket.id, { socketGone: true }).catch((err: unknown) =>
      logger.error({ err }, 'voice leave on disconnect failed'),
    );
  });
};
