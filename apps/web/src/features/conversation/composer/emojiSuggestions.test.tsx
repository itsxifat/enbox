/**
 * ":name" emoji suggestions: two characters after a colon open them (not times, emoticons or
 * a word's colon); custom emoji of my Spaces first (the chat's Space first, others only with
 * USE_EXTERNAL_EMOJI), then unicode emoji by name and keyword; Enter or Tab inserts the emoji
 * (a custom one as ":name:", sent as its token), Escape hides the list.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { PERM, type SpaceEmoji, type SpaceEmojiGroup } from '@enbox/shared';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useEmojis } from '@/stores/emojis';
import { useMessages } from '@/stores/messages';
import { DEFAULT_PREFS, useUi } from '@/stores/ui';
import { makeChat, makeMe, makeUser } from '@/test/factories';
import { useChatMembersStore } from '../members';
import { Composer } from './Composer';
import {
  activeEmojiQuery,
  buildEmojiIndex,
  matchEmoji,
  usableCustomEmoji,
  type UnicodeEmoji,
} from './emojiSuggestions';

const DATA = vi.hoisted(() => ({
  categories: {},
  emojis: {
    custom: [],
    smileys_people: [
      { n: ['face', 'grin', 'smile', 'grinning face'], u: '1f600' },
      { n: ['eye', 'smile', 'grinning face with smiling eyes'], u: '1f604' },
      { n: ['face', 'smirk', 'smirking face'], u: '1f60f' },
      { n: ['+1', 'up', 'thumbs up'], u: '1f44d' },
    ],
    symbols: [{ n: ['red', 'love', 'heart', 'red heart'], u: '2764-fe0f' }],
  },
}));
vi.mock('emoji-picker-react/dist/data/emojis.json', () => ({ default: DATA }));

const PARTY_ID = '00000000-0000-4000-8000-0000000000e1';
const emoji = (id: string, name: string, spaceId = 's1'): SpaceEmoji => ({
  id,
  spaceId,
  name,
  url: `/media/${name}.png`,
  animated: false,
  createdBy: null,
});
const party = emoji(PARTY_ID, 'party');
const group = (spaceId: string, emojis: SpaceEmoji[]): SpaceEmojiGroup => ({
  spaceId,
  spaceName: spaceId === 's1' ? 'Fun' : 'Other',
  iconUrl: null,
  emojis,
});

const dm = makeChat({
  id: 'dm1',
  type: 'direct',
  peer: makeUser({ id: 'olive', displayName: 'Olive' }),
});

const textarea = () => screen.getByRole('textbox', { name: 'Message' });
const type = (value: string) => fireEvent.change(textarea(), { target: { value } });
const press = (key: string) => fireEvent.keyDown(textarea(), { key });
const options = async () =>
  within(await screen.findByRole('listbox', { name: 'Emoji' }))
    .getAllByRole('option')
    .map((o) => o.textContent);

let send: ReturnType<typeof vi.fn>;

beforeEach(() => {
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
  useUi.setState({ prefs: { ...DEFAULT_PREFS, sounds: false } });
  useChatMembersStore.setState({ byChat: {} });
  useEmojis.setState({ groups: [group('s1', [party])], stale: false });
  send = vi.fn().mockResolvedValue(undefined);
  vi.spyOn(useMessages.getState(), 'sendMessage').mockImplementation(send as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  resetSessionState();
});

describe('emoji suggestion helpers', () => {
  it('a colon and two name characters at the caret open them', () => {
    expect(activeEmojiQuery(':sm', 3)).toEqual({ start: 0, query: 'sm' });
    expect(activeEmojiQuery('hi :smi', 7)).toEqual({ start: 3, query: 'smi' });
    expect(activeEmojiQuery('(:+1', 4)).toEqual({ start: 1, query: '+1' });
    for (const text of [':s', '10:30', ':)', 'a:sm', ':smile:', '::'])
      expect(activeEmojiQuery(text, text.length)).toBeNull();
  });

  const unicode: UnicodeEmoji[] = buildEmojiIndex(DATA);

  it('indexes the data: the emoji, a shortcode-like name and the keywords', () => {
    expect(unicode.map((u) => [u.emoji, u.name])).toEqual([
      ['😀', 'grinning_face'],
      ['😄', 'grinning_face_with_smiling_eyes'],
      ['😏', 'smirking_face'],
      ['👍', 'thumbs_up'],
      ['❤️', 'red_heart'],
    ]);
    expect(unicode[3]!.words).toContain('+1');
  });

  it('ranks custom emoji first, then name prefixes, keywords and later words', () => {
    const mine = [{ emoji: emoji('e2', 'smile_wave'), spaceName: 'Fun' }];
    expect(matchEmoji('smi', unicode, mine).map((s) => s.name)).toEqual([
      'smile_wave',
      'smirking_face',
      'grinning_face',
      'grinning_face_with_smiling_eyes',
    ]);
    expect(matchEmoji('+1', unicode).map((s) => s.emoji)).toEqual(['👍']);
    expect(matchEmoji('thumbs_up', unicode).map((s) => s.emoji)).toEqual(['👍']);
    expect(matchEmoji('heart', unicode).map((s) => s.emoji)).toEqual(['❤️']);
    expect(matchEmoji('zz', unicode)).toEqual([]);
    expect(matchEmoji('smi', unicode, [], 2)).toHaveLength(2);
  });

  it('custom emoji: the chat’s Space first; other Spaces only with USE_EXTERNAL_EMOJI; all in DMs', () => {
    const groups = [group('s2', [emoji('e3', 'other')]), group('s1', [party])];
    const inSpace = (perms: number) =>
      usableCustomEmoji(groups, {
        space: { spaceId: 's1' } as never,
        spacePermissions: perms,
      }).map((c) => c.emoji.name);
    expect(inSpace(PERM.USE_EXTERNAL_EMOJI)).toEqual(['party', 'other']);
    expect(inSpace(0)).toEqual(['party']);
    expect(
      usableCustomEmoji(groups, { space: null, spacePermissions: null }).map((c) => c.emoji.name),
    ).toEqual(['other', 'party']);
    expect(usableCustomEmoji(null, { space: null, spacePermissions: null })).toEqual([]);
  });
});

describe('":" in the composer', () => {
  it('lists matching emoji; Enter inserts the emoji', async () => {
    render(<Composer chat={dm} />);
    type('hi :smi');
    expect(await options()).toEqual([
      '😏:smirking_face:',
      '😀:grinning_face:',
      '😄:grinning_face_with_smiling_eyes:',
    ]);
    expect(screen.getByText(':smi')).toBeInTheDocument(); // "Emoji matching :smi"
    press('ArrowDown');
    press('Enter');
    expect(textarea()).toHaveValue('hi 😀 ');
    expect(screen.queryByRole('listbox', { name: 'Emoji' })).toBeNull();
    expect(send).not.toHaveBeenCalled();
    press('Enter');
    expect((send.mock.calls[0]![1] as { text: string }).text).toBe('hi 😀');
  });

  it('a custom emoji goes in as ":name:" and is sent as its token (Tab picks)', async () => {
    render(<Composer chat={dm} />);
    type(':par');
    expect(await options()).toEqual([':party:Fun']);
    press('Tab');
    expect(textarea()).toHaveValue(':party: ');
    press('Enter');
    expect((send.mock.calls[0]![1] as { text: string }).text).toBe(`<:party:${PARTY_ID}>`);
  });

  it('Escape hides the list', async () => {
    render(<Composer chat={dm} />);
    type(':heart');
    expect(await options()).toEqual(['❤️:red_heart:']);
    press('Escape');
    expect(screen.queryByRole('listbox', { name: 'Emoji' })).toBeNull();
    press('Enter');
    expect((send.mock.calls[0]![1] as { text: string }).text).toBe(':heart');
  });
});
