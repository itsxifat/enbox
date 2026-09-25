/**
 * Realtime: presence, profile changes, my own account, contacts/blocks, session revocation.
 * Owned by the foundation (agent 1 may extend for contacts/blocks/profile screens — prefer
 * listening to the bus events `contacts:changed`, `blocks:changed`, `user:changed`).
 */
import { bus } from '@/lib/bus';
import { useConnection, type AppSocket, type ReadyInfo } from '@/lib/socket';
import { api } from '@/lib/api';
import type { UserSelf } from '@enbox/shared';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useContacts } from '@/stores/contacts';
import { useUsers } from '@/stores/users';

export function registerUserHandlers(socket: AppSocket): void {
  socket.on('presence:update', (p) => {
    useUsers.getState().setPresence(p);
  });

  socket.on('user:changed', ({ userId }) => {
    void useUsers
      .getState()
      .invalidateUser(userId)
      .then(() => {
        const user = useUsers.getState().byId[userId];
        if (!user) return;
        const { byId, mutateChat } = useChats.getState();
        // Patching the peer also recomputes the direct chat's permissions: a deleted (or
        // blocked) peer can't be messaged or called — the server sends no chat:upsert for it.
        for (const chat of Object.values(byId)) {
          if (chat.peer?.id === userId)
            mutateChat(chat.id, (c) =>
              c.peer?.id === userId ? { peer: { ...c.peer, ...user } } : null,
            );
        }
      });
    bus.emit('user:changed', { userId });
  });

  socket.on('me:updated', ({ user }) => {
    useAuth.getState().setUser(user);
  });

  socket.on('contacts:changed', () => bus.emit('contacts:changed'));
  socket.on('blocks:changed', () => bus.emit('blocks:changed'));

  socket.on('session:revoked', ({ sessionId }) => {
    const mine = useConnection.getState().sessionId;
    if (!mine || mine === sessionId) void useAuth.getState().logout({ remote: false });
  });
}

export async function resyncUsers(info: ReadyInfo): Promise<void> {
  await useUsers.getState().resubscribePresence();
  if (info.reconnect) {
    // Profile/settings may have changed while we were offline.
    const user = await api.get<UserSelf>('/api/me').catch(() => null);
    if (user) useAuth.getState().setUser(user);
  }
}

// ---------------------------------------------------------------------------
// Contacts & blocks (agent 1): keep saved names and blocked flags live on every device.
// `contacts:changed` / `blocks:changed` only say *that* something changed, so refetch and
// patch the users store + direct-chat peers (see stores/contacts.ts).
// ---------------------------------------------------------------------------

let contactsSyncInstalled = false;

/** Install the bus listeners (idempotent). Runs once when this module loads. */
export function installContactsSync(): void {
  if (contactsSyncInstalled) return;
  contactsSyncInstalled = true;
  bus.on('contacts:changed', () => void useContacts.getState().syncContacts());
  bus.on('blocks:changed', () => void useContacts.getState().syncBlocks());
  bus.on('realtime:ready', ({ reconnect }) => {
    if (!reconnect) return;
    const s = useContacts.getState();
    if (s.loaded) void s.syncContacts();
    if (s.blockedLoaded) void s.syncBlocks();
  });
}

installContactsSync();
