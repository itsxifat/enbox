/**
 * Pure numbers of the Insights page: totals and averages of a range, the change against the
 * previous period (when counting covered all of it), the tiles, the chart summaries read to
 * screen readers, and number and day formatting. Days are UTC days (`YYYY-MM-DD`).
 */
import type { InsightsDay, SpaceInsights } from '@enbox/shared';

export type InsightsRange = 7 | 30 | 90;
export type DayMetric = 'messages' | 'joins' | 'leaves' | 'activeMembers' | 'voiceMinutes';

/**
 * The range fetched to compare a range with the one before it: the API serves 7, 30 or 90
 * days, so 7 days compare within 30 and 30 within 90; 90 days have nothing to compare with.
 */
export const COMPARISON_RANGE: Record<InsightsRange, InsightsRange | null> = {
  7: 30,
  30: 90,
  90: null,
};

export function total(days: readonly InsightsDay[], key: DayMetric): number {
  return days.reduce((sum, d) => sum + d[key], 0);
}

export function average(days: readonly InsightsDay[], key: DayMetric): number {
  return days.length ? total(days, key) / days.length : 0;
}

/** Anything that is activity (not only joins and leaves) on any day. */
export function hasActivity(days: readonly InsightsDay[]): boolean {
  return days.some((d) => d.messages > 0 || d.voiceMinutes > 0 || d.activeMembers > 0);
}

/**
 * The `range` days before the last `range` days of `wide` (oldest first): null when `wide`
 * is too short, doesn't end on the same day as `current`, or counting started inside it
 * (its zeros would not be real).
 */
export function previousPeriod(
  wide: readonly InsightsDay[] | null | undefined,
  current: readonly InsightsDay[],
  since: string,
): InsightsDay[] | null {
  const n = current.length;
  if (!wide || n === 0 || wide.length < n * 2) return null;
  if (wide[wide.length - 1]!.day !== current[n - 1]!.day) return null;
  const prev = wide.slice(wide.length - n * 2, wide.length - n);
  if (since.slice(0, 10) > prev[0]!.day) return null;
  return prev;
}

/** Percent change (null when the previous value is 0: nothing to compare with). */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

export interface Delta {
  text: string;
  direction: 'up' | 'down' | 'flat';
  /** The change is good news (more messages, fewer leaves). */
  good: boolean;
}

export interface Tile {
  key: 'members' | DayMetric;
  label: string;
  value: string;
  /** What the value is, when the label alone doesn't say it. */
  caption?: string;
  delta: Delta | null;
}

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat();
const oneDecimal = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

/** Tile values: 1,284 up to 9,999, then 12.9K / 4.2M. */
export function formatValue(n: number): string {
  return Math.abs(n) < 10_000 ? whole.format(Math.round(n)) : compact.format(n);
}

/** Axis ticks: 0 / 500 / 1K / 1.5K. */
export function formatTick(n: number): string {
  return compact.format(n);
}

/** Averages: one decimal under 10 (2.4 a day), whole numbers above. */
export function formatAverage(n: number): string {
  return n < 10 ? oneDecimal.format(n) : whole.format(Math.round(n));
}

const dayDate = (day: string) => new Date(`${day}T00:00:00.000Z`);
const shortDay = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});
const longDay = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});
const fullDay = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

/** Axis labels: "Oct 23". */
export const formatDayShort = (day: string) => shortDay.format(dayDate(day));
/** Tooltips: "Thu, Oct 23". */
export const formatDayLong = (day: string) => longDay.format(dayDate(day));
/** Captions: "Oct 23, 2026". */
export const formatDayFull = (day: string) => fullDay.format(dayDate(day));

function changeDelta(
  current: number,
  previous: number,
  range: number,
  upIsGood: boolean,
): Delta | null {
  const pct = percentChange(current, previous);
  if (pct === null) return null;
  const rounded = Math.round(Math.abs(pct));
  const direction = rounded === 0 ? 'flat' : pct > 0 ? 'up' : 'down';
  return {
    text:
      direction === 'flat'
        ? `No change vs previous ${range} days`
        : `${whole.format(rounded)}% vs previous ${range} days`,
    direction,
    good: direction === 'flat' || (direction === 'up') === upIsGood,
  };
}

/**
 * The six tiles: members (with the net change of the range), messages, active members (a
 * daily average), voice minutes, joins and leaves; each compared with the previous period
 * when there is one.
 */
export function summaryTiles(
  data: Pick<SpaceInsights, 'days' | 'memberCount'>,
  previous: readonly InsightsDay[] | null,
): Tile[] {
  const days = data.days;
  const range = days.length;
  const net = total(days, 'joins') - total(days, 'leaves');
  const vs = (key: DayMetric, upIsGood = true, avg = false) => {
    if (!previous) return null;
    const pick = avg ? average : total;
    return changeDelta(pick(days, key), pick(previous, key), range, upIsGood);
  };
  return [
    {
      key: 'members',
      label: 'Members',
      value: formatValue(data.memberCount),
      delta: {
        text:
          net === 0
            ? `No change in ${range} days`
            : `${net > 0 ? '+' : '−'}${whole.format(Math.abs(net))} in ${range} days`,
        direction: net === 0 ? 'flat' : net > 0 ? 'up' : 'down',
        good: net >= 0,
      },
    },
    {
      key: 'messages',
      label: 'Messages',
      value: formatValue(total(days, 'messages')),
      delta: vs('messages'),
    },
    {
      key: 'activeMembers',
      label: 'Active members',
      value: formatAverage(average(days, 'activeMembers')),
      caption: 'a day on average',
      delta: vs('activeMembers', true, true),
    },
    {
      key: 'voiceMinutes',
      label: 'Voice minutes',
      value: formatValue(total(days, 'voiceMinutes')),
      delta: vs('voiceMinutes'),
    },
    { key: 'joins', label: 'Joins', value: formatValue(total(days, 'joins')), delta: vs('joins') },
    {
      key: 'leaves',
      label: 'Leaves',
      value: formatValue(total(days, 'leaves')),
      delta: vs('leaves', false),
    },
  ];
}

/** "Messages per day, Oct 17 to Oct 23: 1,284 in all, most on Oct 20 (310)." */
export function seriesSummary(
  title: string,
  days: readonly InsightsDay[],
  values: readonly number[],
  opts: { average?: boolean } = {},
): string {
  if (days.length === 0) return `${title}: no data`;
  const span = `${formatDayShort(days[0]!.day)} to ${formatDayShort(days[days.length - 1]!.day)}`;
  const sum = values.reduce((a, b) => a + b, 0);
  if (sum === 0) return `${title} per day, ${span}: none`;
  let peak = 0;
  values.forEach((v, i) => {
    if (v > values[peak]!) peak = i;
  });
  const amount = opts.average
    ? `${formatAverage(sum / values.length)} a day on average`
    : `${whole.format(sum)} in all`;
  return `${title} per day, ${span}: ${amount}, most on ${formatDayShort(days[peak]!.day)} (${whole.format(values[peak]!)}).`;
}
