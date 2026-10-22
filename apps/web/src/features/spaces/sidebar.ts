/**
 * Channel sidebar logic (pure, unit-tested): grouping by category, what a collapsed category
 * or "Hide Muted Channels" leaves visible, the position changes of a channel or category drag,
 * mute helpers shared by the Space, channel and category menus, and the notification override
 * rows of the Notification Settings dialog.
 */
import {
  MUTE_FOREVER_ISO,
  isMuted,
  type ChatSummary,
  type ID,
  type NotifyLevel,
  type Space,
  type SpaceCategory,
} from '@enbox/shared';

export interface ChannelGroup {
  /** null: the uncategorised channels at the top. */
  category: SpaceCategory | null;
  channels: ChatSummary[];
}

/** Channels by category in sidebar order (uncategorised first, then category position). */
export function groupsOf(space: Pick<Space, 'categories'>, channels: readonly ChatSummary[]): ChannelGroup[] {
  const out: ChannelGroup[] = [{ category: null, channels: [] }];
  const byCat = new Map<ID, ChannelGroup>();
  for (const c of [...space.categories].sort((a, b) => a.position - b.position)) {
    const g: ChannelGroup = { category: c, channels: [] };
    byCat.set(c.id, g);
    out.push(g);
  }
  for (const ch of channels) {
    const g = ch.space?.categoryId ? byCat.get(ch.space.categoryId) : undefined;
    (g ?? out[0]!).channels.push(ch);
  }
  return out;
}

export function isChannelUnread(c: ChatSummary, now = new Date()): boolean {
  return c.type === 'space_text' && c.lastSeq > c.lastReadSeq && !isMuted(c.mutedUntil, now);
}

export function isChannelMuted(c: Pick<ChatSummary, 'mutedUntil'>, now = new Date()): boolean {
  return isMuted(c.mutedUntil, now);
}

export interface SidebarFilter {
  /** Category ids collapsed on this device. */
  collapsed: Record<ID, boolean>;
  /** `space.me.hideMutedChannels`. */
  hideMuted: boolean;
  /** The open channel stays visible whatever the filters say. */
  activeId?: ID | null;
  now?: Date;
}

/**
 * What the sidebar lists of one group. Collapsed (Discord): only the open channel and unread
 * ones. Hide muted: muted channels go, except the open one and those with unread mentions.
 */
export function shownChannels(group: ChannelGroup, f: SidebarFilter): ChatSummary[] {
  const now = f.now ?? new Date();
  const collapsed = group.category ? !!f.collapsed[group.category.id] : false;
  return group.channels.filter((c) => {
    if (c.id === f.activeId) return true;
    if (f.hideMuted && isChannelMuted(c, now) && c.unreadMentionCount === 0) return false;
    if (collapsed) return isChannelUnread(c, now) || c.unreadMentionCount > 0;
    return true;
  });
}

/**
 * The groups to render, with their visible channels. The uncategorised group shows only with
 * channels; a category shows when it is empty (so it can be filled) or something in it is
 * visible — with Hide Muted Channels, a category whose channels are all muted disappears.
 */
