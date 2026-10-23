/**
 * Discord's DM row menu in the DM list: Mark as Read; Profile, Call, Add Note, Add Friend
 * Nickname, Close DM; Invite to Space ▸, the friend action, Ignore, Block; Mute @name ▸ (or
 * Unmute with when it ends); Copy User ID and Copy Channel ID in Developer Mode. A DM with
 * myself or a deleted account keeps the conversation's own items.
 */
import { useEffect } from 'react';
import { Bell, BellOff, MailCheck, X } from 'lucide-react';
import { SPACE_MUTE_DURATIONS, isMuted, userDisplayName, type ChatSummary } from '@enbox/shared';
import { Menu, type MenuAnchor, type MenuEntry } from '@/components/ui';
import { markRead, patchPrefs, unmuteChat } from '@/features/chats/chatActions';
import { copyIdItem, tidy } from '@/features/spaces/menus';
import { muteUntilIso, mutedUntilText } from '@/features/spaces/sidebar';
import {
  blockItem,
  callItem,
  friendItems,
  ignoreItem,
  inviteToSpaceItem,
  nicknameItem,
  noteItem,
  profileItem,
  useUserFacts,
  type UserFacts,
} from '@/features/users/userItems';
import { isChatUnread } from '@/stores/chats';
import { useFriends } from '@/stores/friends';
import { useUi } from '@/stores/ui';
import { useUser } from '@/stores/users';

/** Mute @name ▸ Discord's durations, or Unmute @name. */
function muteItem(chat: ChatSummary, handle: string): MenuEntry {
  if (isMuted(chat.mutedUntil))
    return {
      label: `Unmute ${handle}`,
      icon: Bell,
      description: mutedUntilText(chat.mutedUntil) ?? undefined,
      onSelect: () => void unmuteChat(chat),
    };
  return {
    label: `Mute ${handle}`,
    icon: BellOff,
    submenu: SPACE_MUTE_DURATIONS.map((d) => ({
      label: d.label,
      onSelect: () => void patchPrefs(chat, { mutedUntil: muteUntilIso(d.ms) }),
    })),
  };
}

export function dmRowMenuItems(
  chat: ChatSummary,
  f: UserFacts | null,
  ctx: { at: MenuAnchor | null; devMode: boolean; onCloseDm: () => void },
): MenuEntry[] {
  const person = f?.other ? f : null;
  return tidy([
    {
      label: 'Mark as Read',
      icon: MailCheck,
      disabled: !isChatUnread(chat),
      onSelect: () => markRead(chat),
    },
    'separator',
    person && profileItem(person.user.id, ctx.at),
    person && callItem(person),
    person && noteItem(person),
    person && nicknameItem(person),
    { label: 'Close DM', icon: X, onSelect: ctx.onCloseDm },
    'separator',
    person && inviteToSpaceItem(person),
    ...(person ? friendItems(person) : []),
    person && ignoreItem(person),
    person && blockItem(person),
    'separator',
    muteItem(chat, person ? `@${person.user.username}` : 'Conversation'),
    'separator',
    person && copyIdItem(person.user.id, 'User', ctx.devMode),
    copyIdItem(chat.id, 'Channel', ctx.devMode),
  ]);
}

/** The menu of a direct chat's row, mounted while open (its items follow live changes). */
export function DmRowMenu({
  chat,
  anchor,
  onClose,
  onCloseDm,
}: {
  chat: ChatSummary;
  anchor: MenuAnchor;
  onClose: () => void;
  onCloseDm: () => void;
}) {
  const devMode = useUi((s) => s.prefs.developerMode);
  const peer = chat.type === 'direct' ? chat.peer : null;
  const f = useUserFacts(useUser(peer?.id) ?? peer ?? undefined);
  useEffect(() => {
    void useFriends
      .getState()
      .load()
      .catch(() => undefined);
  }, []);
  return (
    <Menu
      open
      onClose={onClose}
      anchor={anchor}
      items={dmRowMenuItems(chat, f, { at: anchor, devMode, onCloseDm })}
      aria-label={`${peer ? userDisplayName(peer) : 'Conversation'} menu`}
    />
  );
}
