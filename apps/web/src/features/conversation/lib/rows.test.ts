import { describe, expect, it } from 'vitest';
import { makeMessage } from '@/test/factories';
import type { ClientMessage } from '@/stores/messages';
import { buildRows, nextExpiry, reuseRows, rowKey, shiftFirstIndex, visibleMessages } from './rows';

const at = (d: number, h: number, m = 0) => new Date(2025, 2, d, h, m).toISOString(); // local time → stable day boundaries

function msg(p: Partial<ClientMessage>): ClientMessage {
  return makeMessage(p) as ClientMessage;
}

describe('buildRows', () => {
  const items = [
    msg({ id: 'a', seq: 1, senderId: 'bob', createdAt: at(10, 9, 0) }),
    msg({ id: 'b', seq: 2, senderId: 'bob', createdAt: at(10, 9, 2) }),
    msg({ id: 'c', seq: 3, senderId: 'me', createdAt: at(10, 9, 3) }),
    msg({ id: 'd', seq: 4, senderId: 'bob', createdAt: at(11, 8, 0) }),
    msg({ id: 'e', seq: 5, senderId: 'bob', createdAt: at(11, 8, 20) }),
    msg({ id: 'f', seq: 6, senderId: null, type: 'system', createdAt: at(11, 8, 21) }),
    msg({ id: 'g', seq: 7, senderId: 'bob', createdAt: at(11, 8, 22) }),
  ];

  it('adds day separators and groups consecutive messages of a sender', () => {
    const rows = buildRows(items, { meId: 'me' });
    expect(rows.map((r) => r.showDay)).toEqual([true, false, false, true, false, false, false]);
    expect(rows.map((r) => r.firstInGroup)).toEqual([true, false, true, true, true, true, true]);
    expect(rows.map((r) => r.lastInGroup)).toEqual([false, true, true, true, true, true, true]);
    expect(rows.map((r) => r.mine)).toEqual([false, false, true, false, false, false, false]);
  });

  it('places the unread divider before the first unread message from others', () => {
    const rows = buildRows(items, { meId: 'me', unreadAfterSeq: 2, unreadCount: 3 });
    // seq 3 is mine → skipped; seq 4 is the first unread from bob.
    expect(rows.map((r) => r.unreadDivider)).toEqual([0, 0, 0, 3, 0, 0, 0]);
    expect(rows[3]!.firstInGroup).toBe(true);
  });

  it('omits the first day separator while older pages are not loaded', () => {
    const rows = buildRows(items.slice(3), { meId: 'me', hasMoreBefore: true });
    expect(rows[0]!.showDay).toBe(false);
    expect(buildRows(items.slice(3), { meId: 'me' })[0]!.showDay).toBe(true);
  });

  it('keys optimistic and confirmed messages identically (by clientId)', () => {
    expect(rowKey({ id: 'local:x', clientId: 'x' })).toBe(rowKey({ id: 'srv-1', clientId: 'x' }));
    expect(rowKey({ id: 'srv-2', clientId: null })).toBe('srv-2');
  });
});

describe('reuseRows', () => {
  it('keeps unchanged row objects and returns prev when nothing changed', () => {
    const items = [msg({ id: 'a', seq: 1 }), msg({ id: 'b', seq: 2 })];
    const first = buildRows(items, { meId: 'me' });
    expect(reuseRows(first, buildRows(items, { meId: 'me' }))).toBe(first);
    const changed = [items[0]!, { ...items[1]!, text: 'edited' }];
    const next = reuseRows(first, buildRows(changed, { meId: 'me' }));
    expect(next).not.toBe(first);
    expect(next[0]).toBe(first[0]);
    expect(next[1]).not.toBe(first[1]);
  });
});

describe('shiftFirstIndex', () => {
  it('keeps absolute positions when items are prepended', () => {
    expect(shiftFirstIndex(['c', 'd', 'e'], 1000, ['a', 'b', 'c', 'd', 'e'])).toBe(998);
  });
  it('is stable for appends and tolerates removed first rows', () => {
    expect(shiftFirstIndex(['c', 'd'], 1000, ['c', 'd', 'e'])).toBe(1000);
    expect(shiftFirstIndex(['c', 'd', 'e'], 1000, ['d', 'e'])).toBe(1001);
  });
  it('signals a replaced window', () => {
    expect(shiftFirstIndex(['a', 'b'], 1000, ['x', 'y'])).toBeNull();
    expect(shiftFirstIndex([], 1000, ['x'])).toBeNull();
  });
});

describe('disappearing messages', () => {
  it('hides expired messages and finds the next expiry', () => {
    const now = Date.parse('2025-03-12T10:00:00.000Z');
    const items = [
      msg({ id: 'a', expiresAt: '2025-03-12T09:59:00.000Z' }),
      msg({ id: 'b', expiresAt: '2025-03-12T10:05:00.000Z' }),
      msg({ id: 'c', expiresAt: null }),
    ];
    expect(visibleMessages(items, now).map((m) => m.id)).toEqual(['b', 'c']);
    expect(nextExpiry(items, now)).toBe(Date.parse('2025-03-12T10:05:00.000Z'));
    const fresh = [items[1]!, items[2]!];
    expect(visibleMessages(fresh, now)).toBe(fresh);
  });
});
