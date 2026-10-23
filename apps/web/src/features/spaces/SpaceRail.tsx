import { useCallback, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { NavLink, useLocation, useParams, useSearchParams } from 'react-router';
import {
  DndContext,
  DragOverlay,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { CheckCheck, Compass, Folder, FolderClosed, FolderOpen, Plus, Settings } from 'lucide-react';
import { chatTitle, hexColorSchema, isMuted, type ChatSummary, type ID, type RailEntry, type RailFolder, type Space } from '@enbox/shared';
import { ChatAvatar } from '@/components/common/ChatAvatar';
import { LogoMark } from '@/components/common/Logo';
import {
  Avatar,
  Badge,
  Button,
  Input,
  Menu,
  Modal,
  contextMenuAnchor,
  toast,
  type MenuAnchor,
  type MenuEntry,
} from '@/components/ui';
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
import { isChatUnread, useSortedChats, useUnreadChatsCount } from '@/stores/chats';
import { useIncomingFriendRequestCount } from '@/stores/friends';
import {
  applyRailDrop,
  moveInRail,
  normalizeRail,
  sameRail,
  updateRailFolder,
  useFolderBadge,
  useRail,
  useRailItems,
  type RailDrop,
  type RailItem,
} from '@/stores/rail';
import { useSpaceBadge, useSpaceList } from '@/stores/spaces';
import { markSpaceRead, spaceMemory } from './actions';
import { tidy, useSpaceMenu } from './menus';
import { CommunityGate } from './community/CommunityGate';
import { CreateSpaceDialog } from './dialogs/CreateSpaceDialog';

/** Discord's server acronym: first letters of the words (max 5), e.g. "Gaming Lounge" → "GL". */
export function spaceAcronym(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.map((w) => Array.from(w)[0] ?? '').join('');
  return (letters || '?').slice(0, 5);
}

/** Hover tooltip to the right of a rail tile (the rail is a card, so it can't clip). Hidden while dragging. */
const TIP =
  'pointer-events-none absolute top-1/2 left-full z-50 ml-3 -translate-y-1/2 rounded-lg bg-fg px-2.5 py-1.5 text-[13px] font-semibold whitespace-nowrap text-surface opacity-0 shadow-elevated transition-opacity duration-100 group-hover/tile:opacity-100 group-focus-visible/tile:opacity-100 group-data-[dragging=true]/rail:hidden';

// ---------------------------------------------------------------------------
// Drag and drop
// ---------------------------------------------------------------------------

type RailDragData =
  | { kind: 'space'; space: Space; folderId: string | null; label: string }
  | { kind: 'folder'; item: Extract<RailItem, { kind: 'folder' }>; label: string };

type RailDropData =
  | { kind: 'space'; id: ID; folderId: string | null; label: string }
  | { kind: 'folder'; id: string; open: boolean; label: string }
  | { kind: 'end'; label: string };

const collision = pointCollision();
const dragKey = (a: RailDragData) => (a.kind === 'space' ? a.space.id : a.item.folder.id);

/**
 * Where a drag over the rail lands (Discord): near a tile's top or bottom edge, next to it;
 * on its middle, a new folder of the two (a folder: into it). Inside a folder (and for a
 * dragged folder) only next to, by halves. An open folder's header: above it, or first in it.
 */
function railDropFor(a: RailDragData, e: DragMoveEvent): RailDrop | null {
  const hit = collisionTarget<RailDropData>(e.collisions);
  if (!hit) return null;
  const over = hit.data;
  if (over.kind === 'end') return { kind: 'end' };
  const y = hit.point.y;
  const half = dropZone(y, hit.rect, 0.5) === 'before' ? 'before' : 'after';
  if (a.kind === 'space') {
    if (over.kind === 'space') {
      if (over.id === a.space.id) return null;
      if (over.folderId) return { kind: half, targetId: over.id };
      const zone = dropZone(y, hit.rect);
      return zone === 'middle' ? { kind: 'combine', spaceId: over.id } : { kind: zone, targetId: over.id };
    }
    if (over.open) return half === 'before' ? { kind: 'before', targetId: over.id } : { kind: 'into', folderId: over.id, index: 0 };
    const zone = dropZone(y, hit.rect);
    return zone === 'middle' ? { kind: 'into', folderId: over.id } : { kind: zone, targetId: over.id };
  }
  const id = a.item.folder.id;
  if (over.kind === 'folder') return over.id === id ? null : { kind: over.open ? 'before' : half, targetId: over.id };
  if (over.folderId) return over.folderId === id ? null : { kind: half, targetId: over.folderId };
  return { kind: half, targetId: over.id };
}

/** The indicator line between rail tiles (in the 8px gap above or below a 48px tile). */
function RailLine({ side }: { side: 'before' | 'after' }) {
  return (
    <span
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-x-1 z-20 h-0.5 rounded-full bg-brand',
        side === 'before' ? '-top-[5px]' : '-bottom-[5px]',
      )}
      data-testid="rail-drop-indicator"
    />
  );
}

