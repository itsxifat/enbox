import { describe, expect, it } from 'vitest';
import {
  formatReminderTime,
  fromInputs,
  presetLabel,
  presetTime,
  toDateInput,
  toTimeInput,
} from './reminders';

// Thursday 23 October 2026, 14:10 local time.
const NOW = new Date(2026, 9, 23, 14, 10);

describe('Remind Me presets', () => {
  it('lands in 20 minutes, 1 or 3 hours, tomorrow at 9:00 and next Monday at 9:00', () => {
    expect(presetTime('in20m', NOW)).toEqual(new Date(2026, 9, 23, 14, 30));
    expect(presetTime('in1h', NOW)).toEqual(new Date(2026, 9, 23, 15, 10));
    expect(presetTime('in3h', NOW)).toEqual(new Date(2026, 9, 23, 17, 10));
    expect(presetTime('tomorrow', NOW)).toEqual(new Date(2026, 9, 24, 9, 0));
    expect(presetTime('nextWeek', NOW)).toEqual(new Date(2026, 9, 26, 9, 0));
    // On a Monday, next week is the Monday after.
    expect(presetTime('nextWeek', new Date(2026, 9, 26, 8, 0))).toEqual(
      new Date(2026, 10, 2, 9, 0),
    );
  });

  it('labels each with when it lands', () => {
    expect(presetLabel('in20m', NOW).label).toBe('In 20 minutes');
    expect(presetLabel('tomorrow', NOW).label).toBe('Tomorrow');
    expect(presetLabel('nextWeek', NOW).hint).toMatch(/^Mon/);
  });
});

describe('formatReminderTime', () => {
  it('says today, tomorrow, yesterday, else the date', () => {
    expect(formatReminderTime(new Date(2026, 9, 23, 18, 0).toISOString(), NOW)).toMatch(
      /^Today at /,
    );
    expect(formatReminderTime(new Date(2026, 9, 24, 9, 0).toISOString(), NOW)).toMatch(
      /^Tomorrow at /,
    );
    expect(formatReminderTime(new Date(2026, 9, 22, 9, 0).toISOString(), NOW)).toMatch(
      /^Yesterday at /,
    );
    const later = formatReminderTime(new Date(2026, 9, 27, 9, 0).toISOString(), NOW);
    expect(later).toMatch(/27/);
    expect(later).not.toMatch(/2026/);
    expect(formatReminderTime(new Date(2027, 0, 5, 9, 0).toISOString(), NOW)).toMatch(/2027/);
  });
});

describe('date and time inputs', () => {
  it('round-trips a local time and refuses incomplete input', () => {
    const d = new Date(2026, 9, 24, 9, 5);
    expect(toDateInput(d)).toBe('2026-10-24');
    expect(toTimeInput(d)).toBe('09:05');
    expect(fromInputs('2026-10-24', '09:05')).toEqual(d);
    expect(fromInputs('', '09:05')).toBeNull();
    expect(fromInputs('2026-10-24', '')).toBeNull();
  });
});
