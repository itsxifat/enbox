/**
 * Profile cosmetics catalogue: avatar decorations, profile effects, nameplates and display
 * name styles. All free. Profiles store catalogue ids only (never URLs or CSS); the web
 * client draws each id procedurally (components/cosmetics), so an unknown id from a newer
 * catalogue renders as nothing. Ids are stable: never rename or reuse one.
 */

export interface CosmeticCollection {
  id: string;
  name: string;
  description: string;
}

export interface CosmeticItem {
  id: string;
  name: string;
  collection: string;
}

export const COSMETIC_COLLECTIONS: readonly CosmeticCollection[] = [
  { id: 'cosmic', name: 'Cosmic', description: 'Planets, stars and the space between them.' },
  { id: 'nature', name: 'Bloom', description: 'Petals, leaves and things that grow.' },
  { id: 'elemental', name: 'Elemental', description: 'Fire, frost, storm and tide.' },
  { id: 'arcade', name: 'Arcade', description: 'Pixels, scanlines and high scores.' },
  { id: 'cozy', name: 'Cozy', description: 'Soft, warm and a little bit cute.' },
  { id: 'fantasy', name: 'Fantasy', description: 'Halos, horns, crowns and magic.' },
  { id: 'neon', name: 'Neon Nights', description: 'Glowing tubes and city lights.' },
];

export const AVATAR_DECORATIONS: readonly CosmeticItem[] = [
  { id: 'orbit', name: 'Orbit', collection: 'cosmic' },
  { id: 'starfield', name: 'Starfield', collection: 'cosmic' },
  { id: 'crescent', name: 'Crescent Moon', collection: 'cosmic' },
  { id: 'comet', name: 'Comet', collection: 'cosmic' },
  { id: 'saturn', name: 'Ringed Planet', collection: 'cosmic' },
  { id: 'blossom', name: 'Cherry Blossom', collection: 'nature' },
  { id: 'wreath', name: 'Leaf Wreath', collection: 'nature' },
  { id: 'sunflower', name: 'Sunflower', collection: 'nature' },
  { id: 'mushrooms', name: 'Mushroom Ring', collection: 'nature' },
  { id: 'butterflies', name: 'Butterflies', collection: 'nature' },
  { id: 'flames', name: 'Flame Ring', collection: 'elemental' },
  { id: 'frost', name: 'Frost Crown', collection: 'elemental' },
  { id: 'storm', name: 'Storm Cloud', collection: 'elemental' },
  { id: 'bubbles', name: 'Bubbles', collection: 'elemental' },
  { id: 'lightning', name: 'Lightning', collection: 'elemental' },
  { id: 'pixel-hearts', name: 'Pixel Hearts', collection: 'arcade' },
  { id: 'gamepad', name: 'Gamepad', collection: 'arcade' },
  { id: 'glitch', name: 'Glitch', collection: 'arcade' },
  { id: 'coins', name: 'Coin Rush', collection: 'arcade' },
  { id: 'cat-ears', name: 'Cat Ears', collection: 'cozy' },
  { id: 'bunny-ears', name: 'Bunny Ears', collection: 'cozy' },
  { id: 'headphones', name: 'Headphones', collection: 'cozy' },
  { id: 'tea', name: 'Tea Time', collection: 'cozy' },
  { id: 'halo', name: 'Halo', collection: 'fantasy' },
  { id: 'horns', name: 'Horns', collection: 'fantasy' },
  { id: 'crown', name: 'Crystal Crown', collection: 'fantasy' },
  { id: 'wings', name: 'Wings', collection: 'fantasy' },
  { id: 'fairy-dust', name: 'Fairy Dust', collection: 'fantasy' },
  { id: 'neon-ring', name: 'Neon Ring', collection: 'neon' },
  { id: 'rainbow', name: 'Rainbow', collection: 'neon' },
  { id: 'equalizer', name: 'Equalizer', collection: 'neon' },
];

export const PROFILE_EFFECTS: readonly CosmeticItem[] = [
  { id: 'starfall', name: 'Starfall', collection: 'cosmic' },
  { id: 'aurora', name: 'Aurora', collection: 'cosmic' },
  { id: 'nebula', name: 'Nebula', collection: 'cosmic' },
  { id: 'petals', name: 'Petal Drift', collection: 'nature' },
  { id: 'leaves', name: 'Autumn Leaves', collection: 'nature' },
  { id: 'fireflies', name: 'Fireflies', collection: 'nature' },
  { id: 'snowfall', name: 'Snowfall', collection: 'elemental' },
  { id: 'embers', name: 'Embers', collection: 'elemental' },
  { id: 'rain', name: 'Rain', collection: 'elemental' },
  { id: 'bubbles', name: 'Bubbles', collection: 'elemental' },
  { id: 'confetti', name: 'Confetti', collection: 'arcade' },
  { id: 'pixels', name: 'Pixel Burst', collection: 'arcade' },
  { id: 'code-rain', name: 'Code Rain', collection: 'arcade' },
  { id: 'hearts', name: 'Hearts', collection: 'cozy' },
  { id: 'sparkles', name: 'Sparkles', collection: 'fantasy' },
  { id: 'magic', name: 'Magic Circle', collection: 'fantasy' },
  { id: 'neon-grid', name: 'Neon Grid', collection: 'neon' },
];

