/**
 * Display name fonts (NAME_FONTS in @enbox/shared): self-hosted @fontsource packages, each
 * loaded on first use by a dynamic import of its CSS (one chunk per font, so a list full of
 * plain names never downloads one). 'default' is the app font.
 */
import type { NameFontId } from '@enbox/shared';

export interface NameFontDef {
  /** CSS font-family stack (null: the app font). */
  family: string | null;
  /** The weight names wear: 400 for single-weight faces (no faux bold), 700 when the face has it. */
  weight?: number;
  /** Optical size relative to the surrounding text (wide or tiny faces). */
  scale?: number;
  letterSpacing?: string;
}

export const NAME_FONT_DEFS: Record<NameFontId, NameFontDef> = {
  default: { family: null },
  bangers: {
    family: "'Bangers', system-ui, sans-serif",
    weight: 400,
    scale: 1.08,
    letterSpacing: '0.03em',
  },
  pixel: { family: "'Pixelify Sans', system-ui, sans-serif", weight: 700, scale: 1.04 },
  cherry: { family: "'Cherry Bomb One', system-ui, sans-serif", weight: 400 },
  zilla: { family: "'Zilla Slab', serif", weight: 700, scale: 1.04 },
  pacifico: { family: "'Pacifico', cursive", weight: 400, scale: 0.96 },
  orbitron: {
    family: "'Orbitron', system-ui, sans-serif",
    weight: 700,
    scale: 0.9,
    letterSpacing: '0.02em',
  },
  creepster: {
    family: "'Creepster', system-ui, sans-serif",
    weight: 400,
    scale: 1.08,
    letterSpacing: '0.04em',
  },
  righteous: { family: "'Righteous', system-ui, sans-serif", weight: 400 },
  caveat: { family: "'Caveat', cursive", weight: 700, scale: 1.18 },
  'press-start': { family: "'Press Start 2P', monospace", weight: 400, scale: 0.7 },
  cinzel: { family: "'Cinzel', serif", weight: 700, scale: 0.96 },
};

type LoadableFont = Exclude<NameFontId, 'default'>;

/** One loader per font: the face's CSS (the woff2 files download only when text uses it). */
const LOADERS: Record<LoadableFont, () => Promise<unknown>> = {
  bangers: () => import('@fontsource/bangers/400.css'),
  pixel: () => import('@fontsource/pixelify-sans/700.css'),
  cherry: () => import('@fontsource/cherry-bomb-one/400.css'),
  zilla: () => import('@fontsource/zilla-slab/700.css'),
  pacifico: () => import('@fontsource/pacifico/400.css'),
  orbitron: () => import('@fontsource/orbitron/700.css'),
  creepster: () => import('@fontsource/creepster/400.css'),
  righteous: () => import('@fontsource/righteous/400.css'),
  caveat: () => import('@fontsource/caveat/700.css'),
  'press-start': () => import('@fontsource/press-start-2p/400.css'),
  cinzel: () => import('@fontsource/cinzel/700.css'),
};

const loading = new Map<NameFontId, Promise<void>>();

/** Load a name font once (idempotent and cheap to call during render). */
export function loadNameFont(id: NameFontId | null | undefined): Promise<void> {
  if (!id || id === 'default' || !(id in LOADERS)) return Promise.resolve();
  let p = loading.get(id);
  if (!p) {
    p = LOADERS[id as LoadableFont]().then(
      () => undefined,
      () => {
        // A failed chunk (offline) may be retried on the next render.
        loading.delete(id);
      },
    );
    loading.set(id, p);
  }
  return p;
}

/** Whether a font's CSS was requested (tests, previews). */
export function isNameFontRequested(id: NameFontId): boolean {
  return loading.has(id);
}

/** Every font id that has a loader (the catalogue test checks this against NAME_FONTS). */
export const LOADABLE_NAME_FONTS = Object.keys(LOADERS) as LoadableFont[];
