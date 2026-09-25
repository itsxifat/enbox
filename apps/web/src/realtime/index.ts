/**
 * Realtime entry point: connects the socket while authenticated and wires server events
 * into the stores. Domain handlers live in sibling files — each feature agent edits only
 * its own file (see apps/web/README.md "Feature ownership"):
 *
 *   chats.ts        chat list, receipts, typing, pins           (foundation / agent 2)
 *   messages.ts     message:new/updated/removed, notifications  (foundation / agent 2)
 *   users.ts        presence, profiles, me, contacts, sessions  (foundation / agent 1)
 *   communities.ts  community:*                                 (agent 3)
 *   calls.ts        call:*                                      (agent 4)
 *   status.ts       status:*                                    (agent 4)
 *
 * Every domain exports `register<Domain>Handlers(socket)` and `resync<Domain>(info)`; the
 * resyncs run on every server `ready` (first connect and reconnects), after which the
 * `realtime:ready` bus event fires.
 */
import { bus } from '@/lib/bus';
import { syncPushSubscription } from '@/lib/push';
import { connectSocket, disconnectSocket, onReady, type ReadyInfo } from '@/lib/socket';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { installReadTracking, registerChatHandlers, resyncChats } from './chats';
import { registerCallHandlers, resyncCalls } from './calls';
import { registerCommunityHandlers, resyncCommunities } from './communities';
import { registerMessageHandlers } from './messages';
import { registerStatusHandlers, resyncStatus } from './status';
import { registerUserHandlers, resyncUsers } from './users';

export { markChatRead } from './chats';
export { handleNewMessage } from './messages';

let running = false;
let cleanups: (() => void)[] = [];

async function resync(info: ReadyInfo): Promise<void> {
  // Calls right away: a call rejoin must land within the server's reconnect grace, so it
  // can't wait behind the chat reload. Otherwise chats first (drives the UI), the rest in
  // parallel.
  await Promise.allSettled([
    resyncCalls(info),
    resyncChats(info).then(() =>
      Promise.allSettled([resyncUsers(info), resyncCommunities(info), resyncStatus(info)]),
    ),
  ]);
}

/** Connect and register all handlers (idempotent). Requires an authenticated session. */
export function startRealtime(): void {
  const token = useAuth.getState().token;
  if (running || !token) return;
  running = true;

  connectSocket(token, (socket) => {
    registerChatHandlers(socket);
    registerMessageHandlers(socket);
    registerUserHandlers(socket);
    registerCommunityHandlers(socket);
    registerCallHandlers(socket);
    registerStatusHandlers(socket);
  });

  cleanups.push(
    onReady((info) => {
      void resync(info).finally(() => {
        bus.emit('realtime:ready', {
          userId: info.userId,
          sessionId: info.sessionId,
          reconnect: info.reconnect,
        });
      });
    }),
    installReadTracking(),
  );

  // Don't wait for the socket handshake (or a blocked WebSocket) to show the chat list;
  // every `ready` reloads it again to close the gap before rooms were joined.
  void useChats
    .getState()
    .loadChats()
    .catch(() => undefined);
  void syncPushSubscription().catch(() => undefined);
}

/** Disconnect and remove all handlers (idempotent). */
export function stopRealtime(): void {
  if (!running) return;
  running = false;
  for (const fn of cleanups) fn();
  cleanups = [];
  disconnectSocket();
}

/**
 * Start realtime whenever the auth store is authenticated, stop it otherwise.
 * Called once from main.tsx. Returns an unsubscribe function.
 */
export function bindRealtimeToAuth(): () => void {
  const apply = () => {
    const { status } = useAuth.getState();
    if (status === 'authenticated') startRealtime();
    else stopRealtime();
  };
  apply();
  return useAuth.subscribe((s, prev) => {
    if (s.token !== prev.token && prev.token) stopRealtime();
    if (s.status !== prev.status || s.token !== prev.token) apply();
  });
}
