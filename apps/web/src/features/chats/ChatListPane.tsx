/**
 * Chat list (/chats): header (new chat + menu), search over chat titles and message text,
 * filter chips (All / Unread / Favorites / Groups), the Archived entry and a virtualized
 * list of chat rows (fast with hundreds of chats). Channels live in the Updates tab.
 */
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Virtuoso } from 'react-virtuoso';
import {
  Archive,
  CheckCheck,
  EllipsisVertical,
  LogOut,
  MessageSquarePlus,
  Settings,
  SquarePen,
  Star,
  UsersRound,
} from 'lucide-react';
import type { ChatSummary } from '@enbox/shared';
import { PaneHeader } from '@/components/layout/PaneHeader';
import {
  Button,
  DropdownMenu,
  EmptyState,
  IconButton,
  ListItemSkeleton,
  ListSection,
  SearchInput,
  Tabs,
  confirm,
} from '@/components/ui';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { markChatRead } from '@/realtime/chats';
import { useAuth } from '@/stores/auth';
import { isChatUnread, useChats, useSortedChats, type ChatListFilter } from '@/stores/chats';
import { ChatRow } from './ChatRow';
import { MessageSearchResults } from './MessageSearchResults';
import { IN_APP_NAV } from '@/components/layout/navigation';

function ArchivedEntry({ count, unread }: { count: number; unread: number }) {
  return (
    <Link
      to="/archived"
      state={IN_APP_NAV}
      className="flex items-center gap-4 px-6 py-3 text-[15px] font-medium text-fg outline-none hover:bg-hover focus-visible:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
    >
      <Archive size={20} className="text-brand-ink" aria-hidden />
      <span className="flex-1">Archived</span>
      <span
        className="text-xs font-semibold text-brand-ink"
        aria-label={`${unread || count} ${unread ? 'unread' : 'chats'}`}
      >
        {unread || count}
      </span>
    </Link>
  );
}

function ListFooter() {
  return <div className="h-24 lg:h-2" aria-hidden />;
}

const FILTER_LABELS: Record<ChatListFilter, string> = {
  all: 'All',
  unread: 'Unread',
  favorites: 'Favorites',
  groups: 'Groups',
};

export function ChatListPane() {
  const desktop = useIsDesktop();
  const navigate = useNavigate();
  const { chatId } = useParams();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ChatListFilter>('all');
  const loaded = useChats((s) => s.loaded);
  const loadError = useChats((s) => s.error);
  const loading = useChats((s) => s.loading);
  const chats = useSortedChats({ filter: query ? 'all' : filter, query });
  const all = useSortedChats({});
  const archived = useSortedChats({ archived: true });
  const unreadCount = useMemo(() => all.filter(isChatUnread).length, [all]);
  const archivedUnread = useMemo(() => archived.filter(isChatUnread).length, [archived]);

  const logout = async () => {
    if (await confirm({ title: 'Log out of Enbox?', confirmLabel: 'Log out', danger: true })) {
      await useAuth.getState().logout();
    }
  };

  const markAllRead = () => {
    for (const c of all) if (isChatUnread(c)) markChatRead(c.id, { force: true });
  };

  const onDeleted = useCallback(
    (id: string) => {
      if (id === chatId) navigate('/chats', { replace: true });
    },
    [chatId, navigate],
  );

  const renderRow = useCallback(
    (_: number, c: ChatSummary) => (
      <ChatRow
        chat={c}
        to={`/chats/${c.id}`}
        active={c.id === chatId}
        onDeleted={() => onDeleted(c.id)}
      />
    ),
    [chatId, onDeleted],
  );

  const showArchived = archived.length > 0 && !query && filter === 'all';

  const components = useMemo(
    () => ({
      Header: showArchived
        ? () => <ArchivedEntry count={archived.length} unread={archivedUnread} />
        : undefined,
      Footer: ListFooter,
    }),
    [showArchived, archived.length, archivedUnread],
  );

  let body: ReactNode;
  if (!loaded && loadError && !loading) {
    body = (
      <EmptyState
        icon={MessageSquarePlus}
        title="Couldn't load your chats"
        description={loadError}
        action={
          <Button
            onClick={() =>
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
  } else if (query) {
    body = (
      <div className="h-full overflow-y-auto pb-24 scrollbar-thin lg:pb-2">
        <ListSection title={chats.length ? 'Chats' : undefined}>
          {chats.map((c) => (
            <ChatRow key={c.id} chat={c} to={`/chats/${c.id}`} active={c.id === chatId} />
          ))}
        </ListSection>
        <MessageSearchResults query={query} />
      </div>
    );
  } else if (!chats.length) {
    body = (
      <>
        {showArchived ? <ArchivedEntry count={archived.length} unread={archivedUnread} /> : null}
        <EmptyState
          icon={MessageSquarePlus}
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
              <Button onClick={() => navigate('/new')}>Start a chat</Button>
            ) : (
              <Button variant="soft" onClick={() => setFilter('all')}>
                View all chats
              </Button>
            )
          }
        />
      </>
    );
  } else {
    body = (
      <Virtuoso
        data={chats}
        computeItemKey={(_, c) => c.id}
        itemContent={renderRow}
        className="scrollbar-thin"
        style={{ height: '100%' }}
        increaseViewportBy={{ top: 200, bottom: 400 }}
        components={components}
      />
    );
  }

  return (
    <>
      <PaneHeader
        title={desktop ? 'Chats' : 'Enbox'}
        large
        brandTitle={!desktop}
        actions={
          <>
            <IconButton icon={SquarePen} label="New chat" onClick={() => navigate('/new')} />
            <DropdownMenu
              aria-label="Chat list menu"
              trigger={(p) => <IconButton {...p} icon={EllipsisVertical} label="Menu" />}
              items={[
                { label: 'New group', icon: UsersRound, onSelect: () => navigate('/new/group') },
                { label: 'Starred messages', icon: Star, onSelect: () => navigate('/starred') },
                { label: 'Archived', icon: Archive, onSelect: () => navigate('/archived') },
                unreadCount > 0 && {
                  label: 'Mark all as read',
                  icon: CheckCheck,
                  onSelect: markAllRead,
                },
                { label: 'Settings', icon: Settings, onSelect: () => navigate('/settings') },
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
          aria-label="Search chats and messages"
        />
        {!query ? (
          <Tabs
            variant="chips"
            aria-label="Filter chats"
            className="mt-2.5"
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

      <div className="relative min-h-0 flex-1" data-testid="chat-list">
        {body}
      </div>

      {!desktop ? (
        <div className="absolute right-4 bottom-4 z-10">
          <IconButton
            icon={MessageSquarePlus}
            label="New chat"
            variant="brand"
            size="xl"
            noTooltip
            shape="square"
            onClick={() => navigate('/new')}
            className="shadow-elevated"
          />
        </div>
      ) : null}
    </>
  );
}
