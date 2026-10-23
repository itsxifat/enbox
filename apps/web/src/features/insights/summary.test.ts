/** Insights numbers: totals, the previous period, the change against it, the tiles and the summaries. */
import { describe, expect, it } from 'vitest';
import {
  average,
  formatAverage,
  formatDayShort,
  formatTick,
  formatValue,
  hasActivity,
  percentChange,
  previousPeriod,
  seriesSummary,
  summaryTiles,
  total,
} from './summary';
import { makeDays } from './testData';

/** The browser's grouping (1,284 / 1.284): expectations follow the test machine's locale. */
const n = (x: number) => new Intl.NumberFormat().format(x);

describe('totals', () => {
  it('sums and averages a metric; activity is more than joins and leaves', () => {
    const days = makeDays(3, (i) => ({ messages: i + 1, activeMembers: i }));
    expect(total(days, 'messages')).toBe(6);
    expect(average(days, 'activeMembers')).toBe(1);
    expect(average([], 'messages')).toBe(0);
    expect(hasActivity(makeDays(5, () => ({ joins: 2, leaves: 1 })))).toBe(false);
    expect(hasActivity(makeDays(5, (i) => (i === 3 ? { voiceMinutes: 1 } : {})))).toBe(true);
  });

  it('formats values in full up to 9,999, compact above; averages keep one decimal under 10', () => {
    expect(formatValue(1284)).toBe(n(1284));
    expect(formatValue(12_900)).toBe(
      new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(
        12_900,
      ),
    );
    expect(formatTick(0)).toBe('0');
    expect(formatAverage(2.44)).toBe(
      new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(2.4),
    );
    expect(formatAverage(38.6)).toBe('39');
  });
});

describe('previous period', () => {
  const wide = makeDays(30, (i) => ({ messages: i }));
  const week = wide.slice(-7);
  const before = '2026-01-01T00:00:00.000Z';

  it('is the same number of days just before the range', () => {
    const prev = previousPeriod(wide, week, before)!;
    expect(prev.map((d) => d.day)).toEqual(wide.slice(16, 23).map((d) => d.day));
  });

  it('is missing when the wider range is short, ends on another day, or counting started inside it', () => {
    expect(previousPeriod(null, week, before)).toBeNull();
    expect(previousPeriod(wide.slice(-10), week, before)).toBeNull();
    expect(previousPeriod(wide.slice(0, -1), week, before)).toBeNull();
    expect(previousPeriod(wide, week, `${wide[20]!.day}T00:00:00.000Z`)).toBeNull();
    // Counting that started on the first day of the previous period covers it.
    expect(previousPeriod(wide, week, `${wide[16]!.day}T00:00:00.000Z`)).toHaveLength(7);
  });

  it('percent change needs something to compare with', () => {
    expect(percentChange(150, 100)).toBe(50);
    expect(percentChange(50, 100)).toBe(-50);
    expect(percentChange(5, 0)).toBeNull();
  });
});

describe('tiles', () => {
  const days = makeDays(7, (i) => ({
    messages: 10,
    joins: i === 0 ? 3 : 0,
    leaves: i === 1 ? 1 : 0,
    activeMembers: 4,
    voiceMinutes: 30,
  }));

  it('members show the net change; without a previous period nothing else compares', () => {
    const tiles = summaryTiles({ days, memberCount: 1284 }, null);
    expect(tiles.map((t) => [t.label, t.value])).toEqual([
      ['Members', n(1284)],
      ['Messages', '70'],
      ['Active members', '4'],
      ['Voice minutes', '210'],
      ['Joins', '3'],
      ['Leaves', '1'],
    ]);
    expect(tiles[0]!.delta).toEqual({ text: '+2 in 7 days', direction: 'up', good: true });
    expect(tiles.slice(1).every((t) => t.delta === null)).toBe(true);
    expect(tiles[2]!.caption).toBe('a day on average');
    const lost = summaryTiles({ days: makeDays(7, () => ({ leaves: 1 })), memberCount: 3 }, null);
    expect(lost[0]!.delta).toEqual({ text: '−7 in 7 days', direction: 'down', good: false });
  });

  it('compare with the previous period: more leaves is bad news, an equal count no change', () => {
    const previous = makeDays(7, (i) => ({
      messages: 5,
      joins: i === 0 ? 3 : 0,
      activeMembers: 5,
      voiceMinutes: i === 0 ? 210 : 0,
    }));
    const byKey = Object.fromEntries(
      summaryTiles({ days, memberCount: 10 }, previous).map((t) => [t.key, t.delta]),
    );
    expect(byKey.messages).toEqual({
      text: '100% vs previous 7 days',
      direction: 'up',
      good: true,
    });
    expect(byKey.activeMembers).toEqual({
      text: '20% vs previous 7 days',
      direction: 'down',
      good: false,
    });
    expect(byKey.voiceMinutes).toEqual({
      text: 'No change vs previous 7 days',
      direction: 'flat',
      good: true,
    });
    expect(byKey.joins).toMatchObject({ direction: 'flat' });
    // No leaves before: nothing to compare with.
    expect(byKey.leaves).toBeNull();
    const more = summaryTiles({ days: makeDays(7, () => ({ leaves: 2 })), memberCount: 10 }, days);
    expect(more.find((t) => t.key === 'leaves')!.delta).toEqual({
      text: `${n(1300)}% vs previous 7 days`,
      direction: 'up',
      good: false,
    });
  });
});

describe('summaries', () => {
  it('say the span, the amount and the busiest day', () => {
    const days = makeDays(3, (i) => ({ messages: [2, 9, 4][i] }));
    const values = days.map((d) => d.messages);
    const span = `${formatDayShort('2026-10-21')} to ${formatDayShort('2026-10-23')}`;
    expect(seriesSummary('Messages', days, values)).toBe(
      `Messages per day, ${span}: 15 in all, most on ${formatDayShort('2026-10-22')} (9).`,
    );
    expect(seriesSummary('Active members', days, values, { average: true })).toBe(
      `Active members per day, ${span}: 5 a day on average, most on ${formatDayShort('2026-10-22')} (9).`,
    );
    expect(seriesSummary('Joins', days, [0, 0, 0])).toBe(`Joins per day, ${span}: none`);
    expect(seriesSummary('Joins', [], [])).toBe('Joins: no data');
  });
});
