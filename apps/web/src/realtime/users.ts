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
        const { byId, patchChat } = useChats.getState();
        for (const chat of Object.values(byId)) {
          if (chat.peer?.id === userId) patchChat(chat.id, { peer: { ...chat.peer, ...user } });
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
