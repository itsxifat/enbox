/**
 * Chats tab (web features/chats/ChatListPane): header (brand title, new chat + menu), search
 * over chat titles and message text, filter chips (All / Unread / Favorites / Groups), the
 * Archived entry, the chat list and the floating new-chat button.
 */
import { useCallback, useMemo, useState } from 'react';
import { FlatList, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Archive,
  EllipsisVertical,
  LogOut,
  Settings,
  SquarePen,
  Star,
  UsersRound,
} from 'lucide-react-native';
import { DoubleTickIcon, Icon, NewChatIcon } from '@/components/icons';
import { PaneHeader } from '@/components/layout/PaneHeader';
import {
  Button,
  DropdownMenu,
  EmptyState,
  IconButton,
  ListItemSkeleton,
  Press,
  SearchInput,
  SectionLabel,
  T,
  Tabs,
  confirm,
} from '@/components/ui';
import { ChatRow } from '@/features/chats/ChatRow';
import { MessageSearchResults } from '@/features/chats/MessageSearchResults';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { markChatRead } from '@/realtime/chats';
import { useAuth } from '@/stores/auth';
import {
  filterChats,
  isChatUnread,
  useArchivedCounts,
  useChats,
  useSortedChats,
} from '@/stores/chats';
import { useTheme } from '@/theme';

const FILTER_LABELS = { all: 'All', unread: 'Unread', favorites: 'Favorites', groups: 'Groups' };

function ArchivedEntry({ count, unread }) {
  const { tw, c } = useTheme();
  const router = useRouter();
  return (
    <Press
      onPress={() => router.push('/archived')}
      style={tw`mx-2 my-px flex-row items-center gap-4 rounded-xl px-4 py-3`}
    >
      <Icon icon={Archive} size={20} color={c['brand-ink']} />
      <T style={tw`flex-1 text-[15px] font-medium`}>Archived</T>
      <T style={tw`text-xs font-semibold text-brand-ink`}>{unread || count}</T>
    </Press>
  );
}

export default function ChatsScreen() {
  const { tw, shadow } = useTheme();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, 150);
  const searching = !!query;
  const matchQuery = debouncedQuery || query;
  const [filter, setFilter] = useState('all');
  const loaded = useChats((s) => s.loaded);
  const loadError = useChats((s) => s.error);
  const loading = useChats((s) => s.loading);
  const all = useSortedChats({});
  const chats = useMemo(
    () => (searching ? filterChats(all, { query: matchQuery }) : filterChats(all, { filter })),
    [all, searching, matchQuery, filter],
  );
  const { count: archivedCount, unread: archivedUnread } = useArchivedCounts();
  const unreadCount = useMemo(() => {
    let n = 0;
    for (const c of all) if (isChatUnread(c)) n++;
    return n;
  }, [all]);

  const logout = async () => {
    if (await confirm({ title: 'Log out of Enbox?', confirmLabel: 'Log out', danger: true })) {
      await useAuth.getState().logout();
    }
  };
  const markAllRead = () => {
    for (const c of all) if (isChatUnread(c)) markChatRead(c.id, { force: true });
  };

  const renderRow = useCallback(({ item }) => <ChatRow chat={item} />, []);
  const showArchived = archivedCount > 0 && !query && filter === 'all';

  let body;
  if (!loaded && loadError && !loading) {
    body = (
      <EmptyState
        icon={NewChatIcon}
        title="Couldn't load your chats"
        description={loadError}
        action={
          <Button
            onPress={() =>
              void useChats
                .getState()
                .loadChats()
                .catch(() => undefined)
            }
          >
            Try again
          </Button>
        }
      />
    );
  } else if (!loaded) {
    body = <ListItemSkeleton count={8} />;
  } else if (searching) {
    body = (
      <FlatList
        data={chats}
        keyExtractor={(c) => c.id}
        renderItem={renderRow}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListHeaderComponent={
          chats.length ? (
            <View style={tw`px-4 pt-4 pb-1.5`}>
              <SectionLabel>Chats</SectionLabel>
            </View>
          ) : null
        }
        ListFooterComponent={
          <View style={tw`pb-24`}>
            <MessageSearchResults query={query} />
          </View>
        }
      />
    );
  } else if (!chats.length) {
    body = (
      <>
        {showArchived ? <ArchivedEntry count={archivedCount} unread={archivedUnread} /> : null}
        <EmptyState
          icon={NewChatIcon}
          title={
            filter !== 'all' ? `No ${FILTER_LABELS[filter].toLowerCase()} chats` : 'No chats yet'
          }
          description={
            filter === 'favorites'
              ? 'Pin chats to keep your favorites here.'
              : filter !== 'all'
                ? 'Chats matching this filter will show up here.'
                : 'Start a conversation with someone you know.'
          }
          action={
            filter === 'all' ? (
              <Button onPress={() => router.push('/new')}>Start a chat</Button>
            ) : (
              <Button variant="soft" onPress={() => setFilter('all')}>
                View all chats
              </Button>
            )
          }
        />
      </>
    );
  } else {
    body = (
      <FlatList
        data={chats}
        keyExtractor={(c) => c.id}
        renderItem={renderRow}
        initialNumToRender={14}
        windowSize={11}
        ListHeaderComponent={
          showArchived ? <ArchivedEntry count={archivedCount} unread={archivedUnread} /> : null
        }
        ListFooterComponent={<View style={tw`h-24`} />}
      />
    );
  }

  return (
    <View style={tw`flex-1 bg-surface`}>
      <PaneHeader
        title="Enbox"
        large
        brandTitle
        actions={
          <>
            <IconButton icon={SquarePen} label="New chat" onPress={() => router.push('/new')} />
            <DropdownMenu
              trigger={(p) => <IconButton {...p} icon={EllipsisVertical} label="Menu" />}
              items={[
                { label: 'New group', icon: UsersRound, onSelect: () => router.push('/new/group') },
                { label: 'Starred messages', icon: Star, onSelect: () => router.push('/starred') },
                { label: 'Archived', icon: Archive, onSelect: () => router.push('/archived') },
                unreadCount > 0 && {
                  label: 'Mark all as read',
                  icon: DoubleTickIcon,
                  onSelect: markAllRead,
                },
                { label: 'Settings', icon: Settings, onSelect: () => router.navigate('/settings') },
                'separator',
                { label: 'Log out', icon: LogOut, danger: true, onSelect: () => void logout() },
              ]}
            />
          </>
        }
      >
        <SearchInput
          value={query}
          onChange={setQuery}
          onBack={() => setQuery('')}
          placeholder="Search chats and messages"
        />
        {!query ? (
          <Tabs
            variant="chips"
            style={tw`mt-2.5`}
            value={filter}
            onChange={setFilter}
            items={[
              { value: 'all', label: 'All' },
              { value: 'unread', label: 'Unread', count: unreadCount || undefined },
              { value: 'favorites', label: 'Favorites' },
              { value: 'groups', label: 'Groups' },
            ]}
          />
        ) : null}
      </PaneHeader>
      <View style={tw`relative min-h-0 flex-1`}>{body}</View>
      <View style={tw`absolute right-4 bottom-4 z-10`}>
        <IconButton
          icon={NewChatIcon}
          label="New chat"
          variant="brand"
          size="xl"
          shape="square"
          onPress={() => router.push('/new')}
          style={shadow.elevated}
        />
      </View>
    </View>
  );
}
