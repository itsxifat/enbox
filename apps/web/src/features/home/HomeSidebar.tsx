import { memo, useState, type ReactNode } from 'react';
import { NavLink, useNavigate, useParams } from 'react-router';
import { Virtuoso } from 'react-virtuoso';
import { Archive, Plus, Star, Users, X } from 'lucide-react';
import { activePresenceNote, chatTitle, type ChatSummary } from '@enbox/shared';
import { ChatAvatar } from '@/components/common/ChatAvatar';
import { CallsIcon, UpdatesIcon } from '@/components/icons';
import { UserPanel } from '@/components/layout/UserPanel';
import { useTabBadges } from '@/components/layout/useTabBadges';
import { Badge, IconButton, Menu, type IconType, type MenuAnchor } from '@/components/ui';
import { chatMenuItems, setArchived } from '@/features/chats/chatActions';
import { cn } from '@/lib/cn';
import { isChatUnread, useArchivedCounts, useSortedChats } from '@/stores/chats';

function NavRow({
  to,
  end,
  icon: Icon,
  label,
  badge,
}: {
  to: string;
  end?: boolean;
  icon: IconType;
  label: string;
  badge?: ReactNode;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          'flex h-[42px] items-center gap-3 rounded-lg px-3 text-[15px] font-medium',
          isActive ? 'bg-selected text-fg' : 'text-muted hover:bg-hover hover:text-fg',
        )
      }
    >
      <Icon size={22} aria-hidden />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge}
    </NavLink>
  );
}

const DmRow = memo(function DmRow({ chat, active }: { chat: ChatSummary; active: boolean }) {
  const navigate = useNavigate();
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  const unread = isChatUnread(chat);
  const note = chat.type === 'direct' ? activePresenceNote(chat.peer?.presenceNote ?? null, Date.now()) : null;
  const sub =
    chat.type === 'group'
      ? `${chat.memberCount} Member${chat.memberCount === 1 ? '' : 's'}`
      : note
        ? [note.emoji, note.text].filter(Boolean).join(' ')
        : null;
  return (
    <div className="group/dm relative px-2 py-px">
      <NavLink
        to={`/chats/${chat.id}`}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex h-[42px] items-center gap-3 rounded-lg pr-8 pl-2',
          active ? 'bg-selected text-fg' : unread ? 'text-fg hover:bg-hover' : 'text-muted hover:bg-hover hover:text-fg',
        )}
        data-testid="dm-row"
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        <ChatAvatar chat={chat} size={32} showPresence />
        <span className="min-w-0 flex-1 leading-tight">
          <span className={cn('block truncate text-[15px]', unread ? 'font-semibold' : 'font-medium')}>{chatTitle(chat)}</span>
          {sub ? <span className="block truncate text-[12px] text-subtle">{sub}</span> : null}
        </span>
        {chat.unreadCount > 0 && !active ? (
          <Badge
            count={chat.unreadCount}
            size="sm"
            tone="danger"
            label={`${chat.unreadCount} unread message${chat.unreadCount === 1 ? '' : 's'}`}
          />
        ) : null}
      </NavLink>
      {/* Discord's "close DM": hides it from the list (archives it; a new message brings it back). */}
      <span className="absolute top-1/2 right-3 -translate-y-1/2 opacity-0 group-hover/dm:opacity-100 focus-within:opacity-100">
        <IconButton icon={X} label={`Close ${chatTitle(chat)}`} size="xs" variant="ghost" onClick={() => void setArchived(chat, true)} />
      </span>
      {/* Right-click: Discord's DM menu (read state, mute, pin, close, delete). */}
      <Menu
        open={!!menu}
        onClose={() => setMenu(null)}
        anchor={menu}
        aria-label={`${chatTitle(chat)} menu`}
        items={menu ? chatMenuItems(chat, { onDeleted: () => void navigate('/chats', { replace: true }) }) : []}
      />
    </div>
  );
});

interface HeaderContext {
  badges: ReturnType<typeof useTabBadges>;
  archivedUnread: number;
  onCreate: () => void;
}

function HomeHeader({ context }: { context: HeaderContext }) {
  const { badges, archivedUnread, onCreate } = context;
  return (
    <div className="px-2 pt-2">
      <NavRow to="/chats" end icon={Users} label="Friends" />
      <NavRow
        to="/updates"
        icon={UpdatesIcon}
        label="Updates"
        badge={badges.updates ? <Badge dot tone="danger" /> : null}
      />
      <NavRow
        to="/calls"
        icon={CallsIcon}
        label="Calls"
        badge={badges.calls?.count ? <Badge count={badges.calls.count} size="sm" tone="danger" /> : null}
      />
      <NavRow to="/starred" icon={Star} label="Starred messages" />
      <NavRow
        to="/archived"
        icon={Archive}
        label="Archived"
        badge={archivedUnread ? <Badge count={archivedUnread} size="sm" tone="danger" /> : null}
      />
      <div className="group/head mt-4 mb-1 flex items-center justify-between pr-1 pl-3">
        <span className="text-[12px] font-semibold tracking-wide text-muted uppercase group-hover/head:text-fg">Direct Messages</span>
        <IconButton icon={Plus} label="Create DM" size="xs" variant="ghost" onClick={onCreate} />
      </div>
    </div>
  );
}

const COMPONENTS = { Header: HomeHeader, Footer: () => <div className="h-2" /> };

/**
 * Home (Discord's DM sidebar, desktop): find-or-start, Friends / Updates / Calls / Starred /
 * Archived, then every direct and group chat by recent activity (virtualised), and the user
 * panel at the bottom.
 */
export function HomeSidebar() {
  const navigate = useNavigate();
  const { chatId } = useParams<{ chatId?: string }>();
  const chats = useSortedChats();
  const badges = useTabBadges();
  const archived = useArchivedCounts();

  return (
    <aside aria-label="Direct messages" className="card-pane flex w-[264px] shrink-0 flex-col overflow-hidden" data-testid="home-sidebar">
      <div className="flex h-12 shrink-0 items-center px-2.5">
        <button
          type="button"
          onClick={() => void navigate('/new')}
          className="flex h-8 w-full items-center rounded-lg bg-surface-2 px-2.5 text-left text-[14px] text-subtle hover:text-muted focus-visible:outline-2 focus-visible:outline-brand"
        >
          Find or start a conversation
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <Virtuoso
          data={chats}
          computeItemKey={(_, c) => c.id}
          context={{ badges, archivedUnread: archived.unread, onCreate: () => void navigate('/new') }}
          components={COMPONENTS}
          itemContent={(_, c) => <DmRow chat={c} active={c.id === chatId} />}
          className="scrollbar-thin"
        />
      </div>
      <UserPanel />
    </aside>
  );
}
