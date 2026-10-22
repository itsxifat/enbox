import { describe, expect, it } from 'vitest';
import { MUTE_FOREVER_ISO, type ChatSummary, type NotifyLevel, type SpaceCategory } from '@enbox/shared';
import { makeChat } from '@/test/factories';
import { spaceMemory } from './actions';
import {
  groupsOf,
  isCategoryMuted,
  muteUntilIso,
  mutedUntilText,
  overrideRows,
  shownChannels,
  visibleGroups,
} from './sidebar';

const NOW = new Date('2026-10-22T12:00:00.000Z');
const LATER = '2026-10-22T13:00:00.000Z';
const EARLIER = '2026-10-22T11:00:00.000Z';

const cat = (id: string, position: number): SpaceCategory => ({ id, name: id.toUpperCase(), position, overwrites: [] });

function channel(
  id: string,
  categoryId: string | null,
  p: { muted?: boolean; unread?: boolean; mentions?: number; level?: NotifyLevel | null; mutedUntil?: string } = {},
): ChatSummary {
  return makeChat({
    id,
    name: id,
    type: 'space_text',
    lastSeq: p.unread ? 5 : 2,
    lastReadSeq: 2,
    unreadMentionCount: p.mentions ?? 0,
    mutedUntil: p.mutedUntil ?? (p.muted ? MUTE_FOREVER_ISO : null),
    notifyLevel: p.level ?? null,
    space: {
      spaceId: 's1',
      categoryId,
      position: 0,
      topic: null,
      slowmodeSeconds: 0,
      nsfw: false,
      userLimit: null,
      bitrate: null,
      permissionsSynced: true,
      overwrites: [],
    },
  });
}

const space = { categories: [cat('b', 1), cat('a', 0), cat('empty', 2)] };

describe('groupsOf', () => {
  it('puts uncategorised channels first, then categories by position', () => {
    const groups = groupsOf(space, [channel('x', 'b'), channel('top', null), channel('y', 'a')]);
    expect(groups.map((g) => [g.category?.id ?? null, g.channels.map((c) => c.id)])).toEqual([
      [null, ['top']],
      ['a', ['y']],
      ['b', ['x']],
      ['empty', []],
    ]);
  });
});

describe('sidebar filters', () => {
  const chans = [
    channel('read', 'a'),
    channel('unread', 'a', { unread: true }),
    channel('muted', 'a', { muted: true, unread: true }),
    channel('muted-mention', 'a', { muted: true, mentions: 2 }),
    channel('open-muted', 'a', { muted: true }),
  ];
  const [, a] = groupsOf(space, chans);

  it('collapsed: only unread channels, mentions and the open one', () => {
    const shown = shownChannels(a!, { collapsed: { a: true }, hideMuted: false, activeId: 'read', now: NOW });
    expect(shown.map((c) => c.id)).toEqual(['read', 'unread', 'muted-mention']);
  });

  it('hide muted channels: muted ones go unless open or mentioning me', () => {
    const shown = shownChannels(a!, { collapsed: {}, hideMuted: true, activeId: 'open-muted', now: NOW });
    expect(shown.map((c) => c.id)).toEqual(['read', 'unread', 'muted-mention', 'open-muted']);
    const off = shownChannels(a!, { collapsed: {}, hideMuted: false, now: NOW });
    expect(off).toHaveLength(chans.length);
  });

  it('an expired mute counts as unmuted', () => {
    const [, g] = groupsOf(space, [channel('was-muted', 'a', { mutedUntil: EARLIER })]);
    expect(shownChannels(g!, { collapsed: {}, hideMuted: true, now: NOW }).map((c) => c.id)).toEqual(['was-muted']);
  });

  it('visibleGroups: a category whose channels are all muted disappears; empty ones stay', () => {
    const groups = groupsOf(space, [channel('m1', 'b', { muted: true }), channel('m2', 'b', { mutedUntil: LATER }), channel('ok', 'a')]);
    const ids = (hideMuted: boolean) =>
      visibleGroups(groups, { collapsed: {}, hideMuted, now: NOW }).map((g) => g.group.category?.id ?? null);
    expect(ids(true)).toEqual(['a', 'empty']);
    expect(ids(false)).toEqual(['a', 'b', 'empty']);
    // A collapsed category still shows its header.
    expect(visibleGroups(groups, { collapsed: { a: true }, hideMuted: false, now: NOW }).map((g) => [g.group.category?.id, g.shown.length])).toEqual([
      ['a', 0],
      ['b', 2],
      ['empty', 0],
    ]);
  });

  it('isCategoryMuted: every channel muted, and at least one', () => {
    expect(isCategoryMuted([channel('m', 'a', { muted: true })], NOW)).toBe(true);
    expect(isCategoryMuted([channel('m', 'a', { muted: true }), channel('n', 'a')], NOW)).toBe(false);
    expect(isCategoryMuted([], NOW)).toBe(false);
  });
});

