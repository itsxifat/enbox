import { useCallback, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  DndContext,
  DragOverlay,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  ArrowDown,
  ArrowUp,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  CopyPlus,
  Hash,
  Images,
  Link2,
  Megaphone,
  MessagesSquare,
  Pencil,
  PlusCircle,
  Podcast,
  Settings,
  Trash2,
  UserPlus,
  Volume2,
} from 'lucide-react';
import {
  isVoiceChannelType,
  PERM,
  hasPerm,
  type ChatSummary,
  type ID,
  type SpaceCategory,
} from '@enbox/shared';
import {
  Badge,
  DropdownMenu,
  Menu,
  confirm,
  contextMenuAnchor,
  toast,
  type MenuAnchor,
  type MenuEntry,
} from '@/components/ui';
import { UserPanel } from '@/components/layout/UserPanel';
import { JumpPill, useJumpPills } from '@/features/frame/JumpPills';
import { SidebarFrame } from '@/features/frame/SidebarFrame';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import {
  collisionTarget,
  dndAccessibility,
  dropZone,
  inActiveDrag,
  pointCollision,
  pointerListeners,
  suppressClickAfterDrag,
  useDragSensors,
} from '@/lib/dnd';
import { copyText } from '@/features/groups/shared/share';
import { patchPrefs } from '@/features/chats/chatActions';
import { joinVoiceChannel, moveVoiceMember } from '@/features/voice/actions';
import { OpenVoiceChatButton } from '@/features/voice/chat/OpenVoiceChatButton';
import {
  OccupantDragPreview,
  VoiceChannelOccupants,
  type VoiceDragData,
} from '@/features/voice/VoiceChannelOccupants';
import { SidebarThreads } from '@/features/threads/SidebarThreads';
import { SidebarEvents } from '@/features/events/SidebarEvents';
import { SidebarGuideLinks } from '@/features/guide/SidebarGuideLinks';
import { useShowAllChannels } from '@/features/guide/showAll';
import { markChatRead } from '@/realtime';
import { useChats } from '@/stores/chats';
import { useSpace, useSpaceChannels, useSpaces } from '@/stores/spaces';
import { deleteCategory, deleteChannel, moveChannels, setChannelsMuted, spaceMemory } from './actions';
import { CategoryDialog } from './dialogs/CategoryDialog';
import { ChannelDialog } from './dialogs/ChannelDialog';
import { CloneChannelDialog } from './dialogs/CloneChannelDialog';
import { InviteDialog } from './dialogs/InviteDialog';
import { copyIdItem, muteEntry, notifyLevelEntries, spaceNotifyLevel, tidy, useSpaceMenu } from './menus';
import {
  categoryMoveItems,
  channelMoveItems,
  groupsOf,
  isCategoryMuted,
  isChannelMuted,
  isChannelUnread,
  visibleGroups,
  type CategoryDrop,
  type ChannelDrop,
  type ChannelGroup,
  type ChannelPositionItem,
} from './sidebar';

export { isChannelUnread };

// ---------------------------------------------------------------------------
// Drag and drop (MANAGE_CHANNELS: channels and categories; MOVE_MEMBERS: voice occupants)
// ---------------------------------------------------------------------------

type DragData =
  | { kind: 'channel'; chat: ChatSummary; label: string }
  | { kind: 'category'; category: SpaceCategory; label: string }
  | VoiceDragData;

type DropData = { kind: 'channel'; chat: ChatSummary; label: string } | { kind: 'category'; categoryId: ID; label: string };

/** Where the indicator line shows: above or below a channel row (`ch:`) or a category header (`cat:`). */
interface DropLine {
  id: string;
  side: 'before' | 'after';
}

type SidebarDrop =
  | { kind: 'channel'; drop: ChannelDrop; line: DropLine }
  | { kind: 'category'; drop: CategoryDrop }
  | { kind: 'voice'; channelId: ID };

const sameDrop = (a: SidebarDrop | null, b: SidebarDrop | null) => JSON.stringify(a) === JSON.stringify(b);
const collision = pointCollision();

