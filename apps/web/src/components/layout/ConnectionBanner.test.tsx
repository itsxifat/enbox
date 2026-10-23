/** The connection banner: offline, connecting, reconnecting, and Try again after a while. */
import type * as SocketModule from '@/lib/socket';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useConnection, type ConnectionStore } from '@/lib/socket';
import { ConnectionBanner, RETRY_AFTER_MS, connectionPhase, retryConnection } from './ConnectionBanner';

const sock = vi.hoisted(() => ({
  current: null as { connected: boolean; disconnect: () => void; connect: () => void } | null,
}));
vi.mock('@/lib/socket', async (importOriginal) => ({
  ...(await importOriginal<typeof SocketModule>()),
  getSocket: () => sock.current,
}));

const set = (s: Partial<ConnectionStore>) => act(() => useConnection.setState(s));
const fakeSocket = (connected: boolean) => (sock.current = { connected, disconnect: vi.fn(), connect: vi.fn() });

describe('connectionPhase', () => {
  it('offline first; the first connection; a dropped one', () => {
    expect(connectionPhase(false, 'connected', 3)).toBe('offline');
    expect(connectionPhase(true, 'connecting', 0)).toBe('connecting');
    expect(connectionPhase(true, 'disconnected', 2)).toBe('reconnecting');
    expect(connectionPhase(true, 'connected', 2)).toBeNull();
    expect(connectionPhase(true, 'idle', 0)).toBeNull();
  });
});

describe('ConnectionBanner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useConnection.setState({ state: 'connected', readyCount: 1, lastError: null });
  });
  afterEach(() => {
    vi.useRealTimers();
    sock.current = null;
    useConnection.setState({ state: 'idle', readyCount: 0, lastError: null, ready: false });
  });

  it('stays hidden through a quick blip', () => {
    render(<ConnectionBanner />);
    set({ state: 'disconnected' });
    act(() => vi.advanceTimersByTime(1_500));
    set({ state: 'connected' });
    act(() => vi.advanceTimersByTime(5_000));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('“Reconnecting” after a moment, then Try again, which retries at once', () => {
    const fake = fakeSocket(false);
    render(<ConnectionBanner />);
    set({ state: 'disconnected' });
    act(() => vi.advanceTimersByTime(2_000));
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting to Enbox…');
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();

    act(() => vi.advanceTimersByTime(RETRY_AFTER_MS));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(fake.disconnect).toHaveBeenCalledTimes(1);
    expect(fake.connect).toHaveBeenCalledTimes(1);
    expect(useConnection.getState().state).toBe('connecting');
    // The next offer comes after another while.
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    act(() => vi.advanceTimersByTime(RETRY_AFTER_MS));
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();

    set({ state: 'connected' });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('“Connecting…” before the first connection; nothing after a rejected token', () => {
    useConnection.setState({ readyCount: 0 });
    const { unmount } = render(<ConnectionBanner />);
    set({ state: 'connecting' });
    act(() => vi.advanceTimersByTime(2_000));
    expect(screen.getByRole('status')).toHaveTextContent('Connecting…');
    set({ state: 'disconnected', lastError: 'unauthorized' });
    expect(screen.queryByRole('status')).toBeNull();
    unmount();
  });

  it('“You’re offline” at once without a network', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    render(<ConnectionBanner />);
    expect(screen.getByRole('status')).toHaveTextContent("You're offline. Messages will send when you reconnect.");
  });

  it('retryConnection leaves a working connection alone', () => {
    const fake = fakeSocket(true);
    retryConnection();
    expect(fake.disconnect).not.toHaveBeenCalled();
  });
});
