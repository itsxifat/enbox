/** Conversation header: avatar, title, live subtitle, call buttons and the chat menu (web ConversationHeader.tsx). */
import { useMemo } from 'react';
import { useRouter } from 'expo-router';
import {
  Bell,
  BellOff,
  CheckSquare,
  EllipsisVertical,
  Eraser,
  Info,
  LogOut,
  Palette,
  Search,
  Timer,
  Trash2,
} from 'lucide-react-native';
import {
  DISAPPEARING_OPTIONS,
  chatTitle,
  formatTimer,
  isMuted,
  userDisplayName,
} from '@enbox/shared';
import { ChatAvatar } from '@/components/common/avatars';
import { PhoneIcon, VideoIcon } from '@/components/icons';
import { PaneHeader } from '@/components/layout/PaneHeader';
import { DropdownMenu, IconButton, Press, T, choose, toast } from '@/components/ui';
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
import { useTheme } from '@/theme';
import { useChatMembers } from './members';
import { useConversationUi } from './state';

function useSubtitle(chat) {
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
      text: ids.length > 1 ? `${ids.length} people are ${verb}` : `${nameOf(ids[0])} is ${verb}`,
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

export function ConversationHeader({ chat, onOpenInfo, onOpenTheme }) {
  const { tw } = useTheme();
  const router = useRouter();
  const me = useAuth((s) => s.user?.id);
  const subtitle = useSubtitle(chat);
  const muted = isMuted(chat.mutedUntil);
  const canCall =
    chat.permissions.canCall && chat.membership === 'active' && chat.type !== 'channel';

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
      const updated = await api.put(`/api/chats/${chat.id}/disappearing`, { seconds });
      if (updated) useChats.getState().upsertChat(updated);
    } catch (e) {
      toast.error(e);
    }
  };

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/chats'));
  const infoLabel =
    chat.type === 'direct'
      ? 'Contact info'
      : chat.type === 'channel'
        ? 'Channel info'
        : 'Group info';
  const items = [
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
                if (ok) goBack();
              }),
          }
        : null,
  ];

  return (
    <PaneHeader
      back={goBack}
      leading={
        <Press
          feedback={false}
          onPress={onOpenInfo}
          style={tw`mx-1 rounded-full`}
          accessibilityLabel={`${infoLabel}: ${chatTitle(chat, me)}`}
        >
          <ChatAvatar
            chat={chat}
            size="md"
            showPresence={chat.type === 'direct' && chat.peer?.id !== me}
          />
        </Press>
      }
      title={chatTitle(chat, me)}
      subtitle={
        subtitle.text ? (
          <T
            numberOfLines={1}
            style={[
              tw`text-[13px] leading-tight`,
              subtitle.live ? tw`text-brand-ink` : tw`text-muted`,
            ]}
          >
            {subtitle.text}
          </T>
        ) : undefined
      }
      onTitlePress={onOpenInfo}
      actions={
        <>
          {canCall ? (
            <>
              <IconButton
                icon={VideoIcon}
                label="Video call"
                onPress={() => void useCalls.getState().startCall(chat.id, 'video')}
              />
              <IconButton
                icon={PhoneIcon}
                label="Voice call"
                onPress={() => void useCalls.getState().startCall(chat.id, 'audio')}
              />
            </>
          ) : null}
          <DropdownMenu
            trigger={(p) => <IconButton {...p} icon={EllipsisVertical} label="Chat menu" />}
            items={items}
          />
        </>
      }
    />
  );
}
