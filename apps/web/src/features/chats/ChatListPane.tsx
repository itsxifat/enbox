/**
 * Chat list (/chats): header (new chat + menu), search over chat titles and message text,
 * filter chips (All / Unread / Favorites / Groups), the Archived entry and a virtualized
 * list of chat rows (fast with hundreds of chats). Channels live in the Updates tab.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
  SearchInput,
  Tabs,
  confirm,
} from '@/components/ui';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { markChatRead } from '@/realtime/chats';
import { useAuth } from '@/stores/auth';
import {
  filterChats,
  isChatUnread,
  useArchivedCounts,
  useChats,
  useSortedChats,
  type ChatListFilter,
} from '@/stores/chats';
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

interface SearchContext {
  count: number;
  query: string;
}

function SearchHeader({ context }: { context?: SearchContext }) {
  if (!context?.count) return null;
  return (
    <div className="px-4 pt-4 pb-1.5">
      <h3 className="text-[13px] font-semibold tracking-wide text-brand-ink">Chats</h3>
    </div>
  );
}

function SearchFooter({ context }: { context?: SearchContext }) {
  return (
    <div className="pb-24 lg:pb-2">
      <MessageSearchResults query={context?.query ?? ''} />
    </div>
  );
}

const SEARCH_COMPONENTS = { Header: SearchHeader, Footer: SearchFooter };

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
  // The input stays bound to `query`; matching runs on the settled value.
  const debouncedQuery = useDebouncedValue(query, 150);
  const searching = !!query;
  const [filter, setFilter] = useState<ChatListFilter>('all');
  const loaded = useChats((s) => s.loaded);
  const loadError = useChats((s) => s.error);
  const loading = useChats((s) => s.loading);
  // Sort the main list once per chat-store change; filters and search only filter it.
  const all = useSortedChats({});
  const chats = useMemo(
    () =>
      searching
        ? filterChats(all, { query: debouncedQuery })
        : filterChats(all, { filter }),
    [all, searching, debouncedQuery, filter],
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

  // Stable across renders (memoized rows skip re-rendering when their chat is unchanged).
  const openId = useRef(chatId);
  useEffect(() => {
    openId.current = chatId;
  }, [chatId]);
  const onDeleted = useCallback(
    (id: string) => {
      if (id === openId.current) navigate('/chats', { replace: true });
    },
    [navigate],
  );

  const renderRow = useCallback(
    (_: number, c: ChatSummary) => (
      <ChatRow chat={c} to={`/chats/${c.id}`} active={c.id === chatId} onDeleted={onDeleted} />
    ),
    [chatId, onDeleted],
  );

  const showArchived = archivedCount > 0 && !query && filter === 'all';

  const components = useMemo(
    () => ({
      Header: showArchived
        ? () => <ArchivedEntry count={archivedCount} unread={archivedUnread} />
        : undefined,
      Footer: ListFooter,
    }),
    [showArchived, archivedCount, archivedUnread],
  );
  const searchContext = useMemo<SearchContext>(
    () => ({ count: chats.length, query }),
    [chats.length, query],
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
  } else if (searching) {
    // Virtualized too: one letter can match most of a long chat list.
    body = (
      <Virtuoso<ChatSummary, SearchContext>
        data={chats}
        context={searchContext}
        computeItemKey={(_, c) => c.id}
        itemContent={renderRow}
        className="scrollbar-thin"
        style={{ height: '100%' }}
        increaseViewportBy={{ top: 200, bottom: 400 }}
        components={SEARCH_COMPONENTS}
      />
    );
  } else if (!chats.length) {
    body = (
      <>
        {showArchived ? <ArchivedEntry count={archivedCount} unread={archivedUnread} /> : null}
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
