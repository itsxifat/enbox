import { Suspense, memo, useId, useState, type ReactNode } from 'react';
import { NavLink, useNavigate, useParams } from 'react-router';
import { Virtuoso } from 'react-virtuoso';
import { Archive, MailQuestionMark, Plus, Sparkles, Star, Users, X } from 'lucide-react';
import { activePresenceNote, type ChatSummary } from '@enbox/shared';
import { ChatAvatar } from '@/components/common/ChatAvatar';
import { UserAvatar } from '@/components/common/UserAvatar';
import { Nameplate, StyledName } from '@/components/cosmetics';
import { ServerTagPill } from '@/components/cosmetics/TagPill/ServerTagPill';
import { CallsIcon, UpdatesIcon } from '@/components/icons';
import { UserPanel } from '@/components/layout/UserPanel';
import { useTabBadges } from '@/components/layout/useTabBadges';
import { Badge, IconButton, Menu, contextMenuAnchor, type IconType, type MenuAnchor } from '@/components/ui';
import { VirtualList, VirtualListItem } from '@/features/a11y/lists';
import { chatMenuItems, setArchived } from '@/features/chats/chatActions';
import { leaveGroupDm } from '@/features/groupDms/actions';
import { GroupDmAvatar } from '@/features/groupDms/GroupDmAvatar';
import { SelectFriendsPopover } from '@/features/groupDms/lazy';
import { groupDmRowMenu } from '@/features/groupDms/menu';
import type { SelectFriendsMode } from '@/features/groupDms/SelectFriendsPopover';
import { useChatTitle } from '@/features/groupDms/title';
import { cn } from '@/lib/cn';
import { isChatUnread, useArchivedCounts } from '@/stores/chats';
import { useIncomingFriendRequestCount } from '@/stores/friends';
import { useQuickSwitcher } from '@/stores/quickSwitcher';
import { usePendingRequestCount } from '@/stores/requests';
import { useUi } from '@/stores/ui';
import { useDmList } from './dmList';
import { DmRowMenu } from './dmMenu';

const CREATE_DM: SelectFriendsMode = { kind: 'create' };

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

export const DmRow = memo(function DmRow({ chat, active }: { chat: ChatSummary; active: boolean }) {
  const navigate = useNavigate();
  // Direct chats wear the peer's cosmetics: decoration, nameplate, name style.
  const peer = chat.type === 'direct' && chat.peer && !chat.peer.isDeleted ? chat.peer : null;
  // Group DMs: their icon or two members, their name or the members' names; X = Leave Group.
  const groupDm = chat.isGroupDm === true && chat.membership === 'active';
  const title = useChatTitle(chat);
  const devMode = useUi((s) => s.prefs.developerMode);
  const onLeft = () => {
    if (active) void navigate('/chats', { replace: true });
  };
  const leave = () =>
    void leaveGroupDm(chat, title).then((ok) => {
      if (ok) onLeft();
    });
  // Discord's "close DM": hides it from the list (archives it; a new message brings it back).
  const closeDm = () => {
    void setArchived(chat, true);
    onLeft();
  };
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
          'relative flex h-[42px] items-center gap-3 rounded-lg pr-8 pl-2',
          active ? 'bg-selected text-fg' : unread ? 'text-fg hover:bg-hover' : 'text-muted hover:bg-hover hover:text-fg',
        )}
        data-testid="dm-row"
        data-animate-avatars
        onContextMenu={(e) => {
          e.preventDefault();
          // Shift+F10 / the Menu key: under the row, not at the screen's corner.
          setMenu(contextMenuAnchor(e));
        }}
      >
        {/* Behind the row's content, which is positioned (relative) to paint over it. */}
        <Nameplate id={peer?.nameplate} />
        {peer ? (
          <UserAvatar user={peer} size={32} showPresence />
        ) : chat.isGroupDm ? (
          <GroupDmAvatar chat={chat} size={32} />
        ) : (
          <ChatAvatar chat={chat} size={32} showPresence />
        )}
        <span className="relative min-w-0 flex-1 leading-tight">
          <span className="flex min-w-0 items-center gap-1">
            <StyledName
              name={title}
              style={peer?.nameStyle}
              mode="full"
              className={cn('truncate text-[15px]', unread ? 'font-semibold' : 'font-medium')}
            />
            {peer ? <ServerTagPill userId={peer.id} tag={peer.spaceTag ?? null} /> : null}
          </span>
          {sub ? <span className="block truncate text-[12px] text-subtle">{sub}</span> : null}
        </span>
        {chat.unreadCount > 0 && !active ? (
          <span className="relative flex shrink-0">
            <Badge
              count={chat.unreadCount}
              size="sm"
              tone="danger"
              label={`${chat.unreadCount} unread message${chat.unreadCount === 1 ? '' : 's'}`}
            />
          </span>
        ) : null}
      </NavLink>
      <span className="absolute top-1/2 right-3 -translate-y-1/2 opacity-0 group-hover/dm:opacity-100 focus-within:opacity-100">
        {groupDm ? (
          <IconButton icon={X} label={`Leave ${title}`} size="xs" variant="ghost" onClick={leave} />
        ) : (
          <IconButton icon={X} label={`Close ${title}`} size="xs" variant="ghost" onClick={closeDm} />
        )}
      </span>
      {/* Right-click: Discord's DM row menu (the person's items, mute, ids); group DMs: their own. */}
      {menu && chat.type === 'direct' ? (
        <DmRowMenu chat={chat} anchor={menu} onClose={() => setMenu(null)} onCloseDm={closeDm} />
      ) : (
        <Menu
          open={!!menu}
          onClose={() => setMenu(null)}
          anchor={menu}
          aria-label={`${title} menu`}
          items={
            !menu
              ? []
              : groupDm
                ? groupDmRowMenu(chat, { title, devMode, onLeft })
                : chatMenuItems(chat, { onDeleted: () => void navigate('/chats', { replace: true }) })
          }
        />
      )}
    </div>
  );
});

