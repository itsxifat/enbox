import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { Avatar } from '@/components/ui/Avatar';
import { REDUCED_MOTION_QUERY } from '@/hooks/useMediaQuery';
import { DEFAULT_PREFS, initTheme, useUi } from '@/stores/ui';
import { AvatarDecoration, preloadDecorationArt } from './AvatarDecoration';
import { Nameplate } from './Nameplate';

let osReduceMotion = false;
let css = '';

beforeAll(() => preloadDecorationArt());

beforeAll(async () => {
  // CSS imports are stubbed under test (`css: false`): read the stylesheet itself.
  const [fs, url] = ['node:fs', 'node:url'];
  const { readFileSync } = (await import(/* @vite-ignore */ fs)) as {
    readFileSync(path: string, encoding: 'utf8'): string;
  };
  const { fileURLToPath } = (await import(/* @vite-ignore */ url)) as {
    fileURLToPath(href: string): string;
  };
  // (Not `new URL(…, import.meta.url)`: Vite rewrites that into an asset URL.)
  css = readFileSync(fileURLToPath(import.meta.url.replace(/[^/]+$/, 'cosmetics.css')), 'utf8');
});

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

const play = (container: HTMLElement) => container.querySelector('.cos-art')?.getAttribute('data-play');

describe('AvatarDecoration animate modes', () => {
  it("defaults to 'hover': CSS plays it while the row is hovered", () => {
    const { container } = render(<AvatarDecoration id="halo" size={40} />);
    expect(play(container)).toBe('hover');
    // The hover rule lives in the stylesheet, so a list row costs no listener.
    expect(css).toContain("[data-animate-avatars]:hover .cos-art[data-play='hover'] .cos-anim");
    expect(css).toContain(":hover > .cos-art[data-play='hover'] .cos-anim");
  });

  it("'always' plays and 'never' stays on the poster", () => {
    expect(play(render(<AvatarDecoration id="halo" size={40} animate="always" />).container)).toBe('always');
    expect(play(render(<AvatarDecoration id="halo" size={40} animate="never" />).container)).toBe('never');
  });

  it('freezes under reduced motion (OS or device pref)', () => {
    osReduceMotion = true;
    const { container, unmount } = render(<AvatarDecoration id="halo" size={40} animate="always" />);
    expect(play(container)).toBe('never');
    unmount();
    osReduceMotion = false;
    useUi.getState().setPref('reduceMotion', 'on');
    expect(play(render(<AvatarDecoration id="halo" size={40} animate="always" />).container)).toBe('never');
    // The CSS freezes hover playback the same way.
    expect(css).toMatch(/html\[data-reduce-motion='on'\] \.cos-anim[\s\S]*?animation: none !important/);
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]*?\.cos-anim \{\s*animation: none !important/);
  });

  it('freezes while the app is hidden, and plays again when it is back', () => {
    const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    const { container } = render(<AvatarDecoration id="halo" size={40} animate="always" />);
    expect(play(container)).toBe('never');
    focus.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(play(container)).toBe('always');
  });

  it('follows "Animated photos and GIFs: Never"', () => {
    useUi.getState().setPref('autoplayAnimatedMedia', 'never');
    expect(play(render(<AvatarDecoration id="halo" size={40} animate="always" />).container)).toBe('never');
    // …and the list rows' CSS reads the same pref from <html>.
    initTheme();
    expect(document.documentElement.dataset.autoplayMedia).toBe('never');
    act(() => useUi.getState().setPref('autoplayAnimatedMedia', 'always'));
    expect(document.documentElement.dataset.autoplayMedia).toBe('always');
  });

  it('draws at 1.2x the avatar, with simpler art on small avatars', () => {
    const small = render(<AvatarDecoration id="starfield" size={24} />).container.querySelector('svg')!;
    const big = render(<AvatarDecoration id="starfield" size={96} />).container.querySelector('svg')!;
    expect(small).toHaveAttribute('width', '29');
    expect(big).toHaveAttribute('width', '115');
    expect(small.querySelectorAll('path, circle').length).toBeLessThan(big.querySelectorAll('path, circle').length);
  });
});

describe('Avatar decoration', () => {
  it('draws the decoration inside the avatar root, under the presence badge', () => {
    const { container } = render(<Avatar name="Ada" size="md" decoration="crown" presence="online" />);
    const root = container.firstElementChild!;
    const deco = root.querySelector('svg[data-decoration="crown"]')!;
    expect(deco).not.toBeNull();
    expect(deco.parentElement).toBe(root);
    // The badge comes after it, so it paints on top.
    expect(deco.compareDocumentPosition(root.querySelector('[data-presence]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('passes the animate mode on (animated avatars too)', () => {
    const { container } = render(
      <Avatar name="Ada" src="/a.png" animatedSrc="/a.gif" decoration="wings" animate="always" />,
    );
    expect(play(container)).toBe('always');
    expect(render(<Avatar name="Ada" decoration="wings" animate="never" />).container.querySelector('.cos-art')).toHaveAttribute(
      'data-play',
      'never',
    );
  });

  it('has none without a decoration', () => {
    expect(render(<Avatar name="Ada" />).container.querySelector('.cos-art')).toBeNull();
  });
});

describe('Nameplate animate modes', () => {
  it("animates on row hover by default, 'always' honours reduced motion", () => {
    expect(play(render(<Nameplate id="galaxy" />).container)).toBe('hover');
    expect(play(render(<Nameplate id="galaxy" animate="always" />).container)).toBe('always');
    expect(play(render(<Nameplate id="galaxy" animate="never" />).container)).toBe('never');
    useUi.getState().setPref('reduceMotion', 'on');
    expect(play(render(<Nameplate id="galaxy" animate="always" />).container)).toBe('never');
  });
});
