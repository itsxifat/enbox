import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { resetSessionState } from '@/lib/session';
import { makeUser } from '@/test/factories';
import { useUsers } from './users';

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
});
