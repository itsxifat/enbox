import { useMemo, useState } from 'react';
import { NavLink, useLocation, useParams, useSearchParams } from 'react-router';
import { Compass, Plus } from 'lucide-react';
import { chatTitle, isMuted, type ChatSummary, type Space } from '@enbox/shared';
import { ChatAvatar } from '@/components/common/ChatAvatar';
import { LogoMark } from '@/components/common/Logo';
import { Avatar, Badge, Menu, contextMenuAnchor, type MenuAnchor } from '@/components/ui';
import { cn } from '@/lib/cn';
import { isChatUnread, useSortedChats, useUnreadChatsCount } from '@/stores/chats';
import { useSpaceBadge, useSpaceList } from '@/stores/spaces';
import { spaceMemory } from './actions';
import { useSpaceMenu } from './menus';
import { CreateSpaceDialog } from './dialogs/CreateSpaceDialog';
import { JoinSpaceDialog } from './dialogs/JoinSpaceDialog';

/** Discord's server acronym: first letters of the words (max 5), e.g. "Gaming Lounge" → "GL". */
export function spaceAcronym(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.map((w) => Array.from(w)[0] ?? '').join('');
  return (letters || '?').slice(0, 5);
}

/** Hover tooltip to the right of a rail tile (the rail is a card, so it can't clip). */
const TIP =
  'pointer-events-none absolute top-1/2 left-full z-50 ml-3 -translate-y-1/2 rounded-lg bg-fg px-2.5 py-1.5 text-[13px] font-semibold whitespace-nowrap text-surface opacity-0 shadow-elevated transition-opacity duration-100 group-hover/tile:opacity-100 group-focus-visible/tile:opacity-100';

/**
 * A Space in the rail. Right-click (or Shift+F10 / the Menu key) opens Discord's server
 * menu; a muted Space is dimmed and shows no unread pill (mentions of me still count).
 */
function SpaceTile({ space, active }: { space: Space; active: boolean }) {
  const badge = useSpaceBadge(space);
  const last = spaceMemory.lastChannel(space.id);
  const menu = useSpaceMenu(space);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const label = [
    space.name,
    badge.mentions ? `${badge.mentions} mention${badge.mentions === 1 ? '' : 's'}` : badge.unread ? 'unread messages' : null,
    badge.muted ? 'muted' : null,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <>
      <NavLink
        to={last ? `/spaces/${space.id}/${last}` : `/spaces/${space.id}`}
        aria-label={label}
        aria-current={active ? 'page' : undefined}
        onContextMenu={(e) => {
          e.preventDefault();
          setAnchor(contextMenuAnchor(e));
        }}
        className="group/tile relative flex size-12 shrink-0 items-center justify-center outline-none"
        data-testid="space-tile"
        data-muted={badge.muted || undefined}
      >
        {/* Discord pill: tall when current, medium when unread, a nub on hover. */}
        <span
          aria-hidden
          className={cn(
            'absolute top-1/2 -left-3 w-1 -translate-y-1/2 rounded-r-full bg-fg transition-[height,opacity] duration-200',
            active ? 'h-9 opacity-100' : badge.unread ? 'h-2 opacity-100 group-hover/tile:h-5' : 'h-2 opacity-0 group-hover/tile:h-5 group-hover/tile:opacity-100',
          )}
        />
        <span
          className={cn(
            'overflow-hidden transition-[border-radius,opacity] duration-200 group-focus-visible/tile:outline-2 group-focus-visible/tile:outline-offset-2 group-focus-visible/tile:outline-brand',
            active ? 'rounded-2xl' : 'rounded-[24px] group-hover/tile:rounded-2xl',
            // Discord greys out muted servers until hovered or open.
            badge.muted && !active && 'opacity-40 group-hover/tile:opacity-100 group-focus-visible/tile:opacity-100',
          )}
        >
          {space.iconUrl ? (
            <Avatar
              src={space.iconUrl}
              animatedSrc={space.iconAnimatedUrl}
              name={space.name}
              colorSeed={space.id}
              size={48}
              kind="community"
              decorative
              className="rounded-none!"
            />
          ) : (
            // Discord: the name's initials on a plain tile that turns brand-coloured on hover.
            <span
              className={cn(
                'flex size-12 items-center justify-center text-[15px] font-semibold transition-colors duration-200',
                active ? 'bg-brand text-on-brand' : 'bg-surface-2 text-fg group-hover/tile:bg-brand group-hover/tile:text-on-brand',
              )}
              aria-hidden
            >
              {spaceAcronym(space.name)}
            </span>
          )}
        </span>
        {badge.mentions ? (
          <Badge
            count={badge.mentions}
            size="sm"
            tone="danger"
            className="absolute -right-1 -bottom-1 ring-[3px] ring-surface"
          />
        ) : null}
        <span role="tooltip" className={TIP}>
          {space.name}
        </span>
      </NavLink>
      <Menu
        open={!!anchor}
        onClose={() => setAnchor(null)}
        anchor={anchor}
        items={anchor ? menu.railItems() : []}
        aria-label={`${space.name} menu`}
      />
      {menu.dialogs}
    </>
  );
}

