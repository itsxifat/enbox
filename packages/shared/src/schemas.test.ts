import { describe, expect, it } from 'vitest';

import {
  BIO_MAX_LENGTH,
  PRESENCE_NOTE_MAX_LENGTH,
  PRONOUNS_MAX_LENGTH,
  WALLPAPER_BLUR_MAX,
  WALLPAPER_DIM_MAX,
} from './constants.js';
import {
  chatThemeSchema,
  hexColorSchema,
  presenceActivitySchema,
  setChatThemeSchema,
  sharedChatThemeSchema,
  updateAvailabilitySchema,
  updateChatPrefsSchema,
  updatePresenceNoteSchema,
  updateProfileSchema,
} from './schemas.js';

const ISO = '2026-09-26T12:00:00.000Z';
const MEDIA_ID = '4c2c1e9e-0b5d-4e0a-9e5b-2b6c8f1b7a10';

/** A complete theme (every field set). */
const THEME = {
  preset: 'ocean',
  bubbleStyle: 'rounded',
  accent: '#3366ff',
  wallpaper: { kind: 'preset', id: 'sky' },
  dim: 30,
  blur: 4,
  messageAnimation: 'fade',
} as const;
/** A theme that sets nothing (every layer below it decides). */
const EMPTY_THEME = {
  preset: null,
  bubbleStyle: null,
  accent: null,
  wallpaper: null,
  dim: 0,
  blur: 0,
  messageAnimation: null,
};

describe('hexColorSchema', () => {
  it('normalises to lowercase #rrggbb', () => {
    expect(hexColorSchema.parse('#AbCdEf')).toBe('#abcdef');
    expect(hexColorSchema.parse(' #ffffff ')).toBe('#ffffff');
  });

  it.each(['#fff', 'ffffff', '#gggggg', '#12345678', '', 'red'])('rejects %j', (v) => {
    expect(hexColorSchema.safeParse(v).success).toBe(false);
  });
});

describe('updateProfileSchema', () => {
  it('accepts an empty patch and the new profile fields', () => {
    expect(updateProfileSchema.parse({})).toEqual({});
    expect(
      updateProfileSchema.parse({
        bannerMediaId: '4C2C1E9E-0B5D-4E0A-9E5B-2B6C8F1B7A10',
        pronouns: ' she/her ',
        bio: ' Hi there ',
        profileColor: '#FF0000',
        accentColor: null,
      }),
    ).toEqual({
      bannerMediaId: '4c2c1e9e-0b5d-4e0a-9e5b-2b6c8f1b7a10',
      pronouns: 'she/her',
      bio: 'Hi there',
      profileColor: '#ff0000',
      accentColor: null,
    });
  });

  it('clears pronouns with null or blank text, and the banner with null', () => {
    expect(updateProfileSchema.parse({ pronouns: null })).toEqual({ pronouns: null });
    expect(updateProfileSchema.parse({ pronouns: '   ' })).toEqual({ pronouns: null });
    expect(updateProfileSchema.parse({ bannerMediaId: null })).toEqual({ bannerMediaId: null });
    expect(updateProfileSchema.parse({ bio: '' })).toEqual({ bio: '' });
  });

  it.each([
    { pronouns: 'x'.repeat(PRONOUNS_MAX_LENGTH + 1) },
    { bio: 'x'.repeat(BIO_MAX_LENGTH + 1) },
    { bio: null },
    { profileColor: '#12345' },
    { accentColor: 'blue' },
    { bannerMediaId: 'not-a-uuid' },
  ])('rejects %j', (body) => {
    expect(updateProfileSchema.safeParse(body).success).toBe(false);
  });

  it('caps at the limits exactly', () => {
    expect(
      updateProfileSchema.safeParse({ pronouns: 'x'.repeat(PRONOUNS_MAX_LENGTH) }).success,
    ).toBe(true);
    expect(updateProfileSchema.safeParse({ bio: 'x'.repeat(BIO_MAX_LENGTH) }).success).toBe(true);
  });
});

