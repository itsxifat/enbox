/** Compact chat row under a community (web CommunityChatRow.tsx): announcements / groups with a live preview. */
import { useEffect } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Megaphone } from 'lucide-react-native';
import { chatKindOf, isMuted, messagePreviewText, referencedUserIds } from '@enbox/shared';
import { Icon } from '@/components/icons';
import { Avatar, Badge, Press, T } from '@/components/ui';
import { formatChatListTime } from '@/lib/format';
import { getMyId } from '@/stores/auth';
import { isChatUnread, useChat } from '@/stores/chats';
import { nameOf, useUsers } from '@/stores/users';
import { useTheme } from '@/theme';

export function CommunityChatRow({ chatId, name, avatarUrl, announcement, fallback, indent, end }) {
  const { tw, c } = useTheme();
  const router = useRouter();
  const chat = useChat(chatId);
  const me = getMyId() ?? undefined;
  const last = chat?.lastMessage;
  useUsers((s) => s.byId);
  useEffect(() => {
    if (last)
      void useUsers
        .getState()
        .fetchUsers(referencedUserIds(last))
        .catch(() => undefined);
  }, [last]);
  const sender =
    last && last.senderId && last.type !== 'system' && last.type !== 'call'
      ? last.senderId === me
        ? 'You'
        : nameOf(last.senderId)
      : null;
  const preview = last
    ? messagePreviewText(last, (id) => nameOf(id), {
        viewerId: me,
        chatKind: chat ? chatKindOf(chat) : 'group',
      })
    : null;
  const unread = chat ? isChatUnread(chat) : false;
  const muted = chat ? isMuted(chat.mutedUntil) : false;

  const body = (
    <>
      {announcement ? (
        <View style={tw`size-11 items-center justify-center rounded-[12px] bg-brand-soft`}>
          <Icon icon={Megaphone} size={20} color={c['brand-ink']} />
        </View>
      ) : (
        <Avatar src={avatarUrl} name={name} colorSeed={chatId} kind="group" size={44} />
      )}
      <View style={tw`min-w-0 flex-1 gap-0.5`}>
        <View style={tw`flex-row items-baseline gap-2`}>
          <T
            numberOfLines={1}
            style={[tw`min-w-0 flex-1 text-[15.5px]`, unread ? tw`font-semibold` : tw`font-medium`]}
          >
            {announcement ? 'Announcements' : name}
          </T>
          {chat && last && !end ? (
            <T
              style={[
                tw`text-xs`,
                { fontVariant: ['tabular-nums'] },
                unread && !muted ? tw`font-medium text-brand-ink` : tw`text-subtle`,
              ]}
            >
              {formatChatListTime(chat.lastActivityAt)}
            </T>
          ) : null}
        </View>
        <View style={tw`flex-row items-center gap-2`}>
          {typeof (preview ?? fallback) === 'string' || preview ? (
            <T
              numberOfLines={1}
              style={[tw`min-w-0 flex-1 text-[14px]`, unread ? null : tw`text-muted`]}
            >
              {preview ? `${sender ? `${sender}: ` : ''}${preview}` : fallback}
            </T>
          ) : (
            <View style={tw`min-w-0 flex-1`}>{fallback}</View>
          )}
          {chat && unread && !end ? (
            <Badge
              count={chat.unreadCount || undefined}
              dot={!chat.unreadCount}
              tone={muted ? 'muted' : 'brand'}
              size="sm"
            />
          ) : null}
        </View>
      </View>
      {end}
    </>
  );
  const style = [tw`flex-row items-center gap-3 py-2.5 pr-4`, indent ? tw`pl-7` : tw`pl-4`];
  if (end) return <View style={style}>{body}</View>;
  return (
    <Press style={style} onPress={() => router.push(`/chats/${chatId}`)}>
      {body}
    </Press>
  );
}
