/**
 * The voice grid's tiles and focus mode (pure, for VoiceGrid.tsx): each person's camera (or
 * avatar) tile, and their stream tile before it while they share their screen — watched or
 * not. In focus mode one tile is large and the others make a strip.
 */
import { Track, type Participant } from 'livekit-client';
import { tileKey, type TileKind } from './store';

export interface TileSpec {
  key: string;
  participant: Participant;
  kind: TileKind;
}

/** The tiles for `participants` (`streamsOnly`: stream tiles only, a Stage's). */
export function voiceTiles(
  participants: Iterable<Participant>,
  opts: { streamsOnly?: boolean } = {},
): TileSpec[] {
  const tiles: TileSpec[] = [];
  for (const p of participants) {
    if (p.isScreenShareEnabled || p.getTrackPublication(Track.Source.ScreenShare))
      tiles.push({ key: tileKey(p.identity, 'screen'), participant: p, kind: 'screen' });
    if (!opts.streamsOnly)
      tiles.push({ key: tileKey(p.identity, 'camera'), participant: p, kind: 'camera' });
  }
  return tiles;
}

export interface FocusLayout {
  /** The large tile (null: the grid). */
  focused: TileSpec | null;
  /** Every other tile: the strip in focus mode, else the whole grid. */
  others: TileSpec[];
}

/** Focus mode for `focus` (a `tileKey`); a key whose tile went away means the grid. */
export function focusLayout(tiles: readonly TileSpec[], focus: string | null): FocusLayout {
  const focused = (focus && tiles.find((t) => t.key === focus)) || null;
  return { focused, others: focused ? tiles.filter((t) => t !== focused) : [...tiles] };
}

/** Grid columns for `n` tiles. */
export function gridColumns(n: number): string {
  return n <= 1 ? 'grid-cols-1' : n <= 4 ? 'grid-cols-2' : n <= 9 ? 'grid-cols-3' : 'grid-cols-4';
}
