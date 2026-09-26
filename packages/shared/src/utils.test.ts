import { describe, expect, it } from 'vitest';

import type { PresenceNote } from './models.js';
import { activePresenceNote, effectiveAvailability, isDnd } from './utils.js';

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
