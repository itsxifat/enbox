/**
 * Building blocks of the user menus (Discord's): the user context menu (`userMenuItems`) and
 * the DM list's row menu (features/home/dmMenu.tsx). Pure over `UserFacts` — what I know of
 * someone now, kept live by `useUserFacts` — so an open menu follows every change.
 */
import { useMemo } from 'react';
import { AtSign, Ban, EyeOff, MessageCircle, NotebookPen, Send, User, UserPen } from 'lucide-react';
import {
  PERM,
  hasPerm,
  userDisplayName,
  type ChatSummary,
  type ID,
  type Space,
  type UserPublic,
} from '@enbox/shared';
import { PhoneIcon } from '@/components/icons';
import { Avatar, toast, type MenuAnchor, type MenuEntry } from '@/components/ui';
import { ensureDirectChat } from '@/features/calls/directChat';
import { confirmBlock, confirmUnblock } from '@/features/contacts/contactActions';
import { inviteUrl } from '@/features/groups/shared/share';
import { friendMenuItems } from '@/features/home/friendActions';
import { openProfile } from '@/features/profile/open';
import { confirmIgnore, confirmUnignore } from '@/features/safety/actions';
import { createInvite } from '@/features/spaces/actions';
import { copyIdItem, tidy } from '@/features/spaces/menus';
import { bus } from '@/lib/bus';
import { useAuth } from '@/stores/auth';
import { useCalls } from '@/stores/calls';
import { useFriendStatus, type FriendStatus } from '@/stores/friends';
import { useIsIgnored } from '@/stores/ignores';
import { useSpaceList } from '@/stores/spaces';
import { openUserDialog } from './userMenu';

/** What the user menus show for someone: the user as I see them and where we stand. */
export interface UserFacts {
  user: UserPublic;
  /** Someone I can act on: not me, not a deleted account. */
  other: boolean;
  friend: FriendStatus;
  ignored: boolean;
  /** "Invite to Space ▸": my Spaces where I may create invites. */
  spaces: Space[];
}

/** I may invite people to it now (CREATE_INVITE, invites not paused). */
export function canInviteTo(space: Space): boolean {
  return hasPerm(space.myPermissions, PERM.CREATE_INVITE) && !space.invitesPaused;
}

function facts(
  user: UserPublic,
  me: ID | null,
  friend: FriendStatus,
  ignored: boolean,
  spaces: Space[],
): UserFacts {
  return { user, other: user.id !== me && !user.isDeleted, friend, ignored, spaces };
}

const NOBODY = { id: '', isContact: false };

