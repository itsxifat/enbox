import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { REDUCED_MOTION_QUERY } from '@/hooks/useMediaQuery';
import { DEFAULT_PREFS, useUi } from '@/stores/ui';
import { ProfileEffect } from './ProfileEffect';

let osReduceMotion = false;
let frames: FrameRequestCallback[] = [];
let ctxCalls: string[] = [];

function fakeContext(): CanvasRenderingContext2D {
  const props: Record<string, unknown> = {};
  return new Proxy(props, {
    get(target, key: string) {
      if (key in target) return target[key];
      if (key.startsWith('create')) return () => ({ addColorStop: () => undefined });
      return () => {
        ctxCalls.push(key);
      };
    },
    set(target, key: string, value) {
      target[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

beforeEach(() => {
  osReduceMotion = false;
  frames = [];
  ctxCalls = [];
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
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => fakeContext() as unknown as ReturnType<HTMLCanvasElement['getContext']>,
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 300,
    height: 400,
    top: 0,
    left: 0,
    right: 300,
    bottom: 400,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Run queued frames at 16 ms steps. */
function tick(n: number, start = { now: 0 }) {
  for (let i = 0; i < n && frames.length; i++) {
    const cb = frames.shift()!;
    start.now += 16;
    act(() => cb(start.now));
  }
}

const canvas = (c: HTMLElement) => c.querySelector('canvas')!;

describe('ProfileEffect', () => {
  it('renders nothing for an unknown or missing id', () => {
    expect(render(<ProfileEffect id="nope" />).container.innerHTML).toBe('');
    expect(render(<ProfileEffect id={null} />).container.innerHTML).toBe('');
  });

  it('is a decorative overlay over the card', () => {
    const el = canvas(render(<ProfileEffect id="sparkles" className="rounded-xl" />).container);
    expect(el).toHaveAttribute('aria-hidden', 'true');
    expect(el).toHaveClass('pointer-events-none', 'absolute', 'inset-0', 'rounded-xl');
    expect(el).toHaveAttribute('data-effect', 'sparkles');
  });

  it("'once' plays for a few seconds, then rests on a still frame", () => {
    const { container } = render(<ProfileEffect id="confetti" />);
    expect(canvas(container)).toHaveAttribute('data-mode', 'once');
    // Device pixels: 300 × 400 CSS px at devicePixelRatio 1.
    expect(canvas(container).width).toBe(300);
    expect(frames.length).toBe(1);
    tick(1000);
    expect(frames.length).toBe(0);
  });

  it('a new replay key plays it again; the same one stays still', () => {
    const { rerender } = render(<ProfileEffect id="hearts" replayKey={1} />);
    tick(1000);
    expect(frames.length).toBe(0);
    rerender(<ProfileEffect id="hearts" replayKey={1} />);
    expect(frames.length).toBe(0);
    rerender(<ProfileEffect id="hearts" replayKey={2} />);
    expect(frames.length).toBe(1);
  });

  it("'loop' keeps going until unmounted", () => {
    const cancel = vi.fn();
    vi.stubGlobal('cancelAnimationFrame', cancel);
    const { container, unmount } = render(<ProfileEffect id="snowfall" play="loop" />);
    expect(canvas(container)).toHaveAttribute('data-mode', 'loop');
    tick(500);
    expect(frames.length).toBe(1);
    unmount();
    expect(cancel).toHaveBeenCalled();
  });

  it("'still' draws one frame and no loop", () => {
    const { container } = render(<ProfileEffect id="aurora" play="still" />);
    expect(canvas(container)).toHaveAttribute('data-mode', 'still');
    expect(frames.length).toBe(0);
    expect(ctxCalls).toContain('clearRect');
  });

  it('reduced motion and "animated media: never" draw the still frame', () => {
    osReduceMotion = true;
    const a = render(<ProfileEffect id="embers" play="loop" />);
    expect(canvas(a.container)).toHaveAttribute('data-mode', 'still');
    expect(frames.length).toBe(0);
    a.unmount();
    osReduceMotion = false;
    useUi.getState().setPref('autoplayAnimatedMedia', 'never');
    const b = render(<ProfileEffect id="embers" play="loop" />);
    expect(canvas(b.container)).toHaveAttribute('data-mode', 'still');
    expect(frames.length).toBe(0);
  });

  it('stops while the app is hidden and resumes when it is back', () => {
    const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    const { container } = render(<ProfileEffect id="rain" play="loop" />);
    expect(canvas(container)).toHaveAttribute('data-mode', 'still');
    expect(frames.length).toBe(0);
    focus.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(canvas(container)).toHaveAttribute('data-mode', 'loop');
    expect(frames.length).toBe(1);
  });
});
