import { describe, expect, it } from 'vitest';
import {
  formatChatListTime,
  formatCount,
  formatDaySeparator,
  formatLastSeen,
  formatRelativeShort,
  formatTime,
  initials,
  isSameLocalDay,
} from './format';

const locale = 'en-GB';
// Wednesday 12 March 2025, 15:00 local time.
const now = new Date(2025, 2, 12, 15, 0);
const at = (d: number, h = 10, m = 42) => new Date(2025, 2, d, h, m).toISOString();

describe('formatTime', () => {
  it('pads 24-hour locales and drops the leading zero in 12-hour locales', () => {
    expect(formatTime(at(12, 9, 5), { locale: 'en-GB' })).toBe('09:05');
    expect(formatTime(at(12, 9, 5), { locale: 'en-US' })).toMatch(/^9:05\sAM$/);
  });
});

describe('formatChatListTime', () => {
  it('shows time today, "Yesterday", weekday within a week, else a date', () => {
    expect(formatChatListTime(at(12), { now, locale })).toBe('10:42');
    expect(formatChatListTime(at(11), { now, locale })).toBe('Yesterday');
    expect(formatChatListTime(at(7), { now, locale })).toBe('Friday');
    expect(formatChatListTime(at(1), { now, locale })).toBe('01/03/2025');
  });
});

describe('formatDaySeparator', () => {
  it('uses Today / Yesterday / weekday / day month (year when different)', () => {
    expect(formatDaySeparator(at(12), { now, locale })).toBe('Today');
    expect(formatDaySeparator(at(11), { now, locale })).toBe('Yesterday');
    expect(formatDaySeparator(at(9), { now, locale })).toBe('Sunday');
    expect(formatDaySeparator(at(1), { now, locale })).toBe('1 March');
    expect(formatDaySeparator(new Date(2024, 11, 24).toISOString(), { now, locale })).toBe(
      '24 December 2024',
    );
  });
});

describe('formatLastSeen', () => {
  it('formats presence', () => {
    expect(formatLastSeen({ online: true, lastSeenAt: null }, { now, locale })).toBe('online');
    expect(formatLastSeen({ online: false, lastSeenAt: at(12) }, { now, locale })).toBe(
      'last seen today at 10:42',
    );
    expect(formatLastSeen({ online: false, lastSeenAt: at(11, 21, 3) }, { now, locale })).toBe(
      'last seen yesterday at 21:03',
    );
    expect(formatLastSeen({ online: false, lastSeenAt: at(10, 9, 15) }, { now, locale })).toBe(
      'last seen Monday at 09:15',
    );
    expect(formatLastSeen({ online: false, lastSeenAt: at(1) }, { now, locale })).toBe(
      'last seen 01/03/2025',
    );
    expect(formatLastSeen({ online: false, lastSeenAt: null }, { now, locale })).toBe('');
    expect(formatLastSeen(undefined)).toBe('');
  });
});

describe('misc helpers', () => {
  it('formatRelativeShort', () => {
    expect(formatRelativeShort(new Date(now.getTime() - 20_000), { now, locale })).toBe('Just now');
    expect(formatRelativeShort(new Date(now.getTime() - 12 * 60_000), { now, locale })).toBe(
      '12 minutes ago',
    );
    expect(formatRelativeShort(at(12), { now, locale })).toBe('Today, 10:42');
    expect(formatRelativeShort(at(11), { now, locale })).toBe('Yesterday, 10:42');
  });

  it('isSameLocalDay', () => {
    expect(isSameLocalDay(at(12, 0, 1), at(12, 23, 59))).toBe(true);
    expect(isSameLocalDay(at(12, 23, 59), at(13, 0, 1))).toBe(false);
  });

  it('formatCount', () => {
    expect(formatCount(999)).toBe('999');
    expect(formatCount(1200)).toBe('1.2K');
    expect(formatCount(12_345)).toBe('12K');
    expect(formatCount(1_300_000)).toBe('1.3M');
  });

  it('initials', () => {
    expect(initials('Ada Lovelace')).toBe('AL');
    expect(initials('ada')).toBe('A');
    expect(initials('  Grace  Brewster Hopper ')).toBe('GH');
    expect(initials('')).toBe('?');
    expect(initials('😀 Smile')).toBe('😀S');
  });
});
