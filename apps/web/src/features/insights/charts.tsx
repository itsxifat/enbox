/**
 * The Insights charts, drawn as SVG at the container's width (layout: chartLayout.ts):
 * a line (or soft area) of one series per day, and diverging bars (joins up, leaves down).
 * Thin marks, hairline grid, a few clean ticks; a crosshair or the hovered bar with a
 * tooltip (date + values) on pointer and on ←/→ when focused; `role="img"` with a summary
 * for screen readers, and a table twin (DataTable). Nothing animates (reduced motion).
 * Colors are theme tokens: series 1 is the brand violet, series 2 a warm opposite.
 */
import {
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/cn';
import {
  areaPath,
  bandCenter,
  bandLayout,
  divergingBars,
  divergingScale,
  divergingY,
  linePath,
  linePoints,
  nearestIndex,
  niceScale,
  plotArea,
  tickAnchor,
  xLabelIndices,
  type Plot,
} from './chartLayout';
import { formatDayLong, formatDayShort, formatTick, formatValue } from './summary';

/** Series colors (validated for contrast and color-vision separation on the card surfaces). */
export const CHART_COLORS =
  '[--chart-1:var(--brand)] dark:[--chart-1:var(--brand-strong)] [--chart-2:#d9622b] dark:[--chart-2:#dd6b33]';

const HEIGHT = 180;
/** Charts sit on `.card-inset`: markers get a ring of its color. */
const SURFACE = 'var(--surface-2)';

/** The element's width, followed with a ResizeObserver (`fallback` until measured). */
export function useElementWidth<T extends HTMLElement>(fallback = 600) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      if (w > 0) setWidth(w);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Left margin that fits the widest y tick label. */
function axisWidth(labels: readonly string[]): number {
  return Math.max(24, Math.max(...labels.map((l) => l.length)) * 7 + 12);
}

/** Pointer and arrow-key tracking of the day under the crosshair. */
function useHoverIndex(n: number, plot: Plot, kind: 'point' | 'band') {
  const [hover, setHover] = useState<number | null>(null);
  const index = hover !== null && hover < n ? hover : null;
  return {
    hover: index,
    handlers: {
      onPointerMove: (e: PointerEvent<SVGSVGElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        setHover(nearestIndex(e.clientX - rect.left, n, plot, kind));
      },
      onPointerLeave: () => setHover(null),
      onBlur: () => setHover(null),
      onKeyDown: (e: KeyboardEvent<SVGSVGElement>) => {
        const last = n - 1;
        const from = index ?? last;
        const next =
          e.key === 'ArrowLeft'
            ? Math.max(0, index === null ? last : from - 1)
            : e.key === 'ArrowRight'
              ? Math.min(last, index === null ? last : from + 1)
              : e.key === 'Home'
                ? 0
                : e.key === 'End'
                  ? last
                  : e.key === 'Escape'
                    ? null
                    : undefined;
        if (next === undefined) return;
        e.preventDefault();
        setHover(next);
      },
    },
  };
}

export interface TooltipRow {
  label: string;
  value: number;
  color: string;
}

/** Beside the crosshair, flipped to its left on the right half. Values lead, labels follow. */
function ChartTooltip({
  x,
  width,
  top,
  day,
  rows,
}: {
  x: number;
  width: number;
  top: number;
  day: string;
  rows: TooltipRow[];
}) {
  const left = x <= width / 2;
  return (
    <div
      aria-hidden
      data-testid="chart-tooltip"
      className="pointer-events-none absolute z-10 min-w-28 rounded-lg bg-fg px-3 py-2 text-[12px] whitespace-nowrap text-surface shadow-elevated"
      style={left ? { left: x + 12, top } : { right: width - x + 12, top }}
    >
      {/* Inverted like the kit's Tooltip, so it stands out on every card surface. */}
      <p className="text-surface/70">{formatDayLong(day)}</p>
      {rows.map((r) => (
        <p key={r.label} className="mt-0.5 flex items-center gap-2">
          <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: r.color }} />
          <span className="text-[14px] font-semibold tabular-nums">{formatValue(r.value)}</span>
          <span className="text-surface/70">{r.label}</span>
        </p>
      ))}
    </div>
  );
}

