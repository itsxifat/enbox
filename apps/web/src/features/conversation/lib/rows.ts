/**
 * Conversation rows: one row per message with the decorations rendered above/around it
 * (day separator, "N unread messages" divider, bubble grouping). Pure (unit-tested).
 */
import type { ID } from '@enbox/shared';
import type { ClientMessage } from '@/stores/messages';

/** Consecutive messages of one sender within this window form a visual group. */
export const GROUP_WINDOW_MS = 5 * 60 * 1000;

export interface Row {
  /** Stable across optimistic → confirmed replacement (clientId when present). */
  key: string;
  message: ClientMessage;
  mine: boolean;
  /** Day separator above this row. */
  showDay: boolean;
  /** "N unread messages" divider above this row (the count), or 0. */
  unreadDivider: number;
  /** First bubble of a sender group (tail, sender name/avatar). */
  firstInGroup: boolean;
  /** Last bubble of a sender group (bigger bottom gap). */
  lastInGroup: boolean;
}

export interface RowOptions {
  meId: ID | null | undefined;
  /** Show the unread divider before the first message from others with seq > this. */
  unreadAfterSeq?: number | null;
  unreadCount?: number;
  /**
   * Older messages exist before `items[0]` (not loaded yet). The first row then gets no day
   * separator: whether the day changes is unknown, and a separator that vanishes once the
   * older page arrives would shift the content under the reader.
   */
  hasMoreBefore?: boolean;
}

export function rowKey(m: Pick<ClientMessage, 'id' | 'clientId'>): string {
  return m.clientId ? `c:${m.clientId}` : m.id;
}

function groupable(m: ClientMessage): boolean {
  return m.type !== 'system' && m.type !== 'call';
}

interface TimeMeta {
  /** createdAt, ms epoch. */
  t: number;
  /** Local midnight of createdAt (day separators). */
  day: number;
}

/**
 * Parsed times per message object. Rows are rebuilt on every window change (upload
 * progress, reactions…) while message objects are only replaced when they change, so each
 * message is parsed once.
 */
const timeMeta = new WeakMap<ClientMessage, TimeMeta>();

function timesOf(m: ClientMessage): TimeMeta {
  let v = timeMeta.get(m);
  if (!v) {
    const t = Date.parse(m.createdAt);
    v = { t, day: new Date(t).setHours(0, 0, 0, 0) };
    timeMeta.set(m, v);
  }
  return v;
}

function sameGroup(a: ClientMessage, b: ClientMessage): boolean {
  if (!groupable(a) || !groupable(b)) return false;
  if (a.senderId !== b.senderId) return false;
  const gap = timesOf(b).t - timesOf(a).t;
  return gap >= 0 && gap <= GROUP_WINDOW_MS;
}

export function buildRows(items: ClientMessage[], opts: RowOptions): Row[] {
  const { meId, unreadAfterSeq, unreadCount = 0, hasMoreBefore = false } = opts;
  let dividerAt = -1;
  if (unreadAfterSeq != null && unreadCount > 0) {
    dividerAt = items.findIndex(
      (m) => m.seq > unreadAfterSeq && m.senderId !== meId && m.type !== 'system',
    );
  }
  const rows: Row[] = new Array(items.length);
  for (let i = 0; i < items.length; i++) {
    const m = items[i]!;
    const prev = i > 0 ? items[i - 1]! : null;
    const showDay = prev ? timesOf(prev).day !== timesOf(m).day : !hasMoreBefore;
    const divider = i === dividerAt ? unreadCount : 0;
    rows[i] = {
      key: rowKey(m),
      message: m,
      mine: !!meId && m.senderId === meId,
      showDay,
      unreadDivider: divider,
      firstInGroup: !prev || showDay || divider > 0 || !sameGroup(prev, m),
      lastInGroup: true,
    };
    if (i > 0 && !rows[i]!.firstInGroup) rows[i - 1]!.lastInGroup = false;
  }
  return rows;
}

function sameRow(a: Row, b: Row): boolean {
  return (
    a.key === b.key &&
    a.message === b.message &&
    a.mine === b.mine &&
    a.showDay === b.showDay &&
    a.unreadDivider === b.unreadDivider &&
    a.firstInGroup === b.firstInGroup &&
    a.lastInGroup === b.lastInGroup
  );
}

/** Reuse unchanged row objects from `prev` so memoized row components skip re-rendering. */
export function reuseRows(prev: Row[], next: Row[]): Row[] {
  if (!prev.length) return next;
  const byKey = new Map(prev.map((r) => [r.key, r] as const));
  let changed = prev.length !== next.length;
  const out = next.map((r, i) => {
    const old = byKey.get(r.key);
    if (old && sameRow(old, r)) {
      if (prev[i] !== old) changed = true;
      return old;
    }
    changed = true;
    return r;
  });
  return changed ? out : prev;
}

/**
 * The rows' keys — `prev` itself when they are identical, so consumers keyed on the array
 * identity (firstItemIndex bookkeeping) skip work when only row contents changed (upload
 * progress, reactions, edits).
 */
export function rowKeys(rows: readonly Row[], prev: string[]): string[] {
  if (prev.length === rows.length && rows.every((r, i) => r.key === prev[i])) return prev;
  return rows.map((r) => r.key);
}

/**
 * Virtuoso `firstItemIndex` after the data changed: find the first previously-first rows
 * still present and shift so they keep their absolute index (prepends keep the scroll
 * position). Returns null when the window was replaced (nothing in common) → remount.
 */
export function shiftFirstIndex(
  prevKeys: readonly string[],
  prevFirst: number,
  nextKeys: readonly string[],
): number | null {
  if (!prevKeys.length || !nextKeys.length) return null;
  const pos = new Map<string, number>();
  nextKeys.forEach((k, i) => pos.set(k, i));
  const limit = Math.min(prevKeys.length, 200);
  for (let i = 0; i < limit; i++) {
    const j = pos.get(prevKeys[i]!);
    if (j !== undefined) return prevFirst + i - j;
  }
  return null;
}

/** Hide messages whose disappearing timer passed (the server purges them shortly after). */
export function visibleMessages(items: ClientMessage[], now: number): ClientMessage[] {
  let expired = false;
  for (const m of items) {
    if (m.expiresAt && Date.parse(m.expiresAt) <= now) {
      expired = true;
      break;
    }
  }
  return expired ? items.filter((m) => !m.expiresAt || Date.parse(m.expiresAt) > now) : items;
}

/** Earliest future expiry (ms epoch) among messages, for scheduling the next re-filter. */
export function nextExpiry(items: ClientMessage[], now: number): number | null {
  let min: number | null = null;
  for (const m of items) {
    if (!m.expiresAt) continue;
    const t = Date.parse(m.expiresAt);
    if (t > now && (min === null || t < min)) min = t;
  }
  return min;
}
