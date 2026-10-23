import { describe, expect, it } from 'vitest';
import type { InboxMention, SpaceChannelInfo } from '@enbox/shared';
import { makeSpace } from '@/features/spaces/testUtils';
import { DEFAULT_INBOX_FILTERS, mentionsQuery, mentionsQueryKey } from '@/stores/inbox';
import { makeChat, makeMessage } from '@/test/factories';
import { formatInboxTime, groupMentions, inboxMentionCount, mentionPath, spaceIdOfPath, unreadGroups } from './lib';

const info = (spaceId: string): SpaceChannelInfo => ({
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
});

function mention(id: string, chatId: string, extra: Partial<InboxMention['chat']> = {}): InboxMention {
  return {
    message: makeMessage({ id, chatId, seq: 4 }),
    chat: { id: chatId, type: 'space_text', name: 'general', spaceId: 's1', spaceName: 'Rockets', spaceIconUrl: null, parentName: null, ...extra },
  };
}

describe('inboxMentionCount', () => {
  it('sums channel and group mentions, and the server aggregate of Spaces not loaded yet', () => {
    const s1 = makeSpace({ id: 's1', unreadMentionCount: 9 });
    const s2 = makeSpace({ id: 's2', unreadMentionCount: 4 });
    const chats = {
      a: makeChat({ id: 'a', type: 'space_text', space: info('s1'), unreadMentionCount: 2 }),
      t: makeChat({ id: 't', type: 'space_thread', space: info('s1'), unreadMentionCount: 1 }),
      g: makeChat({ id: 'g', type: 'group', unreadMentionCount: 3 }),
      left: makeChat({ id: 'left', type: 'group', membership: 'left', unreadMentionCount: 5 }),
      d: makeChat({ id: 'd', type: 'direct', unreadMentionCount: 7 }),
      // A channel of a Space I left (not in the Spaces store) does not count.
      gone: makeChat({ id: 'gone', type: 'space_text', space: info('s3'), unreadMentionCount: 8 }),
    };
    // s1 loaded: its channels (2 + 1, not the aggregate 9); s2 not loaded: its aggregate (4).
    expect(inboxMentionCount(chats, { s1, s2 }, { s1: true, s3: true })).toBe(2 + 1 + 3 + 4);
    expect(inboxMentionCount({}, {}, {})).toBe(0);
  });
});

describe('unreadGroups', () => {
  const now = new Date('2026-10-23T12:00:00Z');
  it('groups unread, unmuted chats by Space (DMs and groups apart), newest activity first', () => {
    const s1 = makeSpace({ id: 's1', name: 'Rockets' });
    const s2 = makeSpace({ id: 's2', name: 'Quiet', me: { mutedUntil: '2099-01-01T00:00:00.000Z' } });
    const at = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();
    const chats = {
      general: makeChat({ id: 'general', type: 'space_text', space: info('s1'), unreadCount: 2, lastActivityAt: at(10) }),
      memes: makeChat({ id: 'memes', type: 'space_text', space: info('s1'), unreadCount: 1, lastActivityAt: at(1) }),
      read: makeChat({ id: 'read', type: 'space_text', space: info('s1'), unreadCount: 0, lastActivityAt: at(0) }),
      voice: makeChat({ id: 'voice', type: 'space_voice', space: info('s1'), unreadCount: 3, lastActivityAt: at(0) }),
      mutedCh: makeChat({ id: 'mutedCh', type: 'space_text', space: info('s1'), unreadCount: 3, mutedUntil: '2099-01-01T00:00:00.000Z' }),
      quiet: makeChat({ id: 'quiet', type: 'space_text', space: info('s2'), unreadCount: 5, lastActivityAt: at(0) }),
      dm: makeChat({ id: 'dm', type: 'direct', unreadCount: 1, lastActivityAt: at(30) }),
      marked: makeChat({ id: 'marked', type: 'group', markedUnread: true, lastActivityAt: at(40) }),
      archived: makeChat({ id: 'archived', type: 'group', unreadCount: 4, isArchived: true }),
      channel: makeChat({ id: 'channel', type: 'channel', unreadCount: 4 }),
    };
    const groups = unreadGroups(chats, { s1, s2 }, now);
    // A voice channel's text chat counts like a text channel.
    expect(groups.map((g) => [g.key, g.chats.map((c) => c.id)])).toEqual([
      ['s1', ['voice', 'memes', 'general']],
      ['direct', ['dm', 'marked']],
    ]);
    expect(groups[0]!.space?.name).toBe('Rockets');
    expect(groups[1]!.space).toBeNull();
  });
});

describe('groupMentions / mentionPath', () => {
  it('runs of the same chat share a card', () => {
    const groups = groupMentions([mention('1', 'a'), mention('2', 'a'), mention('3', 'b'), mention('4', 'a')]);
    expect(groups.map((g) => [g.chat.id, g.items.map((i) => i.message.id)])).toEqual([
      ['a', ['1', '2']],
      ['b', ['3']],
      ['a', ['4']],
    ]);
  });

  it('jumps into the Space channel or the group at the message', () => {
    expect(mentionPath(mention('m1', 'c1'))).toBe('/spaces/s1/c1?m=4&mid=m1');
    expect(mentionPath(mention('m2', 'g1', { type: 'group', spaceId: null, spaceName: null }))).toBe(
      '/chats/g1?m=4&mid=m2',
    );
  });

  it('knows the Space of the current route', () => {
    expect(spaceIdOfPath('/spaces/s1/c1')).toBe('s1');
    expect(spaceIdOfPath('/spaces/s1')).toBe('s1');
    expect(spaceIdOfPath('/chats/c1')).toBeNull();
  });
});

describe('mentions query', () => {
  it('maps the filters (This Space only needs a Space) and keys them', () => {
    expect(mentionsQuery(DEFAULT_INBOX_FILTERS, 's1')).toEqual({ limit: 25, everyone: true, roles: true });
    const q = mentionsQuery({ everyone: false, roles: true, thisSpace: true }, 's1');
    expect(q).toEqual({ limit: 25, everyone: false, roles: true, spaceId: 's1' });
    expect(mentionsQuery({ everyone: true, roles: true, thisSpace: true }, null)).not.toHaveProperty('spaceId');
    expect(mentionsQueryKey(q)).not.toBe(mentionsQueryKey(mentionsQuery(DEFAULT_INBOX_FILTERS, 's1')));
  });
});

describe('formatInboxTime', () => {
  it('says Today / Yesterday, else the date', () => {
    const now = new Date(2026, 9, 23, 15, 0);
    expect(formatInboxTime(new Date(2026, 9, 23, 9, 5).toISOString(), now)).toMatch(/^Today at /);
    expect(formatInboxTime(new Date(2026, 9, 22, 9, 5).toISOString(), now)).toMatch(/^Yesterday at /);
    expect(formatInboxTime(new Date(2026, 8, 2, 9, 5).toISOString(), now)).not.toMatch(/Today|Yesterday/);
  });
});
