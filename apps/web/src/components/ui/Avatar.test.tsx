import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { REDUCED_MOTION_QUERY } from '@/hooks/useMediaQuery';
import { DEFAULT_PREFS, useUi } from '@/stores/ui';
import { Avatar } from './Avatar';

const POSTER = '/uploads/ada.jpg';
const GIF = '/uploads/ada.gif';

// The hook keeps one MediaQueryList per query, so the OS setting is a live getter.
let osReduceMotion = false;

beforeEach(() => {
  osReduceMotion = false;
  useUi.setState({ prefs: DEFAULT_PREFS });
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

function animated(extra: Partial<Parameters<typeof Avatar>[0]> = {}) {
  const view = render(<Avatar src={POSTER} animatedSrc={GIF} name="Ada Lovelace" {...extra} />);
  const root = view.container.firstElementChild as HTMLElement;
  const img = () => root.querySelector('img')!;
  return { root, img };
}

describe('Avatar (animated)', () => {
  it('shows the poster by default and the animation while hovered', () => {
    const { root, img } = animated();
    expect(img()).toHaveAttribute('src', POSTER);
    expect(root).toHaveAttribute('data-animated', 'poster');
    fireEvent.pointerEnter(root);
    expect(img()).toHaveAttribute('src', GIF);
    expect(root).toHaveAttribute('data-animated', 'playing');
    fireEvent.pointerLeave(root);
    expect(img()).toHaveAttribute('src', POSTER);
  });

  it('follows the hover of an ancestor marked data-animate-avatars', () => {
    render(
      <div data-animate-avatars data-testid="row">
        <span>
          <Avatar src={POSTER} animatedSrc={GIF} name="Ada" />
        </span>
      </div>,
    );
    const row = screen.getByTestId('row');
    const img = () => row.querySelector('img')!;
    expect(img()).toHaveAttribute('src', POSTER);
    fireEvent.pointerEnter(row);
    expect(img()).toHaveAttribute('src', GIF);
    fireEvent.pointerLeave(row);
    expect(img()).toHaveAttribute('src', POSTER);
  });

  it("'always' plays without hover and 'never' never plays", () => {
    const always = animated({ animate: 'always' });
    expect(always.img()).toHaveAttribute('src', GIF);
    const never = animated({ animate: 'never' });
    fireEvent.pointerEnter(never.root);
    expect(never.img()).toHaveAttribute('src', POSTER);
  });

  it('never animates under reduced motion (OS media query or the device pref)', () => {
    osReduceMotion = true;
    const os = animated({ animate: 'always' });
    expect(os.img()).toHaveAttribute('src', POSTER);
    fireEvent.pointerEnter(os.root);
    expect(os.img()).toHaveAttribute('src', POSTER);
    osReduceMotion = false;
    useUi.getState().setPref('reduceMotion', 'on');
    const pref = animated({ animate: 'always' });
    expect(pref.img()).toHaveAttribute('src', POSTER);
  });

  it('honours the autoplayAnimatedMedia device pref', () => {
    useUi.getState().setPref('autoplayAnimatedMedia', 'never');
    const { root, img } = animated();
    fireEvent.pointerEnter(root);
    expect(img()).toHaveAttribute('src', POSTER);
    fireEvent.pointerLeave(root);
    // 'always' plays even the default 'hover' avatars without a hover.
    act(() => useUi.getState().setPref('autoplayAnimatedMedia', 'always'));
    expect(img()).toHaveAttribute('src', GIF);
  });

  it('shows the poster while the app is hidden or unfocused', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    const { img } = animated({ animate: 'always' });
    expect(img()).toHaveAttribute('src', POSTER);
  });

  it('falls back to the poster when the animation fails to load', () => {
    const { root, img } = animated({ animate: 'always' });
    expect(img()).toHaveAttribute('src', GIF);
    fireEvent.error(img());
    expect(img()).toHaveAttribute('src', POSTER);
    expect(root).toHaveAttribute('data-animated', 'poster');
  });

  it('only an avatar with an animation follows the window focus (static ones add no listener)', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const types = () => add.mock.calls.map(([type]) => type);
    const still = render(<Avatar src={POSTER} name="Ada" />);
    expect(types()).not.toContain('focus');
    expect(still.container.firstElementChild).not.toHaveAttribute('data-animated');
    animated();
    expect(types()).toContain('focus');
  });
});

describe('Avatar (presence)', () => {
  it('renders the presence glyphs with their labels', () => {
    const { rerender, container } = render(
      <Avatar name="Ada" presence="online" decorative={false} />,
    );
    expect(screen.getByRole('img', { name: 'Online' })).toHaveAttribute('data-presence', 'online');
    rerender(<Avatar name="Ada" presence="idle" decorative={false} />);
    expect(screen.getByRole('img', { name: 'Idle' })).toHaveAttribute('data-presence', 'idle');
    rerender(<Avatar name="Ada" presence="dnd" decorative={false} />);
    expect(screen.getByRole('img', { name: 'Do not disturb' })).toHaveAttribute(
      'data-presence',
      'dnd',
    );
    rerender(<Avatar name="Ada" presence="offline" decorative={false} />);
    expect(container.querySelector('[data-presence]')).toBeNull();
    rerender(<Avatar name="Ada" presence={null} online decorative={false} />);
    expect(container.querySelector('[data-presence]')).toBeNull();
  });

  it('keeps the legacy online dot', () => {
    const { container } = render(<Avatar name="Ada" online decorative={false} />);
    expect(screen.getByRole('img', { name: 'Online' })).toBeInTheDocument();
    expect(container.querySelector('[data-presence="online"]')).not.toBeNull();
  });

  it('hides the badge from assistive tech when decorative', () => {
    const { container } = render(<Avatar name="Ada" presence="dnd" />);
    const badge = container.querySelector('[data-presence="dnd"]')!;
    expect(badge).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('img')).toBeNull();
  });
});
