/**
 * Collectibles: every cosmetic in one list (all free). Decorations, effects and nameplates
 * come from the shared catalogue; name styles are curated presets of a font, an effect and
 * colours (the editor still lets anyone mix their own). An item's `key` is unique across
 * kinds (`bubbles` is both a decoration and an effect).
 */
import {
  AVATAR_DECORATIONS,
  COSMETIC_COLLECTIONS,
  NAMEPLATES,
  PROFILE_EFFECTS,
  type CosmeticCollection,
  type NameStyle,
  type UpdateProfileRequest,
  type UserPublic,
} from '@enbox/shared';

export type CollectibleKind = 'decoration' | 'effect' | 'nameplate' | 'nameStyle';

export interface Collectible {
  key: string;
  kind: CollectibleKind;
  id: string;
  name: string;
  collection: string;
  /** Name styles only. */
  style?: NameStyle;
}

export const KIND_LABELS: Record<CollectibleKind, string> = {
  decoration: 'Avatar Decoration',
  effect: 'Profile Effect',
  nameplate: 'Nameplate',
  nameStyle: 'Name Style',
};

/** The profile field each kind sets. */
export const KIND_FIELDS = {
  decoration: 'avatarDecoration',
  effect: 'profileEffect',
  nameplate: 'nameplate',
  nameStyle: 'nameStyle',
} as const satisfies Record<CollectibleKind, keyof UpdateProfileRequest>;

/** Curated display name styles, one per font, placed in the collection they suit. */
export const NAME_STYLE_PRESETS: readonly {
  id: string;
  name: string;
  collection: string;
  style: NameStyle;
}[] = [
  {
    id: 'starship',
    name: 'Starship',
    collection: 'cosmic',
    style: { font: 'orbitron', effect: 'gradient', colors: ['#7dd3fc', '#c084fc'] },
  },
  {
    id: 'field-notes',
    name: 'Field Notes',
    collection: 'nature',
    style: { font: 'caveat', effect: 'gradient', colors: ['#86efac', '#16a34a'] },
  },
  {
    id: 'wildfire',
    name: 'Wildfire',
    collection: 'elemental',
    style: { font: 'zilla', effect: 'gradient', colors: ['#facc15', '#ea580c'] },
  },
  {
    id: 'pixel-pop',
    name: 'Pixel Pop',
    collection: 'arcade',
    style: { font: 'pixel', effect: 'neon', colors: ['#4ade80'] },
  },
  {
    id: 'high-score',
    name: 'High Score',
    collection: 'arcade',
    style: { font: 'press-start', effect: 'pop', colors: ['#f43f5e'] },
  },
  {
    id: 'ka-pow',
    name: 'Ka-Pow',
    collection: 'arcade',
    style: { font: 'bangers', effect: 'toon', colors: ['#facc15'] },
  },
  {
    id: 'bubblegum',
    name: 'Bubblegum',
    collection: 'cozy',
    style: { font: 'cherry', effect: 'pop', colors: ['#f9a8d4'] },
  },
  {
    id: 'sunday-brunch',
    name: 'Sunday Brunch',
    collection: 'cozy',
    style: { font: 'pacifico', effect: 'glow', colors: ['#fdba74'] },
  },
  {
    id: 'royal-decree',
    name: 'Royal Decree',
    collection: 'fantasy',
    style: { font: 'cinzel', effect: 'gradient', colors: ['#fde68a', '#d97706'] },
  },
  {
    id: 'haunted',
    name: 'Haunted',
    collection: 'fantasy',
    style: { font: 'creepster', effect: 'glow', colors: ['#a3e635'] },
  },
  {
    id: 'night-drive',
    name: 'Night Drive',
    collection: 'neon',
    style: { font: 'righteous', effect: 'neon', colors: ['#22d3ee'] },
  },
];

const fromCatalogue = (
  kind: CollectibleKind,
  list: readonly { id: string; name: string; collection: string }[],
): Collectible[] => list.map((i) => ({ key: `${kind}:${i.id}`, kind, ...i }));

export const COLLECTIBLES: readonly Collectible[] = [
  ...fromCatalogue('decoration', AVATAR_DECORATIONS),
  ...fromCatalogue('effect', PROFILE_EFFECTS),
  ...fromCatalogue('nameplate', NAMEPLATES),
  ...NAME_STYLE_PRESETS.map((p): Collectible => ({
    key: `nameStyle:${p.id}`,
    kind: 'nameStyle',
    id: p.id,
    name: p.name,
    collection: p.collection,
    style: p.style,
  })),
];

export function collectiblesOf(kind: CollectibleKind): Collectible[] {
  return COLLECTIBLES.filter((c) => c.kind === kind);
}

export function findCollectible(key: string): Collectible | undefined {
  return COLLECTIBLES.find((c) => c.key === key);
}

export interface CollectionGroup {
  collection: CosmeticCollection;
  items: Collectible[];
}

/** Items grouped by collection, in catalogue order; empty collections are left out. */
export function groupByCollection(items: readonly Collectible[]): CollectionGroup[] {
  return COSMETIC_COLLECTIONS.map((collection) => ({
    collection,
    items: items.filter((i) => i.collection === collection.id),
  })).filter((g) => g.items.length > 0);
}

type Worn = Pick<UserPublic, 'avatarDecoration' | 'profileEffect' | 'nameplate' | 'nameStyle'>;

function sameStyle(a: NameStyle | null | undefined, b: NameStyle | null | undefined): boolean {
  if (!a || !b) return false;
  return (
    a.font === b.font &&
    a.effect === b.effect &&
    a.colors.length === b.colors.length &&
    a.colors.every((c, i) => c.toLowerCase() === b.colors[i]?.toLowerCase())
  );
}

/** Whether `user` currently wears the item. */
export function isEquipped(user: Worn | null | undefined, item: Collectible): boolean {
  if (!user) return false;
  if (item.kind === 'nameStyle') return sameStyle(user.nameStyle, item.style);
  return (user[KIND_FIELDS[item.kind]] ?? null) === item.id;
}

/** The one-field `PATCH /api/me` body that equips (or takes off) an item. */
export function equipPatch(item: Collectible, on: boolean): UpdateProfileRequest {
  if (item.kind === 'nameStyle') return { nameStyle: on ? (item.style ?? null) : null };
  return { [KIND_FIELDS[item.kind]]: on ? item.id : null };
}

/** `user` wearing the item (try-on). */
export function withItem<T extends Worn>(user: T, item: Collectible): T {
  if (item.kind === 'nameStyle') return { ...user, nameStyle: item.style ?? null };
  return { ...user, [KIND_FIELDS[item.kind]]: item.id };
}