/** The drop indicator line (brand colour) at the top or bottom edge of a `relative` box. */
function DropIndicator({ side, className }: { side: 'before' | 'after'; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-x-2 z-10 h-0.5 rounded-full bg-brand',
        className ?? (side === 'before' ? '-top-px' : '-bottom-px'),
      )}
      data-testid="drop-indicator"
    />
  );
}

function ChannelRow({
  chat,
  active,
  draggable,
  line,
  voiceTarget,
  channels,
  onMenu,
  onInvite,
  onEdit,
}: {
  chat: ChatSummary;
  active: boolean;
  /** I may drag it (MANAGE_CHANNELS). */
  draggable: boolean;
  /** The drop indicator on this row. */
  line?: 'before' | 'after';
  /** A voice occupant is dragged over this voice channel. */
  voiceTarget: boolean;
  /** The Space's channels in sidebar order (the occupants' "Move To"). */
  channels: readonly ChatSummary[];
  onMenu: (chat: ChatSummary, anchor: MenuAnchor) => void;
  onInvite: (chat: ChatSummary) => void;
  onEdit: (chat: ChatSummary) => void;
}) {
  const unread = isChannelUnread(chat);
  const muted = isChannelMuted(chat);
  // Stages connect like voice channels (as a listener) and list their people the same way.
  const voice = chat.type === 'space_voice' || chat.type === 'space_stage';
  const forumIcon = chat.space?.forum?.settings.media ? Images : MessagesSquare;
  const Icon = chat.type === 'space_stage' ? Podcast : voice ? Volume2 : chat.type === 'space_forum' ? forumIcon : chat.space?.isNews ? Megaphone : Hash;
  const canManage = hasPerm(chat.spacePermissions, PERM.MANAGE_CHANNELS);
  const canInvite = hasPerm(chat.spacePermissions, PERM.CREATE_INVITE);
  const label = chat.name ?? 'channel';
  const drag = useDraggable({
    id: `ch:${chat.id}`,
    data: { kind: 'channel', chat, label } satisfies DragData,
    disabled: !draggable,
  });
  // The row and its voice occupants are one drop target.
  const drop = useDroppable({ id: `ch:${chat.id}`, data: { kind: 'channel', chat, label } satisfies DropData });
  // The link is the handle: Space on its invite / edit buttons still presses them.
  const { setNodeRef: setDragNode, setActivatorNodeRef: setDragHandle } = drag;
  const linkRef = useCallback(
    (el: HTMLAnchorElement | null) => {
      setDragNode(el);
      setDragHandle(el);
    },
    [setDragNode, setDragHandle],
  );
  return (
    <div
      ref={drop.setNodeRef}
      className={cn('group/ch relative px-2', drag.isDragging && 'opacity-40')}
      // The jump pills' targets (the open channel is being read).
      data-jump={active ? undefined : chat.unreadMentionCount > 0 ? 'mention' : unread ? 'unread' : undefined}
    >
      {/* Unread pill on the sidebar edge (Discord). */}
      {unread && !active ? (
        <span aria-hidden className="absolute top-1/2 left-0 h-2 w-1 -translate-y-1/2 rounded-r-full bg-fg" />
      ) : null}
      {line ? <DropIndicator side={line} /> : null}
      <Link
        ref={linkRef}
        to={`/spaces/${chat.space!.spaceId}/${chat.id}`}
        aria-current={active ? 'page' : undefined}
        draggable={false}
        {...(draggable ? { ...drag.listeners, 'aria-describedby': drag.attributes['aria-describedby'] } : null)}
        // Discord: clicking a voice channel connects at once (and shows it).
        onClick={voice ? () => joinVoiceChannel(chat) : undefined}
        onContextMenu={(e: MouseEvent<HTMLAnchorElement>) => {
          e.preventDefault();
          if (!inActiveDrag(e.currentTarget)) onMenu(chat, contextMenuAnchor(e));
        }}
        className={cn(
          'flex h-9 items-center gap-1.5 rounded-lg px-2 text-[15px] transition-colors outline-none [-webkit-touch-callout:none] focus-visible:outline-2 focus-visible:outline-brand',
          voiceTarget
            ? 'bg-brand-soft font-semibold text-fg ring-2 ring-brand'
            : active
              ? 'bg-selected font-semibold text-fg'
              : unread
                ? 'font-semibold text-fg hover:bg-hover'
                : muted
                  ? 'text-subtle hover:bg-hover hover:text-muted'
                  : 'text-muted hover:bg-hover hover:text-fg',
        )}
        data-testid="space-channel-row"
        data-channel-name={chat.name}
      >
        <Icon size={18} className="shrink-0 opacity-70" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{chat.name}</span>
        {chat.unreadMentionCount > 0 ? (
          <Badge count={chat.unreadMentionCount} size="sm" tone="danger" />
        ) : null}
        {voice ? <OpenVoiceChatButton chat={chat} active={active} /> : null}
        {canInvite ? (
          <button
            type="button"
            aria-label={`Create invite to ${chat.name}`}
            title="Create Invite"
            className={cn('rounded p-0.5 text-muted hover:text-fg', active ? 'block' : 'hidden group-focus-within/ch:block group-hover/ch:block')}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onInvite(chat);
            }}
          >
            <UserPlus size={15} aria-hidden />
          </button>
        ) : null}
        {canManage ? (
          <button
            type="button"
            aria-label={`Edit channel ${chat.name}`}
            title="Edit Channel"
            className={cn('rounded p-0.5 text-muted hover:text-fg', active ? 'block' : 'hidden group-focus-within/ch:block group-hover/ch:block')}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onEdit(chat);
            }}
          >
            <Settings size={15} aria-hidden />
          </button>
        ) : null}
      </Link>
      {voice ? <VoiceChannelOccupants chat={chat} channels={channels} /> : <SidebarThreads channel={chat} />}
    </div>
  );
}

