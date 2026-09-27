/**
 * Conversation rows: one row per message with the decorations rendered above/around it
 * (day separator, "N unread messages" divider, bubble grouping). Pure (unit-tested).
 */

/** Consecutive messages of one sender within this window form a visual group. */
export const GROUP_WINDOW_MS = 5 * 60 * 1000;

export function rowKey(m) {
  return m.clientId ? `c:${m.clientId}` : m.id;
}

function groupable(m) {
  return m.type !== 'system' && m.type !== 'call';
}

/**
 * Parsed times per message object. Rows are rebuilt on every window change (upload
 * progress, reactions…) while message objects are only replaced when they change, so each
 * message is parsed once.
 */
const timeMeta = new WeakMap();

function timesOf(m) {
  let v = timeMeta.get(m);
  if (!v) {
    const t = Date.parse(m.createdAt);
    v = { t, day: new Date(t).setHours(0, 0, 0, 0) };
    timeMeta.set(m, v);
  }
  return v;
}

function sameGroup(a, b) {
  if (!groupable(a) || !groupable(b)) return false;
  if (a.senderId !== b.senderId) return false;
  const gap = timesOf(b).t - timesOf(a).t;
  return gap >= 0 && gap <= GROUP_WINDOW_MS;
}

export function buildRows(items, opts) {
  const { meId, unreadAfterSeq, unreadCount = 0, hasMoreBefore = false } = opts;
  let dividerAt = -1;
  if (unreadAfterSeq != null && unreadCount > 0) {
    dividerAt = items.findIndex(
      (m) => m.seq > unreadAfterSeq && m.senderId !== meId && m.type !== 'system',
    );
  }
  const rows = new Array(items.length);
  for (let i = 0; i < items.length; i++) {
    const m = items[i];
    const prev = i > 0 ? items[i - 1] : null;
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
    if (i > 0 && !rows[i].firstInGroup) rows[i - 1].lastInGroup = false;
  }
  return rows;
}

function sameRow(a, b) {
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
export function reuseRows(prev, next) {
  if (!prev.length) return next;
  const byKey = new Map(prev.map((r) => [r.key, r]));
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
export function rowKeys(rows, prev) {
  if (prev.length === rows.length && rows.every((r, i) => r.key === prev[i])) return prev;
  return rows.map((r) => r.key);
}

/**
 * Virtuoso `firstItemIndex` after the data changed: find the first previously-first rows
 * still present and shift so they keep their absolute index (prepends keep the scroll
 * position). Returns null when the window was replaced (nothing in common) → remount.
 */
export function shiftFirstIndex(prevKeys, prevFirst, nextKeys) {
  if (!prevKeys.length || !nextKeys.length) return null;
  const pos = new Map();
  nextKeys.forEach((k, i) => pos.set(k, i));
  const limit = Math.min(prevKeys.length, 200);
  for (let i = 0; i < limit; i++) {
    const j = pos.get(prevKeys[i]);
    if (j !== undefined) return prevFirst + i - j;
  }
  return null;
}

/** Hide messages whose disappearing timer passed (the server purges them shortly after). */
export function visibleMessages(items, now) {
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
export function nextExpiry(items, now) {
  let min = null;
  for (const m of items) {
    if (!m.expiresAt) continue;
    const t = Date.parse(m.expiresAt);
    if (t > now && (min === null || t < min)) min = t;
  }
  return min;
}