export const NAMEPLATES: readonly CosmeticItem[] = [
  { id: 'galaxy', name: 'Galaxy', collection: 'cosmic' },
  { id: 'starry', name: 'Starry Night', collection: 'cosmic' },
  { id: 'meadow', name: 'Meadow', collection: 'nature' },
  { id: 'sakura', name: 'Sakura', collection: 'nature' },
  { id: 'ocean', name: 'Ocean', collection: 'elemental' },
  { id: 'lava', name: 'Lava', collection: 'elemental' },
  { id: 'glacier', name: 'Glacier', collection: 'elemental' },
  { id: 'circuit', name: 'Circuit', collection: 'arcade' },
  { id: 'pixel-sky', name: 'Pixel Sky', collection: 'arcade' },
  { id: 'candy', name: 'Candy', collection: 'cozy' },
  { id: 'sunset', name: 'Sunset', collection: 'cozy' },
  { id: 'gold', name: 'Gilded', collection: 'fantasy' },
  { id: 'enchanted', name: 'Enchanted', collection: 'fantasy' },
  { id: 'synthwave', name: 'Synthwave', collection: 'neon' },
  { id: 'city-lights', name: 'City Lights', collection: 'neon' },
];

/** Display name fonts (self-hosted OFL fonts, loaded on first use). */
export const NAME_FONTS = [
  { id: 'default', name: 'Default' },
  { id: 'bangers', name: 'Comic' },
  { id: 'pixel', name: 'Pixel' },
  { id: 'cherry', name: 'Bubble' },
  { id: 'zilla', name: 'Slab' },
  { id: 'pacifico', name: 'Script' },
  { id: 'orbitron', name: 'Future' },
  { id: 'creepster', name: 'Spooky' },
  { id: 'righteous', name: 'Retro' },
  { id: 'caveat', name: 'Handwritten' },
  { id: 'press-start', name: 'Arcade' },
  { id: 'cinzel', name: 'Royal' },
] as const;
export type NameFontId = (typeof NAME_FONTS)[number]['id'];

/** Display name effects; `colors` holds 1 colour (solid/neon/toon/pop/glow) or 2 (gradient). */
export const NAME_EFFECTS = [
  { id: 'solid', name: 'Solid' },
  { id: 'gradient', name: 'Gradient' },
  { id: 'neon', name: 'Neon' },
  { id: 'toon', name: 'Toon' },
  { id: 'pop', name: 'Pop' },
  { id: 'glow', name: 'Glow' },
] as const;
export type NameEffectId = (typeof NAME_EFFECTS)[number]['id'];

export interface NameStyle {
  font: NameFontId;
  effect: NameEffectId;
  /** Lowercase `#rrggbb`; 1 or 2 entries. */
  colors: string[];
}

export type RoleColorStyle = 'solid' | 'gradient' | 'holographic';
export const ROLE_COLOR_STYLES: readonly RoleColorStyle[] = ['solid', 'gradient', 'holographic'];

const ids = (list: readonly { id: string }[]) => new Set(list.map((i) => i.id));
const DECORATION_IDS = ids(AVATAR_DECORATIONS);
const EFFECT_IDS = ids(PROFILE_EFFECTS);
const NAMEPLATE_IDS = ids(NAMEPLATES);
const FONT_IDS = ids(NAME_FONTS);
const NAME_EFFECT_IDS = ids(NAME_EFFECTS);

export const isAvatarDecorationId = (id: string): boolean => DECORATION_IDS.has(id);
export const isProfileEffectId = (id: string): boolean => EFFECT_IDS.has(id);
export const isNameplateId = (id: string): boolean => NAMEPLATE_IDS.has(id);
export const isNameFontId = (id: string): id is NameFontId => FONT_IDS.has(id);
export const isNameEffectId = (id: string): id is NameEffectId => NAME_EFFECT_IDS.has(id);

export function cosmeticName(kind: 'decoration' | 'effect' | 'nameplate', id: string | null | undefined): string | null {
  if (!id) return null;
  const list = kind === 'decoration' ? AVATAR_DECORATIONS : kind === 'effect' ? PROFILE_EFFECTS : NAMEPLATES;
  return list.find((i) => i.id === id)?.name ?? null;
}

// ---------------------------------------------------------------------------
// Badges (derived, never stored)
// ---------------------------------------------------------------------------

export interface ProfileBadge {
  id: string;
  /** Tooltip text. */
  label: string;
}

/** Supporter tenure tiers by account age in months (everyone is a supporter: perks are free). */
export const TENURE_TIERS = [
  { months: 0, id: 'tenure-bronze', label: 'Supporter' },
  { months: 1, id: 'tenure-silver', label: 'Supporter for 1 month' },
  { months: 3, id: 'tenure-gold', label: 'Supporter for 3 months' },
  { months: 6, id: 'tenure-platinum', label: 'Supporter for 6 months' },
  { months: 12, id: 'tenure-diamond', label: 'Supporter for a year' },
  { months: 24, id: 'tenure-emerald', label: 'Supporter for 2 years' },
  { months: 36, id: 'tenure-ruby', label: 'Supporter for 3 years' },
  { months: 60, id: 'tenure-opal', label: 'Supporter for 5 years' },
] as const;

/** Accounts created before this are "Early Member". */
export const EARLY_MEMBER_BEFORE = '2027-01-01T00:00:00.000Z';

/** Badges shown on a profile, in display order. */
export function profileBadges(
  user: { createdAt: string | null; isDeleted?: boolean },
  now: number = Date.now(),
): ProfileBadge[] {
  if (!user.createdAt || user.isDeleted) return [];
  const created = Date.parse(user.createdAt);
  if (!Number.isFinite(created)) return [];
  const out: ProfileBadge[] = [];
  const months = Math.max(0, Math.floor((now - created) / (30.44 * 86_400_000)));
  let tier: (typeof TENURE_TIERS)[number] = TENURE_TIERS[0];
  for (const t of TENURE_TIERS) if (months >= t.months) tier = t;
  out.push({ id: tier.id, label: tier.label });
  if (created < Date.parse(EARLY_MEMBER_BEFORE)) out.push({ id: 'early-member', label: 'Early Member' });
  return out;
}
