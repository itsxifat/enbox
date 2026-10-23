/** The NEW line: right after my read position, above my own message too (Mark Unread on it). */
import { describe, expect, it } from 'vitest';
import type { ClientMessage } from '@/stores/messages';
import { makeMessage } from '@/test/factories';
import { buildRows } from './lib/rows';
import { withUnreadDivider } from './MessageList';

const at = (m: number) => new Date(2026, 9, 23, 10, m).toISOString();
const msg = (p: Partial<ClientMessage>) => makeMessage(p) as ClientMessage;

// bob, bob, me, me (grouped), bob — all within the grouping window.
const items = [
  msg({ id: 'a', seq: 1, senderId: 'bob', createdAt: at(0) }),
  msg({ id: 'b', seq: 2, senderId: 'bob', createdAt: at(1) }),
  msg({ id: 'c', seq: 3, senderId: 'me', createdAt: at(2) }),
  msg({ id: 'd', seq: 4, senderId: 'me', createdAt: at(3) }),
  msg({ id: 'e', seq: 5, senderId: 'bob', createdAt: at(4) }),
];
const rows = () => buildRows(items, { meId: 'me' });

describe('withUnreadDivider', () => {
  it('Mark Unread on my own message puts the NEW line above it', () => {
    // The server moved my read position to just before message d (mine); one unread after it.
    const out = withUnreadDivider(rows(), { afterSeq: 3, count: 1 });
    expect(out.map((r) => r.unreadDivider)).toEqual([0, 0, 0, 1, 0]);
    // The line splits my group: d starts a new one, c ends the one above.
    expect(out[3]!.firstInGroup).toBe(true);
    expect(out[2]!.lastInGroup).toBe(true);
  });

  it('above the first unread message from someone else as before', () => {
    const out = withUnreadDivider(rows(), { afterSeq: 4, count: 1 });
    expect(out.map((r) => r.unreadDivider)).toEqual([0, 0, 0, 0, 1]);
    expect(out[4]!.firstInGroup).toBe(true);
  });

  it('skips system messages; no snapshot or nothing past it: no line', () => {
    const withSystem = [
      ...items.slice(0, 2),
      msg({ id: 's', seq: 3, type: 'system', senderId: null, createdAt: at(2) }),
      items[3]!,
    ];
    const out = withUnreadDivider(buildRows(withSystem, { meId: 'me' }), { afterSeq: 2, count: 1 });
    expect(out.map((r) => r.unreadDivider)).toEqual([0, 0, 0, 1]);
    const base = rows();
    expect(withUnreadDivider(base, null)).toBe(base);
    expect(withUnreadDivider(base, { afterSeq: 5, count: 1 })).toBe(base);
    expect(withUnreadDivider(base, { afterSeq: 1, count: 0 })).toBe(base);
  });
});
