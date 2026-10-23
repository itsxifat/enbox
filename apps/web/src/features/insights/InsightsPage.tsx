/**
 * Space Settings ▸ Insights (MANAGE_SPACE or VIEW_AUDIT_LOG; docs/design/discord-parity.md
 * W12-F): a 7 / 30 / 90 day range over the activity counted per UTC day. Tiles (members with
 * the range's net change; messages, active members a day, voice minutes, joins and leaves
 * against the previous period when counting covered it), then messages per day, joins and
 * leaves, active members per day, the top channels I can see, and the range as CSV. A Space
 * without activity yet gets an empty state. Switching ranges keeps the last render, dimmed,
 * until the new one arrives.
 */
import { useEffect, useId, useState, type ReactNode } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  ChartColumn,
  Download,
  Hash,
  Images,
  Megaphone,
  MessagesSquare,
  Minus,
  Podcast,
  Table2,
  Volume2,
} from 'lucide-react';
import { INSIGHTS_RANGES, type InsightsDay, type Space, type SpaceInsights } from '@enbox/shared';
import { Button, EmptyState, Spinner, Tabs, toast } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useChats } from '@/stores/chats';
import { CHART_COLORS, DataTable, DivergingBarChart, LegendItem, LineChart } from './charts';
import { downloadInsightsCsv, fetchInsights } from './insightsApi';
import {
  COMPARISON_RANGE,
  formatDayFull,
  formatValue,
  hasActivity,
  previousPeriod,
  seriesSummary,
  summaryTiles,
  total,
  type InsightsRange,
  type Tile,
} from './summary';

interface Loaded {
  data: SpaceInsights;
  /** The wider range the previous period comes from (null: none, or it failed). */
  wide: SpaceInsights | null;
}

/** The range and, for 7 and 30 days, the wider one to compare with (fetched together). */
function useInsights(spaceId: string, range: InsightsRange) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    const wideRange = COMPARISON_RANGE[range];
    Promise.all([
      fetchInsights(spaceId, range, ctrl.signal),
      wideRange ? fetchInsights(spaceId, wideRange, ctrl.signal).catch(() => null) : null,
    ])
      .then(([data, wide]) => {
        if (ctrl.signal.aborted) return;
        setLoaded({ data, wide });
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return;
        setError(errorMessage(e, 'Could not load Insights'));
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [spaceId, range, attempt]);
  return { loaded, error, loading, retry: () => setAttempt((n) => n + 1) };
}

const RANGE_ITEMS = INSIGHTS_RANGES.map((n) => ({ value: String(n), label: `${n} days` }));

