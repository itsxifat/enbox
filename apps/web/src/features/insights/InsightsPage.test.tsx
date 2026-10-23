/** Space Settings ▸ Insights: the range tabs refetch, tiles compare periods, charts and top channels, the empty state, CSV export. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { SpaceInsights } from '@enbox/shared';
import { api, setApiToken } from '@/lib/api';
import { useChats } from '@/stores/chats';
import { useUi } from '@/stores/ui';
import { makeChat } from '@/test/factories';
import { makeSpace } from '@/features/spaces/testUtils';
import { InsightsPage } from './InsightsPage';
import { makeInsights } from './testData';

const space = makeSpace({ owner: true });

/** Busy days in every range: 3 messages and 2 active members a day, a join every other day. */
const busy = (days: number, p: Partial<SpaceInsights> = {}) =>
  makeInsights(days, (i) => ({ messages: 3, activeMembers: 2, joins: i % 2, voiceMinutes: 10 }), {
    topChannels: [
      { channelId: 'general', name: 'general', messages: 60 },
      { channelId: 'voice', name: 'Lounge', messages: 30 },
    ],
    ...p,
  });

function mockInsights(byDays: (days: number) => SpaceInsights) {
  return vi
    .spyOn(api, 'get')
    .mockImplementation(async (_path: string, opts?: { query?: Record<string, unknown> }) => {
      return byDays(Number(opts?.query?.days)) as never;
    });
}

const daysAsked = (get: ReturnType<typeof mockInsights>) =>
  get.mock.calls.map(([path, opts]) => [path, (opts as { query: { days: number } }).query.days]);

beforeEach(() => {
  useUi.setState({ toasts: [] });
  useChats.setState({
    byId: {
      general: { ...makeChat({ id: 'general', name: 'general', type: 'space_text' }) },
      voice: { ...makeChat({ id: 'voice', name: 'Lounge', type: 'space_voice' }) },
    },
  });
});

afterEach(() => setApiToken(null));

