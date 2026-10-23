/**
 * Conversation header: avatar, title, live subtitle and, for DMs and group DMs, Discord's
 * toolbar (Start Voice Call, Start Video Call, Pinned Messages, Add Friends to DM, Show User
 * Profile or Show Member List, search, Inbox) with the chat menu.
 */
import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router';
import {
  Bell,
  BellOff,
  CheckSquare,
  CircleUserRound,
  EllipsisVertical,
  Eraser,
  Info,
  LogOut,
  Palette,
  Search,
  Timer,
  Trash2,
  XCircle,
} from 'lucide-react';
import {
  DISAPPEARING_OPTIONS,
  formatTimer,
  isMuted,
  userDisplayName,
  type ChatSummary,
} from '@enbox/shared';
import { ChatAvatar } from '@/components/common/ChatAvatar';
import { PhoneIcon, VideoIcon } from '@/components/icons';
import { PaneHeader } from '@/components/layout/PaneHeader';
import { DropdownMenu, IconButton, choose, toast, type MenuEntry } from '@/components/ui';
import { GroupDmAvatar } from '@/features/groupDms/GroupDmAvatar';
import {
  DmAddFriendsTool,
  GroupDmName,
  GroupDmTools,
  addFriendsMenuItem,
  canAddFriendsToDm,
  groupDmMenuItems,
} from '@/features/groupDms/header';
import { useGroupDmUi } from '@/features/groupDms/state';
import { useChatTitle } from '@/features/groupDms/title';
import { InboxButton } from '@/features/inbox/InboxButton';
import { HeaderSearch } from '@/features/search/HeaderSearch';
import { DM_PROFILE_QUERY, dmProfilePeer, useDmProfilePanel } from '@/features/users/profilePanel';
import { useIsDesktop, useMediaQuery } from '@/hooks/useMediaQuery';
import { api } from '@/lib/api';
import { formatCount, formatLastSeen } from '@/lib/format';
import { useAuth } from '@/stores/auth';
import { useCalls } from '@/stores/calls';
import { useChats, useTypingUsers } from '@/stores/chats';
import { nameOf, usePresence } from '@/stores/users';
import {
  clearChat,
  deleteChat,
  exitGroup,
  muteChat,
  unmuteChat,
} from '@/features/chats/chatActions';
import { useChatMembers } from './members';
import { PinsButton } from './pins/PinsPopout';
import { useConversationUi } from './state';

export function backPath(pathname: string): string {
  for (const base of ['/archived', '/starred', '/updates'])
    if (pathname.startsWith(base)) return base;
  return '/chats';
}

/** A DM's "Show User Profile" / "Hide User Profile" (the panel beside the conversation). */
function ProfileToggle() {
  const open = useDmProfilePanel((s) => s.open);
  return (
    <IconButton
      icon={CircleUserRound}
      label={open ? 'Hide User Profile' : 'Show User Profile'}
      active={open}
      aria-pressed={open}
      onClick={() => useDmProfilePanel.getState().toggle()}
    />
  );
}

function useSubtitle(chat: ChatSummary): { text: string; live: boolean } {
  const me = useAuth((s) => s.user?.id);
  const typing = useTypingUsers(chat.id);
  const presence = usePresence(
    chat.type === 'direct' && chat.peer?.id !== me ? chat.peer?.id : null,
  );
  const members = useChatMembers(chat);
  const memberNames = useMemo(() => {
    if (!members || chat.type !== 'group') return null;
    const others = members
      .filter((m) => m.user.id !== me)
      .map((m) => userDisplayName(m.user))
      .sort((a, b) => a.localeCompare(b));
    return [...others, 'You'].join(', ');
  }, [members, chat.type, me]);

  const ids = Object.keys(typing);
  if (ids.length) {
    const recording = Object.values(typing).some((t) => t.state === 'recording');
    const verb = recording ? 'recording audio…' : 'typing…';
    if (chat.type === 'direct') return { text: verb, live: true };
    return {
      text: ids.length > 1 ? `${ids.length} people are ${verb}` : `${nameOf(ids[0]!)} is ${verb}`,
      live: true,
    };
  }
  if (chat.type === 'direct') {
    if (chat.peer?.id === me) return { text: 'Message yourself', live: false };
    if (chat.peer?.isDeleted) return { text: '', live: false };
    return { text: formatLastSeen(presence), live: false };
  }
  if (chat.type === 'channel')
    return { text: `${formatCount(chat.memberCount)} followers`, live: false };
  if (chat.membership !== 'active') return { text: 'You’re no longer a member', live: false };
  // Group DMs: the names are the title already (when it has none).
  if (chat.isGroupDm)
    return { text: `${chat.memberCount} Member${chat.memberCount === 1 ? '' : 's'}`, live: false };
  return { text: memberNames ?? `${chat.memberCount} members`, live: false };
}

