/**
 * Messages of people I blocked (Discord): each run of consecutive ones folds into one
 * "2 blocked messages — Show messages" row, which expands them in place below it. A day
 * separator or the NEW line starts a new run (the fold shows it). `collapseBlocked` is pure
 * (unit-tested); `useBlockedSenders` follows the users store.
 */
import { useMemo } from 'react';
import type { ID } from '@enbox/shared';
import type { ClientMessage } from '@/stores/messages';
import { useUsers } from '@/stores/users';
import type { Row } from '../lib/rows';

export interface BlockedRun {
  /** The key of the run's first message row (what Show / Hide toggles). */
  key: string;
  count: number;
  expanded: boolean;
}

/** A row of the message list: a message, or the fold of a blocked run (`blocked`). */
export type ListRow = Row & { blocked?: BlockedRun };

const folds = new WeakMap<Row, ListRow>();
const opened = new WeakMap<Row, Row>();

/** The fold row of a run starting at `first` (the same object while the run is unchanged). */
function foldOf(first: Row, count: number, expanded: boolean): ListRow {
  const cached = folds.get(first);
  if (cached?.blocked?.count === count && cached.blocked.expanded === expanded) return cached;
  const fold: ListRow = { ...first, key: `blocked:${first.key}`, blocked: { key: first.key, count, expanded } };
  folds.set(first, fold);
  return fold;
}

/** The run's first message under its fold: the fold already shows its day and NEW line. */
function underFold(first: Row): Row {
  if (!first.showDay && !first.unreadDivider) return first;
  let row = opened.get(first);
  if (!row) {
    row = { ...first, showDay: false, unreadDivider: 0 };
    opened.set(first, row);
  }
  return row;
}

/** `rows` with each run of blocked messages folded (`rows` itself when there is none). */
export function collapseBlocked(
  rows: Row[],
  blocked: ReadonlySet<ID>,
  expanded: ReadonlySet<string>,
): ListRow[] {
  if (!blocked.size) return rows;
  const isBlocked = (r: Row) =>
    !r.mine && r.message.type !== 'system' && !!r.message.senderId && blocked.has(r.message.senderId);
  if (!rows.some(isBlocked)) return rows;
  const out: ListRow[] = [];
  for (let i = 0; i < rows.length; ) {
    const first = rows[i]!;
    if (!isBlocked(first)) {
      out.push(first);
      i++;
      continue;
    }
    let end = i + 1;
    while (end < rows.length && isBlocked(rows[end]!) && !rows[end]!.showDay && !rows[end]!.unreadDivider)
      end++;
    const open = expanded.has(first.key);
    out.push(foldOf(first, end - i, open));
    if (open) out.push(underFold(first), ...rows.slice(i + 1, end));
    i = end;
  }
  return out;
}

/** The senders of `items` I blocked (a stable set while it doesn't change). */
export function useBlockedSenders(items: readonly ClientMessage[], me: ID | undefined): ReadonlySet<ID> {
  // A string selector: the list re-renders only when who is blocked changes.
  const ids = useUsers((s) => {
    const seen = new Set<ID>();
    let out = '';
    for (const m of items) {
      const id = m.senderId;
      if (!id || id === me || seen.has(id)) continue;
      seen.add(id);
      if (s.byId[id]?.isBlocked) out += out ? `,${id}` : id;
    }
    return out;
  });
  return useMemo(() => new Set(ids ? ids.split(',') : []), [ids]);
}
