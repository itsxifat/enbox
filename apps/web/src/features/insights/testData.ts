/** Test data for the Insights page: UTC days ending on a fixed day. */
import type { InsightsDay, SpaceInsights } from '@enbox/shared';

export const LAST_DAY = '2026-10-23';

/** `n` days ending on `end`, oldest first; `fill(i)` sets the counts (zeros otherwise). */
export function makeDays(
  n: number,
  fill: (i: number) => Partial<Omit<InsightsDay, 'day'>> = () => ({}),
  end = LAST_DAY,
): InsightsDay[] {
  const last = Date.parse(`${end}T00:00:00.000Z`);
  return Array.from({ length: n }, (_, i) => ({
    day: new Date(last - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10),
    messages: 0,
    joins: 0,
    leaves: 0,
    activeMembers: 0,
    voiceMinutes: 0,
    ...fill(i),
  }));
}

export function makeInsights(
  n: number,
  fill?: (i: number) => Partial<Omit<InsightsDay, 'day'>>,
  p: Partial<Omit<SpaceInsights, 'days'>> = {},
): SpaceInsights {
  return {
    spaceId: 's1',
    days: makeDays(n, fill),
    memberCount: 12,
    since: '2026-01-01T00:00:00.000Z',
    topChannels: [],
    ...p,
  };
}