export function visibleGroups(
  groups: readonly ChannelGroup[],
  f: SidebarFilter,
): { group: ChannelGroup; shown: ChatSummary[] }[] {
  const out: { group: ChannelGroup; shown: ChatSummary[] }[] = [];
  for (const group of groups) {
    const shown = shownChannels(group, f);
    if (!group.category) {
      if (shown.length) out.push({ group, shown });
      continue;
    }
    const hiddenByMute =
      f.hideMuted &&
      group.channels.length > 0 &&
      shownChannels(group, { ...f, collapsed: {} }).length === 0;
    if (!hiddenByMute) out.push({ group, shown });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Drag reorder (channels and categories)
// ---------------------------------------------------------------------------

/** Where a dragged channel lands: next to a channel, or at the start / end of a category (null: none). */
export type ChannelDrop =
  | { kind: 'before' | 'after'; channelId: ID }
  | { kind: 'start' | 'end'; categoryId: ID | null };

/** One item of `PATCH /api/spaces/:id/channels/positions`. */
export interface ChannelPositionItem {
  id: ID;
  categoryId: ID | null;
  position: number;
  /** Moving a synced channel into another category syncs it there (Discord). */
  syncPermissions?: boolean;
}

/** Text-like channels always list before voice ones in a category; positions count per kind. */
const sortClass = (c: Pick<ChatSummary, 'type'>) => (c.type === 'space_voice' ? 1 : 0);

/**
 * The position changes of dropping channel `dragId` at `drop` (Discord's channel drag): it
 * joins the target category, where the channels of its kind are numbered 0…n in their new
 * order. Only the channels whose category or position change are returned (one PATCH); a
 * drop that changes nothing returns [].
 */
export function channelMoveItems(groups: readonly ChannelGroup[], dragId: ID, drop: ChannelDrop): ChannelPositionItem[] {
  const from = groups.find((g) => g.channels.some((c) => c.id === dragId));
  const dragged = from?.channels.find((c) => c.id === dragId);
  if (!from || !dragged?.space) return [];
  const edge = 'categoryId' in drop ? drop : null;
  const next = 'channelId' in drop ? drop : null;
  const to = edge
    ? groups.find((g) => (g.category?.id ?? null) === edge.categoryId)
    : next && next.channelId !== dragId
      ? groups.find((g) => g.channels.some((c) => c.id === next.channelId))
      : undefined;
  if (!to) return [];
  const rest = to.channels.filter((c) => c.id !== dragId);
  const at = edge
    ? edge.kind === 'start'
      ? 0
      : rest.length
    : rest.findIndex((c) => c.id === next!.channelId) + (next!.kind === 'after' ? 1 : 0);
  const klass = sortClass(dragged);
  // Dropped among the other kind's channels: the nearest end of its own kind's run.
  const index = rest.slice(0, at).filter((c) => sortClass(c) === klass).length;
  const list = rest.filter((c) => sortClass(c) === klass);
  list.splice(index, 0, dragged);
  const categoryId = to.category?.id ?? null;
  const moved = from !== to;
  const items: ChannelPositionItem[] = [];
  list.forEach((c, position) => {
    if ((c.space?.categoryId ?? null) === categoryId && c.space?.position === position) return;
    const item: ChannelPositionItem = { id: c.id, categoryId, position };
    if (c.id === dragId && moved && categoryId && dragged.space!.permissionsSynced) item.syncPermissions = true;
    items.push(item);
  });
  return items;
}

/** Where a dragged category lands: before or after another one. */
export interface CategoryDrop {
  kind: 'before' | 'after';
  categoryId: ID;
}

/** The position changes of a category drag (categories numbered 0…n in their new order). */
export function categoryMoveItems(
  categories: readonly SpaceCategory[],
  dragId: ID,
  drop: CategoryDrop,
): { id: ID; position: number }[] {
  if (drop.categoryId === dragId) return [];
  const sorted = [...categories].sort((a, b) => a.position - b.position);
  const dragged = sorted.find((c) => c.id === dragId);
  const rest = sorted.filter((c) => c.id !== dragId);
  const i = rest.findIndex((c) => c.id === drop.categoryId);
  if (!dragged || i < 0) return [];
  rest.splice(drop.kind === 'after' ? i + 1 : i, 0, dragged);
  return rest.flatMap((c, position) => (c.position === position ? [] : [{ id: c.id, position }]));
}

/** Every channel of the category is muted (and it has some). */
export function isCategoryMuted(channels: readonly ChatSummary[], now = new Date()): boolean {
  return channels.length > 0 && channels.every((c) => isChannelMuted(c, now));
}

/** `mutedUntil` for one of SPACE_MUTE_DURATIONS (0 = until I turn it back on). */
export function muteUntilIso(ms: number, now = Date.now()): string {
  return ms > 0 ? new Date(now + ms).toISOString() : MUTE_FOREVER_ISO;
}

/** "Muted until 3:45 PM" style line under Unmute items (null when not muted). */
export function mutedUntilText(mutedUntil: string | null | undefined, now = new Date()): string | null {
  if (!isMuted(mutedUntil, now)) return null;
  if (mutedUntil === MUTE_FOREVER_ISO || Date.parse(mutedUntil!) - now.getTime() > 365 * 86_400_000)
    return 'Muted until you turn it back on';
  const until = new Date(mutedUntil!);
  const sameDay = until.toDateString() === now.toDateString();
  const time = until.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `Muted until ${sameDay ? time : `${until.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`}`;
}

export const NOTIFY_LABELS: Record<NotifyLevel, string> = {
  all: 'All Messages',
  mentions: 'Only @mentions',
  none: 'Nothing',
};

// ---------------------------------------------------------------------------
// Notification overrides (Notification Settings dialog)
// ---------------------------------------------------------------------------

export interface OverrideRow {
  kind: 'channel' | 'category';
  id: ID;
  name: string;
  /** The channels the row's settings apply to (a category: all of its channels). */
  channels: ChatSummary[];
  /** null = follow the Space setting. */
  level: NotifyLevel | null;
  muted: boolean;
}

export function hasOverride(c: ChatSummary, now = new Date()): boolean {
  return c.notifyLevel !== null || isChannelMuted(c, now);
}

/**
 * The override list: a category whose channels all share one non-default setting shows as
 * one row (Discord stores category overrides; Enbox stores them per channel), the other
 * overridden channels each as a row. `added` rows (picked in the dialog, nothing set yet)
 * follow, so a newly added channel or category can be configured.
 */
export function overrideRows(
  space: Pick<Space, 'categories'>,
  channels: readonly ChatSummary[],
  added: readonly { kind: 'channel' | 'category'; id: ID }[] = [],
  now = new Date(),
): OverrideRow[] {
  const out: OverrideRow[] = [];
  const covered = new Set<ID>();
  const groups = groupsOf(space, channels);
  const keyOf = (c: ChatSummary) => `${c.notifyLevel ?? '-'}:${isChannelMuted(c, now)}`;
  for (const g of groups) {
    if (g.category && g.channels.length > 0 && g.channels.every(hasOverrideAt(now))) {
      const first = g.channels[0]!;
      if (g.channels.every((c) => keyOf(c) === keyOf(first))) {
        out.push({
          kind: 'category',
          id: g.category.id,
          name: g.category.name,
          channels: g.channels,
          level: first.notifyLevel,
          muted: isChannelMuted(first, now),
        });
        for (const c of g.channels) covered.add(c.id);
        continue;
      }
    }
    for (const c of g.channels)
      if (hasOverride(c, now)) {
        out.push(channelRow(c, now));
        covered.add(c.id);
      }
  }
  for (const a of added) {
    if (out.some((r) => r.kind === a.kind && r.id === a.id)) continue;
    if (a.kind === 'channel') {
      const c = channels.find((x) => x.id === a.id);
      if (c && !covered.has(c.id)) out.push(channelRow(c, now));
    } else {
      const g = groups.find((x) => x.category?.id === a.id);
      if (!g?.category) continue;
      const first = g.channels[0];
      const same = !!first && g.channels.every((c) => keyOf(c) === keyOf(first));
      for (const c of g.channels) covered.add(c.id);
      out.push({
        kind: 'category',
        id: g.category.id,
        name: g.category.name,
        channels: g.channels,
        level: same ? first.notifyLevel : null,
        muted: isCategoryMuted(g.channels, now),
      });
    }
  }
  return out;
}

const hasOverrideAt = (now: Date) => (c: ChatSummary) => hasOverride(c, now);

function channelRow(c: ChatSummary, now: Date): OverrideRow {
  return {
    kind: 'channel',
    id: c.id,
    name: c.name ?? 'channel',
    channels: [c],
    level: c.notifyLevel,
    muted: isChannelMuted(c, now),
  };
}
