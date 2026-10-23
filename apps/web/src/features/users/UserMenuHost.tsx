import { useEffect } from 'react';
import { userDisplayName, type ID, type SpaceMember } from '@enbox/shared';
import { Menu } from '@/components/ui';
import { FriendOnlineAlerts } from '@/features/friends/onlineAlerts';
import { MemberDialog, memberSpaceItems } from '@/features/spaces/MemberActions';
import { useMe } from '@/stores/auth';
import { useFriends } from '@/stores/friends';
import { useSpace, useSpaceMember, useSpaces } from '@/stores/spaces';
import { useUi } from '@/stores/ui';
import { useUser } from '@/stores/users';
import { FriendNicknameDialog, UserNoteDialog } from './UserDialogs';
import { useUserFacts, userMenuItems } from './userItems';
import {
  closeUserDialog,
  closeUserMenu,
  openUserDialog,
  useUserMenu,
  type UserDialog,
  type UserMenuRequest,
} from './userMenu';

/** Their membership of the Space (mine from `space.me`), batch-loaded when not seen yet. */
function useMember(spaceId: ID | null | undefined, userId: ID): SpaceMember | undefined {
  const me = useMe();
  const space = useSpace(spaceId);
  const self = me?.id === userId;
  const stored = useSpaceMember(spaceId && !self ? spaceId : null, userId);
  useEffect(() => {
    if (spaceId && space && !self && !stored) useSpaces.getState().fetchMembers(spaceId, [userId]);
  }, [spaceId, space, self, stored, userId]);
  if (!space || !me) return undefined;
  return self ? { ...space.me, userId } : stored;
}

function UserContextMenu({ request }: { request: UserMenuRequest }) {
  const { userId, at, opts } = request;
  const me = useMe();
  const f = useUserFacts(useUser(userId));
  const space = useSpace(opts.spaceId);
  const member = useMember(opts.spaceId, userId);
  const devMode = useUi((s) => s.prefs.developerMode);

  // Pending requests decide the friend item.
  useEffect(() => {
    void useFriends
      .getState()
      .load()
      .catch(() => undefined);
  }, []);

  const spaceItems =
    space && member && me
      ? memberSpaceItems(
          space,
          member,
          me.id,
          (dialog) => openUserDialog({ kind: 'member', userId, spaceId: space.id, dialog }),
          { roles: 'submenu' },
        )
      : undefined;
  const mentionName = member?.nickname || (f ? userDisplayName(f.user) : undefined);
  const items = f
    ? userMenuItems(f, { at, spaceId: opts.spaceId, chatId: opts.chatId, mentionName, spaceItems, devMode })
    : [];
  // Opens once the user is known (a name in an old message may load first).
  return (
    <Menu
      open={items.length > 0}
      onClose={closeUserMenu}
      anchor={at}
      items={items}
      aria-label={f ? `${userDisplayName(f.user)} menu` : 'User menu'}
    />
  );
}

function MemberDialogHost({ dialog }: { dialog: Extract<UserDialog, { kind: 'member' }> }) {
  const space = useSpace(dialog.spaceId);
  const member = useMember(dialog.spaceId, dialog.userId);
  if (!space || !member) return null;
  return (
    <MemberDialog space={space} member={member} dialog={dialog.dialog} onClose={closeUserDialog} />
  );
}

/**
 * Renders the user context menu opened with `openUserMenu` (everyday wave, agent 5), the dialogs
 * its items and the DM list's row menu open (note, friend nickname, the member's Space dialogs),
 * and runs the friend-online alerts. Mounted once (lazily) in AppShell.
 */
export function UserMenuHost() {
  const menu = useUserMenu((s) => s.menu);
  const dialog = useUserMenu((s) => s.dialog);
  return (
    <>
      {/* A new right-click is a new menu (positioned and focused afresh). */}
      {menu ? (
        <UserContextMenu key={`${menu.userId}:${menu.at.x}:${menu.at.y}`} request={menu} />
      ) : null}
      {dialog?.kind === 'note' ? (
        <UserNoteDialog userId={dialog.userId} onClose={closeUserDialog} />
      ) : null}
      {dialog?.kind === 'nickname' ? (
        <FriendNicknameDialog userId={dialog.userId} onClose={closeUserDialog} />
      ) : null}
      {dialog?.kind === 'member' ? <MemberDialogHost dialog={dialog} /> : null}
      <FriendOnlineAlerts />
    </>
  );
}
