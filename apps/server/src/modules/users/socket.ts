import { USER_RATE_LIMITS, presenceActivitySchema, presenceSubscribeSchema } from '@enbox/shared';
import { assertUserLimit } from '../../lib/userLimit.js';
import { socketHandler } from '../../realtime/handler.js';
import { presenceEvents, setSocketIdle } from '../../realtime/presence.js';
import type { SocketRegistrar } from '../../realtime/types.js';
import {
  forgetPresenceSocket,
  reevaluatePresence,
  subscribePresence,
  unsubscribePresence,
} from './presence.js';

// Online/offline transitions (first socket connected / last one gone) and auto-idle changes
// re-evaluate the subject's presence for every subscribed socket (per-viewer privacy, changes
// only — an invisible user therefore never produces an update from any of these).
presenceEvents.on('online', (userId) => void reevaluatePresence(userId));
presenceEvents.on(
  'offline',
  (userId, lastSeenAt) => void reevaluatePresence(userId, { lastSeenAt }),
);
presenceEvents.on('activity', (userId) => void reevaluatePresence(userId));

/**
 * Users socket handlers (see ClientToServerEvents in @enbox/shared):
 * - `presence:subscribe { userIds }` (ack: Presence[] of the known ids, per-viewer privacy;
 *   rate-limited per socket with USER_RATE_LIMITS.presenceSubscribe; ids beyond
 *   MAX_PRESENCE_SUBSCRIPTIONS per socket are ignored);
 * - `presence:unsubscribe { userIds }`;
 * - `presence:activity { idle }` (no ack: this device's idle flag, kept per counted socket in
 *   realtime/presence.ts and ignored until the socket counts). When the user's auto-idle
 *   state changes (idle iff every counted socket is idle) their subscribers are
 *   re-evaluated. The flag is state, not a pulse, so it is applied even beyond
 *   USER_RATE_LIMITS.presenceActivity — only the re-evaluation is dropped then, and the next
 *   allowed event or any other re-evaluation shows the right state; a dropped transition
 *   can never leave a device idle or active for good.
 * Subscriptions are per socket and die with it (clients re-subscribe after every `ready`,
 * and re-send their idle state).
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
  socket.on(
    'presence:activity',
    socketHandler(socket, presenceActivitySchema, ({ idle }, { userId }) => {
      const changed = setSocketIdle(userId, socket.id, idle);
      assertUserLimit(socket.id, 'presenceActivity', USER_RATE_LIMITS.presenceActivity);
      if (changed) presenceEvents.emit('activity', userId);
    }),
  );
  socket.on('disconnect', () => forgetPresenceSocket(socket.id));
};
