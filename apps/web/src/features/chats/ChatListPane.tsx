/**
 * PLACEHOLDER (agent 2 owns this file): chat list pane for /chats.
 * Demonstrates the store contract (useSortedChats, filters, archive row). Agent 2 replaces
 * it with the virtualized list (react-virtuoso), context menus, multi-select, etc.
 */
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  Archive,
  EllipsisVertical,
  LogOut,
  MessageSquarePlus,
  Settings,
  SquarePen,
  Star,
  UsersRound,
} from 'lucide-react';
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
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { useAuth } from '@/stores/auth';
import { useChats, useSortedChats, type ChatListFilter } from '@/stores/chats';
import { ChatRow } from './ChatRow';

export function ChatListPane() {
  const desktop = useIsDesktop();
  const navigate = useNavigate();
  const { chatId } = useParams();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ChatListFilter>('all');
  const loaded = useChats((s) => s.loaded);
  const loadError = useChats((s) => s.error);
  const loading = useChats((s) => s.loading);
  const chats = useSortedChats({ filter, query });
  const archivedCount = useSortedChats({ archived: true }).length;

  const logout = async () => {
    if (await confirm({ title: 'Log out of Enbox?', confirmLabel: 'Log out', danger: true })) {
      await useAuth.getState().logout();
    }
  };

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
                { label: 'Settings', icon: Settings, onSelect: () => navigate('/settings') },
                'separator',
                { label: 'Log out', icon: LogOut, danger: true, onSelect: () => void logout() },
              ]}
            />
          </>
        }
      >
        <SearchInput value={query} onChange={setQuery} placeholder="Search chats" />
        <Tabs
          variant="chips"
          aria-label="Filter chats"
          className="mt-2.5"
          value={filter}
          onChange={setFilter}
          items={[
            { value: 'all', label: 'All' },
            { value: 'unread', label: 'Unread' },
            { value: 'groups', label: 'Groups' },
          ]}
        />
      </PaneHeader>

      <div className="relative min-h-0 flex-1 overflow-y-auto pb-24 scrollbar-thin lg:pb-2">
        {archivedCount > 0 && !query ? (
          <Link
            to="/archived"
            className="flex items-center gap-4 px-6 py-3 text-[15px] font-medium text-fg hover:bg-hover"
          >
            <Archive size={20} className="text-brand-ink" aria-hidden />
            <span className="flex-1">Archived</span>
            <span className="text-xs text-brand-ink">{archivedCount}</span>
          </Link>
        ) : null}
        {!loaded && loadError && !loading ? (
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
        ) : !loaded ? (
          <ListItemSkeleton count={8} />
        ) : chats.length ? (
          chats.map((c) => (
            <ChatRow key={c.id} chat={c} to={`/chats/${c.id}`} active={c.id === chatId} />
          ))
        ) : (
          <EmptyState
            icon={MessageSquarePlus}
            title={query || filter !== 'all' ? 'No chats found' : 'No chats yet'}
            description={
              query || filter !== 'all'
                ? 'Try a different search or filter.'
                : 'Start a conversation with someone you know.'
            }
            action={
              !query && filter === 'all' ? (
                <Button onClick={() => navigate('/new')}>Start a chat</Button>
              ) : null
            }
          />
        )}
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
