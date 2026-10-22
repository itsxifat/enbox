import { describe, expect, it } from 'vitest';
import { contrastRatio, inkOn, mixHex, parseHex, profileTheme, relativeLuminance } from './theme';

describe('profile theme', () => {
  it('parses and mixes #rrggbb colours', () => {
    expect(parseHex('#112233')).toEqual([17, 34, 51]);
    expect(parseHex('#ABCDEF')).toEqual([171, 205, 239]);
    expect(parseHex('red')).toBeNull();
    expect(parseHex('#123')).toBeNull();
    expect(parseHex(null)).toBeNull();
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixHex('#102030', '#102030', 0.3)).toBe('#102030');
  });

  it('computes WCAG luminance and contrast', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1);
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21);
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1);
  });

  it('picks white ink on dark colours and near-black on light ones', () => {
    expect(inkOn('#112233')).toBe('light');
    expect(inkOn('#6d5dfc')).toBe('light');
    expect(inkOn('#ffe680')).toBe('dark');
    expect(inkOn('#f2f3f5')).toBe('dark');
  });

  it('no colours: no theme', () => {
    expect(profileTheme(null, null)).toBeNull();
    expect(profileTheme(undefined, 'not-a-colour')).toBeNull();
  });

  it('themes a vertical primary → accent gradient with overriding tokens', () => {
    const t = profileTheme('#112233', '#445566')!;
    expect(t.background).toBe('linear-gradient(180deg, #112233 0%, #445566 100%)');
    expect(t.ink).toBe('light');
    expect(t.vars).toMatchObject({ '--fg': '#ffffff', color: 'var(--fg)' });
    // The ring is the primary under the panel's dark veil: darker than the primary.
    expect(relativeLuminance(t.ring)).toBeLessThan(relativeLuminance('#112233'));
    expect(t.panel).toMatch(/^rgb\(0 0 0/);

    const light = profileTheme('#FFE680', null)!;
    expect(light.primary).toBe('#ffe680');
    expect(light.ink).toBe('dark');
    expect(light.vars).toMatchObject({ '--fg': '#060607' });
    expect(light.panel).toMatch(/^rgb\(255 255 255/);
    // A lone primary fades into a darker shade of itself.
    expect(relativeLuminance(light.accent)).toBeLessThan(relativeLuminance(light.primary));
  });

  it('a lone accent is the primary too', () => {
    const t = profileTheme(null, '#aa2266')!;
    expect(t.primary).toBe('#aa2266');
  });

  it('the chosen ink keeps AA contrast on the veiled gradient for typical colours', () => {
    for (const [p, a] of [
      ['#6d5dfc', '#2b1d8f'],
      ['#ffe680', '#ffb3c7'],
      ['#22aa66', '#115533'],
      ['#808080', '#909090'],
    ] as const) {
      const t = profileTheme(p, a)!;
      const ink = t.ink === 'light' ? '#ffffff' : '#060607';
      expect(contrastRatio(t.ring, ink)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