/** Alt+Shift+↑/↓ (Discord): move the focused item by one place. */
function moveKey(e: KeyboardEvent): -1 | 1 | null {
  if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey) return null;
  return e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : null;
}

// ---------------------------------------------------------------------------
// Tiles
// ---------------------------------------------------------------------------

/** A Space's icon (or its initials) in the rail's rounded tile. */
function SpaceIcon({ space, active }: { space: Space; active: boolean }) {
  return space.iconUrl ? (
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
  );
}

/**
 * A Space in the rail (top level or in an open folder). Right-click (or Shift+F10 / the Menu
 * key) opens Discord's server menu; a muted Space is dimmed and shows no unread pill (mentions
 * of me still count). Drags to reorder; Alt+Shift+↑/↓ moves it.
 */
function SpaceTile({
  space,
  active,
  folderId,
  line,
  combine,
  onMove,
}: {
  space: Space;
  active: boolean;
  folderId: string | null;
  line?: 'before' | 'after';
  /** A Space is dragged onto this one (they would make a folder). */
  combine?: boolean;
  onMove: (id: string, dir: -1 | 1) => void;
}) {
  const badge = useSpaceBadge(space);
  const last = spaceMemory.lastChannel(space.id);
  const menu = useSpaceMenu(space);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const drag = useDraggable({
    id: `space:${space.id}`,
    data: { kind: 'space', space, folderId, label: space.name } satisfies RailDragData,
  });
  const drop = useDroppable({ id: `space:${space.id}`, data: { kind: 'space', id: space.id, folderId, label: space.name } satisfies RailDropData });
  const { setNodeRef: setDragNode, setActivatorNodeRef: setDragHandle } = drag;
  const { setNodeRef: setDropNode } = drop;
  const ref = useCallback(
    (el: HTMLAnchorElement | null) => {
      setDragNode(el);
      setDragHandle(el);
      setDropNode(el);
    },
    [setDragNode, setDragHandle, setDropNode],
  );
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
        ref={ref}
        to={last ? `/spaces/${space.id}/${last}` : `/spaces/${space.id}`}
        aria-label={label}
        aria-current={active ? 'page' : undefined}
        aria-describedby={drag.attributes['aria-describedby']}
        draggable={false}
        {...drag.listeners}
        onKeyDown={(e) => {
          const dir = moveKey(e);
          if (dir) {
            // The app-wide Alt+Shift+↑/↓ (unread navigation) skips handled events.
            e.preventDefault();
            e.stopPropagation();
            onMove(space.id, dir);
            return;
          }
          drag.listeners?.onKeyDown?.(e);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          if (!inActiveDrag(e.currentTarget)) setAnchor(contextMenuAnchor(e));
        }}
        className={cn(
          'group/tile relative flex size-12 shrink-0 items-center justify-center outline-none [-webkit-touch-callout:none]',
          drag.isDragging && 'opacity-40',
        )}
        data-testid="space-tile"
        data-rail-key={space.id}
        data-muted={badge.muted || undefined}
      >
        {/* Discord pill: tall when current, medium when unread, a nub on hover. */}
        <Pill active={active} unread={badge.unread} />
        {line ? <RailLine side={line} /> : null}
        {/* Painted before the (positioned) icon, so it shows around it. */}
        {combine ? <span aria-hidden className="absolute -inset-1 rounded-[18px] bg-brand/25 ring-2 ring-brand" /> : null}
        <span
          className={cn(
            'relative overflow-hidden transition-[border-radius,opacity,scale] duration-200 group-focus-visible/tile:outline-2 group-focus-visible/tile:outline-offset-2 group-focus-visible/tile:outline-brand',
            active || combine ? 'rounded-2xl' : 'rounded-[24px] group-hover/tile:rounded-2xl',
            combine && 'scale-90',
            // Discord greys out muted servers until hovered or open.
            badge.muted && !active && 'opacity-40 group-hover/tile:opacity-100 group-focus-visible/tile:opacity-100',
          )}
        >
          <SpaceIcon space={space} active={active} />
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

/** A Space in a closed folder's 2×2 preview. */
function MiniIcon({ space }: { space: Space }) {
  return space.iconUrl ? (
    <Avatar src={space.iconUrl} name={space.name} colorSeed={space.id} size={16} kind="community" decorative />
  ) : (
    <span className="flex size-4 items-center justify-center rounded-[5px] bg-surface-2 text-[8px] leading-none font-semibold text-fg" aria-hidden>
      {Array.from(space.name.trim())[0] ?? '?'}
    </span>
  );
}

/** The folder colour (null: the brand colour) mixed with transparency. */
function tint(color: string | null, percent: number): string {
  return `color-mix(in srgb, ${color ?? 'var(--brand)'} ${percent}%, transparent)`;
}

/** A folder's name, else the names of its first Spaces. */
function folderTitle(folder: RailFolder, spaces: readonly Space[]): string {
  if (folder.name) return folder.name;
  const names = spaces.slice(0, 3).map((s) => s.name);
  return spaces.length > 3 ? `${names.join(', ')} and ${spaces.length - 3} more` : names.join(', ');
}

/** Mark every Space of a folder read (one after the other). */
async function markFolderRead(spaces: readonly Space[]): Promise<void> {
  for (const s of spaces) {
    try {
      await markSpaceRead(s.id);
    } catch (e) {
      toast.error(e);
      return;
    }
  }
}

/** The closed look of a folder: its colour with the first four icons. */
function FolderPreview({ folder, spaces }: { folder: RailFolder; spaces: readonly Space[] }) {
  return (
    <span
      className="relative grid size-12 grid-cols-2 content-center justify-items-center gap-1 rounded-2xl p-1.5"
      style={{ backgroundColor: tint(folder.color, 35) }}
      aria-hidden
    >
      {spaces.slice(0, 4).map((s) => (
        <MiniIcon key={s.id} space={s} />
      ))}
    </span>
  );
}

/**
 * A folder of Spaces (Discord). Closed: a tinted tile with a 2×2 preview, the folder's unread
 * pill and summed mentions. Open: a folder icon, then its Spaces in a tinted strip. Click
 * toggles (per device); right-click: Folder Settings, Mark Folder As Read, Close / Expand.
 */
function FolderItem({
  item,
  activeSpaceId,
  open,
  drop,
  onMove,
  onEdit,
}: {
  item: Extract<RailItem, { kind: 'folder' }>;
  activeSpaceId: ID | undefined;
  open: boolean;
  drop: RailDrop | null;
  onMove: (id: string, dir: -1 | 1) => void;
  onEdit: (folder: RailFolder) => void;
}) {
  const { folder, spaces } = item;
  const badge = useFolderBadge(spaces);
  const toggle = () => useRail.getState().toggleFolder(folder.id);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const title = folderTitle(folder, spaces);
  const drag = useDraggable({ id: `folder:${folder.id}`, data: { kind: 'folder', item, label: title } satisfies RailDragData });
  const target = useDroppable({ id: `folder:${folder.id}`, data: { kind: 'folder', id: folder.id, open, label: title } satisfies RailDropData });
  const { setNodeRef: setDragNode } = drag;
  const { setNodeRef: setDropNode } = target;
  const ref = useCallback(
    (el: HTMLButtonElement | null) => {
      setDragNode(el);
      setDropNode(el);
    },
    [setDragNode, setDropNode],
  );
  const containsActive = spaces.some((s) => s.id === activeSpaceId);
  const line = drop && (drop.kind === 'before' || drop.kind === 'after') && drop.targetId === folder.id ? drop.kind : undefined;
  const into = drop?.kind === 'into' && drop.folderId === folder.id;
  const label = [
    `${title}, folder`,
    !open && badge.mentions ? `${badge.mentions} mention${badge.mentions === 1 ? '' : 's'}` : !open && badge.unread ? 'unread messages' : null,
  ]
    .filter(Boolean)
    .join(', ');
  const items = (): MenuEntry[] =>
    tidy([
      { label: 'Mark Folder As Read', icon: CheckCheck, disabled: !badge.unread && !badge.mentions, onSelect: () => void markFolderRead(spaces) },
      'separator',
      { label: 'Folder Settings', icon: Settings, onSelect: () => onEdit(folder) },
      { label: open ? 'Close Folder' : 'Expand Folder', icon: open ? FolderClosed : FolderOpen, onSelect: toggle },
    ]);
  return (
    <div
      className={cn('relative flex flex-col items-center gap-2 rounded-2xl', drag.isDragging && 'opacity-40')}
      style={open ? { backgroundColor: tint(folder.color, 18) } : undefined}
      data-testid="rail-folder"
    >
      {line ? <RailLine side={line} /> : null}
      <button
        ref={ref}
        type="button"
        {...pointerListeners(drag.listeners)}
        aria-label={label}
        aria-expanded={open}
        onClick={toggle}
        onKeyDown={(e) => {
          const dir = moveKey(e);
          if (!dir) return;
          e.preventDefault();
          e.stopPropagation();
          onMove(folder.id, dir);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          if (!inActiveDrag(e.currentTarget)) setAnchor(contextMenuAnchor(e));
        }}
        className="group/tile relative flex size-12 shrink-0 items-center justify-center rounded-2xl outline-none [-webkit-touch-callout:none] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        data-rail-key={folder.id}
      >
        {open ? null : <Pill active={containsActive} unread={badge.unread} />}
        {into && !open ? <span aria-hidden className="absolute -inset-1 rounded-[18px] bg-brand/25 ring-2 ring-brand" /> : null}
        {open ? (
          <span className="flex size-12 items-center justify-center" style={{ color: folder.color ?? 'var(--brand)' }} aria-hidden>
            <Folder size={24} fill="currentColor" />
          </span>
        ) : (
          <FolderPreview folder={folder} spaces={spaces} />
        )}
        {!open && badge.mentions ? (
          <Badge count={badge.mentions} size="sm" tone="danger" className="absolute -right-1 -bottom-1 ring-[3px] ring-surface" />
        ) : null}
        <span role="tooltip" className={TIP}>
          {title}
        </span>
      </button>
      {open
        ? spaces.map((s, i) => (
            <SpaceTile
              key={s.id}
              space={s}
              active={s.id === activeSpaceId}
              folderId={folder.id}
              line={
                into && drop?.kind === 'into' && drop.index === 0 && i === 0
                  ? 'before'
                  : drop && (drop.kind === 'before' || drop.kind === 'after') && drop.targetId === s.id
                    ? drop.kind
                    : undefined
              }
              onMove={onMove}
            />
          ))
        : null}
      <Menu open={!!anchor} onClose={() => setAnchor(null)} anchor={anchor} items={anchor ? items() : []} aria-label={`${title} menu`} />
    </div>
  );
}

/** The drag preview: the Space's icon, or the closed folder. */
function RailDragPreview({ data }: { data: RailDragData }) {
  if (data.kind === 'folder') return <FolderPreview folder={data.item.folder} spaces={data.item.spaces} />;
  return (
    <span className="block size-12 overflow-hidden rounded-2xl shadow-elevated">
      <SpaceIcon space={data.space} active />
    </span>
  );
}

// ---------------------------------------------------------------------------
// Folder settings
// ---------------------------------------------------------------------------

/** Folder colour presets (null: the brand colour). */
const FOLDER_COLORS = [
  '#3b82f6',
  '#0ea5e9',
  '#14b8a6',
  '#22c55e',
  '#84cc16',
  '#eab308',
  '#f97316',
  '#ef4444',
  '#ec4899',
  '#a855f7',
  '#64748b',
] as const;

/** Folder Settings (Discord): its name and colour (presets or any hex). */
function FolderSettingsDialog({
  folder,
  spaces,
  onSave,
  onClose,
}: {
  folder: RailFolder;
  spaces: readonly Space[];
  onSave: (patch: Pick<RailFolder, 'name' | 'color'>) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(folder.name ?? '');
  const [color, setColor] = useState<string | null>(folder.color);
  const [hex, setHex] = useState(folder.color ?? '');
  const parsed = hex.trim() ? hexColorSchema.safeParse(hex.trim()) : null;
  const hexError = parsed && !parsed.success ? 'Use a #rrggbb colour' : undefined;
  const pick = (c: string | null) => {
    setColor(c);
    setHex(c ?? '');
  };
  const save = () => {
    if (hexError) return;
    onSave({ name: name.trim() || null, color });
    onClose();
  };
  const swatch = (c: string | null, labelText: string) => (
    <button
      key={c ?? 'default'}
      type="button"
      aria-label={labelText}
      aria-pressed={color === c}
      onClick={() => pick(c)}
      className={cn(
        'size-8 rounded-full ring-offset-2 ring-offset-surface outline-none focus-visible:ring-2 focus-visible:ring-brand',
        color === c && 'ring-2 ring-fg',
      )}
      style={{ backgroundColor: c ?? 'var(--brand)' } as CSSProperties}
    />
  );
  return (
    <Modal
      open
      onClose={onClose}
      title="Folder Settings"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!!hexError} onClick={save}>
            Done
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        className="flex flex-col gap-5"
      >
        <Input
          label="Folder name"
          value={name}
          maxLength={32}
          placeholder={folderTitle({ ...folder, name: null }, spaces)}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          data-testid="folder-name-input"
        />
        <div className="flex flex-col gap-3">
          <span className="text-[13px] font-semibold text-muted">Folder colour</span>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Folder colour presets">
            {swatch(null, 'Default colour')}
            {FOLDER_COLORS.map((c) => swatch(c, c))}
          </div>
          <Input
            label="Hex colour"
            value={hex}
            onChange={(e) => {
              const text = e.target.value;
              setHex(text);
              const r = hexColorSchema.safeParse(text.trim());
              if (r.success) setColor(r.data);
              else if (!text.trim()) setColor(null);
            }}
            placeholder="#6d5dfc"
            maxLength={7}
            autoComplete="off"
            spellCheck={false}
            error={hexError}
            hint={hex ? undefined : 'Default'}
            rightSlot={
              <input
                type="color"
                aria-label="Folder colour picker"
                value={color ?? '#6d5dfc'}
                onChange={(e) => pick(e.target.value.toLowerCase())}
                className="size-8 shrink-0 cursor-pointer rounded-md border-0 bg-transparent p-0"
              />
            }
            data-testid="folder-color-input"
          />
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Home and DMs
// ---------------------------------------------------------------------------

/** Home (DMs and Friends): the app mark; a red count of unread DMs. */
function HomeTile({ active }: { active: boolean }) {
  // Pending friend requests count on Home too (Discord).
  const unread = useUnreadChatsCount() + useIncomingFriendRequestCount();
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

// ---------------------------------------------------------------------------
// The rail
// ---------------------------------------------------------------------------

const ACTION =
  'group/tile relative flex size-12 shrink-0 items-center justify-center rounded-[24px] bg-surface-2 text-success transition-[border-radius,background-color,color] duration-200 hover:rounded-2xl hover:bg-success hover:text-on-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';

/** "Create a Space", which is also where a drag drops after the last item. */
function CreateTile({ line, onClick }: { line: boolean; onClick: () => void }) {
  const target = useDroppable({ id: 'rail-end', data: { kind: 'end', label: 'the end of the list' } satisfies RailDropData });
  return (
    <button ref={target.setNodeRef} type="button" className={ACTION} aria-label="Create a Space" onClick={onClick} data-testid="create-space">
      {line ? <RailLine side="before" /> : null}
      <Plus size={24} aria-hidden />
      <span role="tooltip" className={TIP}>
        Create a Space
      </span>
    </button>
  );
}

/**
 * The app-wide rail (Discord's server list): Home with unread DMs under it, my Spaces and
 * folders in my order (synced across my devices; drag to reorder, onto a Space to make a
 * folder, Alt+Shift+↑/↓ to move the focused one), then create / join.
 */
export function SpaceRail() {
  const spaces = useSpaceList();
  const items = useRailItems();
  const openFolders = useRail((s) => s.open);
  const { spaceId } = useParams<{ spaceId?: string }>();
  const { pathname } = useLocation();
  const inSpaces = pathname === '/spaces' || pathname.startsWith('/spaces/');
  // Previewing a Space from Discover keeps Discover selected.
  const inDiscover = pathname === '/discover' || pathname.startsWith('/preview/');
  const chats = useSortedChats();
  const unreadDms = useMemo(
    () => chats.filter((c) => isChatUnread(c) && !isMuted(c.mutedUntil)).slice(0, 5),
    [chats],
  );
  const activeSpaceId = spaceId ?? (inSpaces ? pathname.split('/')[2] : undefined);
  // `/spaces?create=1` (New chat → New Space) opens the create dialog.
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(() => params.get('create') === '1');
  const [editing, setEditing] = useState<RailFolder | null>(null);
  const closeCreate = () => {
    setCreating(false);
    if (params.has('create')) setParams({}, { replace: true });
  };

  const sensors = useDragSensors(14);
  const [dragging, setDragging] = useState<RailDragData | null>(null);
  const [drop, setDrop] = useState<RailDrop | null>(null);
  const dropRef = useRef<RailDrop | null>(null);

  /** Apply a change to my (normalised) layout; it shows at once and saves. */
  const commit = (change: (layout: RailEntry[]) => RailEntry[]) => {
    const base = normalizeRail(useRail.getState().layout, spaces);
    const next = change(base);
    if (!sameRail(next, base)) useRail.getState().setLayout(next);
  };
  const moveBy = (id: string, dir: -1 | 1) => {
    commit((layout) => moveInRail(layout, id, dir));
    // Keep the focus on what moved (leaving a folder remounts it).
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-rail-key="${CSS.escape(id)}"]`)?.focus());
  };

  const resetDrag = () => {
    setDragging(null);
    setDrop(null);
    dropRef.current = null;
  };
  const onDragStart = (e: DragStartEvent) => {
    setDragging((e.active.data.current as RailDragData | undefined) ?? null);
    setDrop(null);
    dropRef.current = null;
  };
  const onDragMove = (e: DragMoveEvent) => {
    const a = e.active.data.current as RailDragData | undefined;
    let next = a ? railDropFor(a, e) : null;
    // A drop that would change nothing shows nothing.
    if (next && a) {
      const base = normalizeRail(useRail.getState().layout, spaces);
      if (sameRail(applyRailDrop(base, dragKey(a), next), base)) next = null;
    }
    if (JSON.stringify(next) === JSON.stringify(dropRef.current)) return;
    dropRef.current = next;
    setDrop(next);
  };
  const onDragEnd = (e: DragEndEvent) => {
    const a = e.active.data.current as RailDragData | undefined;
    const d = dropRef.current;
    resetDrag();
    suppressClickAfterDrag();
    if (a && d) commit((layout) => applyRailDrop(layout, dragKey(a), d));
  };

  const lineFor = (id: string) => (drop && (drop.kind === 'before' || drop.kind === 'after') && drop.targetId === id ? drop.kind : undefined);
  const editingItem = editing ? items.find((i) => i.kind === 'folder' && i.folder.id === editing.id) : undefined;
  return (
    <nav
      aria-label="Spaces"
      className="group/rail lg:card-pane flex w-[72px] shrink-0 flex-col items-center gap-2 overflow-y-auto overflow-x-visible bg-surface-2 py-3 lg:overflow-visible lg:bg-surface"
      data-dragging={dragging ? 'true' : undefined}
    >
      <HomeTile active={!inSpaces && !inDiscover} />
      {unreadDms.map((c) => (
        <UnreadDmTile key={c.id} chat={c} />
      ))}
      <div className="mx-auto h-0.5 w-8 shrink-0 rounded-full bg-line-strong" aria-hidden />
      <DndContext
        sensors={sensors}
        collisionDetection={collision}
        accessibility={dndAccessibility}
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
        onDragCancel={resetDrag}
      >
        {items.map((item) =>
          item.kind === 'space' ? (
            <SpaceTile
              key={item.space.id}
              space={item.space}
              active={item.space.id === activeSpaceId}
              folderId={null}
              line={lineFor(item.space.id)}
              combine={drop?.kind === 'combine' && drop.spaceId === item.space.id}
              onMove={moveBy}
            />
          ) : (
            <FolderItem
              key={item.folder.id}
              item={item}
              activeSpaceId={activeSpaceId}
              open={!!openFolders[item.folder.id]}
              drop={drop}
              onMove={moveBy}
              onEdit={setEditing}
            />
          ),
        )}
        <CreateTile line={drop?.kind === 'end'} onClick={() => setCreating(true)} />
        <DragOverlay dropAnimation={null}>{dragging ? <RailDragPreview data={dragging} /> : null}</DragOverlay>
      </DndContext>
      <NavLink
        to="/discover"
        className={cn(ACTION, inDiscover && 'rounded-2xl! bg-success! text-on-brand!')}
        aria-label="Explore Spaces"
        aria-current={inDiscover ? 'page' : undefined}
        data-testid="rail-discover"
      >
        <Pill active={inDiscover} />
        <Compass size={24} aria-hidden />
        <span role="tooltip" className={TIP}>
          Explore Spaces
        </span>
      </NavLink>
      <CreateSpaceDialog open={creating} onClose={closeCreate} />
      {/* Onboarding and the welcome screen of the Space that opens. */}
      <CommunityGate />
      {editing && editingItem?.kind === 'folder' ? (
        <FolderSettingsDialog
          folder={editingItem.folder}
          spaces={editingItem.spaces}
          onSave={(patch) => commit((layout) => updateRailFolder(layout, editing.id, patch))}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </nav>
  );
}