/** Discord's pill on the rail edge: tall when current, medium when unread, a nub on hover. */
function Pill({ active, unread }: { active: boolean; unread?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'absolute top-1/2 -left-3 w-1 -translate-y-1/2 rounded-r-full bg-fg transition-[height,opacity] duration-200',
        active ? 'h-9 opacity-100' : unread ? 'h-2 opacity-100 group-hover/tile:h-5' : 'h-2 opacity-0 group-hover/tile:h-5 group-hover/tile:opacity-100',
      )}
    />
  );
}

/** Home (DMs and Friends): the app mark; a red count of unread DMs. */
function HomeTile({ active }: { active: boolean }) {
  const unread = useUnreadChatsCount();
  return (
    <NavLink
      to="/chats"
      aria-label={unread ? `Direct Messages, ${unread} unread` : 'Direct Messages'}
      aria-current={active ? 'page' : undefined}
      className="group/tile relative flex size-12 shrink-0 items-center justify-center outline-none"
      data-testid="rail-home"
    >
      <Pill active={active} />
      <span
        className={cn(
          'flex size-12 items-center justify-center transition-[border-radius,background-color] duration-200 group-focus-visible/tile:outline-2 group-focus-visible/tile:outline-offset-2 group-focus-visible/tile:outline-brand',
          active ? 'rounded-2xl bg-brand' : 'rounded-[24px] bg-surface-2 group-hover/tile:rounded-2xl group-hover/tile:bg-brand',
        )}
      >
        <LogoMark size={30} />
      </span>
      {unread ? <Badge count={unread} size="sm" tone="danger" className="absolute -right-1 -bottom-1 ring-[3px] ring-surface" /> : null}
      <span role="tooltip" className={TIP}>
        Direct Messages
      </span>
    </NavLink>
  );
}

/** A DM with unread messages, shown under Home (Discord). */
function UnreadDmTile({ chat }: { chat: ChatSummary }) {
  return (
    <NavLink
      to={`/chats/${chat.id}`}
      aria-label={`${chatTitle(chat)}, ${chat.unreadCount || 'new'} unread`}
      className="group/tile relative flex size-12 shrink-0 items-center justify-center outline-none"
    >
      <Pill active={false} unread />
      <ChatAvatar chat={chat} size={48} />
      {chat.unreadCount ? <Badge count={chat.unreadCount} size="sm" tone="danger" className="absolute -right-1 -bottom-1 ring-[3px] ring-surface" /> : null}
      <span role="tooltip" className={TIP}>
        {chatTitle(chat)}
      </span>
    </NavLink>
  );
}

/**
 * The app-wide rail (Discord's server list): Home with unread DMs under it, the Space
 * icons, then create / join.
 */
export function SpaceRail() {
  const spaces = useSpaceList();
  const { spaceId } = useParams<{ spaceId?: string }>();
  const { pathname } = useLocation();
  const inSpaces = pathname === '/spaces' || pathname.startsWith('/spaces/');
  const chats = useSortedChats();
  const unreadDms = useMemo(
    () => chats.filter((c) => isChatUnread(c) && !isMuted(c.mutedUntil)).slice(0, 5),
    [chats],
  );
  const activeSpaceId = spaceId ?? (inSpaces ? pathname.split('/')[2] : undefined);
  // `/spaces?create=1` (New chat → New Space) opens the create dialog.
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(() => params.get('create') === '1');
  const [joining, setJoining] = useState(false);
  const closeCreate = () => {
    setCreating(false);
    if (params.has('create')) setParams({}, { replace: true });
  };
  const action =
    'group/tile relative flex size-12 shrink-0 items-center justify-center rounded-[24px] bg-surface-2 text-success transition-[border-radius,background-color,color] duration-200 hover:rounded-2xl hover:bg-success hover:text-on-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';
  return (
    <nav
      aria-label="Spaces"
      className="lg:card-pane flex w-[72px] shrink-0 flex-col items-center gap-2 overflow-y-auto overflow-x-visible bg-surface-2 py-3 lg:overflow-visible lg:bg-surface"
    >
      <HomeTile active={!inSpaces} />
      {unreadDms.map((c) => (
        <UnreadDmTile key={c.id} chat={c} />
      ))}
      <div className="mx-auto h-0.5 w-8 shrink-0 rounded-full bg-line-strong" aria-hidden />
      {spaces.map((s) => (
        <SpaceTile key={s.id} space={s} active={s.id === activeSpaceId} />
      ))}
      <button type="button" className={action} aria-label="Create a Space" onClick={() => setCreating(true)} data-testid="create-space">
        <Plus size={24} aria-hidden />
        <span role="tooltip" className={TIP}>
          Create a Space
        </span>
      </button>
      <button type="button" className={action} aria-label="Join a Space" onClick={() => setJoining(true)}>
        <Compass size={24} aria-hidden />
        <span role="tooltip" className={TIP}>
          Join a Space
        </span>
      </button>
      <CreateSpaceDialog open={creating} onClose={closeCreate} />
      <JoinSpaceDialog open={joining} onClose={() => setJoining(false)} />
    </nav>
  );
}