export function InsightsPage({ space }: { space: Space }) {
  const [range, setRange] = useState<InsightsRange>(30);
  const insights = useInsights(space.id, range);
  const { error, loading, retry } = insights;
  // Another Space's numbers never stand in while this one's load.
  const loaded = insights.loaded?.data.spaceId === space.id ? insights.loaded : null;
  const [exporting, setExporting] = useState(false);

  const exportCsv = async () => {
    setExporting(true);
    try {
      await downloadInsightsCsv(space.id, range);
    } catch (e) {
      toast.error(e);
    } finally {
      setExporting(false);
    }
  };

  let body: ReactNode;
  if (!loaded) {
    body = error ? (
      <div className="flex flex-col items-start gap-3">
        <p className="text-danger">{error}</p>
        <Button size="sm" variant="secondary" onClick={retry}>
          Try again
        </Button>
      </div>
    ) : (
      <Spinner />
    );
  } else {
    body = (
      <div
        className={cn(
          'flex flex-col gap-6',
          loading && 'opacity-60 motion-safe:transition-opacity',
        )}
        aria-busy={loading}
      >
        {error ? <p className="text-[13px] text-danger">{error}</p> : null}
        <InsightsBody {...loaded} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6" data-testid="insights-page">
      <div className="flex flex-wrap items-center gap-3">
        <Tabs
          variant="chips"
          aria-label="Date range"
          value={String(range)}
          onChange={(v) => setRange(Number(v) as InsightsRange)}
          items={RANGE_ITEMS}
        />
        <Button
          size="sm"
          variant="secondary"
          leftIcon={Download}
          loading={exporting}
          onClick={() => void exportCsv()}
          className="ml-auto"
          data-testid="insights-export"
        >
          Export CSV
        </Button>
      </div>
      {body}
    </div>
  );
}

function InsightsBody({ data, wide }: Loaded) {
  const days = data.days;
  // New Spaces: nothing in this range nor in the wider one (a quiet week still gets charts).
  if (!hasActivity(days) && !(wide && hasActivity(wide.days)))
    return (
      <section className="card-inset" data-testid="insights-empty">
        <EmptyState
          icon={ChartColumn}
          title="No activity yet"
          description="Insights fill in as your Space gets activity."
        />
      </section>
    );
  const dayList = days.map((d) => d.day);
  const previous = previousPeriod(wide?.days, days, data.since);
  const sinceDay = data.since.slice(0, 10);
  const series = (key: keyof Omit<InsightsDay, 'day'>) => days.map((d) => d[key]);
  const messages = series('messages');
  const active = series('activeMembers');
  const joins = series('joins');
  const leaves = series('leaves');
  return (
    <>
      {sinceDay > dayList[0]! ? (
        <p className="text-[13px] text-muted" data-testid="insights-since">
          Counting started on {formatDayFull(sinceDay)}; earlier days weren’t counted.
        </p>
      ) : null}
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Summary">
        {summaryTiles(data, previous).map((tile) => (
          <SummaryTile key={tile.key} tile={tile} />
        ))}
      </ul>
      <ChartCard
        title="Messages"
        headline={`${formatValue(total(days, 'messages'))} in ${days.length} days`}
        chart={
          <LineChart
            area
            days={dayList}
            values={messages}
            label="messages"
            summary={seriesSummary('Messages', days, messages)}
          />
        }
        table={
          <DataTable
            caption="Messages per day"
            days={dayList}
            columns={[{ label: 'Messages', values: messages }]}
          />
        }
      />
      <ChartCard
        title="Joins and leaves"
        headline={`${formatValue(total(days, 'joins'))} joined, ${formatValue(total(days, 'leaves'))} left`}
        legend={
          <span className="flex items-center gap-3">
            <LegendItem color="var(--chart-1)" shape="bar">
              Joins
            </LegendItem>
            <LegendItem color="var(--chart-2)" shape="bar">
              Leaves
            </LegendItem>
          </span>
        }
        chart={
          <DivergingBarChart
            days={dayList}
            up={joins}
            down={leaves}
            labels={{ up: 'joined', down: 'left' }}
            summary={`${seriesSummary('Joins', days, joins)} ${seriesSummary('Leaves', days, leaves)}`}
          />
        }
        table={
          <DataTable
            caption="Joins and leaves per day"
            days={dayList}
            columns={[
              { label: 'Joins', values: joins },
              { label: 'Leaves', values: leaves },
            ]}
          />
        }
      />
      <ChartCard
        title="Active members"
        headline="Members who sent a message or were in voice, per day"
        chart={
          <LineChart
            days={dayList}
            values={active}
            label="active"
            summary={seriesSummary('Active members', days, active, { average: true })}
          />
        }
        table={
          <DataTable
            caption="Active members per day"
            days={dayList}
            columns={[{ label: 'Active members', values: active }]}
          />
        }
      />
      <TopChannels channels={data.topChannels} days={days.length} />
    </>
  );
}

function SummaryTile({ tile }: { tile: Tile }) {
  const d = tile.delta;
  const Arrow =
    d?.direction === 'up' ? ArrowUpRight : d?.direction === 'down' ? ArrowDownRight : Minus;
  return (
    <li className="card-inset flex min-w-0 flex-col gap-1 p-4" data-testid={`tile-${tile.key}`}>
      <span className="text-[13px] font-medium text-muted">{tile.label}</span>
      <span className="text-[24px] leading-tight font-semibold text-fg">
        {tile.value}
        {tile.caption ? (
          <span className="ml-1.5 text-[12px] font-normal text-muted">{tile.caption}</span>
        ) : null}
      </span>
      {d ? (
        <span
          className={cn(
            'flex items-start gap-1 text-[12px]',
            d.direction === 'flat' ? 'text-muted' : d.good ? 'text-success' : 'text-danger',
          )}
          data-testid={`delta-${tile.key}`}
        >
          <Arrow size={14} className="mt-px shrink-0" aria-hidden />
          {d.text}
        </span>
      ) : null}
    </li>
  );
}

function ChartCard({
  title,
  headline,
  legend,
  chart,
  table,
}: {
  title: string;
  headline?: string;
  legend?: ReactNode;
  chart: ReactNode;
  table: ReactNode;
}) {
  const [asTable, setAsTable] = useState(false);
  const id = useId();
  return (
    <section className="card-inset flex flex-col gap-3 p-4" aria-labelledby={id}>
      <header className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <h3 id={id} className="text-[15px] font-semibold">
            {title}
          </h3>
          {headline ? <p className="text-[13px] text-muted">{headline}</p> : null}
        </div>
        {legend}
        <Button
          size="sm"
          variant="ghost"
          leftIcon={Table2}
          aria-pressed={asTable}
          onClick={() => setAsTable((v) => !v)}
        >
          Table
        </Button>
      </header>
      {asTable ? table : chart}
    </section>
  );
}

function channelIcon(type: string | undefined, isNews: boolean | undefined, media?: boolean) {
  if (type === 'space_voice') return Volume2;
  if (type === 'space_stage') return Podcast;
  if (type === 'space_forum') return media ? Images : MessagesSquare;
  return isNews ? Megaphone : Hash;
}

function TopChannelRow({
  channel,
  max,
}: {
  channel: SpaceInsights['topChannels'][number];
  max: number;
}) {
  const chat = useChats((s) => s.byId[channel.channelId]);
  const Icon = channelIcon(chat?.type, chat?.space?.isNews, chat?.space?.forum?.settings.media);
  return (
    <li className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)_auto] items-center gap-3 text-[14px]">
      <span className="flex min-w-0 items-center gap-1.5">
        <Icon size={16} className="shrink-0 text-muted" aria-hidden />
        <span className="truncate">{channel.name}</span>
      </span>
      <span className="h-2 overflow-hidden rounded-full bg-brand-soft" aria-hidden>
        <span
          className="block h-full rounded-full bg-[var(--chart-1)]"
          style={{ width: `${Math.max(2, (channel.messages / max) * 100)}%` }}
        />
      </span>
      <span className="text-muted tabular-nums">
        {formatValue(channel.messages)}
        <span className="sr-only"> messages</span>
      </span>
    </li>
  );
}

function TopChannels({ channels, days }: { channels: SpaceInsights['topChannels']; days: number }) {
  const max = Math.max(1, ...channels.map((c) => c.messages));
  const id = useId();
  return (
    <section
      className={cn('card-inset flex flex-col gap-3 p-4', CHART_COLORS)}
      aria-labelledby={id}
    >
      <div>
        <h3 id={id} className="text-[15px] font-semibold">
          Top channels
        </h3>
        <p className="text-[13px] text-muted">Most messages in {days} days</p>
      </div>
      {channels.length ? (
        <ol className="flex flex-col gap-2.5" data-testid="top-channels">
          {channels.map((c) => (
            <TopChannelRow key={c.channelId} channel={c} max={max} />
          ))}
        </ol>
      ) : (
        <p className="text-[13px] text-muted">No messages in the channels you can see yet.</p>
      )}
    </section>
  );
}
