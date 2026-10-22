import { CatEars, BunnyEars, Headphones, Tea } from './cozy';
import { Coins, Gamepad, Glitch, PixelHearts } from './arcade';
import { Comet, Crescent, Orbit, Saturn, Starfield } from './cosmic';
import { Bubbles, Flames, Frost, Lightning, Storm } from './elemental';
import { Crown, FairyDust, Halo, Horns, Wings } from './fantasy';
import { Blossom, Butterflies, Mushrooms, Sunflowers, Wreath } from './nature';
import { Equalizer, NeonRing, Rainbow } from './neon';
import type { DecorationArt } from './shapes';

export type { ArtProps, DecorationArt } from './shapes';

/** Art per AVATAR_DECORATIONS id (the catalogue test fails when one is missing). */
export const DECORATION_ART: Readonly<Record<string, DecorationArt>> = {
  orbit: Orbit,
  starfield: Starfield,
  crescent: Crescent,
  comet: Comet,
  saturn: Saturn,
  blossom: Blossom,
  wreath: Wreath,
  sunflower: Sunflowers,
  mushrooms: Mushrooms,
  butterflies: Butterflies,
  flames: Flames,
  frost: Frost,
  storm: Storm,
  bubbles: Bubbles,
  lightning: Lightning,
  'pixel-hearts': PixelHearts,
  gamepad: Gamepad,
  glitch: Glitch,
  coins: Coins,
  'cat-ears': CatEars,
  'bunny-ears': BunnyEars,
  headphones: Headphones,
  tea: Tea,
  halo: Halo,
  horns: Horns,
  crown: Crown,
  wings: Wings,
  'fairy-dust': FairyDust,
  'neon-ring': NeonRing,
  rainbow: Rainbow,
  equalizer: Equalizer,
};

export function decorationArt(id: string | null | undefined): DecorationArt | null {
  return id && Object.hasOwn(DECORATION_ART, id) ? DECORATION_ART[id]! : null;
}
