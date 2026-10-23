/**
 * The emoji popout: a click on an emoji in a message shows it large with its `:name:`; a
 * custom one says which Space it is from (Open Space when I'm in it, else "a Space you're not
 * in"); unicode ones their name only. Emoji in previews (`inline`) and links stay plain.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { SpaceEmoji } from '@enbox/shared';
import { makeSpace } from '@/features/spaces/testUtils';
import { bus } from '@/lib/bus';
import { resetSessionState } from '@/lib/session';
import { useEmojis } from '@/stores/emojis';
import { useSpaces } from '@/stores/spaces';
import { RichText } from '../RichText';
import { splitEmoji, unifiedOf } from './unicodeEmoji';

vi.mock('emoji-picker-react', () => ({
  emojiByUnified: (u: string) =>
    ({
      '1f44d': { n: ['+1', 'thumbs up'], u: '1f44d' },
      '2764-fe0f': { n: ['love', 'red heart'], u: '2764-fe0f' },
    })[u],
}));

const ID = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const BLOB: SpaceEmoji = { id: ID, spaceId: 's1', name: 'blob', url: '/uploads/blob.png', animated: false, createdBy: 'u1' };

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetSessionState();
  useEmojis.setState({ groups: null, bySpace: {}, byId: {}, stale: false });
});

describe('splitEmoji', () => {
  it('cuts out emoji, sequences and flags; text stays text', () => {
    expect(splitEmoji('hi 👍🏽 ok')).toEqual(['hi ', { emoji: '👍🏽' }, ' ok']);
    expect(splitEmoji('👨‍👩‍👧 🇺🇦 1️⃣ ❤️')).toEqual([
      { emoji: '👨‍👩‍👧' },
      ' ',
      { emoji: '🇺🇦' },
      ' ',
      { emoji: '1️⃣' },
      ' ',
      { emoji: '❤️' },
    ]);
    expect(splitEmoji('plain © ™ 2 * 3')).toEqual(['plain © ™ 2 * 3']);
    expect(unifiedOf('👍🏽')).toBe('1f44d-1f3fd');
  });
});

describe('the popout', () => {
  it('a custom emoji of one of my Spaces: its name, the Space, Open Space', () => {
    useSpaces.setState({ byId: { s1: makeSpace({ id: 's1', name: 'Climbers' }) } });
    useEmojis.setState({
      groups: [{ spaceId: 's1', spaceName: 'Climbers', iconUrl: null, emojis: [BLOB] }],
      byId: { [ID]: BLOB },
    });
    const emit = vi.spyOn(bus, 'emit');
    render(<RichText text={`nice <:blob:${ID}>`} />);
    fireEvent.click(screen.getByRole('button', { name: ':blob:' }));
    const popout = screen.getByTestId('emoji-popout');
    expect(within(popout).getByText(':blob:')).toBeInTheDocument();
    expect(within(popout).getByText('This emoji is from')).toBeInTheDocument();
    expect(within(popout).getByText('Climbers')).toBeInTheDocument();
    fireEvent.click(within(popout).getByRole('button', { name: 'Open Space' }));
    expect(emit).toHaveBeenCalledWith('navigate', { to: '/spaces/s1' });
    expect(screen.queryByTestId('emoji-popout')).toBeNull();
  });

  it('a custom emoji of a Space I am not in says so', () => {
    useEmojis.setState({ groups: [], byId: {} });
    render(<RichText text={`<:blob:${ID}>`} jumbo />);
    fireEvent.click(screen.getByRole('button', { name: ':blob:' }));
    expect(screen.getByText('This emoji is from a Space you’re not in.')).toBeInTheDocument();
  });

  it('a unicode emoji shows its name', async () => {
    render(<RichText text="great 👍" />);
    fireEvent.click(screen.getByRole('button', { name: '👍' }));
    expect(await within(screen.getByTestId('emoji-popout')).findByText(':thumbs_up:')).toBeInTheDocument();
  });

  it('emoji in previews and links are not buttons', () => {
    render(<RichText text={`👍 <:blob:${ID}>`} inline />);
    expect(screen.queryByRole('button')).toBeNull();
    render(<RichText text="[go 👍](https://example.com)" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
