/**
 * Browse Channels in the sidebar (pure `shownChannels` / `visibleGroups` with my choices,
 * opt-in defaults and Show All Channels), the batched saves of my choices, guide progress and
 * answer normalisation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelPref, ChatSummary, OnboardingPrompt, SpaceCategory } from '@enbox/shared';
import { api } from '@/lib/api';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useSpaces } from '@/stores/spaces';
import { makeMe } from '@/test/factories';
import { groupsOf, shownChannels, visibleGroups } from '@/features/spaces/sidebar';
import {
  PREFS_BATCH_MS,
  flushChannelPrefs,
  guideProgress,
  normalizeAnswers,
  receiveChannelPrefs,
  setChannelsShown,
} from './actions';
import { seedSpace, spaceChannel } from './testUtils';

const cat = (id: string, position: number): SpaceCategory => ({
  id,
  name: id.toUpperCase(),
  position,
  overwrites: [],
});
const ch = (
  id: string,
  categoryId: string | null,
  p: { optIn?: boolean; mentions?: number } = {},
): ChatSummary =>
  spaceChannel(id, id, { unreadMentionCount: p.mentions ?? 0 }, { categoryId, optIn: p.optIn });

describe('sidebar: Browse Channels choices', () => {
  const space = { categories: [cat('a', 0), cat('b', 1), cat('empty', 2)] };
  const chans = [
    ch('general', 'a'),
    ch('clubs', 'a', { optIn: true }),
    ch('memes', 'a', { optIn: true, mentions: 3 }),
    ch('lfg', 'b', { optIn: true }),
    ch('top', null),
  ];
  const groups = groupsOf(space, chans);
  const ids = (prefs: ChannelPref[] = [], extra: { showAll?: boolean; activeId?: string } = {}) =>
    groups.map((g) =>
      shownChannels(g, { collapsed: {}, hideMuted: false, prefs, ...extra }).map((c) => c.id),
    );

  it('opt-in channels stay out until I show them; mentions do not bring them back', () => {
    expect(ids()).toEqual([['top'], ['general'], [], []]);
    expect(ids([{ channelId: 'clubs', shown: true }])).toEqual([
      ['top'],
      ['general', 'clubs'],
      [],
      [],
    ]);
  });

  it('I can hide default channels; the open one always shows', () => {
    expect(
      ids([
        { channelId: 'general', shown: false },
        { channelId: 'top', shown: false },
      ]),
    ).toEqual([[], [], [], []]);
    expect(ids([{ channelId: 'general', shown: false }], { activeId: 'general' })).toEqual([
      ['top'],
      ['general'],
      [],
      [],
    ]);
    expect(ids([], { activeId: 'lfg' })).toEqual([['top'], ['general'], ['lfg'], []]);
  });

  it('Show All Channels lists everything whatever I picked', () => {
    expect(ids([{ channelId: 'general', shown: false }], { showAll: true })).toEqual([
      ['top'],
      ['general', 'clubs', 'memes'],
      ['lfg'],
      [],
    ]);
  });

  it('a category whose channels are all hidden goes; empty and collapsed ones stay', () => {
    const cats = (prefs: ChannelPref[], collapsed: Record<string, boolean> = {}) =>
      visibleGroups(groups, { collapsed, hideMuted: false, prefs }).map(
        (g) => g.group.category?.id ?? null,
      );
    // `b` has only an opt-in channel; `empty` has none.
    expect(cats([])).toEqual([null, 'a', 'empty']);
    expect(cats([{ channelId: 'lfg', shown: true }])).toEqual([null, 'a', 'b', 'empty']);
    expect(cats([{ channelId: 'general', shown: false }])).toEqual([null, 'empty']);
    expect(cats([], { a: true })).toEqual([null, 'a', 'empty']);
  });

  it('the other filters still apply to the channels I show', () => {
    const muted = spaceChannel(
      'quiet',
      'quiet',
      { mutedUntil: '9999-01-01T00:00:00.000Z' },
      { categoryId: 'a', optIn: true },
    );
    const [, a] = groupsOf(space, [muted]);
    expect(
      shownChannels(a!, {
        collapsed: {},
        hideMuted: true,
        prefs: [{ channelId: 'quiet', shown: true }],
      }),
    ).toEqual([]);
    expect(
      shownChannels(a!, {
        collapsed: {},
        hideMuted: false,
        prefs: [{ channelId: 'quiet', shown: true }],
      }),
    ).toHaveLength(1);
  });
});

describe('my choices: shown at once, saved in one batch', () => {
  beforeEach(() => {
    resetSessionState();
    vi.useFakeTimers();
    useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
    seedSpace({}, [
      ch('general', null),
      ch('clubs', null, { optIn: true }),
      ch('lfg', null, { optIn: true }),
    ]);
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  const prefs = () => useSpaces.getState().byId.s1!.me.channelPrefs ?? [];
  const sorted = (list: ChannelPref[]) =>
    [...list].sort((a, b) => a.channelId.localeCompare(b.channelId));

  it('patches my Space now, then one PUT of everything changed meanwhile', async () => {
    const put = vi
      .spyOn(api, 'put')
      .mockImplementation(
        async (_p: string, body?: unknown) =>
          (body as { prefs: ChannelPref[] }).prefs.filter(
            (x) => x.channelId !== 'general' || !x.shown,
          ) as never,
      );
    setChannelsShown('s1', { clubs: true });
    setChannelsShown('s1', { general: false, lfg: true });
    setChannelsShown('s1', { lfg: false });
    // A choice equal to the default is no row: lfg is opt-in.
    expect(sorted(prefs())).toEqual([
      { channelId: 'clubs', shown: true },
      { channelId: 'general', shown: false },
    ]);
    expect(put).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(PREFS_BATCH_MS);
    expect(put).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledWith('/api/spaces/s1/channel-prefs', {
      prefs: [
        { channelId: 'clubs', shown: true },
        { channelId: 'general', shown: false },
        { channelId: 'lfg', shown: false },
      ],
    });
  });

  it('a list from the server keeps my unsent choices on top; a refused save goes back', async () => {
    setChannelsShown('s1', { clubs: true });
    // Another device's choices arrive before mine went out.
    receiveChannelPrefs('s1', [{ channelId: 'general', shown: false }]);
    expect(sorted(prefs())).toEqual([
      { channelId: 'clubs', shown: true },
      { channelId: 'general', shown: false },
    ]);
    vi.spyOn(api, 'put').mockRejectedValue(new Error('nope'));
    const get = vi
      .spyOn(api, 'get')
      .mockResolvedValue({
        me: { channelPrefs: [{ channelId: 'general', shown: false }] },
      } as never);
    await flushChannelPrefs('s1');
    expect(get).toHaveBeenCalledWith('/api/spaces/s1/members/me');
    await vi.waitFor(() => expect(prefs()).toEqual([{ channelId: 'general', shown: false }]));
  });
});

describe('guide progress and answers', () => {
  it('counts the to-dos whose channel I visited', () => {
    const guide = { todos: [{ channelId: 'a' }, { channelId: 'b' }, { channelId: 'c' }] } as never;
    expect(guideProgress(guide, ['b', 'x'])).toEqual({ done: 1, total: 3 });
    expect(guideProgress(null, ['b'])).toEqual({ done: 0, total: 0 });
  });

  it('answers keep questions with picks, in their options’ order', () => {
    const prompts: OnboardingPrompt[] = [
      {
        id: 'p1',
        title: 'Q1',
        singleSelect: false,
        required: false,
        options: [
          { id: 'o1', title: 'A', description: null, emoji: null, roleIds: [] },
          { id: 'o2', title: 'B', description: null, emoji: null, roleIds: [] },
        ],
      },
      {
        id: 'p2',
        title: 'Q2',
        singleSelect: true,
        required: false,
        options: [{ id: 'o3', title: 'C', description: null, emoji: null, roleIds: [] }],
      },
    ];
    expect(normalizeAnswers(prompts, { p1: ['o2', 'o1', 'gone'], p2: [], p9: ['o3'] })).toEqual({
      p1: ['o1', 'o2'],
    });
  });
});
