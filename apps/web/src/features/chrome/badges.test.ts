/** The favicon's red badge (drawn on a canvas, restored at 0) and the app badge. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAppBadge, setFaviconBadge } from './badges';

function fakeCanvas() {
  const ctx = {
    drawImage: vi.fn(),
    measureText: vi.fn(() => ({ width: 20 })),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    fillText: vi.fn(),
    font: '',
    fillStyle: '',
    textAlign: '',
    textBaseline: '',
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    ctx as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,badge');
  return ctx;
}

/** jsdom doesn't load images: this one "loads" as soon as it gets a src. */
class LoadingImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_v: string) {
    queueMicrotask(() => this.onload?.());
  }
}

let link: HTMLLinkElement;

beforeEach(() => {
  link = document.createElement('link');
  link.rel = 'icon';
  link.type = 'image/svg+xml';
  link.setAttribute('href', '/icons/icon.svg');
  document.head.appendChild(link);
  vi.stubGlobal('Image', LoadingImage);
});

afterEach(() => {
  setFaviconBadge('');
  link.remove();
});

describe('favicon badge', () => {
  it('draws the count on the icon, then puts the original back at 0', async () => {
    const ctx = fakeCanvas();
    setFaviconBadge('3');
    await vi.waitFor(() => expect(link.getAttribute('href')).toBe('data:image/png;base64,badge'));
    expect(link.type).toBe('image/png');
    expect(ctx.fillText).toHaveBeenCalledWith('3', expect.any(Number), expect.any(Number));
    setFaviconBadge('');
    expect(link.getAttribute('href')).toBe('/icons/icon.svg');
    expect(link.type).toBe('image/svg+xml');
  });

  it('a newer count wins over a draw still waiting for the icon', async () => {
    const ctx = fakeCanvas();
    setFaviconBadge('2');
    setFaviconBadge('9+');
    await vi.waitFor(() => expect(link.getAttribute('href')).toBe('data:image/png;base64,badge'));
    expect(ctx.fillText.mock.calls.map((c) => c[0])).toEqual(['9+']);
  });

  it('without a 2D canvas the icon stays as it is', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    setFaviconBadge('1');
    await new Promise((r) => setTimeout(r, 0));
    expect(link.getAttribute('href')).toBe('/icons/icon.svg');
  });
});

describe('app badge', () => {
  it('sets the count and clears it at 0 where the Badging API exists', () => {
    const setBadge = vi.fn(async () => undefined);
    const clearBadge = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'setAppBadge', { value: setBadge, configurable: true });
    Object.defineProperty(navigator, 'clearAppBadge', { value: clearBadge, configurable: true });
    setAppBadge(4);
    expect(setBadge).toHaveBeenCalledWith(4);
    setAppBadge(0);
    expect(clearBadge).toHaveBeenCalledTimes(1);
    delete (navigator as { setAppBadge?: unknown }).setAppBadge;
    delete (navigator as { clearAppBadge?: unknown }).clearAppBadge;
    expect(() => setAppBadge(2)).not.toThrow();
  });
});
