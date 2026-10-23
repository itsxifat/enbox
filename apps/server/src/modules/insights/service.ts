/**
 * Space insights reads (docs/design/discord-parity.md W12-F): the daily rows of a range of
 * UTC days ending today, zeros filled, and the busiest channels the viewer can see. Readers
 * need MANAGE_SPACE or VIEW_AUDIT_LOG (non-members get 404). Every read is an index range:
 * space_stats_daily and space_active_daily by their primary keys, the channel rows by
 * (space_id, day). Counting: ./counters.ts.
 */
import { sql } from 'drizzle-orm';
import {
  PERM,
  hasAnyPerm,
  hasPerm,
  type InsightsDay,
  type SpaceChannelType,
  type SpaceInsights,
} from '@enbox/shared';
import { db } from '../../db/index.js';
import { forbidden } from '../../lib/errors.js';
import {
  channelBits,
  loadChannelOverwrites,
  requireSpaceMember,
  type SpaceAccess,
} from '../../services/spaceAccess.js';
import { num, rawRows } from '../../services/sql.js';
import { utcDay } from './counters.js';

const DAY_MS = 86_400_000;
const TOP_CHANNELS = 10;

/** 404 unless a member, 403 without MANAGE_SPACE or VIEW_AUDIT_LOG. */
export async function requireInsightsAccess(
  viewerId: string,
  spaceId: string,
): Promise<SpaceAccess> {
  const access = await requireSpaceMember(db, spaceId, viewerId);
  if (!hasAnyPerm(access.base, PERM.MANAGE_SPACE | PERM.VIEW_AUDIT_LOG))
    throw forbidden('You need Manage Space or View Audit Log to see Insights');
  return access;
}

/** The `days` UTC days ending on `today`, oldest first. */
export function rangeDays(days: number, today = utcDay()): string[] {
  const end = Date.parse(`${today}T00:00:00.000Z`);
  return Array.from({ length: days }, (_, i) => utcDay(new Date(end - (days - 1 - i) * DAY_MS)));
}

/** One entry per day of `range` (zeros for days without a row). */
export async function insightsDays(
  spaceId: string,
  range: readonly string[],
): Promise<InsightsDay[]> {
  const from = range[0]!;
  const to = range[range.length - 1]!;
  const stats = await rawRows<{
    day: string;
    messages: number;
    joins: number;
    leaves: number;
    voice_minutes: number;
  }>(
    db,
    sql`select day::text as day, messages, joins, leaves, voice_minutes from space_stats_daily
        where space_id = ${spaceId} and day between ${from}::date and ${to}::date`,
  );
  const active = await rawRows<{ day: string; n: number }>(
    db,
    sql`select day::text as day, count(*)::int as n from space_active_daily
        where space_id = ${spaceId} and day between ${from}::date and ${to}::date
        group by day`,
  );
  const byDay = new Map(stats.map((r) => [r.day, r]));
  const activeByDay = new Map(active.map((r) => [r.day, num(r.n)]));
  return range.map((day) => {
    const s = byDay.get(day);
    return {
      day,
      messages: num(s?.messages),
      joins: num(s?.joins),
      leaves: num(s?.leaves),
      activeMembers: activeByDay.get(day) ?? 0,
      voiceMinutes: num(s?.voice_minutes),
    };
  });
}

/** The busiest channels of the range that the viewer can see (most messages first). */
async function topChannels(
  access: SpaceAccess,
  viewerId: string,
  spaceId: string,
  from: string,
  to: string,
): Promise<SpaceInsights['topChannels']> {
  const rows = await rawRows<{ channel_id: string; name: string | null; type: string; n: number }>(
    db,
    sql`select s.channel_id, c.name, c.type, sum(s.messages)::bigint as n
        from space_channel_stats_daily s join chats c on c.id = s.channel_id
        where s.space_id = ${spaceId} and s.day between ${from}::date and ${to}::date
        group by s.channel_id, c.name, c.type
        having sum(s.messages) > 0
        order by n desc, c.name asc, s.channel_id asc`,
  );
  if (rows.length === 0) return [];
  const overwrites = await loadChannelOverwrites(
    db,
    rows.map((r) => r.channel_id),
  );
  const visible = rows.filter((r) =>
    hasPerm(
      channelBits(
        access.ctx,
        viewerId,
        access.me,
        r.type as SpaceChannelType,
        overwrites.get(r.channel_id) ?? [],
        access.base,
      ),
      PERM.VIEW_CHANNEL,
    ),
  );
  return visible
    .slice(0, TOP_CHANNELS)
    .map((r) => ({ channelId: r.channel_id, name: r.name ?? '', messages: num(r.n) }));
}

/** `GET /spaces/:spaceId/insights?days=` */
export async function getSpaceInsights(
  viewerId: string,
  spaceId: string,
  days: number,
): Promise<SpaceInsights> {
  const access = await requireInsightsAccess(viewerId, spaceId);
  const range = rangeDays(days);
  const from = range[0]!;
  const to = range[range.length - 1]!;
  const [head] = await rawRows<{
    member_count: number;
    created_at: string | Date;
    first: string | null;
  }>(
    db,
    sql`select member_count, created_at,
          (select min(day)::text from space_stats_daily where space_id = ${spaceId}) as first
        from spaces where id = ${spaceId}`,
  );
  return {
    spaceId,
    days: await insightsDays(spaceId, range),
    memberCount: num(head?.member_count),
    since: head?.first
      ? new Date(`${head.first}T00:00:00.000Z`).toISOString()
      : new Date(head?.created_at ?? Date.now()).toISOString(),
    topChannels: await topChannels(access, viewerId, spaceId, from, to),
  };
}

const CSV_HEADER = 'day,messages,joins,leaves,active_members,voice_minutes';

/** `GET /spaces/:spaceId/insights.csv?days=`: one row per day, oldest first. */
export async function getSpaceInsightsCsv(
  viewerId: string,
  spaceId: string,
  days: number,
): Promise<{ fileName: string; csv: string }> {
  await requireInsightsAccess(viewerId, spaceId);
  const range = rangeDays(days);
  const rows = (await insightsDays(spaceId, range)).map((d) =>
    [d.day, d.messages, d.joins, d.leaves, d.activeMembers, d.voiceMinutes].join(','),
  );
  return {
    fileName: `insights-${range[range.length - 1]}-${days}d.csv`,
    csv: [CSV_HEADER, ...rows].join('\n') + '\n',
  };
}
