/**
 * "Channels" section of the Updates tab (web features/channels/ChannelsSection.tsx):
 * followed channels and, while you follow only a few, suggestions from the directory.
 */
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { BellOff, Compass, Megaphone, Plus } from 'lucide-react-native';
import { chatTitle, isMuted, messagePreviewText } from '@enbox/shared';
import { ChatAvatar } from '@/components/common/avatars';
import { Icon } from '@/components/icons';
import {
  Avatar,
  Badge,
  Button,
  DropdownMenu,
  IconButton,
  ListItem,
  ListSection,
  Press,
  T,
  toast,
} from '@/components/ui';
import { formatChatListTime, formatCount } from '@/lib/format';
import { isChatUnread, useChats, useSortedChats } from '@/stores/chats';
import { nameOf } from '@/stores/users';
import { useTheme } from '@/theme';
import { discoverChannels, followChannel } from './channelApi';

const SUGGEST_WHEN_FEWER_THAN = 4;

export function ChannelsSection() {
  const { tw, c } = useTheme();
  const router = useRouter();
  const channels = useSortedChats({ kind: 'channels' });
  const loaded = useChats((s) => s.loaded);

  return (
    <ListSection
      title="Channels"
      action={
        <DropdownMenu
          items={[
            {
              label: 'Create channel',
              icon: Plus,
              onSelect: () => router.push('/updates/channels/new'),
            },
            {
              label: 'Explore channels',
              icon: Compass,
              onSelect: () => router.push('/updates/channels/discover'),
            },
          ]}
          trigger={(t) => (
            <IconButton
              {...t}
              icon={Plus}
              label="New channel or explore"
              size="sm"
              variant="solid"
            />
          )}
        />
      }
    >
      {channels.length ? (
        channels.map((ch) => {
          const unread = isChatUnread(ch);
          const muted = isMuted(ch.mutedUntil);
          return (
            <ListItem
              key={ch.id}
              onPress={() => router.push(`/updates/channels/${ch.id}`)}
              leading={<ChatAvatar chat={ch} size="lg" />}
              title={chatTitle(ch)}
              subtitle={
                ch.lastMessage
                  ? messagePreviewText(ch.lastMessage, (id) => nameOf(id), { chatKind: 'channel' })
                  : (ch.description ?? 'No posts yet')
              }
              meta={formatChatListTime(ch.lastActivityAt)}
              highlight={unread && !muted}
              trailing={
                muted || unread ? (
                  <>
                    {muted ? <Icon icon={BellOff} size={16} color={c.subtle} /> : null}
                    {unread ? (
                      <Badge
                        count={ch.unreadCount || undefined}
                        dot={!ch.unreadCount}
                        tone={muted ? 'muted' : 'brand'}
                        size="sm"
                      />
                    ) : null}
                  </>
                ) : null
              }
            />
          );
        })
      ) : loaded ? (
        <T style={[tw`px-4 pt-1 pb-2 text-[14px] text-muted`, { lineHeight: 22.75 }]}>
          Stay updated on topics that matter to you. Find channels to follow below.
        </T>
      ) : null}
      {loaded && channels.length < SUGGEST_WHEN_FEWER_THAN ? <Suggestions /> : null}
      <View style={tw`flex-row gap-2 px-4 pt-2 pb-3`}>
        <Press
          onPress={() => router.push('/updates/channels/discover')}
          feedback={false}
          style={({ pressed }) => [
            tw`h-9 flex-row items-center gap-1.5 rounded-full bg-brand-soft px-4`,
            pressed ? { opacity: 0.9 } : null,
          ]}
        >
          <Icon icon={Compass} size={18} color={c['brand-ink']} />
          <T style={tw`text-[14px] font-semibold text-brand-ink`}>Explore channels</T>
        </Press>
      </View>
    </ListSection>
  );
}

function Suggestions() {
  const { tw, c } = useTheme();
  const router = useRouter();
  const [list, setList] = useState(null);
  const [busy, setBusy] = useState(null);
  const followed = useChats((s) => s.byId);

  useEffect(() => {
    const ctrl = new AbortController();
    discoverChannels('', { limit: 12, signal: ctrl.signal })
      .then(setList)
      .catch(() => setList([]));
    return () => ctrl.abort();
  }, []);

  const items = (list ?? []).filter((ch) => !ch.isFollowing && !followed[ch.id]).slice(0, 5);
  if (!items.length) return null;

  const follow = async (ch) => {
    setBusy(ch.id);
    try {
      await followChannel(ch.id);
      toast.success(`You're following ${ch.name}`);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={tw`pt-1`}>
      <View style={tw`flex-row items-center gap-1.5 px-4 pt-2 pb-1`}>
        <Icon icon={Megaphone} size={14} color={c.muted} />
        <T style={tw`text-[13px] font-medium text-muted`}>Find channels to follow</T>
      </View>
      {items.map((ch) => (
        <View key={ch.id} style={tw`flex-row items-center gap-3 pr-4`}>
          <Press
            onPress={() => router.push(`/updates/channels/${ch.id}`)}
            style={tw`min-w-0 flex-1 flex-row items-center gap-3 py-2.5 pl-3`}
          >
            <Avatar src={ch.avatarUrl} name={ch.name} colorSeed={ch.id} kind="channel" size="lg" />
            <View style={tw`min-w-0 flex-1`}>
              <T numberOfLines={1} style={tw`text-[16px] font-medium`}>
                {ch.name}
              </T>
              <T numberOfLines={1} style={tw`text-[14px] text-muted`}>
                {formatCount(ch.followerCount)} {ch.followerCount === 1 ? 'follower' : 'followers'}
              </T>
            </View>
          </Press>
          <Button
            size="sm"
            variant="soft"
            loading={busy === ch.id}
            onPress={() => void follow(ch)}
            accessibilityLabel={`Follow ${ch.name}`}
          >
            Follow
          </Button>
        </View>
      ))}
    </View>
  );
}
