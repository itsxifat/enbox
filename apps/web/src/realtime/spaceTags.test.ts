/**
 * Realtime: a Space's server tag changing or going (`space:updated { tag }`, `space:removed
 * { deleted }`) reaches my copy of the Space and the cached users wearing that tag.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { SpaceTag } from '@enbox/shared';
import type { AppSocket } from '@/lib/socket';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useSpaces } from '@/stores/spaces';
import { useUsers } from '@/stores/users';
import { makeSpace } from '@/features/spaces/testUtils';
import { makeMe, makeUser } from '@/test/factories';
import { registerSpaceHandlers } from './spaces';

type Handler = (payload: never) => void;

function fakeSocket() {
  const handlers = new Map<string, Handler>();
  const socket = {
    on: (event: string, fn: Handler) => handlers.set(event, fn),
  } as unknown as AppSocket;
  registerSpaceHandlers(socket);
  return (event: string, payload: unknown) => handlers.get(event)!(payload as never);
}

const rkt: SpaceTag = { tag: 'RKT', badge: 'rocket', color: '#ff8800' };
const qc: SpaceTag = { tag: 'QC', badge: 'moon', color: '#336699' };
const user = (id: string) => useUsers.getState().byId[id]!;

beforeEach(() => {
  resetSessionState();
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
  useSpaces.setState({
    byId: { s1: makeSpace({ id: 's1', tag: rkt }), s2: makeSpace({ id: 's2', tag: qc }) },
    order: ['s1', 's2'],
    loaded: true,
  });
  useUsers
    .getState()
    .upsertUsers([
      makeUser({ id: 'ann', spaceTag: { ...rkt, spaceId: 's1' } }),
      makeUser({ id: 'ben', spaceTag: { ...rkt, spaceId: 's1' } }),
      makeUser({ id: 'cat', spaceTag: { ...qc, spaceId: 's2' } }),
      makeUser({ id: 'dan', spaceTag: null }),
    ]);
});

describe('server tags realtime', () => {
  it("space:updated with a new tag: my Space and that tag's cached wearers follow", () => {
    const emit = fakeSocket();
    const next: SpaceTag = { tag: 'RK7', badge: 'star', color: '#00aa55' };
    emit('space:updated', { spaceId: 's1', changes: { tag: next } });
    expect(useSpaces.getState().byId.s1!.tag).toEqual(next);
    expect(user('ann').spaceTag).toEqual({ ...next, spaceId: 's1' });
    expect(user('ben').spaceTag).toEqual({ ...next, spaceId: 's1' });
    expect(user('cat').spaceTag).toEqual({ ...qc, spaceId: 's2' });
    expect(user('dan').spaceTag).toBeNull();
  });

  it('a removed tag clears its wearers; other Space changes leave the users alone', () => {
    const emit = fakeSocket();
    const before = useUsers.getState().byId;
    emit('space:updated', { spaceId: 's1', changes: { name: 'Rocket Club' } });
    expect(useUsers.getState().byId).toBe(before);
    expect(useSpaces.getState().byId.s1!.tag).toEqual(rkt);

    emit('space:updated', { spaceId: 's1', changes: { tag: null } });
    expect(useSpaces.getState().byId.s1!.tag).toBeNull();
    expect(user('ann').spaceTag).toBeNull();
    expect(user('ben').spaceTag).toBeNull();
    expect(user('cat').spaceTag).toEqual({ ...qc, spaceId: 's2' });
  });

  it('a deleted Space takes its tag off its wearers; leaving one does not touch theirs', () => {
    const emit = fakeSocket();
    emit('space:removed', { spaceId: 's2', reason: 'left' });
    expect(user('cat').spaceTag).toEqual({ ...qc, spaceId: 's2' });
    emit('space:removed', { spaceId: 's1', reason: 'deleted' });
    expect(useSpaces.getState().byId.s1).toBeUndefined();
    expect(user('ann').spaceTag).toBeNull();
    expect(user('cat').spaceTag).toEqual({ ...qc, spaceId: 's2' });
  });
});