describe('InsightsPage', () => {
  it('loads 30 days with 90 to compare, then shows the tiles, the charts and the top channels', async () => {
    const get = mockInsights((days) => busy(days));
    render(<InsightsPage space={space} />);
    await screen.findByTestId('tile-messages');
    expect(daysAsked(get)).toEqual([
      ['/api/spaces/s1/insights', 30],
      ['/api/spaces/s1/insights', 90],
    ]);
    expect(screen.getByRole('tab', { name: '30 days' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('tile-members')).toHaveTextContent('12');
    expect(screen.getByTestId('tile-members')).toHaveTextContent('+15 in 30 days');
    expect(screen.getByTestId('tile-messages')).toHaveTextContent('90');
    // Same activity as the 30 days before: no change.
    expect(screen.getByTestId('delta-messages')).toHaveTextContent('No change vs previous 30 days');
    expect(screen.getByTestId('tile-activeMembers')).toHaveTextContent('2a day on average');
    expect(screen.getByTestId('tile-voiceMinutes')).toHaveTextContent('300');

    expect(screen.getByRole('img', { name: /^Messages per day/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /^Joins per day/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /^Active members per day/ })).toBeInTheDocument();
    expect(screen.getAllByTestId('chart-bar')).toHaveLength(30);

    const top = within(screen.getByTestId('top-channels')).getAllByRole('listitem');
    expect(top.map((li) => li.textContent)).toEqual(['general60 messages', 'Lounge30 messages']);
  });

  it('switching the range refetches and keeps the last render meanwhile', async () => {
    const get = mockInsights((days) => busy(days));
    render(<InsightsPage space={space} />);
    await screen.findByTestId('tile-messages');
    get.mockClear();
    fireEvent.click(screen.getByRole('tab', { name: '7 days' }));
    // Still the 30 days, dimmed, while loading.
    expect(screen.getByTestId('tile-messages')).toHaveTextContent('90');
    await waitFor(() => expect(screen.getByTestId('tile-messages')).toHaveTextContent('21'));
    expect(daysAsked(get)).toEqual([
      ['/api/spaces/s1/insights', 7],
      ['/api/spaces/s1/insights', 30],
    ]);
    expect(screen.getAllByTestId('chart-bar')).toHaveLength(7);

    get.mockClear();
    fireEvent.click(screen.getByRole('tab', { name: '90 days' }));
    await waitFor(() => expect(screen.getAllByTestId('chart-bar').length).toBe(90));
    // Nothing older to compare 90 days with.
    expect(daysAsked(get)).toEqual([['/api/spaces/s1/insights', 90]]);
    expect(screen.queryByTestId('delta-messages')).toBeNull();
  });

  it('compares with the previous period only when counting covered it', async () => {
    // Counting started 13 days ago: inside the 30-day range.
    mockInsights((days) => busy(days, { since: '2026-10-10T00:00:00.000Z' }));
    render(<InsightsPage space={space} />);
    await screen.findByTestId('tile-messages');
    expect(screen.queryByTestId('delta-messages')).toBeNull();
    expect(screen.getByTestId('insights-since')).toHaveTextContent('Counting started on');
  });

  it('new Spaces get the empty state', async () => {
    mockInsights((days) => makeInsights(days, (i) => (i === days - 1 ? { joins: 1 } : {})));
    render(<InsightsPage space={space} />);
    expect(
      await screen.findByText('Insights fill in as your Space gets activity.'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('tile-messages')).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
    // The range and the export stay.
    expect(screen.getByRole('tab', { name: '7 days' })).toBeInTheDocument();
    expect(screen.getByTestId('insights-export')).toBeEnabled();
  });

  it('a quiet range of an active Space shows its charts, not the empty state', async () => {
    mockInsights((days) =>
      makeInsights(days, (i) => (days === 30 && i === 0 ? { messages: 4, activeMembers: 1 } : {})),
    );
    render(<InsightsPage space={space} />);
    await screen.findByTestId('tile-messages');
    fireEvent.click(screen.getByRole('tab', { name: '7 days' }));
    await waitFor(() => expect(screen.getAllByTestId('chart-bar').length).toBe(7));
    expect(screen.queryByTestId('insights-empty')).toBeNull();
  });

  it('a chart can be read as a table', async () => {
    mockInsights((days) => busy(days));
    render(<InsightsPage space={space} />);
    await screen.findByTestId('tile-messages');
    const card = screen.getByRole('region', { name: 'Joins and leaves' });
    fireEvent.click(within(card).getByRole('button', { name: 'Table' }));
    expect(within(card).getByRole('button', { name: 'Table' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(
      within(card).getByRole('table', { name: 'Joins and leaves per day' }),
    ).toBeInTheDocument();
    expect(within(card).queryByRole('img')).toBeNull();
  });

  it('Export CSV downloads the range with the session token, under the server’s file name', async () => {
    mockInsights((days) => busy(days));
    setApiToken('tok');
    const fetchMock = vi.fn(
      async () =>
        new Response('day,messages,joins,leaves,active_members,voice_minutes\n', {
          status: 200,
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': 'attachment; filename="insights-2026-10-23-7d.csv"',
          },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:csv');
    const { createObjectURL: realCreate, revokeObjectURL: realRevoke } = URL;
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      expect(this.download).toBe('insights-2026-10-23-7d.csv');
      expect(this.href).toBe('blob:csv');
    });
    try {
      render(<InsightsPage space={space} />);
      await screen.findByTestId('tile-messages');
      fireEvent.click(screen.getByRole('tab', { name: '7 days' }));
      fireEvent.click(screen.getByTestId('insights-export'));
      await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe('/api/spaces/s1/insights.csv?days=7');
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
      const blob = createObjectURL.mock.calls[0]![0];
      expect(blob.type).toBe('text/csv;charset=utf-8');
    } finally {
      Object.assign(URL, { createObjectURL: realCreate, revokeObjectURL: realRevoke });
    }
  });

  it('a failed export says why', async () => {
    mockInsights((days) => busy(days));
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { code: 'forbidden', message: 'Not for you' } }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    );
    render(<InsightsPage space={space} />);
    await screen.findByTestId('tile-messages');
    fireEvent.click(screen.getByTestId('insights-export'));
    await waitFor(() =>
      expect(useUi.getState().toasts.map((t) => t.message)).toContain('Not for you'),
    );
  });

  it('a failed load can be retried', async () => {
    let fail = true;
    vi.spyOn(api, 'get').mockImplementation(
      async (_p: string, opts?: { query?: Record<string, unknown> }) => {
        if (fail) throw new Error('Server down');
        return busy(Number(opts?.query?.days)) as never;
      },
    );
    render(<InsightsPage space={space} />);
    expect(await screen.findByText('Server down')).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByTestId('tile-messages');
  });
});
