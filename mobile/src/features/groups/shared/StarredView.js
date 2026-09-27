/** Starred messages of one chat (web shared/StarredView.tsx): `GET /api/messages/starred?chatId=`. */
import { useEffect, useState } from 'react';
import { FlatList, View } from 'react-native';
import { Star } from 'lucide-react-native';
import { chatKindOf, messagePreviewText } from '@enbox/shared';
import { UserAvatar } from '@/components/common/avatars';
import { Icon } from '@/components/icons';
import { PaneHeader } from '@/components/layout/PaneHeader';
import { EmptyState, ListItemSkeleton, T } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { formatChatListTime } from '@/lib/format';
import { getMyId } from '@/stores/auth';
import { nameOf, useUsers } from '@/stores/users';
import { useTheme } from '@/theme';
import { fetchStarred } from './mediaCounts';

export function StarredView({ chat, onBack, onOpen }) {
  const { tw, c } = useTheme();
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  useUsers((s) => s.byId);

  useEffect(() => {
    let alive = true;
    fetchStarred(chat.id)
      .then((mine) => {
        if (!alive) return;
        const ids = mine.map((r) => r.message.senderId).filter((x) => !!x);
        void useUsers
          .getState()
          .fetchUsers(ids)
          .catch(() => undefined);
        setItems(mine);
      })
      .catch((e) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [chat.id]);

  const me = getMyId() ?? undefined;
  return (
    <View style={tw`flex-1 bg-surface`}>
      <PaneHeader title="Starred messages" back={onBack} />
      {items === null && !error ? (
        <ListItemSkeleton count={4} />
      ) : !items?.length ? (
        <EmptyState
          compact
          icon={Star}
          title={error ? "Couldn't load" : 'No starred messages'}
          description={
            error ??
            'Tap and hold on any message in this chat to star it, so you can easily find it later.'
          }
        />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(r) => r.message.id}
          ItemSeparatorComponent={() => <View style={tw`h-px bg-line`} />}
          renderItem={({ item: { message } }) => (
            <View
              style={tw`flex-row gap-3 px-4 py-3`}
              onTouchEnd={onOpen ? () => onOpen(message) : undefined}
            >
              {message.senderId ? (
                <UserAvatar userId={message.senderId} size="sm" />
              ) : (
                <View style={tw`size-8`} />
              )}
              <View style={tw`min-w-0 flex-1`}>
                <View style={tw`flex-row items-baseline justify-between gap-2`}>
                  <T numberOfLines={1} style={tw`shrink text-[14px] font-semibold`}>
                    {message.senderId ? nameOf(message.senderId) : (chat.name ?? 'Channel')}
                  </T>
                  <T style={tw`text-xs text-subtle`}>{formatChatListTime(message.createdAt)}</T>
                </View>
                <T numberOfLines={3} style={tw`mt-0.5 text-[14.5px]`}>
                  {messagePreviewText(message, (id) => nameOf(id), {
                    viewerId: me,
                    chatKind: chatKindOf(chat),
                  })}
                </T>
              </View>
              <Icon icon={Star} size={14} color={c.warning} style={tw`mt-1`} />
            </View>
          )}
        />
      )}
    </View>
  );
}
