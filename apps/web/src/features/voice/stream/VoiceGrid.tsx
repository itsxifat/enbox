/**
 * The call area of a voice channel while I am connected: a grid of tiles — each person's
 * camera or avatar (Tile.tsx), and a stream tile (StreamTile.tsx) while they share their screen
 * — or focus mode: the tile in focus large, the others in a strip below it (beside it when the
 * pane is wide). Clicking a tile focuses it; clicking it again or Escape returns to the grid;
 * watching a stream focuses it (store.ts). A stream's fullscreen button shows the focus area
 * fullscreen, focusing that stream first.
 *
 * `streamsOnly`: stream tiles only (a Stage, which lists its people apart). `fill`: the grid
 * takes the pane's height (the voice view); else it flows in a scrolling column (the Stage).
 */
import { useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import type { Space } from '@enbox/shared';
import { cn } from '@/lib/cn';
import { useVoice } from '@/stores/voice';
import { getVoiceRoom } from '../engine';
import { focusLayout, gridColumns, voiceTiles, type TileSpec } from './layout';
import { fullscreenSupported, toggleFullscreen, useFullscreenElement } from './media';
import { useStreams } from './store';
import { StreamTile } from './StreamTile';
import { Tile, type TileLayout } from './Tile';

/** Typing somewhere: Escape belongs to that field. */
function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

export function VoiceGrid({
  space,
  streamsOnly = false,
  fill = true,
}: {
  space: Space;
  streamsOnly?: boolean;
  fill?: boolean;
}) {
  useVoice((s) => s.roomVersion);
  const focus = useStreams((s) => s.focus);
  const fullscreenElement = useFullscreenElement();
  const focusArea = useRef<HTMLDivElement>(null);
  const room = getVoiceRoom();
  const tiles = room
    ? voiceTiles([room.localParticipant, ...room.remoteParticipants.values()], { streamsOnly })
    : [];
  const { focused, others } = focusLayout(tiles, focus);
  const fullscreen = !!fullscreenElement && fullscreenElement === focusArea.current;
  const hasFocus = !!focused;

  // Escape goes back to the grid — after every other listener, so a menu or dialog that closes
  // on Escape (and says so) keeps the focus; not while typing, not out of fullscreen.
  useEffect(() => {
    if (!hasFocus) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || isEditable(e.target)) return;
      setTimeout(() => {
        if (!e.defaultPrevented && !document.fullscreenElement)
          useStreams.getState().setFocus(null);
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hasFocus]);

  /** Fullscreen the focus area with `key` in it (or leave fullscreen). */
  const fullscreenTile = (key: string) => {
    if (fullscreen && focus === key) {
      void toggleFullscreen(focusArea.current);
      return;
    }
    // The focus area must exist within this click for the browser to allow fullscreen.
    flushSync(() => useStreams.getState().setFocus(key));
    void toggleFullscreen(focusArea.current);
  };

  const render = (t: TileSpec, layout: TileLayout) => {
    const isFocused = t === focused;
    const select = () => useStreams.getState().toggleFocus(t.key);
    return t.kind === 'screen' ? (
      <StreamTile
        key={t.key}
        participant={t.participant}
        spaceId={space.id}
        layout={layout}
        focused={isFocused}
        fullscreen={isFocused && fullscreen}
        onSelect={select}
        onFullscreen={fullscreenSupported() ? () => fullscreenTile(t.key) : undefined}
      />
    ) : (
      <Tile
        key={t.key}
        participant={t.participant}
        spaceId={space.id}
        layout={layout}
        focused={isFocused}
        onSelect={select}
      />
    );
  };

  if (!tiles.length) return fill ? <div className="flex-1" /> : null;

  if (focused)
    return (
      <div
        className={cn('@container flex min-w-0 flex-col', fill && 'min-h-0 flex-1')}
        data-testid="voice-grid"
        data-mode="focus"
      >
        <div
          className={cn(
            'flex min-w-0 flex-col gap-3',
            fill ? 'min-h-0 flex-1 p-4 @5xl:flex-row' : 'py-2',
          )}
        >
          <div
            ref={focusArea}
            className={cn(
              'relative min-w-0 [&:fullscreen]:bg-black',
              fill ? 'min-h-0 flex-1' : 'aspect-video w-full',
            )}
            data-testid="voice-focus"
          >
            <div className="absolute inset-0">{render(focused, 'focus')}</div>
          </div>
          {others.length ? (
            <div
              className={cn(
                'flex shrink-0 gap-2 overflow-x-auto pb-1 scrollbar-thin',
                fill &&
                  '@5xl:w-52 @5xl:flex-col @5xl:overflow-x-hidden @5xl:overflow-y-auto @5xl:pb-0',
              )}
              role="group"
              aria-label="Everyone else"
              data-testid="voice-strip"
            >
              {others.map((t) => (
                <div key={t.key} className={cn('w-40 shrink-0', fill && '@5xl:w-full')}>
                  {render(t, 'strip')}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    );

  return (
    <div
      className={cn(
        'flex min-w-0 justify-center',
        fill && 'min-h-0 flex-1 items-center overflow-y-auto p-4',
      )}
      data-testid="voice-grid"
      data-mode="grid"
    >
      <div className={cn('grid w-full max-w-6xl gap-3', gridColumns(others.length))}>
        {others.map((t) => render(t, 'grid'))}
      </div>
    </div>
  );
}
