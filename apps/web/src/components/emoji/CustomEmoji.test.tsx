/** Custom emoji images: alt `:name:`, sizes, known vs unknown sources, animated on hover / by pref, fallback text. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { SpaceEmoji } from '@enbox/shared';
import { REDUCED_MOTION_QUERY } from '@/hooks/useMediaQuery';
import { useEmojis } from '@/stores/emojis';
import { DEFAULT_PREFS, useUi } from '@/stores/ui';
import { CustomEmoji, EmojiGlyph } from './CustomEmoji';

const ID = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const KNOWN: SpaceEmoji = { id: ID, spaceId: 's1', name: 'blob', url: '/uploads/2026/10/blob.png', animated: false, createdBy: 'u1' };

let osReduceMotion = false;

beforeEach(() => {
  osReduceMotion = false;
  useUi.setState({ prefs: DEFAULT_PREFS });
  useEmojis.setState({ groups: null, bySpace: {}, byId: {}, stale: false });
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        get matches() {
          return query === REDUCED_MOTION_QUERY && osReduceMotion;
        },
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }) as MediaQueryList,
  );
});

describe('CustomEmoji', () => {
  it('renders an unknown emoji through the public redirect with alt :name: at the size asked', () => {
    render(<CustomEmoji id={ID} name="blob" size={48} />);
    const img = screen.getByRole('img', { name: ':blob:' });
    expect(img.getAttribute('src')).toMatch(new RegExp(`/api/emojis/${ID}$`));
    expect(img).toHaveAttribute('title', ':blob:');
    expect(img).toHaveAttribute('width', '48');
    expect(img).toHaveAttribute('height', '48');
  });

  it('uses the file of an emoji of my Spaces directly, and keeps the token’s name', () => {
    useEmojis.setState({ byId: { [ID]: { ...KNOWN, name: 'renamed' } } });
    render(<CustomEmoji id={ID} name="blob" />);
    const img = screen.getByRole('img', { name: ':blob:' });
    expect(img.getAttribute('src')).toMatch(/\/uploads\/2026\/10\/blob\.png$/);
    expect(img).toHaveAttribute('width', '22');
  });

  it('falls back to :name: text when the image fails (a deleted emoji)', () => {
    render(<CustomEmoji id={ID} name="gone" />);
    fireEvent.error(screen.getByRole('img', { name: ':gone:' }));
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText(':gone:')).toBeInTheDocument();
  });

  it('animated: the still by default, the animation while the row is hovered', () => {
    render(
      <div data-animate-avatars data-testid="row">
        <CustomEmoji id={ID} name="party" animated />
      </div>,
    );
    const img = () => screen.getByRole('img', { name: ':party:' });
    expect(img().getAttribute('src')).toMatch(/\?static=1$/);
    expect(img()).toHaveAttribute('data-animated', 'still');
    fireEvent.pointerEnter(screen.getByTestId('row'));
    expect(img().getAttribute('src')).toMatch(new RegExp(`/api/emojis/${ID}$`));
    expect(img()).toHaveAttribute('data-animated', 'playing');
    fireEvent.pointerLeave(screen.getByTestId('row'));
    expect(img()).toHaveAttribute('data-animated', 'still');
  });

  it('animated: plays always with the "always" pref, never with reduced motion or "never"', () => {
    useUi.setState({ prefs: { ...DEFAULT_PREFS, autoplayAnimatedMedia: 'always' } });
    const view = render(<CustomEmoji id={ID} name="party" animated />);
    expect(screen.getByRole('img')).toHaveAttribute('data-animated', 'playing');
    act(() => useUi.setState({ prefs: { ...DEFAULT_PREFS, autoplayAnimatedMedia: 'always', reduceMotion: 'on' } }));
    expect(screen.getByRole('img')).toHaveAttribute('data-animated', 'still');
    act(() => useUi.setState({ prefs: { ...DEFAULT_PREFS, autoplayAnimatedMedia: 'never' } }));
    fireEvent.pointerEnter(screen.getByRole('img'));
    expect(screen.getByRole('img')).toHaveAttribute('data-animated', 'still');
    view.unmount();
  });

  it('animated: "Play animated emoji" off keeps the still, on "always" and while hovered too', () => {
    useUi.setState({ prefs: { ...DEFAULT_PREFS, autoplayAnimatedMedia: 'always', animateEmoji: false } });
    render(
      <div data-animate-avatars data-testid="row">
        <CustomEmoji id={ID} name="party" animated />
      </div>,
    );
    expect(screen.getByRole('img')).toHaveAttribute('data-animated', 'still');
    fireEvent.pointerEnter(screen.getByTestId('row'));
    expect(screen.getByRole('img')).toHaveAttribute('data-animated', 'still');
    act(() => useUi.getState().setPref('animateEmoji', true));
    expect(screen.getByRole('img')).toHaveAttribute('data-animated', 'playing');
  });

  it('EmojiGlyph renders tokens as images and unicode as text', () => {
    render(
      <>
        <EmojiGlyph emoji={`<:blob:${ID}>`} />
        <EmojiGlyph emoji="🎉" />
      </>,
    );
    expect(screen.getByRole('img', { name: ':blob:' })).toHaveAttribute('width', '16');
    expect(screen.getByText('🎉')).toBeInTheDocument();
  });
});
