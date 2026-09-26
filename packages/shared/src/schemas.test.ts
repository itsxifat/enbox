import { describe, expect, it } from 'vitest';

import { BIO_MAX_LENGTH, PRESENCE_NOTE_MAX_LENGTH, PRONOUNS_MAX_LENGTH } from './constants.js';
import {
  hexColorSchema,
  presenceActivitySchema,
  updateAvailabilitySchema,
  updatePresenceNoteSchema,
  updateProfileSchema,
} from './schemas.js';

const ISO = '2026-09-26T12:00:00.000Z';

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