/** The live facts (null until the user is known). */
export function useUserFacts(user: UserPublic | undefined): UserFacts | null {
  const me = useAuth((s) => s.user?.id ?? null);
  const friend = useFriendStatus(user ?? NOBODY);
  const ignored = useIsIgnored(user?.id);
  const all = useSpaceList();
  const spaces = useMemo(() => all.filter(canInviteTo), [all]);
  return useMemo(
    () => (user ? facts(user, me, friend, ignored, spaces) : null),
    [user, me, friend, ignored, spaces],
  );
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Open (create) our DM and go there. */
export async function messageUser(userId: ID): Promise<ChatSummary | null> {
  try {
    const chat = await ensureDirectChat(userId);
    bus.emit('navigate', { to: `/chats/${chat.id}` });
    return chat;
  } catch (e) {
    toast.error(e);
    return null;
  }
}

/** Discord's "Call" (voice; the friend list's video too): a call in our DM, opened. */
export async function callUser(userId: ID, type: 'audio' | 'video' = 'audio'): Promise<void> {
  try {
    const chat = await ensureDirectChat(userId);
    if (!chat.permissions.canCall) {
      toast.error("You can't call this person.");
      return;
    }
    bus.emit('navigate', { to: `/chats/${chat.id}` });
    await useCalls.getState().startCall(chat.id, type);
  } catch (e) {
    toast.error(e);
  }
}

/** A fresh invite to `space` (a week, any number of uses) sent to them in our DM. */
export async function inviteToSpace(user: UserPublic, space: Space): Promise<boolean> {
  try {
    const chat = await ensureDirectChat(user.id);
    if (!chat.permissions.canSend) {
      toast.error("You can't message this person.");
      return false;
    }
    const invite = await createInvite(space.id, {});
    // The conversation's send path (optimistic, kept while offline), loaded on use.
    const { sendQueued } = await import('@/features/conversation/lib/outbox');
    void sendQueued(chat.id, { type: 'text', text: inviteUrl(invite.code) });
    toast.success(`Invite to ${space.name} sent to ${userDisplayName(user)}`);
    return true;
  } catch (e) {
    toast.error(e);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

/** Their profile card, opened where the menu was. */
export function profileItem(userId: ID, at: MenuAnchor | null, spaceId?: ID | null): MenuEntry {
  return {
    label: 'Profile',
    icon: User,
    onSelect: () => openProfile(userId, at, spaceId ? { spaceId } : {}),
  };
}

export function messageItem(f: UserFacts): MenuEntry {
  return (
    f.other && {
      label: 'Message',
      icon: MessageCircle,
      onSelect: () => void messageUser(f.user.id),
    }
  );
}

export function callItem(f: UserFacts): MenuEntry {
  return (
    f.other &&
    !f.user.isBlocked && {
      label: 'Call',
      icon: PhoneIcon,
      onSelect: () => void callUser(f.user.id),
    }
  );
}

/** My private note about them (the dialog shows the saved one). */
export function noteItem(f: UserFacts): MenuEntry {
  return (
    f.other && {
      label: 'Add Note',
      icon: NotebookPen,
      onSelect: () => openUserDialog({ kind: 'note', userId: f.user.id }),
    }
  );
}

/** Friends: the name I saved them under, shown instead of theirs (only to me). */
export function nicknameItem(f: UserFacts): MenuEntry {
  return (
    f.other &&
    f.friend === 'friend' && {
      label: f.user.contactName ? 'Edit Friend Nickname' : 'Add Friend Nickname',
      icon: UserPen,
      onSelect: () => openUserDialog({ kind: 'nickname', userId: f.user.id }),
    }
  );
}

export function inviteToSpaceItem(f: UserFacts): MenuEntry {
  if (!f.other || f.user.isBlocked || f.spaces.length === 0) return null;
  return {
    label: 'Invite to Space',
    icon: Send,
    submenu: f.spaces.map((s) => ({
      label: (
        <span className="flex min-w-0 items-center gap-2.5">
          <Avatar
            kind="community"
            src={s.iconUrl}
            name={s.name}
            colorSeed={s.id}
            size={20}
            decorative
          />
          <span className="truncate">{s.name}</span>
        </span>
      ),
      onSelect: () => void inviteToSpace(f.user, s),
    })),
  };
}

export function friendItems(f: UserFacts): MenuEntry[] {
  return f.other ? friendMenuItems(f.user, f.friend) : [];
}

export function ignoreItem(f: UserFacts): MenuEntry {
  return (
    f.other && {
      label: f.ignored ? 'Unignore' : 'Ignore',
      icon: EyeOff,
      onSelect: () => void (f.ignored ? confirmUnignore(f.user) : confirmIgnore(f.user)),
    }
  );
}

export function blockItem(f: UserFacts): MenuEntry {
  if (!f.other) return null;
  return f.user.isBlocked
    ? { label: 'Unblock', icon: Ban, onSelect: () => void confirmUnblock(f.user) }
    : { label: 'Block', icon: Ban, danger: true, onSelect: () => void confirmBlock(f.user) };
}

export interface UserMenuContext {
  /** Where it opened (Profile opens its card there). */
  at: { x: number; y: number };
  spaceId?: ID | null;
  /** The chat it opened from: Mention inserts into its composer. */
  chatId?: ID | null;
  /** The name the mention shows (their Space nickname there). */
  mentionName?: string;
  /** In a Space: the member's items (`memberSpaceItems`). */
  spaceItems?: MenuEntry[];
  devMode: boolean;
}

/**
 * Discord's user context menu: Profile, Message, Call, Add Note, Add Friend Nickname; Invite to
 * Space ▸, the friend action, Ignore, Block; in a Space the member's items; Copy User ID in
 * Developer Mode. Mine and a deleted account's keep Profile, the Space items and the id.
 */
export function userMenuItems(f: UserFacts, ctx: UserMenuContext): MenuEntry[] {
  return tidy([
    profileItem(f.user.id, ctx.at, ctx.spaceId),
    ctx.chatId && !f.user.isDeleted
      ? {
          label: 'Mention',
          icon: AtSign,
          onSelect: () =>
            bus.emit('composer:mention', {
              chatId: ctx.chatId!,
              userId: f.user.id,
              name: ctx.mentionName ?? f.user.displayName,
            }),
        }
      : null,
    messageItem(f),
    callItem(f),
    noteItem(f),
    nicknameItem(f),
    'separator',
    inviteToSpaceItem(f),
    ...friendItems(f),
    ignoreItem(f),
    blockItem(f),
    'separator',
    ...(ctx.spaceItems ?? []),
    'separator',
    copyIdItem(f.user.id, 'User', ctx.devMode),
  ]);
}