describe('updateAvailabilitySchema', () => {
  it.each(['online', 'idle', 'dnd', 'invisible'] as const)('accepts %s', (availability) => {
    expect(updateAvailabilitySchema.parse({ availability })).toEqual({ availability });
  });

  it('accepts an optional expiry', () => {
    expect(updateAvailabilitySchema.parse({ availability: 'dnd', until: ISO })).toEqual({
      availability: 'dnd',
      until: ISO,
    });
    expect(updateAvailabilitySchema.parse({ availability: 'dnd', until: null })).toEqual({
      availability: 'dnd',
      until: null,
    });
  });

  it.each([
    {},
    { availability: 'busy' },
    { availability: 'offline' },
    { availability: 'dnd', until: 'tomorrow' },
    { availability: 'dnd', until: 1234 },
  ])('rejects %j', (body) => {
    expect(updateAvailabilitySchema.safeParse(body).success).toBe(false);
  });
});

describe('updatePresenceNoteSchema', () => {
  it('fills omitted fields with null', () => {
    expect(updatePresenceNoteSchema.parse({ text: ' Focus time ' })).toEqual({
      text: 'Focus time',
      emoji: null,
      expiresAt: null,
    });
    expect(updatePresenceNoteSchema.parse({ emoji: '🎉' })).toEqual({
      text: null,
      emoji: '🎉',
      expiresAt: null,
    });
    expect(updatePresenceNoteSchema.parse({ text: 'Away', emoji: '🌴', expiresAt: ISO })).toEqual({
      text: 'Away',
      emoji: '🌴',
      expiresAt: ISO,
    });
  });

  it('needs text or an emoji (blank text counts as none)', () => {
    expect(updatePresenceNoteSchema.safeParse({}).success).toBe(false);
    expect(updatePresenceNoteSchema.safeParse({ text: '   ' }).success).toBe(false);
    expect(updatePresenceNoteSchema.safeParse({ text: null, emoji: null }).success).toBe(false);
    expect(updatePresenceNoteSchema.safeParse({ expiresAt: ISO }).success).toBe(false);
  });

  it.each([
    { text: 'x'.repeat(PRESENCE_NOTE_MAX_LENGTH + 1) },
    { emoji: 'abc' },
    { emoji: '🎉🎉' },
    { text: 'Away', expiresAt: 'soon' },
  ])('rejects %j', (body) => {
    expect(updatePresenceNoteSchema.safeParse(body).success).toBe(false);
  });

  it('caps the text at the limit exactly', () => {
    expect(
      updatePresenceNoteSchema.safeParse({ text: 'x'.repeat(PRESENCE_NOTE_MAX_LENGTH) }).success,
    ).toBe(true);
  });
});

describe('presenceActivitySchema', () => {
  it('accepts the idle flag only as a boolean', () => {
    expect(presenceActivitySchema.parse({ idle: true })).toEqual({ idle: true });
    expect(presenceActivitySchema.parse({ idle: false })).toEqual({ idle: false });
    expect(presenceActivitySchema.safeParse({}).success).toBe(false);
    expect(presenceActivitySchema.safeParse({ idle: 'yes' }).success).toBe(false);
  });
});

