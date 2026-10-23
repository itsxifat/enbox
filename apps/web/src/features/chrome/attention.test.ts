/** Tab title and badge counts: from the stores' counters to "(N) Enbox | …", "• Enbox", N. */
import { describe, expect, it } from 'vitest';
import type { ChatSummary, Space } from '@enbox/shared';
import { makeSpace } from '@/features/spaces/testUtils';
import { makeChat, makeUser } from '@/test/factories';
import { badgeLabel, computeAttention, documentTitle, placeTitle } from './attention';

const FOREVER = '9999-12-31T23:59:59.000Z';

function byId<T extends { id: string }>(...xs: T[]): Record<string, T> {
  return Object.fromEntries(xs.map((x) => [x.id, x]));
}

function spaceChannel(id: string, spaceId: string, p: Partial<ChatSummary> = {}): ChatSummary {
  return makeChat({
    id,
    type: 'space_text',
    name: id,
    space: {
      spaceId,
      categoryId: null,
      position: 0,
      topic: null,
      slowmodeSeconds: 0,
      nsfw: false,
      userLimit: null,
      bitrate: null,
      permissionsSynced: true,
      overwrites: [],
    },
    ...p,
  });
}

describe('computeAttention', () => {
  it('counts every unread DM message, group mentions only, and a dot for other unreads', () => {
    const chats = byId(
      makeChat({ id: 'dm', type: 'direct', unreadCount: 3, unreadMentionCount: 0 }),
      makeChat({ id: 'g1', type: 'group', unreadCount: 7, unreadMentionCount: 2 }),
      makeChat({ id: 'g2', type: 'group', unreadCount: 4 }),
    );
    expect(computeAttention(chats, {}, {})).toEqual({ mentions: 5, unread: true });
    // Only non-mention unreads left: no count, the dot.
    expect(computeAttention(byId(makeChat({ id: 'g2', unreadCount: 4 })), {}, {})).toEqual({
      mentions: 0,
      unread: true,
    });
    // Marked unread counts as unread; nothing at all is nothing.
    expect(computeAttention(byId(makeChat({ markedUnread: true })), {}, {}).unread).toBe(true);
    expect(computeAttention({}, {}, {})).toEqual({ mentions: 0, unread: false });
  });

  it('a group DM counts like a DM', () => {
    const chats = byId(makeChat({ id: 'gdm', type: 'group', isGroupDm: true, unreadCount: 2 }));
    expect(computeAttention(chats, {}, {}).mentions).toBe(2);
  });

  it('muted and archived chats and broadcast channels do not count', () => {
    const chats = byId(
      makeChat({ id: 'm', type: 'direct', unreadCount: 3, mutedUntil: FOREVER }),
      makeChat({ id: 'a', type: 'group', unreadCount: 2, unreadMentionCount: 2, isArchived: true }),
      makeChat({ id: 'c', type: 'channel', unreadCount: 9 }),
    );
    expect(computeAttention(chats, {}, {})).toEqual({ mentions: 0, unread: false });
    // A mute that ended counts again.
    const ended = byId(
      makeChat({ type: 'direct', unreadCount: 1, mutedUntil: '2000-01-01T00:00:00.000Z' }),
    );
    expect(computeAttention(ended, {}, {}).mentions).toBe(1);
  });

  it('Spaces: loaded channels, else the server aggregate; muted Spaces and channels are left out', () => {
    const spaces: Record<string, Space> = byId(
      makeSpace({ id: 'loaded' }),
      makeSpace({ id: 'remote', unread: true, unreadMentionCount: 4 }),
      makeSpace({ id: 'muted', unread: true, unreadMentionCount: 6, me: { mutedUntil: FOREVER } }),
    );
    const chats = byId(
      spaceChannel('general', 'loaded', { lastSeq: 5, lastReadSeq: 3, unreadMentionCount: 1 }),
      spaceChannel('quiet', 'loaded', {
        lastSeq: 9,
        lastReadSeq: 0,
        unreadMentionCount: 2,
        mutedUntil: FOREVER,
      }),
    );
    expect(computeAttention(chats, spaces, { loaded: true })).toEqual({
      mentions: 5,
      unread: true,
    });
    // Read everywhere (the remote Space's aggregate too): nothing.
    const read = byId(spaceChannel('general', 'loaded', { lastSeq: 5, lastReadSeq: 5 }));
    expect(computeAttention(read, byId(makeSpace({ id: 'loaded' })), { loaded: true })).toEqual({
      mentions: 0,
      unread: false,
    });
  });
});

describe('the title', () => {
  const space = makeSpace({ id: 's1', name: 'Gaming' });

  it('names the place: #channel | Space, @friend, a group', () => {
    expect(placeTitle(spaceChannel('general', 's1'), space)).toBe('#general | Gaming');
    expect(
      placeTitle(
        makeChat({ type: 'direct', name: null, peer: makeUser({ displayName: 'Alice' }) }),
        undefined,
      ),
    ).toBe('@Alice');
    expect(placeTitle(makeChat({ type: 'group', name: 'Book club' }), undefined)).toBe('Book club');
    expect(placeTitle(undefined, space)).toBe('Gaming');
    expect(placeTitle(undefined, undefined)).toBeNull();
  });

  it('an unnamed group DM reads its members’ names (no @, never "Untitled")', () => {
    const gdm = makeChat({ type: 'group', isGroupDm: true, name: null });
    expect(placeTitle(gdm, undefined, 'Alice, Bob')).toBe('Alice, Bob');
    expect(placeTitle(makeChat({ type: 'group', isGroupDm: true, name: 'Trip' }), undefined)).toBe(
      'Trip',
    );
  });

  it('prefixes (N) for mentions, • for other unreads', () => {
    expect(documentTitle({ mentions: 3, unread: true }, '#general | Gaming')).toBe(
      '(3) Enbox | #general | Gaming',
    );
    expect(documentTitle({ mentions: 0, unread: true }, '@Alice')).toBe('• Enbox | @Alice');
    expect(documentTitle({ mentions: 0, unread: false }, null)).toBe('Enbox');
  });

  it('the favicon badge reads 1–9, then 9+', () => {
    expect(badgeLabel(0)).toBe('');
    expect(badgeLabel(1)).toBe('1');
    expect(badgeLabel(9)).toBe('9');
    expect(badgeLabel(10)).toBe('9+');
  });
});