/** A category's header: collapse toggle, create button; drags (MANAGE_CHANNELS) and takes drops. */
function CategoryHeader({
  category,
  collapsed,
  draggable,
  line,
  onToggle,
  onCreate,
  onMenu,
}: {
  category: SpaceCategory;
  collapsed: boolean;
  draggable: boolean;
  line?: 'before' | 'after';
  onToggle: () => void;
  onCreate?: () => void;
  onMenu: (anchor: MenuAnchor) => void;
}) {
  const label = category.name;
  const drag = useDraggable({ id: `cat:${category.id}`, data: { kind: 'category', category, label } satisfies DragData, disabled: !draggable });
  const drop = useDroppable({ id: `cat:${category.id}`, data: { kind: 'category', categoryId: category.id, label } satisfies DropData });
  const { setNodeRef: setDragNode } = drag;
  const { setNodeRef: setDropNode } = drop;
  const ref = useCallback(
    (el: HTMLDivElement | null) => {
      setDragNode(el);
      setDropNode(el);
    },
    [setDragNode, setDropNode],
  );
  return (
    <div
      ref={ref}
      {...(draggable ? pointerListeners(drag.listeners) : null)}
      className={cn('group/cat relative flex items-center pr-3 pl-2', drag.isDragging && 'opacity-40')}
      onContextMenu={(e) => {
        e.preventDefault();
        if (!inActiveDrag(e.currentTarget)) onMenu(contextMenuAnchor(e));
      }}
    >
      {line ? <DropIndicator side={line} /> : null}
      <button
        type="button"
        aria-expanded={!collapsed}
        onClick={onToggle}
        className="flex min-w-0 flex-1 items-center gap-0.5 rounded px-1 py-1 text-[12px] font-bold tracking-wide text-muted uppercase hover:text-fg"
      >
        {collapsed ? <ChevronRight size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
        <span className="truncate">{category.name}</span>
      </button>
      {onCreate ? (
        <button
          type="button"
          aria-label={`Create channel in ${category.name}`}
          title="Create Channel"
          onClick={onCreate}
          className="rounded p-0.5 text-muted opacity-0 group-hover/cat:opacity-100 hover:text-fg focus-visible:opacity-100"
        >
          <PlusCircle size={16} aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

/** What the pointer is over while dragging (null: nowhere it could drop, or no change). */
function dropFor(
  a: DragData,
  e: DragMoveEvent,
  groups: readonly ChannelGroup[],
  categories: readonly SpaceCategory[],
): SidebarDrop | null {
  const hit = collisionTarget<DropData>(e.collisions);
  if (!hit) return null;
  const over = hit.data;
  if (a.kind === 'voice') {
    // Onto another voice channel (or Stage: they land in its audience) I may move people into.
    const voiceLike = over.kind === 'channel' && (over.chat.type === 'space_voice' || over.chat.type === 'space_stage');
    if (over.kind !== 'channel' || !voiceLike || over.chat.id === a.state.channelId) return null;
    const bits = over.chat.spacePermissions;
    return hasPerm(bits, PERM.MOVE_MEMBERS) && hasPerm(bits, PERM.CONNECT) ? { kind: 'voice', channelId: over.chat.id } : null;
  }
  const side = dropZone(hit.point.y, hit.rect, 0.5) === 'before' ? 'before' : 'after';
  if (a.kind === 'channel') {
    let next: SidebarDrop;
    if (over.kind === 'channel') {
      next = { kind: 'channel', drop: { kind: side, channelId: over.chat.id }, line: { id: `ch:${over.chat.id}`, side } };
    } else if (side === 'before') {
      // Above a category header: the end of the group above it (the first one: no category).
      const i = groups.findIndex((g) => g.category?.id === over.categoryId);
      const above = groups[i - 1];
      next = { kind: 'channel', drop: { kind: 'end', categoryId: above?.category?.id ?? null }, line: { id: `cat:${over.categoryId}`, side } };
    } else {
      next = { kind: 'channel', drop: { kind: 'start', categoryId: over.categoryId }, line: { id: `cat:${over.categoryId}`, side } };
    }
    return channelMoveItems(groups, a.chat.id, next.drop).length ? next : null;
  }
  // A category: next to another one; over a channel, after its category (uncategorised: before the first).
  let drop: CategoryDrop | null;
  if (over.kind === 'category') drop = { kind: side, categoryId: over.categoryId };
  else {
    const g = groups.find((x) => x.channels.some((c) => c.id === over.chat.id));
    const first = groups.find((x) => x.category)?.category;
    drop = g?.category ? { kind: 'after', categoryId: g.category.id } : first ? { kind: 'before', categoryId: first.id } : null;
  }
  return drop && categoryMoveItems(categories, a.category.id, drop).length ? { kind: 'category', drop } : null;
}

function DragPreview({ data }: { data: DragData }) {
  if (data.kind === 'voice') return <OccupantDragPreview data={data} />;
  if (data.kind === 'category')
    return (
      <div className="w-max max-w-60 truncate rounded-lg bg-elevated px-3 py-1.5 text-[12px] font-bold tracking-wide text-muted uppercase shadow-elevated">
        {data.label}
      </div>
    );
  const t = data.chat.type;
  const forumIcon = data.chat.space?.forum?.settings.media ? Images : MessagesSquare;
  const Icon = t === 'space_stage' ? Podcast : t === 'space_voice' ? Volume2 : t === 'space_forum' ? forumIcon : data.chat.space?.isNews ? Megaphone : Hash;
  return (
    <div className="flex h-9 w-60 items-center gap-1.5 rounded-lg bg-elevated px-2 text-[15px] font-semibold text-fg shadow-elevated">
      <Icon size={18} className="shrink-0 opacity-70" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{data.label}</span>
    </div>
  );
}

type SidebarDialog =
  | { kind: 'channel'; chat?: ChatSummary; categoryId?: ID | null }
  | { kind: 'clone'; chat: ChatSummary }
  | { kind: 'category'; category: SpaceCategory }
  | { kind: 'invite'; channelId?: ID };

type ContextMenu =
  | { kind: 'channel'; chatId: ID; anchor: MenuAnchor }
  | { kind: 'category'; categoryId: ID; anchor: MenuAnchor };

/**
 * Channel list of one Space (Discord's left column), with the Space menu in its header.
 * With MANAGE_CHANNELS, channels drag within and across categories (into "no category" too:
 * above the first category) and categories drag among themselves; with MOVE_MEMBERS, people
 * in voice drag onto another voice channel. Moves show at once (one PATCH; reverted with a
 * toast if it fails). Unread channels scrolled out of view show a NEW UNREADS / NEW MENTIONS
 * pill on that edge; on desktop the sidebar is resizable (features/frame/SidebarFrame.tsx).
 */
export function ChannelSidebar({ spaceId }: { spaceId: ID }) {
  const space = useSpace(spaceId);
  const channels = useSpaceChannels(spaceId);
  const navigate = useNavigate();
  const { chatId } = useParams<{ chatId?: string }>();
  const [collapsed, setCollapsed] = useState(spaceMemory.collapsed);
  const [menu, setMenu] = useState<ContextMenu | null>(null);
  const [dialog, setDialog] = useState<SidebarDialog | null>(null);
  const spaceMenu = useSpaceMenu(space);
  const groups = useMemo(() => (space ? groupsOf(space, channels) : []), [space, channels]);
  const hideMuted = !!space?.me.hideMutedChannels;
  // Browse Channels: my choices (opt-in channels hidden until shown), or everything.
  const prefs = space?.me.channelPrefs;
  const showAll = useShowAllChannels(spaceId);
  const shown = useMemo(
    () => visibleGroups(groups, { collapsed, hideMuted, activeId: chatId, prefs, showAll }),
    [groups, collapsed, hideMuted, chatId, prefs, showAll],
  );
  const sensors = useDragSensors(12);
  const [dragging, setDragging] = useState<DragData | null>(null);
  const [drop, setDrop] = useState<SidebarDrop | null>(null);
  const dropRef = useRef<SidebarDrop | null>(null);
  const desktop = useIsDesktop();
  const pills = useJumpPills();
  // Desktop: in the resizable frame (its width is shared with Home's DM list).
  const framed = (aside: ReactNode) => (desktop ? <SidebarFrame defaultWidth={260}>{aside}</SidebarFrame> : aside);

  if (!space) {
    return framed(
      <aside aria-label="Channels" className="lg:card-pane flex w-[260px] min-w-0 flex-1 flex-col bg-surface lg:flex-none" />,
    );
  }

  const manageChannels = hasPerm(space.myPermissions, PERM.MANAGE_CHANNELS);
  const closeDialog = () => setDialog(null);

  const toggle = (id: ID) => {
    const next = !collapsed[id];
    spaceMemory.setCollapsed(id, next);
    setCollapsed((c) => {
      const out = { ...c };
      if (next) out[id] = true;
      else delete out[id];
      return out;
    });
  };
  const collapseAll = () => setCollapsed(spaceMemory.setCollapsedMany(space.categories.map((c) => c.id), true));

  const mute = (list: ChatSummary[], until: string | null) => void setChannelsMuted(list, until);

  /** Optimistic channel moves; back where they were (and a toast) when the PATCH fails. */
  const applyChannelMove = (items: ChannelPositionItem[]) => {
    if (!items.length) return;
    const byId = useChats.getState().byId;
    const before = items.map((it) => ({
      id: it.id,
      categoryId: byId[it.id]?.space?.categoryId ?? null,
      position: byId[it.id]?.space?.position ?? 0,
    }));
    void moveChannels(spaceId, items).catch((e: unknown) => {
      for (const b of before)
        useChats
          .getState()
          .mutateChat(b.id, (c) => (c.space ? { space: { ...c.space, categoryId: b.categoryId, position: b.position } } : null));
      toast.error(e);
    });
  };

  /** Optimistic category moves, reverted with a toast when the PATCH fails. */
  const applyCategoryMove = (items: { id: ID; position: number }[]) => {
    if (!items.length) return;
    const was = new Map(space.categories.map((c) => [c.id, c.position]));
    const to = new Map(items.map((i) => [i.id, i.position]));
    const store = useSpaces.getState();
    store.applySpaceUpdate(spaceId, {
      categories: space.categories.map((c) => (to.has(c.id) ? { ...c, position: to.get(c.id)! } : c)),
    });
    void api.patch(`/api/spaces/${spaceId}/categories/positions`, { items }).catch((e: unknown) => {
      const cur = useSpaces.getState().byId[spaceId];
      if (cur)
        useSpaces.getState().applySpaceUpdate(spaceId, {
          categories: cur.categories.map((c) => (was.has(c.id) ? { ...c, position: was.get(c.id)! } : c)),
        });
      toast.error(e);
    });
  };

  /** Move Up / Move Down: past the neighbour of the same kind in its category (text always sorts before voice). */
  const move = (c: ChatSummary, dir: -1 | 1) => {
    const g = groups.find((x) => x.channels.some((y) => y.id === c.id));
    const row = (g?.channels ?? []).filter((x) => isVoiceChannelType(x.type) === isVoiceChannelType(c.type));
    const next = row[row.findIndex((x) => x.id === c.id) + dir];
    if (next) applyChannelMove(channelMoveItems(groups, c.id, { kind: dir < 0 ? 'before' : 'after', channelId: next.id }));
  };

  const moveCategory = (category: SpaceCategory, dir: -1 | 1) => {
    const sorted = [...space.categories].sort((a, b) => a.position - b.position);
    const next = sorted[sorted.findIndex((x) => x.id === category.id) + dir];
    if (next)
      applyCategoryMove(categoryMoveItems(space.categories, category.id, { kind: dir < 0 ? 'before' : 'after', categoryId: next.id }));
  };

  const endDrag = () => {
    setDragging(null);
    setDrop(null);
    dropRef.current = null;
  };
  const onDragStart = (e: DragStartEvent) => {
    setDragging((e.active.data.current as DragData | undefined) ?? null);
    setDrop(null);
    dropRef.current = null;
  };
  const onDragMove = (e: DragMoveEvent) => {
    const a = e.active.data.current as DragData | undefined;
    const next = a ? dropFor(a, e, groups, space.categories) : null;
    if (sameDrop(next, dropRef.current)) return;
    dropRef.current = next;
    setDrop(next);
  };
  const onDragEnd = (e: DragEndEvent) => {
    const a = e.active.data.current as DragData | undefined;
    const d = dropRef.current;
    endDrag();
    suppressClickAfterDrag();
    if (!a || !d) return;
    if (a.kind === 'voice' && d.kind === 'voice')
      void moveVoiceMember(spaceId, a.state.userId, d.channelId).catch((e: unknown) => toast.error(e));
    else if (a.kind === 'channel' && d.kind === 'channel') applyChannelMove(channelMoveItems(groups, a.chat.id, d.drop));
    else if (a.kind === 'category' && d.kind === 'category')
      applyCategoryMove(categoryMoveItems(space.categories, a.category.id, d.drop));
  };
  const lineOf = (id: string) => (drop?.kind === 'channel' && drop.line.id === id ? drop.line.side : undefined);
  const groupLine = (categoryId: ID | undefined) =>
    drop?.kind === 'category' && categoryId && drop.drop.categoryId === categoryId ? drop.drop.kind : undefined;

  const removeChannel = (c: ChatSummary) =>
    void confirm({
      title: `Delete ${c.type === 'space_voice' || c.type === 'space_stage' ? '' : '#'}${c.name}?`,
      message: 'Its messages are deleted for everyone. This cannot be undone.',
      confirmLabel: 'Delete Channel',
      danger: true,
    }).then(async (ok) => {
      if (!ok) return;
      try {
        await deleteChannel(spaceId, c.id);
        if (chatId === c.id) navigate(`/spaces/${spaceId}`, { replace: true });
      } catch (e) {
        toast.error(e);
      }
    });

  const channelItems = (c: ChatSummary): MenuEntry[] => {
    const canManage = hasPerm(c.spacePermissions, PERM.MANAGE_CHANNELS);
    const muted = isChannelMuted(c);
    const unread = c.lastSeq > c.lastReadSeq || c.unreadMentionCount > 0;
    return tidy([
      {
        label: 'Mark As Read',
        icon: CheckCheck,
        disabled: !unread,
        onSelect: () => markChatRead(c.id, { force: true }),
      },
      'separator',
      hasPerm(c.spacePermissions, PERM.CREATE_INVITE) && {
        label: 'Invite People',
        icon: UserPlus,
        onSelect: () => setDialog({ kind: 'invite', channelId: c.id }),
      },
      {
        label: 'Copy Link',
        icon: Link2,
        onSelect: () =>
          void copyText(`${location.origin}/spaces/${spaceId}/${c.id}`).then((ok) => ok && toast.success('Link copied')),
      },
      'separator',
      muteEntry('Channel', c.mutedUntil, muted, (until) => mute([c], until)),
      {
        label: 'Notification Settings',
        submenu: notifyLevelEntries(
          c.notifyLevel,
          (level) => void patchPrefs(c, { notifyLevel: level }),
          { spaceLevel: spaceNotifyLevel(space) },
        ),
      },
      canManage && 'separator',
      canManage && { label: 'Edit Channel', icon: Pencil, onSelect: () => setDialog({ kind: 'channel', chat: c }) },
      canManage && manageChannels && { label: 'Clone Channel', icon: CopyPlus, onSelect: () => setDialog({ kind: 'clone', chat: c }) },
      canManage && manageChannels && { label: 'Move Up', icon: ArrowUp, onSelect: () => move(c, -1) },
      canManage && manageChannels && { label: 'Move Down', icon: ArrowDown, onSelect: () => move(c, 1) },
      canManage && { label: 'Delete Channel', icon: Trash2, danger: true, onSelect: () => removeChannel(c) },
      'separator',
      copyIdItem(c.id, 'Channel'),
    ]);
  };

  const categoryItems = (category: SpaceCategory): MenuEntry[] => {
    const inside = channels.filter((c) => c.space?.categoryId === category.id);
    const unread = inside.filter((c) => c.lastSeq > c.lastReadSeq || c.unreadMentionCount > 0);
    const muted = isCategoryMuted(inside);
    return tidy([
      {
        label: 'Mark As Read',
        icon: CheckCheck,
        disabled: unread.length === 0,
        onSelect: () => {
          for (const c of unread) markChatRead(c.id, { force: true });
        },
      },
      'separator',
      {
        label: 'Collapse Category',
        checked: !!collapsed[category.id],
        keepOpen: true,
        onSelect: () => toggle(category.id),
      },
      { label: 'Collapse All Categories', icon: ChevronsDownUp, onSelect: collapseAll },
      'separator',
      // A category mute is the mute of each of its channels (per-channel prefs).
      inside.length > 0 &&
        muteEntry(
          'Category',
          muted ? (inside.map((c) => c.mutedUntil!).sort()[0] ?? null) : null,
          muted,
          (until) => mute(inside, until),
        ),
      manageChannels && 'separator',
      manageChannels && { label: 'Edit Category', icon: Pencil, onSelect: () => setDialog({ kind: 'category', category }) },
      manageChannels && { label: 'Move Up', icon: ArrowUp, onSelect: () => moveCategory(category, -1) },
      manageChannels && { label: 'Move Down', icon: ArrowDown, onSelect: () => moveCategory(category, 1) },
      manageChannels && {
        label: 'Delete Category',
        icon: Trash2,
        danger: true,
        onSelect: () =>
          void confirm({
            title: `Delete ‘${category.name}’?`,
            message: 'Its channels are kept and move out of the category.',
            confirmLabel: 'Delete Category',
            danger: true,
          }).then(
            (ok) => ok && void deleteCategory(spaceId, category.id).catch((e: unknown) => toast.error(e)),
          ),
      },
      'separator',
      copyIdItem(category.id, 'Category'),
    ]);
  };

  const menuItems = (): MenuEntry[] => {
    if (!menu) return [];
    if (menu.kind === 'channel') {
      const chat = channels.find((c) => c.id === menu.chatId);
      return chat ? channelItems(chat) : [];
    }
    const category = space.categories.find((c) => c.id === menu.categoryId);
    return category ? categoryItems(category) : [];
  };

  const list = shown.map(({ group: g, shown: rows }) => {
    const isCollapsed = g.category ? !!collapsed[g.category.id] : false;
    const line = groupLine(g.category?.id);
    return (
      <div key={g.category?.id ?? 'none'} className="relative pt-4">
        {line === 'before' ? <DropIndicator side="before" className="top-2" /> : null}
        {g.category ? (
          <CategoryHeader
            category={g.category}
            collapsed={isCollapsed}
            draggable={manageChannels}
            line={lineOf(`cat:${g.category.id}`)}
            onToggle={() => toggle(g.category!.id)}
            onCreate={manageChannels ? () => setDialog({ kind: 'channel', categoryId: g.category!.id }) : undefined}
            onMenu={(anchor) => setMenu({ kind: 'category', categoryId: g.category!.id, anchor })}
          />
        ) : null}
        <div className="mt-0.5 flex flex-col gap-0.5">
          {rows.map((c) => (
            <ChannelRow
              key={c.id}
              chat={c}
              active={c.id === chatId}
              draggable={manageChannels}
              line={lineOf(`ch:${c.id}`)}
              voiceTarget={drop?.kind === 'voice' && drop.channelId === c.id}
              channels={channels}
              onMenu={(chat, anchor) => setMenu({ kind: 'channel', chatId: chat.id, anchor })}
              onInvite={(chat) => setDialog({ kind: 'invite', channelId: chat.id })}
              onEdit={(chat) => setDialog({ kind: 'channel', chat })}
            />
          ))}
        </div>
        {line === 'after' ? <DropIndicator side="after" className="-bottom-2" /> : null}
      </div>
    );
  });

  return framed(
    <aside aria-label="Channels" className="lg:card-pane flex w-[260px] min-w-0 flex-1 flex-col bg-surface lg:flex-none">
      <DropdownMenu
        aria-label={`${space.name} menu`}
        align="start"
        items={spaceMenu.headerItems()}
        trigger={({ active, ...p }) => (
          <button
            type="button"
            {...p}
            className="flex h-14 w-full shrink-0 items-center gap-2 px-4 text-left font-bold text-fg transition-colors hover:bg-hover lg:rounded-t-[var(--radius-card)]"
            data-testid="space-header"
          >
            <span className="min-w-0 flex-1 truncate text-[16px]">{space.name}</span>
            <ChevronDown size={18} className={cn('shrink-0 transition-transform', active && 'rotate-180')} aria-hidden />
          </button>
        )}
      />
      {space.bannerUrl ? (
        <div className="mx-3 mb-2 h-24 shrink-0 overflow-hidden rounded-xl bg-surface-2">
          <img src={space.bannerUrl} alt="" className="size-full object-cover" />
        </div>
      ) : null}
      <SidebarGuideLinks space={space} />
      <SidebarEvents space={space} />
      <div className="relative flex min-h-0 flex-1 flex-col">
        <nav
          ref={pills.ref}
          className="min-h-0 flex-1 overflow-y-auto pb-4"
          aria-label={`${space.name} channels`}
          data-dragging={dragging ? 'true' : undefined}
        >
          <DndContext
            sensors={sensors}
            collisionDetection={collision}
            accessibility={dndAccessibility}
            onDragStart={onDragStart}
            onDragMove={onDragMove}
            onDragEnd={onDragEnd}
            onDragCancel={endDrag}
          >
            {list}
            <DragOverlay dropAnimation={null}>{dragging ? <DragPreview data={dragging} /> : null}</DragOverlay>
          </DndContext>
          {channels.length === 0 ? (
            <p className="px-4 pt-6 text-sm text-muted">No channels you can see yet.</p>
          ) : null}
        </nav>
        {/* NEW UNREADS / NEW MENTIONS: unread channels scrolled out of view. */}
        <JumpPill side="top" kind={pills.above} onJump={pills.jump} />
        <JumpPill side="bottom" kind={pills.below} onJump={pills.jump} />
      </div>
      <UserPanel className="hidden lg:flex" />

      <Menu
        open={!!menu}
        onClose={() => setMenu(null)}
        anchor={menu?.anchor ?? null}
        items={menuItems()}
        aria-label={menu?.kind === 'category' ? 'Category menu' : 'Channel menu'}
      />
      {spaceMenu.dialogs}
      {dialog?.kind === 'channel' ? (
        <ChannelDialog spaceId={spaceId} chat={dialog.chat} categoryId={dialog.categoryId} onClose={closeDialog} />
      ) : null}
      {dialog?.kind === 'clone' ? <CloneChannelDialog spaceId={spaceId} chat={dialog.chat} onClose={closeDialog} /> : null}
      {dialog?.kind === 'category' ? (
        <CategoryDialog spaceId={spaceId} category={dialog.category} onClose={closeDialog} />
      ) : null}
      {dialog?.kind === 'invite' ? <InviteDialog space={space} channelId={dialog.channelId} onClose={closeDialog} /> : null}
    </aside>,
  );
}
