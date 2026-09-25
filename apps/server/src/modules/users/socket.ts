import { USER_RATE_LIMITS, presenceSubscribeSchema } from '@enbox/shared';
import { assertUserLimit } from '../../lib/userLimit.js';
import { socketHandler } from '../../realtime/handler.js';
import { presenceEvents } from '../../realtime/presence.js';
import type { SocketRegistrar } from '../../realtime/types.js';
import {
  forgetPresenceSocket,
  reevaluatePresence,
  subscribePresence,
  unsubscribePresence,
} from './presence.js';

// Online/offline transitions (first socket connected / last one gone) re-evaluate the
// subject's presence for every subscribed socket (per-viewer privacy, changes only).
presenceEvents.on('online', (userId) => void reevaluatePresence(userId));
presenceEvents.on(
  'offline',
  (userId, lastSeenAt) => void reevaluatePresence(userId, { lastSeenAt }),
);

/**
 * Users socket handlers (see ClientToServerEvents in @enbox/shared):
 * - `presence:subscribe { userIds }` (ack: Presence[] of the known ids, per-viewer privacy;
 *   rate-limited per socket with USER_RATE_LIMITS.presenceSubscribe; ids beyond
 *   MAX_PRESENCE_SUBSCRIPTIONS per socket are ignored);
 * - `presence:unsubscribe { userIds }`.
 * Subscriptions are per socket and die with it (clients re-subscribe after every `ready`).
 */
export const registerUsersSocket: SocketRegistrar = (_io, socket) => {
  socket.on(
    'presence:subscribe',
    socketHandler(socket, presenceSubscribeSchema, ({ userIds }, { userId }) => {
      assertUserLimit(socket.id, 'presenceSubscribe', USER_RATE_LIMITS.presenceSubscribe);
      return subscribePresence(socket, userId, userIds);
    }),
  );
  socket.on(
    'presence:unsubscribe',
    socketHandler(socket, presenceSubscribeSchema, ({ userIds }) => {
      unsubscribePresence(socket.id, userIds);
    }),
  );
  socket.on('disconnect', () => forgetPresenceSocket(socket.id));
};
