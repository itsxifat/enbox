/**
 * Realtime: friend requests (W7-A). `friends:request` adds the incoming request to the
 * friends store and shows an in-app toast; like a message it also plays the notification
 * sound while I'm looking at Enbox, or shows a system notification (tag `friend:<id>`, the
 * same as its push, so the two collapse) while I'm not — neither in do not disturb.
 * `friends:changed` (accepted, declined, cancelled, removed, a block) refetches the requests;
 * the friend list itself follows `contacts:changed` (realtime/users.ts). Every `ready`
 * refetches them too, for the badge.
 */
import { isDnd, userDisplayName, type FriendRequest } from '@enbox/shared';
import { bus } from '@/lib/bus';
import { isAppFocused, playSound, showNotification } from '@/lib/notify';
import type { AppSocket, ReadyInfo } from '@/lib/socket';
import { useAuth } from '@/stores/auth';
import { useFriends } from '@/stores/friends';
import { toast, useUi } from '@/stores/ui';

/** Where the toast's View button (and a friend request push) lead. */
export const PENDING_FRIENDS_URL = '/chats?friends=pending';

function announce(request: FriendRequest): void {
  const name = userDisplayName(request.user);
  toast.info(`${name} sent you a friend request.`, {
    id: `friend-request:${request.user.id}`,
    action: { label: 'View', onClick: () => bus.emit('navigate', { to: PENDING_FRIENDS_URL }) },
  });
  const me = useAuth.getState().user;
  if (!me || isDnd(me)) return;
  const { prefs } = useUi.getState();
  if (isAppFocused() || !prefs.desktopNotifications) {
    if (prefs.sounds) playSound('notification');
    return;
  }
  void showNotification({
    title: name,
    body: 'Sent you a friend request',
    tag: `friend:${request.user.id}`,
    url: PENDING_FRIENDS_URL,
    ...(request.user.avatarUrl ? { icon: request.user.avatarUrl } : {}),
  });
}

export function registerFriendHandlers(socket: AppSocket): void {
  socket.on('friends:request', ({ request }) => {
    useFriends.getState().applyIncoming(request);
    announce(request);
  });
  socket.on('friends:changed', () => void useFriends.getState().sync());
}

export async function resyncFriends(_info: ReadyInfo): Promise<void> {
  await useFriends.getState().sync();
}
