/** Conversation header: avatar, title, live subtitle, call buttons and the chat menu. */
import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router';
import {
  Bell,
  BellOff,
  CheckSquare,
  EllipsisVertical,
  Eraser,
  Info,
  LogOut,
  Search,
  Timer,
  Trash2,
  XCircle,
} from 'lucide-react';
import {
  DISAPPEARING_OPTIONS,
  chatTitle,
  formatTimer,
  isMuted,
  userDisplayName,
  type ChatSummary,
} from '@enbox/shared';
import { ChatAvatar } from '@/components/common/ChatAvatar';
import { PhoneIcon, VideoIcon } from '@/components/icons';
import { PaneHeader } from '@/components/layout/PaneHeader';
import { DropdownMenu, IconButton, choose, toast, type MenuEntry } from '@/components/ui';
import { useIsDesktop } from '@/hooks/useMediaQuery';
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
import { useConversationUi } from './state';

export function backPath(pathname: string): string {
  for (const base of ['/archived', '/starred', '/updates'])
    if (pathname.startsWith(base)) return base;
  return '/chats';
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
  return { text: memberNames ?? `${chat.memberCount} members`, live: false };
}

export function ConversationHeader({
  chat,
  onOpenInfo,
}: {
  chat: ChatSummary;
  onOpenInfo: () => void;
}) {
  const desktop = useIsDesktop();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const me = useAuth((s) => s.user?.id);
  const subtitle = useSubtitle(chat);
  const muted = isMuted(chat.mutedUntil);
  const canCall =
    chat.permissions.canCall && chat.membership === 'active' && chat.type !== 'channel';
  const base = backPath(pathname);

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
    { label: infoLabel, icon: Info, onSelect: onOpenInfo },
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
      ? chat.permissions.canLeave
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
          onClick={onOpenInfo}
          aria-label={`${infoLabel}: ${chatTitle(chat, me)}`}
          className="mx-1 shrink-0 rounded-full outline-none focus-visible:outline-2 focus-visible:outline-brand"
        >
          <ChatAvatar
            chat={chat}
            size="md"
            showPresence={chat.type === 'direct' && chat.peer?.id !== me}
          />
        </button>
      }
      title={chatTitle(chat, me)}
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
      onTitleClick={onOpenInfo}
      border
      actions={
        <>
          {canCall ? (
            <>
              <IconButton
                icon={VideoIcon}
                label="Video call"
                onClick={() => void useCalls.getState().startCall(chat.id, 'video')}
              />
              <IconButton
                icon={PhoneIcon}
                label="Voice call"
                onClick={() => void useCalls.getState().startCall(chat.id, 'audio')}
              />
            </>
          ) : null}
          {desktop ? (
            <IconButton
              icon={Search}
              label="Search in chat"
              onClick={() => useConversationUi.getState().setSearch(chat.id, '')}
            />
          ) : null}
          <DropdownMenu
            aria-label="Chat menu"
            trigger={(p) => <IconButton {...p} icon={EllipsisVertical} label="Chat menu" />}
            items={items}
          />
        </>
      }
    />
  );
}
