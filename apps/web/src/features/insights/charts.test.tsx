/** Insights charts: one point or bar per day, tooltips on hover and arrow keys, summaries and the table twin. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { DataTable, DivergingBarChart, LineChart } from './charts';
import { bandCenter, plotArea, pointX } from './chartLayout';
import { formatDayLong, formatDayShort } from './summary';
import { makeDays } from './testData';

// jsdom has no PointerEvent: a MouseEvent carries clientX the same way.
beforeEach(() => {
  if (!('PointerEvent' in window)) vi.stubGlobal('PointerEvent', MouseEvent);
});

const days = makeDays(7).map((d) => d.day);
/** jsdom measures 0 px: the charts lay out at their 600 px fallback (margins as in charts.tsx). */
const plotFor = (left: number) => plotArea(600, 180, { top: 10, right: 12, bottom: 26, left });

describe('LineChart', () => {
  it('draws one point per day, its area, and tells screen readers the summary', () => {
    render(
      <LineChart
        area
        days={days}
        values={[1, 4, 2, 0, 8, 3, 5]}
        label="messages"
        summary="Messages per day"
      />,
    );
    const chart = screen.getByRole('img', { name: 'Messages per day' });
    expect(screen.getByTestId('chart-line')).toHaveAttribute('data-points', '7');
    expect(screen.getByTestId('chart-line').getAttribute('d')!.match(/[ML]/g)).toHaveLength(7);
    expect(screen.getByTestId('chart-area')).toBeInTheDocument();
    // Clean y ticks (0–8 by 2), then every day of a week on the x axis, today last.
    const labels = [...chart.querySelectorAll('text')].map((t) => t.textContent);
    expect(labels.slice(0, 5)).toEqual(['0', '2', '4', '6', '8']);
    expect(labels.slice(5)).toEqual(days.map(formatDayShort));
    expect(screen.queryByTestId('chart-tooltip')).toBeNull();
  });

  it('shows the day under the pointer with its value, and hides it when the pointer leaves', () => {
    render(
      <LineChart days={days} values={[1, 4, 2, 0, 8, 3, 5]} label="messages" summary="Messages" />,
    );
    expect(screen.queryByTestId('chart-area')).toBeNull();
    const chart = screen.getByRole('img', { name: 'Messages' });
    // y ticks 0–8 are one character: a 24 px axis.
    fireEvent.pointerMove(chart, { clientX: pointX(4, 7, plotFor(24)) + 3 });
    const tip = screen.getByTestId('chart-tooltip');
    expect(tip).toHaveTextContent(formatDayLong(days[4]!));
    expect(tip).toHaveTextContent('8messages');
    expect(screen.getByTestId('chart-crosshair')).toBeInTheDocument();
    fireEvent.pointerLeave(chart);
    expect(screen.queryByTestId('chart-tooltip')).toBeNull();
  });

  it('walks the days with the arrow keys from today', () => {
    render(
      <LineChart days={days} values={[1, 4, 2, 0, 8, 3, 5]} label="active" summary="Active" />,
    );
    const chart = screen.getByRole('img', { name: 'Active' });
    fireEvent.keyDown(chart, { key: 'ArrowLeft' });
    expect(screen.getByTestId('chart-tooltip')).toHaveTextContent(formatDayLong(days[6]!));
    fireEvent.keyDown(chart, { key: 'ArrowLeft' });
    expect(screen.getByTestId('chart-tooltip')).toHaveTextContent(formatDayLong(days[5]!));
    fireEvent.keyDown(chart, { key: 'Home' });
    expect(screen.getByTestId('chart-tooltip')).toHaveTextContent(
      `${formatDayLong(days[0]!)}1active`,
    );
    fireEvent.keyDown(chart, { key: 'Escape' });
    expect(screen.queryByTestId('chart-tooltip')).toBeNull();
  });
});

describe('DivergingBarChart', () => {
  const joins = [3, 0, 1, 0, 2, 0, 5];
  const leaves = [0, 1, 1, 0, 0, 2, 0];

  it('draws a bar group per day: joins up, leaves down, nothing for zeros', () => {
    render(
      <DivergingBarChart
        days={days}
        up={joins}
        down={leaves}
        labels={{ up: 'joined', down: 'left' }}
        summary="Joins and leaves"
      />,
    );
    screen.getByRole('img', { name: 'Joins and leaves' });
    const groups = screen.getAllByTestId('chart-bar');
    expect(groups).toHaveLength(7);
    expect(groups.map((g) => g.querySelectorAll('[data-kind="up"]').length)).toEqual([
      1, 0, 1, 0, 1, 0, 1,
    ]);
    expect(groups.map((g) => g.querySelectorAll('[data-kind="down"]').length)).toEqual([
      0, 1, 1, 0, 0, 1, 0,
    ]);
  });

  it('the hovered day lifts and its tooltip lists both series', () => {
    render(
      <DivergingBarChart
        days={days}
        up={joins}
        down={leaves}
        labels={{ up: 'joined', down: 'left' }}
        summary="Joins and leaves"
      />,
    );
    const chart = screen.getByRole('img', { name: 'Joins and leaves' });
    fireEvent.pointerMove(chart, { clientX: bandCenter(2, 7, plotFor(24)) });
    const tip = screen.getByTestId('chart-tooltip');
    expect(tip).toHaveTextContent(formatDayLong(days[2]!));
    expect(tip).toHaveTextContent('1joined');
    expect(tip).toHaveTextContent('1left');
    expect(screen.getByTestId('chart-hover-band')).toBeInTheDocument();
    const groups = screen.getAllByTestId('chart-bar');
    expect(groups[2]).toHaveAttribute('opacity', '1');
    expect(groups[0]).toHaveAttribute('opacity', '0.45');
  });
});

describe('DataTable', () => {
  it('lists every day, newest first', () => {
    render(
      <DataTable
        caption="Joins and leaves per day"
        days={days}
        columns={[
          { label: 'Joins', values: [1, 2, 3, 4, 5, 6, 7] },
          { label: 'Leaves', values: [0, 0, 0, 0, 0, 0, 1] },
        ]}
      />,
    );
    const table = screen.getByRole('table', { name: 'Joins and leaves per day' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(8);
    expect(rows[1]).toHaveTextContent(`${formatDayLong(days[6]!)}71`);
    expect(rows[7]).toHaveTextContent(`${formatDayLong(days[0]!)}10`);
  });
});