function YGrid({
  ticks,
  y,
  plot,
  label = formatTick,
}: {
  ticks: readonly number[];
  y: (v: number) => number;
  plot: Plot;
  label?: (v: number) => string;
}) {
  return (
    <g>
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={plot.left}
            x2={plot.left + plot.width}
            y1={y(t)}
            y2={y(t)}
            stroke={t === 0 ? 'var(--line-strong)' : 'var(--line)'}
            strokeWidth={1}
            shapeRendering="crispEdges"
          />
          <text
            x={plot.left - 8}
            y={y(t)}
            textAnchor="end"
            dominantBaseline="middle"
            fill="var(--subtle)"
            fontSize={11}
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {label(t)}
          </text>
        </g>
      ))}
    </g>
  );
}

function XLabels({
  days,
  plot,
  x,
}: {
  days: readonly string[];
  plot: Plot;
  x: (i: number) => number;
}) {
  return (
    <g>
      {xLabelIndices(days.length, plot.width).map((i) => (
        <text
          key={days[i]}
          x={x(i)}
          y={plot.top + plot.height + 18}
          textAnchor={tickAnchor(x(i), plot)}
          fill="var(--subtle)"
          fontSize={11}
        >
          {formatDayShort(days[i]!)}
        </text>
      ))}
    </g>
  );
}

const SVG_CLASS =
  'block touch-pan-y rounded-md outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';

export interface LineChartProps {
  days: readonly string[];
  values: readonly number[];
  /** The series in the tooltip ("messages"). */
  label: string;
  /** What screen readers hear (seriesSummary). */
  summary: string;
  /** Fill under the line (a single series' trend). */
  area?: boolean;
  height?: number;
}

/** One series per day: a 2 px line (and its soft area), a crosshair and an end dot. */
export function LineChart({ days, values, label, summary, area, height = HEIGHT }: LineChartProps) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const scale = niceScale(Math.max(0, ...values));
  const plot = plotArea(width, height, {
    top: 10,
    right: 12,
    bottom: 26,
    left: axisWidth(scale.ticks.map(formatTick)),
  });
  const points = linePoints(values, plot, scale.max);
  const baseline = plot.top + plot.height;
  const y = (v: number) => baseline - (v / scale.max) * plot.height;
  const { hover, handlers } = useHoverIndex(values.length, plot, 'point');
  const dot = points[hover ?? points.length - 1];
  return (
    <div ref={ref} className={cn('relative', CHART_COLORS)}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={summary}
        tabIndex={0}
        className={SVG_CLASS}
        data-testid="line-chart"
        {...handlers}
      >
        <YGrid ticks={scale.ticks} y={y} plot={plot} />
        {area ? (
          <path
            d={areaPath(points, baseline)}
            fill="var(--chart-1)"
            fillOpacity={0.1}
            data-testid="chart-area"
          />
        ) : null}
        <path
          d={linePath(points)}
          fill="none"
          stroke="var(--chart-1)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          data-testid="chart-line"
          data-points={points.length}
        />
        {hover !== null && dot ? (
          <line
            x1={dot.x}
            x2={dot.x}
            y1={plot.top}
            y2={baseline}
            stroke="var(--line-strong)"
            strokeWidth={1}
            shapeRendering="crispEdges"
            data-testid="chart-crosshair"
          />
        ) : null}
        {dot ? (
          <circle
            cx={dot.x}
            cy={dot.y}
            r={4}
            fill="var(--chart-1)"
            stroke={SURFACE}
            strokeWidth={2}
          />
        ) : null}
        <XLabels days={days} plot={plot} x={(i) => points[i]!.x} />
      </svg>
      {hover !== null && dot ? (
        <ChartTooltip
          x={dot.x}
          width={width}
          top={plot.top}
          day={days[hover]!}
          rows={[{ label, value: values[hover]!, color: 'var(--chart-1)' }]}
        />
      ) : null}
    </div>
  );
}

