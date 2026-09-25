import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import { resetSessionState } from '@/lib/session';
import { flushOutbox, holdForReconnect, isOfflineError, isQueued } from './outbox';

describe('offline outbox', () => {
  it('classifies connectivity errors', () => {
    expect(isOfflineError(new ApiError('network_error', 'x'))).toBe(true);
    expect(isOfflineError(new ApiError('timeout', 'x'))).toBe(true);
    expect(isOfflineError(new ApiError('forbidden', 'x', 403))).toBe(false);
    expect(isOfflineError(new Error('x'))).toBe(false);
  });

  it('re-sends held messages on flush and keeps them queued while still offline', async () => {
    const ok = vi.fn(() => Promise.resolve());
    const offline = vi.fn(() => Promise.reject(new ApiError('network_error', 'down')));
    holdForReconnect('chat-1', 'a', ok);
    holdForReconnect('chat-1', 'b', offline);
    await flushOutbox();
    expect(ok).toHaveBeenCalledTimes(1);
    expect(offline).toHaveBeenCalledTimes(1);
    expect(isQueued('a')).toBe(false);
    expect(isQueued('b')).toBe(true);
    resetSessionState();
    expect(isQueued('b')).toBe(false);
  });
});
