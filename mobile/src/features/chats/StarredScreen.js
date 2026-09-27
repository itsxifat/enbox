/**
 * Starred messages (/starred; web features/chats/StarredPane.tsx): newest star first; tap to
 * open the message in its chat, unstar from the row.
 */
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { ChevronRight, Star, StarOff } from 'lucide-react-native';
import { chatTitle, renderMentions } from '@enbox/shared';
import { ChatAvatar, UserAvatar } from '@/components/common/avatars';
import { Icon } from '@/components/icons';
import { PaneHeader } from '@/components/layout/PaneHeader';
import { Button, EmptyState, IconButton, ListItemSkeleton, Press, T } from '@/components/ui';
import { api, errorMessage, mediaUrl } from '@/lib/api';
import { formatShortDate, formatTime } from '@/lib/format';
import { useAuth } from '@/stores/auth';
import { useMessages } from '@/stores/messages';
import { toast } from '@/stores/ui';
import { useUserName, useUsers } from '@/stores/users';
import { useTheme } from '@/theme';
import { chatPath } from './links';
import { PreviewLine, mentionName, previewParts } from './preview';

/** The web's `max-h-40` thumbnail at the media's aspect ratio (bubble max ~240px wide). */
function thumbSize(media) {
  const ratio = media?.width && media?.height ? media.width / media.height : 4 / 3;
  const height = Math.min(160, 240 / ratio);
  return { width: Math.round(height * ratio), height: Math.round(height) };
}

function StarredRow({ r, onUnstar }) {
  const { tw, c, shadow } = useTheme();
  const router = useRouter();
  const me = useAuth((s) => s.user?.id);
  const m = r.message;
  const sender = useUserName(m.senderId, { you: 'You' });
  const chatName = chatTitle({ ...r.chat }, me);
  const direct = r.chat.type === 'direct';
  const channel = r.chat.type === 'channel';
  const mine = m.senderId === me;
  const thumb = m.media?.thumbnailUrl ?? (m.media?.kind === 'image' ? m.media.url : null);
  const text = m.text ? renderMentions(m.text, mentionName) : null;
  const from = channel ? chatName : sender;
  const to = channel ? null : direct ? (mine ? chatName : 'You') : chatName;
  const meta = mine ? c['bubble-out-meta'] : c['bubble-in-meta'];
  return (
    <View style={tw`mx-2 my-0.5`}>
      <Press
        onPress={() => router.push(chatPath(r.chat, { seq: m.seq, messageId: m.id }))}
        accessibilityLabel={`Open starred message from ${from}`}
        style={tw`rounded-xl px-3 py-3`}
      >
        <View style={tw`flex-row items-center gap-2 pr-8`}>
          {channel ? (
            <ChatAvatar chat={{ ...r.chat, isAnnouncement: false, communityId: null }} size="xs" />
          ) : (
            <UserAvatar userId={m.senderId} size="xs" />
          )}
          <View style={tw`min-w-0 flex-1 flex-row items-center gap-1`}>
            <T numberOfLines={1} style={tw`shrink text-[13px] font-medium`}>
              {from}
            </T>
            {to ? (
              <>
                <Icon icon={ChevronRight} size={14} color={c.subtle} />
                <T numberOfLines={1} style={tw`shrink text-[13px] font-medium`}>
                  {to}
                </T>
              </>
            ) : null}
          </View>
          <T style={tw`text-xs text-subtle`}>{formatShortDate(m.createdAt)}</T>
        </View>
        <View style={tw`mt-2 flex-row items-end gap-2 pl-8`}>
          <View
            style={[
              tw`rounded-xl px-3 py-2`,
              { maxWidth: '85%', backgroundColor: mine ? c['bubble-out'] : c['bubble-in'] },
              shadow.bubble,
            ]}
          >
            {thumb ? (
              <Image
                source={{ uri: mediaUrl(thumb) }}
                style={[tw`mb-1.5 rounded-lg`, thumbSize(m.media)]}
                contentFit="cover"
              />
            ) : null}
            {text ? (
              <T numberOfLines={4} style={tw`text-[14px]`}>
                {text}
              </T>
            ) : (
              <PreviewLine parts={previewParts(m, { meId: me })} color={c.fg} />
            )}
            <View style={tw`mt-0.5 flex-row items-center justify-end gap-1`}>
              <Star size={12} color={meta} fill={meta} accessibilityLabel="Starred" />
              <T style={{ fontSize: 11, color: meta }}>{formatTime(m.createdAt)}</T>
            </View>
          </View>
        </View>
      </Press>
      <IconButton
        icon={StarOff}
        label="Unstar"
        size="sm"
        onPress={onUnstar}
        style={tw`absolute top-1.5 right-2`}
      />
    </View>
  );
}

export function StarredScreen() {
  const { tw } = useTheme();
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setError(null);
    api
      .get('/api/messages/starred')
      .then((list) => {
        const ids = new Set();
        for (const r of list) if (r.message.senderId) ids.add(r.message.senderId);
        void useUsers
          .getState()
          .fetchUsers([...ids])
          .catch(() => undefined);
        setItems(list);
      })
      .catch((e) => setError(errorMessage(e)));
  }, []);

  useEffect(load, [load]);

  const unstar = async (r) => {
    setItems((list) => list?.filter((x) => x.message.id !== r.message.id) ?? null);
    try {
      await api.delete(`/api/messages/${r.message.id}/star`);
      useMessages.getState().patchMessage(r.message.chatId, r.message.id, { starred: false });
    } catch (e) {
      toast.error(e);
      load();
    }
  };

  return (
    <View style={tw`flex-1 bg-surface`}>
      <PaneHeader title="Starred messages" back="/chats" />
      {error && !items ? (
        <EmptyState
          icon={Star}
          title="Couldn't load starred messages"
          description={error}
          action={<Button onPress={load}>Try again</Button>}
        />
      ) : !items ? (
        <ListItemSkeleton count={5} />
      ) : items.length ? (
        <ScrollView style={tw`min-h-0 flex-1`} contentContainerStyle={tw`pb-6`}>
          {items.map((r) => (
            <StarredRow key={r.message.id} r={r} onUnstar={() => void unstar(r)} />
          ))}
        </ScrollView>
      ) : (
        <EmptyState
          icon={Star}
          title="No starred messages"
          description="Tap and hold (or right-click) any message and choose Star to find it here later."
        />
      )}
    </View>
  );
}