export interface DivergingBarChartProps {
  days: readonly string[];
  /** Drawn up from the baseline (series 1). */
  up: readonly number[];
  /** Drawn down from it (series 2). */
  down: readonly number[];
  labels: { up: string; down: string };
  summary: string;
  height?: number;
}

/** Two series per day around one baseline and one scale: joins up, leaves down. */
export function DivergingBarChart({
  days,
  up,
  down,
  labels,
  summary,
  height = HEIGHT,
}: DivergingBarChartProps) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const scale = divergingScale(Math.max(0, ...up), Math.max(0, ...down));
  const tickLabel = (v: number) => formatTick(Math.abs(v));
  const plot = plotArea(width, height, {
    top: 10,
    right: 12,
    bottom: 26,
    left: axisWidth(scale.ticks.map(tickLabel)),
  });
  const bars = divergingBars(up, down, plot, scale);
  const { band } = bandLayout(days.length, plot);
  const { hover, handlers } = useHoverIndex(days.length, plot, 'band');
  const x = (i: number) => bandCenter(i, days.length, plot);
  return (
    <div ref={ref} className={cn('relative', CHART_COLORS)}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={summary}
        tabIndex={0}
        className={SVG_CLASS}
        data-testid="bar-chart"
        {...handlers}
      >
        {hover !== null ? (
          <rect
            x={x(hover) - band / 2}
            y={plot.top}
            width={band}
            height={plot.height}
            fill="var(--hover)"
            data-testid="chart-hover-band"
          />
        ) : null}
        <YGrid
          ticks={scale.ticks}
          y={(v) => divergingY(v, plot, scale)}
          plot={plot}
          label={tickLabel}
        />
        {bars.map((b) => (
          <g
            key={days[b.index]}
            opacity={hover !== null && hover !== b.index ? 0.45 : 1}
            data-testid="chart-bar"
          >
            {b.upPath ? <path d={b.upPath} fill="var(--chart-1)" data-kind="up" /> : null}
            {b.downPath ? <path d={b.downPath} fill="var(--chart-2)" data-kind="down" /> : null}
          </g>
        ))}
        <XLabels days={days} plot={plot} x={x} />
      </svg>
      {hover !== null ? (
        <ChartTooltip
          x={x(hover)}
          width={width}
          top={plot.top}
          day={days[hover]!}
          rows={[
            { label: labels.up, value: up[hover] ?? 0, color: 'var(--chart-1)' },
            { label: labels.down, value: down[hover] ?? 0, color: 'var(--chart-2)' },
          ]}
        />
      ) : null}
    </div>
  );
}

/** A legend entry: the mark's shape in the series color, the name in text ink. */
export function LegendItem({
  color,
  shape,
  children,
}: {
  color: string;
  shape: 'bar' | 'line';
  children: ReactNode;
}) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[12px] text-muted', CHART_COLORS)}>
      <span
        aria-hidden
        className={shape === 'bar' ? 'size-2.5 rounded-[3px]' : 'h-0.5 w-3 rounded-full'}
        style={{ background: color }}
      />
      {children}
    </span>
  );
}

/** The table twin of a chart: one row per day, newest first. */
export function DataTable({
  caption,
  days,
  columns,
}: {
  caption: string;
  days: readonly string[];
  columns: { label: string; values: readonly number[] }[];
}) {
  const rows = days.map((day, i) => ({ day, i })).reverse();
  return (
    <div className="max-h-64 overflow-y-auto rounded-md">
      <table className="w-full text-[13px]">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 bg-surface-2 text-muted">
          <tr>
            <th scope="col" className="py-1.5 text-left font-medium">
              Day
            </th>
            {columns.map((c) => (
              <th key={c.label} scope="col" className="py-1.5 text-right font-medium">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ day, i }) => (
            <tr key={day}>
              <th scope="row" className="py-1 text-left font-normal">
                {formatDayLong(day)}
              </th>
              {columns.map((c) => (
                <td key={c.label} className="py-1 text-right tabular-nums">
                  {formatValue(c.values[i] ?? 0)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
