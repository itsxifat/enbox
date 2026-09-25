import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  api,
  errorMessage,
  fieldErrors,
  mediaUrl,
  setApiToken,
  setUnauthorizedHandler,
  throttleProgress,
} from './api';

function mockFetch(status: number, body?: unknown) {
  const fn = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  setApiToken(null);
  setUnauthorizedHandler(null);
});

describe('api client', () => {
  it('sends JSON with the bearer token and query params', async () => {
    setApiToken('tok');
    const fetch = mockFetch(200, { ok: true });
    await expect(
      api.post('/api/x', { a: 1 }, { query: { q: 'hi', n: 2, skip: undefined } }),
    ).resolves.toEqual({ ok: true });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('/api/x?q=hi&n=2');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('{"a":1}');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('returns undefined for 204', async () => {
    mockFetch(204);
    await expect(api.delete('/api/x')).resolves.toBeUndefined();
  });

  it('throws ApiError from the error envelope', async () => {
    mockFetch(403, { error: { code: 'blocked', message: 'You blocked this user' } });
    const err = await api.get('/api/x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: 'blocked', status: 403, message: 'You blocked this user' });
  });

  it('maps validation details to field errors', async () => {
    mockFetch(400, {
      error: {
        code: 'validation_error',
        message: 'Invalid',
        details: [{ path: ['username'], message: 'Taken' }],
      },
    });
    const err = await api.post('/api/x', {}).catch((e: unknown) => e);
    expect(fieldErrors(err)).toEqual({ username: 'Taken' });
  });

  it('calls the unauthorized handler on 401 with the current token (not for login)', async () => {
    setApiToken('tok');
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    mockFetch(401, { error: { code: 'unauthorized', message: 'nope' } });
    await api.get('/api/me').catch(() => undefined);
    expect(handler).toHaveBeenCalledTimes(1);
    await api.post('/api/auth/login', {}).catch(() => undefined);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('reports network errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const err = await api.get('/api/x').catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'network_error', status: 0 });
    expect(errorMessage(err)).toMatch(/connection/);
  });

  it('mediaUrl resolves relative upload paths and passes absolute ones through', () => {
    expect(mediaUrl('/uploads/a.jpg')).toBe('/uploads/a.jpg');
    expect(mediaUrl('https://cdn/x.png')).toBe('https://cdn/x.png');
    expect(mediaUrl('blob:abc')).toBe('blob:abc');
    expect(mediaUrl(null)).toBeUndefined();
  });
});

describe('throttleProgress', () => {
  afterEach(() => vi.useRealTimers());

  it('passes one call per interval and whole percent; the final 1 always goes through', () => {
    vi.useFakeTimers();
    const seen: number[] = [];
    const fn = throttleProgress((p) => seen.push(p), 150)!;
    fn(0.1);
    fn(0.1001); // same percent
    fn(0.2); // too soon
    vi.advanceTimersByTime(160);
    fn(0.3);
    fn(1); // done: never dropped
    expect(seen).toEqual([0.1, 0.3, 1]);
    expect(throttleProgress(undefined)).toBeUndefined();
  });
});
