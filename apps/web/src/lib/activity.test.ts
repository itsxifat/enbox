import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PRESENCE_IDLE_AFTER_MS } from '@enbox/shared';
import { sendEvent } from '@/lib/socket';
import type * as SocketModule from '@/lib/socket';
import { isIdle, reportActivity, startActivityTracking, stopActivityTracking } from './activity';

vi.mock('@/lib/socket', async (importOriginal) => {
  const actual = await importOriginal<typeof SocketModule>();
  return { ...actual, sendEvent: vi.fn(() => true) };
});

const send = vi.mocked(sendEvent);
const activitySends = () =>
  send.mock.calls.filter(([e]) => e === 'presence:activity').map(([, p]) => p);

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2025-03-12T10:00:00Z'));
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  send.mockClear();
  startActivityTracking();
});

afterEach(() => {
  stopActivityTracking();
  vi.useRealTimers();
});

describe('activity tracking', () => {
  it('goes idle after PRESENCE_IDLE_AFTER_MS without input and active on the next input', () => {
    expect(isIdle()).toBe(false);
    expect(activitySends()).toEqual([]);

    vi.advanceTimersByTime(PRESENCE_IDLE_AFTER_MS);
    expect(isIdle()).toBe(true);
    expect(activitySends()).toEqual([{ idle: true }]);

    window.dispatchEvent(new Event('pointerdown'));
    expect(isIdle()).toBe(false);
    expect(activitySends()).toEqual([{ idle: true }, { idle: false }]);
  });

  it('input keeps the device active (the timer restarts) and sends nothing while active', () => {
    vi.advanceTimersByTime(PRESENCE_IDLE_AFTER_MS - 5_000);
    window.dispatchEvent(new Event('keydown'));
    vi.advanceTimersByTime(PRESENCE_IDLE_AFTER_MS - 5_000);
    expect(isIdle()).toBe(false);
    expect(activitySends()).toEqual([]);
    vi.advanceTimersByTime(5_000);
    expect(isIdle()).toBe(true);
  });

  it('a hidden page is idle at once; showing it again is activity', () => {
    setVisibility('hidden');
    expect(isIdle()).toBe(true);
    expect(activitySends()).toEqual([{ idle: true }]);
    // Input while hidden (a key repeat, a wheel event) doesn't count.
    window.dispatchEvent(new Event('wheel'));
    expect(isIdle()).toBe(true);

    setVisibility('visible');
    expect(isIdle()).toBe(false);
    expect(activitySends()).toEqual([{ idle: true }, { idle: false }]);
  });

  it('reportActivity re-sends the current state (used on every ready)', () => {
    reportActivity();
    expect(activitySends()).toEqual([{ idle: false }]);
    vi.advanceTimersByTime(PRESENCE_IDLE_AFTER_MS);
    reportActivity();
    expect(activitySends()).toEqual([{ idle: false }, { idle: true }, { idle: true }]);
  });

  it('stopActivityTracking forgets the state and stops listening', () => {
    stopActivityTracking();
    vi.advanceTimersByTime(PRESENCE_IDLE_AFTER_MS);
    expect(isIdle()).toBe(false);
    expect(activitySends()).toEqual([]);
  });
});