describe('chatThemeSchema', () => {
  it('accepts a full theme and normalises the accent to lowercase', () => {
    expect(chatThemeSchema.parse(THEME)).toEqual(THEME);
    expect(chatThemeSchema.parse({ ...THEME, accent: '#33AAFF' })).toEqual({
      ...THEME,
      accent: '#33aaff',
    });
  });

  it('accepts an all-null theme, the animated presets and my own wallpaper upload', () => {
    expect(chatThemeSchema.parse(EMPTY_THEME)).toEqual(EMPTY_THEME);
    expect(
      chatThemeSchema.parse({ ...THEME, wallpaper: { kind: 'preset', id: 'aurora' } }).wallpaper,
    ).toEqual({ kind: 'preset', id: 'aurora' });
    expect(chatThemeSchema.parse({ ...THEME, wallpaper: { kind: 'media' } }).wallpaper).toEqual({
      kind: 'media',
    });
  });

  it('is strict: every field is required and unknown keys are rejected', () => {
    expect(chatThemeSchema.safeParse({ ...THEME, extra: true }).success).toBe(false);
    expect(chatThemeSchema.safeParse({ ...THEME, css: 'body{}' }).success).toBe(false);
    const { dim: _dim, ...withoutDim } = THEME;
    expect(chatThemeSchema.safeParse(withoutDim).success).toBe(false);
    expect(chatThemeSchema.safeParse({}).success).toBe(false);
  });

  it.each([
    { preset: 'neon' },
    { preset: 'Ocean' },
    { bubbleStyle: 'square' },
    { messageAnimation: 'bounce' },
    { accent: 'red' },
    { accent: '#fff' },
    { accent: 'url(https://evil.example/x)' },
    { accent: '#3366ff; background: url(x)' },
    { dim: WALLPAPER_DIM_MAX + 1 },
    { dim: -1 },
    { dim: 1.5 },
    { dim: '30' },
    { blur: WALLPAPER_BLUR_MAX + 1 },
    { wallpaper: { kind: 'preset', id: 'nope' } },
    { wallpaper: { kind: 'preset', id: 'sky', url: 'x' } },
    { wallpaper: { kind: 'media', id: MEDIA_ID } },
    { wallpaper: { kind: 'url', url: 'https://example.com/x.png' } },
    { wallpaper: 'sky' },
  ])('rejects %j', (patch) => {
    expect(chatThemeSchema.safeParse({ ...THEME, ...patch }).success).toBe(false);
  });

  it('caps dim and blur at the limits exactly', () => {
    expect(
      chatThemeSchema.parse({ ...THEME, dim: WALLPAPER_DIM_MAX, blur: WALLPAPER_BLUR_MAX }),
    ).toMatchObject({ dim: WALLPAPER_DIM_MAX, blur: WALLPAPER_BLUR_MAX });
  });
});

describe('sharedChatThemeSchema', () => {
  it('accepts built-in wallpapers and none', () => {
    expect(sharedChatThemeSchema.parse(THEME)).toEqual(THEME);
    expect(sharedChatThemeSchema.parse(EMPTY_THEME)).toEqual(EMPTY_THEME);
  });

  it('rejects a member-private wallpaper upload', () => {
    expect(
      sharedChatThemeSchema.safeParse({ ...THEME, wallpaper: { kind: 'media' } }).success,
    ).toBe(false);
  });

  it('is as strict as the private theme', () => {
    expect(sharedChatThemeSchema.safeParse({ ...THEME, extra: 1 }).success).toBe(false);
    expect(sharedChatThemeSchema.safeParse({ ...THEME, dim: WALLPAPER_DIM_MAX + 1 }).success).toBe(
      false,
    );
  });
});

describe('updateChatPrefsSchema', () => {
  it('accepts the theme and wallpaper prefs, null clearing each', () => {
    expect(
      updateChatPrefsSchema.parse({ theme: THEME, wallpaperMediaId: MEDIA_ID.toUpperCase() }),
    ).toEqual({ theme: THEME, wallpaperMediaId: MEDIA_ID });
    expect(updateChatPrefsSchema.parse({ theme: null, wallpaperMediaId: null })).toEqual({
      theme: null,
      wallpaperMediaId: null,
    });
    expect(updateChatPrefsSchema.parse({ isPinned: true })).toEqual({ isPinned: true });
  });

  it.each([
    { theme: 'ocean' },
    { theme: { ...THEME, extra: true } },
    { theme: { ...THEME, accent: 'red' } },
    { wallpaperMediaId: 'not-a-uuid' },
  ])('rejects %j', (body) => {
    expect(updateChatPrefsSchema.safeParse(body).success).toBe(false);
  });
});

describe('setChatThemeSchema', () => {
  it('takes a shared theme or null', () => {
    expect(setChatThemeSchema.parse({ theme: THEME })).toEqual({ theme: THEME });
    expect(setChatThemeSchema.parse({ theme: null })).toEqual({ theme: null });
  });

  it.each([{}, { theme: { ...THEME, wallpaper: { kind: 'media' } } }, { theme: 'ocean' }])(
    'rejects %j',
    (body) => {
      expect(setChatThemeSchema.safeParse(body).success).toBe(false);
    },
  );
});
