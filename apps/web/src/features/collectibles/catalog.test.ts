import { describe, expect, it } from 'vitest';
import {
  AVATAR_DECORATIONS,
  COSMETIC_COLLECTIONS,
  NAMEPLATES,
  PROFILE_EFFECTS,
  isNameEffectId,
  isNameFontId,
  nameStyleSchema,
} from '@enbox/shared';
import {
  COLLECTIBLES,
  NAME_STYLE_PRESETS,
  equipPatch,
  findCollectible,
  groupByCollection,
  isEquipped,
  withItem,
} from './catalog';

describe('collectibles catalogue', () => {
  it('lists every cosmetic once with a unique key', () => {
    expect(COLLECTIBLES).toHaveLength(
      AVATAR_DECORATIONS.length +
        PROFILE_EFFECTS.length +
        NAMEPLATES.length +
        NAME_STYLE_PRESETS.length,
    );
    expect(new Set(COLLECTIBLES.map((c) => c.key)).size).toBe(COLLECTIBLES.length);
    // `bubbles` is both a decoration and an effect.
    expect(findCollectible('decoration:bubbles')?.kind).toBe('decoration');
    expect(findCollectible('effect:bubbles')?.kind).toBe('effect');
  });

  it('name style presets are valid styles in known collections', () => {
    const collections = new Set(COSMETIC_COLLECTIONS.map((c) => c.id));
    for (const p of NAME_STYLE_PRESETS) {
      expect(collections.has(p.collection)).toBe(true);
      expect(isNameFontId(p.style.font) && isNameEffectId(p.style.effect)).toBe(true);
      expect(nameStyleSchema.safeParse(p.style).success).toBe(true);
      expect(p.style.colors).toHaveLength(p.style.effect === 'gradient' ? 2 : 1);
    }
  });

  it('groups by collection in catalogue order, skipping empty ones', () => {
    const groups = groupByCollection(COLLECTIBLES.filter((c) => c.kind === 'nameStyle'));
    expect(groups.map((g) => g.collection.id)).toEqual(
      COSMETIC_COLLECTIONS.map((c) => c.id).filter((id) =>
        NAME_STYLE_PRESETS.some((p) => p.collection === id),
      ),
    );
  });

  it('equips, takes off and detects one field at a time', () => {
    const halo = findCollectible('decoration:halo')!;
    const starship = findCollectible('nameStyle:starship')!;
    expect(equipPatch(halo, true)).toEqual({ avatarDecoration: 'halo' });
    expect(equipPatch(halo, false)).toEqual({ avatarDecoration: null });
    expect(equipPatch(findCollectible('nameplate:galaxy')!, true)).toEqual({ nameplate: 'galaxy' });
    expect(equipPatch(starship, true)).toEqual({ nameStyle: starship.style });
    expect(equipPatch(starship, false)).toEqual({ nameStyle: null });

    const worn = {
      avatarDecoration: 'halo',
      profileEffect: null,
      nameplate: null,
      nameStyle: null,
    };
    expect(isEquipped(worn, halo)).toBe(true);
    expect(isEquipped(worn, findCollectible('effect:bubbles')!)).toBe(false);
    expect(isEquipped(withItem(worn, starship), starship)).toBe(true);
    expect(
      isEquipped(
        { ...worn, nameStyle: { ...starship.style!, colors: ['#000000', '#ffffff'] } },
        starship,
      ),
    ).toBe(false);
  });
});
