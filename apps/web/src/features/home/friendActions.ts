/**
 * Friend actions with their dialogs and toasts, shared by the Friends page and the profile
 * menus (kept out of FriendsPage.tsx, which is code-split).
 */
import { Check, UserMinus, UserPlus, UserX, X } from 'lucide-react';
import { userDisplayName, type UserPublic } from '@enbox/shared';
import { confirm, toast, type MenuEntry } from '@/components/ui';
import { useFriends, type FriendStatus } from '@/stores/friends';

type Who = Pick<UserPublic, 'id' | 'displayName' | 'contactName' | 'isDeleted' | 'username'>;

/**
 * The friend entries of a user's menu for where I stand with them (`useFriendStatus`): Add
 * Friend, Accept / Ignore their request, Cancel mine, or Remove Friend. None for me, deleted
 * accounts, or (adding) someone I blocked.
 */
export function friendMenuItems(
  user: Who & Pick<UserPublic, 'isBlocked'>,
  status: FriendStatus,
): MenuEntry[] {
  if (status === 'self' || user.isDeleted) return [];
  switch (status) {
    case 'friend':
      return [
        {
          label: 'Remove Friend',
          icon: UserMinus,
          danger: true,
          onSelect: () => void confirmRemoveFriend(user),
        },
      ];
    case 'incoming':
      return [
        { label: 'Accept Friend Request', icon: Check, onSelect: () => void acceptFriend(user) },
        { label: 'Ignore Friend Request', icon: X, onSelect: () => void ignoreFriend(user) },
      ];
    case 'outgoing':
      return [
        { label: 'Cancel Request', icon: UserX, onSelect: () => void cancelFriendRequest(user) },
      ];
    default:
      return user.isBlocked
        ? []
        : [{ label: 'Add Friend', icon: UserPlus, onSelect: () => void addFriend(user) }];
  }
}

/** Run a friend action; failures become an error toast. True when it went through. */
async function attempt(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch (e) {
    toast.error(e);
    return false;
  }
}

/** Send a request (from a profile: the user is known). */
export async function addFriend(user: Who): Promise<boolean> {
  try {
    const status = await useFriends.getState().send({ userId: user.id });
    const name = userDisplayName(user);
    toast.success(
      status === 'accepted' ? `You and ${name} are now friends` : `Friend request sent to ${name}`,
    );
    return true;
  } catch (e) {
    toast.error(e);
    return false;
  }
}

export const acceptFriend = (user: Who) => attempt(() => useFriends.getState().accept(user.id));
export const ignoreFriend = (user: Who) => attempt(() => useFriends.getState().decline(user.id));
export const cancelFriendRequest = (user: Who) =>
  attempt(() => useFriends.getState().cancel(user.id));

/** Confirm, then remove the friendship (both sides). */
export async function confirmRemoveFriend(user: Who): Promise<boolean> {
  const name = userDisplayName(user);
  const ok = await confirm({
    title: `Remove ‘${name}’`,
    message: `Are you sure you want to remove ${name} from your friends?`,
    confirmLabel: 'Remove Friend',
    danger: true,
  });
  if (!ok) return false;
  return attempt(() => useFriends.getState().removeFriend(user.id));
}