interface HeaderContext {
  badges: ReturnType<typeof useTabBadges>;
  archivedUnread: number;
  /** "+": opens Select Friends under the button. */
  onCreate: (anchor: HTMLElement) => void;
  creating: boolean;
  /** The "Direct Messages" label, which names the list of chats. */
  listLabelId: string;
}

function HomeHeader({ context }: { context: HeaderContext }) {
  const { badges, archivedUnread, onCreate, creating, listLabelId } = context;
  const requests = useIncomingFriendRequestCount();
  const messageRequests = usePendingRequestCount();
  return (
    <div className="px-2 pt-2">
      <NavRow
        to="/chats"
        end
        icon={Users}
        label="Friends"
        badge={requests ? <Badge count={requests} size="sm" tone="danger" label={`${requests} pending friend request${requests === 1 ? '' : 's'}`} /> : null}
      />
      <NavRow
        to="/updates"
        icon={UpdatesIcon}
        label="Updates"
        badge={badges.updates ? <Badge dot tone="danger" label="New updates" /> : null}
      />
      <NavRow
        to="/calls"
        icon={CallsIcon}
        label="Calls"
        badge={
          badges.calls?.count ? (
            <Badge count={badges.calls.count} size="sm" tone="danger" label={`${badges.calls.count} missed call${badges.calls.count === 1 ? '' : 's'}`} />
          ) : null
        }
      />
      <NavRow to="/collectibles" icon={Sparkles} label="Collectibles" />
      <NavRow
        to="/message-requests"
        icon={MailQuestionMark}
        label="Message Requests"
        badge={
          messageRequests ? (
            <Badge count={messageRequests} size="sm" tone="danger" label={`${messageRequests} message request${messageRequests === 1 ? '' : 's'}`} />
          ) : null
        }
      />
      <NavRow to="/starred" icon={Star} label="Starred messages" />
      <NavRow
        to="/archived"
        icon={Archive}
        label="Archived"
        badge={archivedUnread ? <Badge count={archivedUnread} size="sm" tone="danger" label={`${archivedUnread} unread`} /> : null}
      />
      <div className="group/head mt-4 mb-1 flex items-center justify-between pr-1 pl-3">
        <span id={listLabelId} className="text-[12px] font-semibold tracking-wide text-muted uppercase group-hover/head:text-fg">Direct Messages</span>
        <IconButton icon={Plus} label="Create DM" size="xs" variant="ghost" active={creating} onClick={(e) => onCreate(e.currentTarget)} />
      </div>
    </div>
  );
}

const COMPONENTS = {
  Header: HomeHeader,
  Footer: () => <div className="h-2" />,
  List: VirtualList,
  Item: VirtualListItem,
};

/**
 * Home (Discord's DM sidebar, desktop): find-or-start, Friends / Updates / Calls / Message
 * Requests / Starred / Archived, then every direct and group chat by recent activity alone
 * (virtualised; no pinned DMs), and the user panel at the bottom. "+" opens Select Friends (a DM, or a group
 * DM with several). The links and the chats are a `nav`; the chats a list named by its label.
 */
export function HomeSidebar() {
  const { chatId } = useParams<{ chatId?: string }>();
  const chats = useDmList();
  const badges = useTabBadges();
  const archived = useArchivedCounts();
  const [createAt, setCreateAt] = useState<HTMLElement | null>(null);
  const toggleCreate = (el: HTMLElement) => setCreateAt((cur) => (cur ? null : el));
  const listLabelId = useId();

  return (
    <aside aria-label="Home" className="card-pane flex w-[264px] shrink-0 flex-col overflow-hidden" data-testid="home-sidebar">
      <div className="flex h-12 shrink-0 items-center px-2.5">
        <button
          type="button"
          onClick={() => useQuickSwitcher.getState().show()}
          aria-keyshortcuts="Control+K"
          className="flex h-8 w-full items-center rounded-lg bg-surface-2 px-2.5 text-left text-[14px] text-subtle hover:text-muted focus-visible:outline-2 focus-visible:outline-brand"
        >
          Find or start a conversation
        </button>
      </div>
      <nav aria-label="Direct messages" className="min-h-0 flex-1">
        <Virtuoso
          data={chats}
          computeItemKey={(_, c) => c.id}
          context={{ badges, archivedUnread: archived.unread, onCreate: toggleCreate, creating: !!createAt, listLabelId }}
          components={COMPONENTS}
          itemContent={(_, c) => <DmRow chat={c} active={c.id === chatId} />}
          className="scrollbar-thin"
        />
      </nav>
      <Suspense fallback={null}>
        {createAt ? <SelectFriendsPopover mode={CREATE_DM} anchor={createAt} onClose={() => setCreateAt(null)} /> : null}
      </Suspense>
      <UserPanel />
    </aside>
  );
}
