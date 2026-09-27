/** Find channels (web features/channels/ChannelDiscoverPane.tsx): search the public directory. */
import { useEffect, useState } from 'react';
import { FlatList, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Check, Megaphone, Plus, SearchX } from 'lucide-react-native';
import { Icon } from '@/components/icons';
import { PaneHeader } from '@/components/layout/PaneHeader';
import {
  Avatar,
  Button,
  EmptyState,
  IconButton,
  ListItemSkeleton,
  Press,
  SearchInput,
  T,
  toast,
} from '@/components/ui';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { errorMessage } from '@/lib/api';
import { formatCount } from '@/lib/format';
import { useChats } from '@/stores/chats';
import { useTheme } from '@/theme';
import { discoverChannels, followChannel } from './channelApi';

export function ChannelDiscover() {
  const { tw, c } = useTheme();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const q = useDebouncedValue(query, 250);
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const followed = useChats((s) => s.byId);

  useEffect(() => {
    const ctrl = new AbortController();
    setError(null);
    discoverChannels(q, { limit: 50, signal: ctrl.signal })
      .then((r) => setList(r))
      .catch((e) => {
        if (!ctrl.signal.aborted) setError(errorMessage(e));
      });
    return () => ctrl.abort();
  }, [q]);

  const follow = async (ch) => {
    setBusy(ch.id);
    try {
      await followChannel(ch.id);
      setList(
        (l) =>
          l?.map((x) =>
            x.id === ch.id ? { ...x, isFollowing: true, followerCount: x.followerCount + 1 } : x,
          ) ?? l,
      );
      toast.success(`You're following ${ch.name}`, {
        action: { label: 'Open', onClick: () => router.push(`/updates/channels/${ch.id}`) },
      });
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={tw`flex-1 bg-surface`}>
      <PaneHeader
        title="Find channels"
        subtitle="Public channels on Enbox"
        back="/updates"
        actions={
          <IconButton
            icon={Plus}
            label="Create channel"
            onPress={() => router.push('/updates/channels/new')}
          />
        }
      >
        <SearchInput value={query} onChange={setQuery} placeholder="Search channels" />
      </PaneHeader>
      {list === null && !error ? (
        <ListItemSkeleton count={7} />
      ) : error ? (
        <EmptyState compact icon={Megaphone} title="Couldn't load channels" description={error} />
      ) : list && list.length ? (
        <FlatList
          data={list}
          keyExtractor={(ch) => ch.id}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          renderItem={({ item: ch }) => {
            const following = ch.isFollowing || !!followed[ch.id];
            return (
              <View style={tw`mx-2 my-0.5 flex-row items-center gap-3 rounded-xl pr-4`}>
                <Press
                  onPress={() => router.push(`/updates/channels/${ch.id}`)}
                  style={tw`min-w-0 flex-1 flex-row items-center gap-3 rounded-xl py-3 pl-4`}
                >
                  <Avatar
                    src={ch.avatarUrl}
                    name={ch.name}
                    colorSeed={ch.id}
                    kind="channel"
                    size="lg"
                  />
                  <View style={tw`min-w-0 flex-1`}>
                    <T numberOfLines={1} style={tw`text-[16px] font-medium`}>
                      {ch.name}
                    </T>
                    <T numberOfLines={1} style={tw`text-[13.5px] text-muted`}>
                      {formatCount(ch.followerCount)}{' '}
                      {ch.followerCount === 1 ? 'follower' : 'followers'}
                      {ch.description ? ` · ${ch.description}` : ''}
                    </T>
                  </View>
                </Press>
                {following ? (
                  <View style={tw`h-8 flex-row items-center gap-1 px-3`}>
                    <Icon icon={Check} size={16} color={c.muted} />
                    <T style={tw`text-[13px] font-medium text-muted`}>Following</T>
                  </View>
                ) : (
                  <Button
                    size="sm"
                    variant="soft"
                    loading={busy === ch.id}
                    onPress={() => void follow(ch)}
                    accessibilityLabel={`Follow ${ch.name}`}
                  >
                    Follow
                  </Button>
                )}
              </View>
            );
          }}
        />
      ) : (
        <EmptyState
          icon={q ? SearchX : Megaphone}
          title={q ? 'No channels found' : 'No channels yet'}
          description={
            q
              ? `No public channel matches “${q}”.`
              : 'Be the first: create a channel and share updates with your followers.'
          }
          action={
            <Button leftIcon={Plus} onPress={() => router.push('/updates/channels/new')}>
              Create channel
            </Button>
          }
        />
      )}
    </View>
  );
}
