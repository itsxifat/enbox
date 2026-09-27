import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import type { ChatWallpaperAttachment } from '@enbox/shared';
import { DEFAULT_PREFS, useUi } from '@/stores/ui';
import { ChatBackground } from './ChatBackground';
import { EMPTY_THEME, resolveAppearance } from './presets';

const gif: ChatWallpaperAttachment = {
  id: 'm1',
  kind: 'image',
  url: '/uploads/wall.gif',
  thumbnailUrl: '/uploads/wall-poster.webp',
  mimeType: 'image/gif',
  animated: true,
  durationMs: null,
  width: 800,
  height: 600,
};

const video: ChatWallpaperAttachment = {
  ...gif,
  id: 'm2',
  kind: 'video',
  url: '/uploads/wall.mp4',
  thumbnailUrl: '/uploads/wall-poster.jpg',
  mimeType: 'video/mp4',
  animated: false,
  durationMs: 4000,
};

function appearanceFor(media: ChatWallpaperAttachment) {
  return resolveAppearance({
    override: { ...EMPTY_THEME, wallpaper: { kind: 'media' }, dim: 20 },
    shared: null,
    device: DEFAULT_PREFS,
    resolvedTheme: 'light',
    media,
  });
}

let play: ReturnType<typeof vi.fn>;
let pause: ReturnType<typeof vi.fn>;

beforeEach(() => {
  useUi.setState({ prefs: DEFAULT_PREFS, resolvedTheme: 'light' });
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  play = vi.fn(() => Promise.resolve());
  pause = vi.fn();
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: play });
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: pause });
});

describe('ChatBackground', () => {
  it('shows a GIF wallpaper as its poster under reduced motion', () => {
    useUi.getState().setPref('reduceMotion', 'on');
    render(<ChatBackground appearance={appearanceFor(gif)} />);
    const img = screen.getByTestId('chat-background') as HTMLImageElement;
    expect(img.getAttribute('src')).toContain('wall-poster.webp');
    expect(screen.getByTestId('chat-background-layer').dataset.motion).toBe('off');
    expect(screen.getByTestId('chat-background-dim')).toHaveStyle({ opacity: '0.2' });

    act(() => useUi.getState().setPref('reduceMotion', 'off'));
    expect(
      (screen.getByTestId('chat-background') as HTMLImageElement).getAttribute('src'),
    ).toContain('wall.gif');
  });

  it('pauses a video wallpaper while the app is hidden and plays it when visible', () => {
    useUi.getState().setPref('reduceMotion', 'off');
    render(<ChatBackground appearance={appearanceFor(video)} />);
    const el = screen.getByTestId('chat-background') as HTMLVideoElement;
    expect(el.tagName).toBe('VIDEO');
    expect(el.muted).toBe(true);
    expect(el.getAttribute('poster')).toContain('wall-poster.jpg');
    expect(play).toHaveBeenCalled();

    (document.hasFocus as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(pause).toHaveBeenCalled();
    expect(screen.getByTestId('chat-background-layer').dataset.motion).toBe('off');
  });
});
