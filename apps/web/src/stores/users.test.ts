import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { USER_RATE_LIMITS, type UserPublic } from '@enbox/shared';
import { ApiError, api } from '@/lib/api';
import { resetSessionState } from '@/lib/session';
import { emitWithAck, sendEvent, useConnection } from '@/lib/socket';
import type * as SocketModule from '@/lib/socket';
import { makeUser } from '@/test/factories';
import { PRESENCE_FLUSH_DELAY_MS, PRESENCE_LINGER_MS, useUsers } from './users';

vi.mock('@/lib/socket', async (importOriginal) => {
  const actual = await importOriginal<typeof SocketModule>();
  return { ...actual, emitWithAck: vi.fn(), sendEvent: vi.fn(() => true) };
});

const emit = vi.mocked(emitWithAck);
const send = vi.mocked(sendEvent);

describe('users store', () => {
  beforeEach(() => {
    resetSessionState();
    vi.restoreAllMocks();
  });

  it('fetchUsers coalesces ids requested in the same tick into one batch request', async () => {
    useUsers.getState().upsertUsers([makeUser({ id: 'cached' })]);
    const post = vi
      .spyOn(api, 'post')
      .mockImplementation(async (_path: string, body: unknown) =>
        (body as { userIds: string[] }).userIds.map((id) => makeUser({ id, displayName: id })),
      );
    await Promise.all([
      useUsers.getState().fetchUsers(['a', 'b', 'cached']),
      useUsers.getState().fetchUsers(['b', 'c']),
    ]);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/api/users/batch', { userIds: ['a', 'b', 'c'] });
    expect(useUsers.getState().byId.c?.displayName).toBe('c');
  });

  it('seeds presence from always-present UserPublic fields (null = hidden)', () => {
    useUsers
      .getState()
      .upsertUsers([
        makeUser({ id: 'u1', online: true }),
        makeUser({ id: 'u2', online: null, lastSeenAt: null }),
      ]);
    expect(useUsers.getState().presence.u1?.online).toBe(true);
    expect(useUsers.getState().presence.u2).toEqual({
      userId: 'u2',
      online: null,
      lastSeenAt: null,
    });
  });

  it('drops a batch response that lands after a logout (no cross-account profile leak)', async () => {
    let resolve!: (users: UserPublic[]) => void;
    vi.spyOn(api, 'post').mockReturnValue(
      new Promise<UserPublic[]>((r) => (resolve = r)) as never,
    );
    const pending = useUsers.getState().fetchUsers(['x']);
    await new Promise((r) => setTimeout(r, 5)); // the batch goes out
    resetSessionState();
    resolve([makeUser({ id: 'x', contactName: 'Mom', phone: '+100' })]);
    await pending;
    expect(useUsers.getState().byId.x).toBeUndefined();
  });
});

describe('presence subscriptions', () => {
  beforeEach(() => {
    resetSessionState();
    vi.useFakeTimers();
    emit.mockReset();
    send.mockReset();
    emit.mockImplementation(
      async (_event, payload) =>
        (payload as { userIds: string[] }).userIds.map((userId) => ({
          userId,
          online: true,
          lastSeenAt: null,
        })) as never,
    );
    useConnection.setState({ ready: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    useConnection.setState({ ready: false });
  });

  const { subscribePresence, unsubscribePresence } = useUsers.getState();
  const subscribed = () => emit.mock.calls.map((c) => (c[1] as { userIds: string[] }).userIds);

  it('coalesces the rows mounting together into one presence:subscribe', async () => {
    for (let i = 0; i < 40; i++) void subscribePresence([`u${i}`]);
    void subscribePresence(['u1']); // a second subscriber of the same user
    await vi.advanceTimersByTimeAsync(PRESENCE_FLUSH_DELAY_MS);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(subscribed()[0]).toHaveLength(40);
    expect(useUsers.getState().presence.u7?.online).toBe(true);
  });

  it('keeps an unmounted id subscribed for a while (remounts send nothing)', async () => {
    void subscribePresence(['a']);
    await vi.advanceTimersByTimeAsync(PRESENCE_FLUSH_DELAY_MS);
    unsubscribePresence(['a']);
    void subscribePresence(['a']); // scrolled back into view
    await vi.advanceTimersByTimeAsync(PRESENCE_FLUSH_DELAY_MS);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();

    unsubscribePresence(['a']);
    await vi.advanceTimersByTimeAsync(PRESENCE_LINGER_MS + 10);
    expect(send).toHaveBeenCalledWith('presence:unsubscribe', { userIds: ['a'] });
  });

  it('retries rejected subscriptions (rate_limited) with back-off', async () => {
    emit.mockRejectedValueOnce(new ApiError('rate_limited', 'Too many requests'));
    void subscribePresence(['x']);
    await vi.advanceTimersByTimeAsync(PRESENCE_FLUSH_DELAY_MS);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(useUsers.getState().presence.x).toBeUndefined();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(emit).toHaveBeenCalledTimes(2);
    expect(subscribed()[1]).toEqual(['x']);
    expect(useUsers.getState().presence.x?.online).toBe(true);
  });

  it('stays under the per-socket rate limit', async () => {
    const { limit, windowMs } = USER_RATE_LIMITS.presenceSubscribe;
    for (let i = 0; i <= limit; i++) {
      void subscribePresence([`r${i}`]);
      await vi.advanceTimersByTimeAsync(PRESENCE_FLUSH_DELAY_MS);
    }
    expect(emit).toHaveBeenCalledTimes(limit);
    await vi.advanceTimersByTimeAsync(windowMs);
    expect(emit).toHaveBeenCalledTimes(limit + 1);
  });

  it('waits for `ready`, then resubscribes everything on the new socket', async () => {
    useConnection.setState({ ready: false });
    void subscribePresence(['p', 'q']);
    await vi.advanceTimersByTimeAsync(PRESENCE_FLUSH_DELAY_MS);
    expect(emit).not.toHaveBeenCalled();

    useConnection.setState({ ready: true });
    await useUsers.getState().resubscribePresence();
    expect(subscribed()).toEqual([['p', 'q']]);
    // A reconnect: the new socket has no subscriptions.
    await useUsers.getState().resubscribePresence();
    expect(subscribed()).toEqual([
      ['p', 'q'],
      ['p', 'q'],
    ]);
  });
});