export function ConversationHeader({
  chat,
  onOpenInfo,
  onOpenTheme,
}: {
  chat: ChatSummary;
  onOpenInfo: () => void;
  /** Open the ChatThemeSheet (private override / shared theme). */
  onOpenTheme?: () => void;
}) {
  const desktop = useIsDesktop();
  // The profile panel (and so its toggle) needs a wide window.
  const profileFits = useMediaQuery(DM_PROFILE_QUERY);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const me = useAuth((s) => s.user?.id);
  const subtitle = useSubtitle(chat);
  const muted = isMuted(chat.mutedUntil);
  const canCall =
    chat.permissions.canCall && chat.membership === 'active' && chat.type !== 'channel';
  const base = backPath(pathname);
  // Group DMs: their own name, member list and Leave Group; a DM with a friend can grow into one.
  const title = useChatTitle(chat, { me: true });
  const groupDm = chat.isGroupDm === true;
  const gdm = groupDm
    ? groupDmMenuItems(chat, { title, onLeft: () => navigate(base, { replace: true }) })
    : null;
  const dmGrows = canAddFriendsToDm(chat, me);

  const setDisappearing = async () => {
    const current = chat.disappearingSeconds;
    const choice = await choose({
      title: 'Disappearing messages',
      message: 'New messages will disappear from this chat after the selected duration.',
      options: [
        ...DISAPPEARING_OPTIONS.map((s) => ({
          value: String(s),
          label: `${formatTimer(s)}${current === s ? '  ✓' : ''}`,
        })),
        { value: 'off', label: `Off${current === null ? '  ✓' : ''}` },
      ],
    });
    if (!choice) return;
    const seconds = choice === 'off' ? null : Number(choice);
    if (seconds === current) return;
    try {
      const updated = await api.put<ChatSummary>(`/api/chats/${chat.id}/disappearing`, { seconds });
      if (updated) useChats.getState().upsertChat(updated);
    } catch (e) {
      toast.error(e);
    }
  };

  const infoLabel =
    chat.type === 'direct'
      ? 'Contact info'
      : chat.type === 'channel'
        ? 'Channel info'
        : 'Group info';
  const items: MenuEntry[] = [
    gdm ? gdm.members : { label: infoLabel, icon: Info, onSelect: onOpenInfo },
    !desktop && ((groupDm && chat.membership === 'active') || dmGrows)
      ? addFriendsMenuItem(chat)
      : null,
    {
      label: 'Search',
      icon: Search,
      onSelect: () => useConversationUi.getState().setSearch(chat.id, ''),
    },
    {
      label: 'Select messages',
      icon: CheckSquare,
      onSelect: () => useConversationUi.getState().startSelect(chat.id),
    },
    muted
      ? { label: 'Unmute notifications', icon: Bell, onSelect: () => void unmuteChat(chat) }
      : { label: 'Mute notifications', icon: BellOff, onSelect: () => void muteChat(chat) },
    onOpenTheme && chat.type !== 'channel'
      ? { label: 'Chat theme', icon: Palette, onSelect: onOpenTheme }
      : null,
    chat.type !== 'channel' && chat.permissions.canEditInfo
      ? {
          label: 'Disappearing messages',
          icon: Timer,
          hint: chat.disappearingSeconds ? formatTimer(chat.disappearingSeconds) : 'Off',
          onSelect: () => void setDisappearing(),
        }
      : null,
    desktop ? { label: 'Close chat', icon: XCircle, onSelect: () => navigate(base) } : null,
    'separator',
    chat.lastMessage
      ? { label: 'Clear chat', icon: Eraser, onSelect: () => void clearChat(chat) }
      : null,
    chat.type === 'group' && chat.membership === 'active'
      ? gdm
        ? gdm.leave
        : chat.permissions.canLeave
          ? { label: 'Exit group', icon: LogOut, danger: true, onSelect: () => void exitGroup(chat) }
          : null
      : chat.type !== 'channel'
        ? {
            label: chat.type === 'group' ? 'Delete group' : 'Delete chat',
            icon: Trash2,
            danger: true,
            onSelect: () =>
              void deleteChat(chat).then((ok) => {
                if (ok) navigate(base, { replace: true });
              }),
          }
        : null,
  ];

  return (
    <PaneHeader
      back={desktop ? undefined : base}
      leading={
        <button
          type="button"
          onClick={groupDm ? () => useGroupDmUi.getState().toggleMembers(chat.id) : onOpenInfo}
          aria-label={`${groupDm ? 'Members' : infoLabel}: ${title}`}
          className="mx-1 shrink-0 rounded-full outline-none focus-visible:outline-2 focus-visible:outline-brand"
        >
          {groupDm ? (
            <GroupDmAvatar chat={chat} size={32} />
          ) : (
            <ChatAvatar
              chat={chat}
              size="sm"
              showPresence={chat.type === 'direct' && chat.peer?.id !== me}
            />
          )}
        </button>
      }
      title={groupDm ? <GroupDmName chat={chat} /> : title}
      subtitle={
        subtitle.text ? (
          <span
            className={subtitle.live ? 'text-brand-ink' : undefined}
            data-testid="chat-subtitle"
          >
            {subtitle.text}
          </span>
        ) : undefined
      }
      onTitleClick={groupDm ? undefined : onOpenInfo}
      actions={
        <>
          {canCall ? (
            <>
              {/* Discord's toolbar: voice call, video call, pins, add friends, the profile. */}
              <IconButton
                icon={PhoneIcon}
                label="Start Voice Call"
                onClick={() => void useCalls.getState().startCall(chat.id, 'audio')}
              />
              <IconButton
                icon={VideoIcon}
                label="Start Video Call"
                onClick={() => void useCalls.getState().startCall(chat.id, 'video')}
              />
            </>
          ) : null}
          {desktop ? <PinsButton chat={chat} /> : null}
          {groupDm ? (
            <GroupDmTools chat={chat} desktop={desktop} />
          ) : dmGrows ? (
            <DmAddFriendsTool chat={chat} desktop={desktop} />
          ) : null}
          {desktop && profileFits && dmProfilePeer(chat, me) ? <ProfileToggle /> : null}
          {desktop ? <HeaderSearch scope={{ kind: 'chat', chatId: chat.id }} chatId={chat.id} /> : null}
          <DropdownMenu
            aria-label="Chat menu"
            trigger={(p) => <IconButton {...p} icon={EllipsisVertical} label="Chat menu" />}
            items={items}
          />
          {desktop ? <InboxButton /> : null}
        </>
      }
    />
  );
}