describe('mute helpers', () => {
  it('muteUntilIso: a duration from now, 0 = until I turn it back on', () => {
    expect(muteUntilIso(3_600_000, NOW.getTime())).toBe(LATER);
    expect(muteUntilIso(0, NOW.getTime())).toBe(MUTE_FOREVER_ISO);
  });

  it('mutedUntilText: null when not muted, forever wording for the forever mute', () => {
    expect(mutedUntilText(null, NOW)).toBeNull();
    expect(mutedUntilText(EARLIER, NOW)).toBeNull();
    expect(mutedUntilText(MUTE_FOREVER_ISO, NOW)).toBe('Muted until you turn it back on');
    expect(mutedUntilText(LATER, NOW)).toMatch(/^Muted until /);
  });
});

describe('notification overrides', () => {
  it('a category whose channels share one override is one row; mixed ones list their channels', () => {
    const chans = [
      channel('a1', 'a', { level: 'none' }),
      channel('a2', 'a', { level: 'none' }),
      channel('b1', 'b', { level: 'all' }),
      channel('b2', 'b'),
      channel('top', null, { muted: true }),
    ];
    const rows = overrideRows(space, chans, [], NOW);
    expect(rows.map((r) => [r.kind, r.id, r.level, r.muted])).toEqual([
      ['channel', 'top', null, true],
      ['category', 'a', 'none', false],
      ['channel', 'b1', 'all', false],
    ]);
    expect(rows[1]!.channels.map((c) => c.id)).toEqual(['a1', 'a2']);
  });

  it('added rows (nothing set yet) follow, without duplicates or channels a category covers', () => {
    const chans = [channel('a1', 'a', { level: 'all' }), channel('b1', 'b'), channel('b2', 'b')];
    const rows = overrideRows(
      space,
      chans,
      [
        { kind: 'channel', id: 'a1' },
        { kind: 'category', id: 'b' },
        { kind: 'channel', id: 'b1' },
      ],
      NOW,
    );
    expect(rows.map((r) => [r.kind, r.id, r.level])).toEqual([
      ['category', 'a', 'all'],
      ['category', 'b', null],
    ]);
  });
});

describe('collapsed categories persist per device', () => {
  it('stores collapse and collapse-all in localStorage', () => {
    expect(spaceMemory.collapsed()).toEqual({});
    spaceMemory.setCollapsed('c1', true);
    expect(spaceMemory.collapsed()).toEqual({ c1: true });
    expect(spaceMemory.setCollapsedMany(['c2', 'c3'], true)).toEqual({ c1: true, c2: true, c3: true });
    spaceMemory.setCollapsed('c1', false);
    expect(spaceMemory.collapsed()).toEqual({ c2: true, c3: true });
    expect(JSON.parse(localStorage.getItem('enbox.spaces.collapsed')!)).toEqual({ c2: true, c3: true });
  });
});
