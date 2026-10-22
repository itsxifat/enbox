import { describe, expect, it } from 'vitest';
import { makeMe } from '@/test/factories';
import { hasSpaceOverrides, selfCardUser } from './model';

describe('profile model', () => {
  it('my card carries my cosmetics', () => {
    const me = makeMe({
      avatarDecoration: 'halo',
      profileEffect: 'confetti',
      nameplate: 'galaxy',
      nameStyle: { font: 'pixel', effect: 'neon', colors: ['#ff00aa'] },
    });
    expect(selfCardUser(me)).toMatchObject({
      avatarDecoration: 'halo',
      profileEffect: 'confetti',
      nameplate: 'galaxy',
      nameStyle: { font: 'pixel', effect: 'neon', colors: ['#ff00aa'] },
    });
    expect(selfCardUser(makeMe())).toMatchObject({
      avatarDecoration: null,
      profileEffect: null,
      nameplate: null,
      nameStyle: null,
    });
  });

  it('knows when a member has a per-Space profile', () => {
    expect(hasSpaceOverrides(null)).toBe(false);
    expect(hasSpaceOverrides({})).toBe(false);
    expect(hasSpaceOverrides({ bio: null, pronouns: null, avatarUrl: null })).toBe(false);
    expect(hasSpaceOverrides({ bio: 'Hi' })).toBe(true);
    expect(hasSpaceOverrides({ avatarUrl: '/uploads/a.webp' })).toBe(true);
    expect(hasSpaceOverrides({ avatarDecoration: 'horns' })).toBe(true);
    expect(hasSpaceOverrides({ nameplate: 'ocean' })).toBe(true);
  });
});
