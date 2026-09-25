import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { ApiError } from '@/lib/api';

const get = vi.fn();
vi.mock('@/lib/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  api: { get: (...a: unknown[]) => get(...a) },
}));

const { checkUsername, useUsernameAvailability } = await import('./usernameAvailability');

describe('checkUsername', () => {
  afterEach(() => get.mockReset());

  it('asks the public endpoint and maps the answer', async () => {
    get.mockResolvedValueOnce({ available: true }).mockResolvedValueOnce({ available: false });
    await expect(checkUsername('river')).resolves.toEqual({ state: 'available' });
    await expect(checkUsername('river')).resolves.toEqual({ state: 'taken' });
    expect(get).toHaveBeenCalledWith('/api/auth/username-available', {
      query: { username: 'river' },
      signal: undefined,
    });
  });

  it('treats 400 as invalid and 429 / network errors as unknown', async () => {
    get.mockRejectedValueOnce(new ApiError('validation_error', 'Bad username', 400));
    await expect(checkUsername('x')).resolves.toEqual({
      state: 'invalid',
      message: 'Bad username',
    });
    get.mockRejectedValueOnce(new ApiError('rate_limited', 'Too many requests', 429));
    await expect(checkUsername('river')).resolves.toEqual({ state: 'unknown' });
    get.mockRejectedValueOnce(new ApiError('network_error', 'Offline', 0));
    await expect(checkUsername('river')).resolves.toEqual({ state: 'unknown' });
  });
});

describe('useUsernameAvailability', () => {
  afterEach(() => {
    get.mockReset();
    vi.useRealTimers();
  });

  it('debounces, skips invalid formats and the current name', async () => {
    vi.useFakeTimers();
    get.mockResolvedValue({ available: false });
    const { result, rerender } = renderHook(
      ({ v }) => useUsernameAvailability(v, { current: 'me_now', delayMs: 300 }),
      { initialProps: { v: 'ab' } },
    );
    expect(result.current.state).toBe('invalid');
    rerender({ v: 'me_now' });
    expect(result.current.state).toBe('mine');
    rerender({ v: 'taken_name' });
    expect(result.current.state).toBe('checking');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });
    expect(get).toHaveBeenCalledTimes(1);
    expect(result.current).toEqual({ state: 'taken', message: '@taken_name is taken.' });
  });
});
