import { describe, expect, it } from 'vitest';

import { CHAT_THEME_PRESET_LABELS, CHAT_THEME_PRESETS } from './constants.js';
import type { ChatTheme, PresenceNote } from './models.js';
import {
  activePresenceNote,
  effectiveAvailability,
  isDnd,
  isSharedChatTheme,
  systemEventText,
} from './utils.js';

const NOW = Date.parse('2026-09-26T12:00:00.000Z');
const past = '2026-09-26T11:59:59.999Z';
const future = '2026-09-26T12:00:00.001Z';

describe('effectiveAvailability', () => {
  it('returns the choice while it has no expiry', () => {
    expect(effectiveAvailability({ availability: 'dnd', availabilityUntil: null }, NOW)).toBe(
      'dnd',
    );
    expect(effectiveAvailability({ availability: 'invisible', availabilityUntil: null }, NOW)).toBe(
      'invisible',
    );
  });

  it('keeps the choice until the expiry passes, then reverts to online', () => {
    expect(effectiveAvailability({ availability: 'idle', availabilityUntil: future }, NOW)).toBe(
      'idle',
    );
    expect(effectiveAvailability({ availability: 'idle', availabilityUntil: past }, NOW)).toBe(
      'online',
    );
    // Exactly at the expiry the choice is over.
    expect(
      effectiveAvailability(
        { availability: 'dnd', availabilityUntil: new Date(NOW).toISOString() },
        NOW,
      ),
    ).toBe('online');
  });

  it('accepts a Date (database rows) as well as an ISO string', () => {
    expect(
      effectiveAvailability({ availability: 'dnd', availabilityUntil: new Date(future) }, NOW),
    ).toBe('dnd');
    expect(
      effectiveAvailability({ availability: 'dnd', availabilityUntil: new Date(past) }, NOW),
    ).toBe('online');
  });

  it('is online whatever a stale expiry says', () => {
    expect(effectiveAvailability({ availability: 'online', availabilityUntil: future }, NOW)).toBe(
      'online',
    );
  });
});

describe('isDnd', () => {
  it('is true only for an unexpired dnd choice', () => {
    expect(isDnd({ availability: 'dnd', availabilityUntil: null }, NOW)).toBe(true);
    expect(isDnd({ availability: 'dnd', availabilityUntil: future }, NOW)).toBe(true);
    expect(isDnd({ availability: 'dnd', availabilityUntil: past }, NOW)).toBe(false);
    expect(isDnd({ availability: 'idle', availabilityUntil: null }, NOW)).toBe(false);
    expect(isDnd({ availability: 'invisible', availabilityUntil: null }, NOW)).toBe(false);
  });
});

describe('activePresenceNote', () => {
  const note: PresenceNote = { text: 'Focus time', emoji: null, expiresAt: null };

  it('passes an unset note through as null', () => {
    expect(activePresenceNote(null, NOW)).toBeNull();
    expect(activePresenceNote(undefined, NOW)).toBeNull();
  });

  it('returns the note while it has not expired', () => {
    expect(activePresenceNote(note, NOW)).toBe(note);
    const timed = { ...note, expiresAt: future };
    expect(activePresenceNote(timed, NOW)).toBe(timed);
  });

  it('hides an expired note', () => {
    expect(activePresenceNote({ ...note, expiresAt: past }, NOW)).toBeNull();
    expect(activePresenceNote({ ...note, expiresAt: new Date(NOW).toISOString() }, NOW)).toBeNull();
  });
});

describe('systemEventText: theme_changed', () => {
  const nameOf = (id: string) => (id === 'me' ? 'You' : 'Alex');

  it('names the preset, or says the theme was removed', () => {
    expect(
      systemEventText({ kind: 'theme_changed', actorId: 'alex', preset: 'ocean' }, nameOf),
    ).toBe('Alex changed the chat theme to Ocean');
    expect(systemEventText({ kind: 'theme_changed', actorId: 'me', preset: null }, nameOf)).toBe(
      'You removed the chat theme',
    );
  });

  it('has a label for every preset, whatever the chat kind', () => {
    for (const preset of CHAT_THEME_PRESETS) {
      expect(
        systemEventText({ kind: 'theme_changed', actorId: 'alex', preset }, nameOf, 'channel'),
      ).toBe(`Alex changed the chat theme to ${CHAT_THEME_PRESET_LABELS[preset]}`);
    }
  });
});

describe('isSharedChatTheme', () => {
  const theme: ChatTheme = {
    preset: 'forest',
    bubbleStyle: null,
    accent: null,
    wallpaper: null,
    dim: 0,
    blur: 0,
    messageAnimation: null,
  };

  it('allows no wallpaper and built-in wallpapers', () => {
    expect(isSharedChatTheme(theme)).toBe(true);
    expect(isSharedChatTheme({ ...theme, wallpaper: { kind: 'preset', id: 'waves' } })).toBe(true);
  });

  it('refuses a theme showing my own wallpaper upload', () => {
    expect(isSharedChatTheme({ ...theme, wallpaper: { kind: 'media' } })).toBe(false);
  });
});
