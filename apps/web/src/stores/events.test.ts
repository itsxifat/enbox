/** Events store: the reducers (order, finished events, neutral copies), loading, mutations, Interested, helpers. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PERM } from '@enbox/shared';
import { makeEvent } from '@/features/events/testUtils';
import { makeSpace } from '@/features/spaces/testUtils';
import { api } from '@/lib/api';
import { resetSessionState } from '@/lib/session';
import {
  EVENT_START_EARLY_MS,
  canCreateEvents,
  canManageEvent,
  canStartEvent,
  eventLink,
  mergeEvent,
  sortEvents,
  useEvents,
} from './events';

const s = () => useEvents.getState();
const names = (spaceId = 's1') => s().bySpace[spaceId]?.map((e) => e.name);

beforeEach(() => {
  resetSessionState();
  vi.restoreAllMocks();
});

describe('event reducers', () => {
  const a = makeEvent({ id: 'a', name: 'A', startAt: '2026-10-25T19:00:00.000Z' });
  const b = makeEvent({ id: 'b', name: 'B', startAt: '2026-10-26T19:00:00.000Z' });

  it('sorts by start time, then id', () => {
    const same = makeEvent({ id: '0', name: 'Zero', startAt: a.startAt });
    expect(sortEvents([b, a, same]).map((e) => e.id)).toEqual(['0', 'a', 'b']);
  });

  it('merge: inserts in order, replaces, drops finished events, keeps my interested on neutral copies', () => {
    let list = mergeEvent([b], a);
    expect(list.map((e) => e.id)).toEqual(['a', 'b']);
    // A moved start re-sorts.
    list = mergeEvent(list, { ...a, startAt: '2026-10-27T19:00:00.000Z' });
    expect(list.map((e) => e.id)).toEqual(['b', 'a']);
    // The room's copy carries interested: false; mine stays.
    list = mergeEvent(list, { ...b, interested: true });
    list = mergeEvent(list, { ...b, interestedCount: 5, interested: false }, true);
    expect(list.find((e) => e.id === 'b')).toMatchObject({ interestedCount: 5, interested: true });
    // A REST response (not neutral) is authoritative.
    list = mergeEvent(list, { ...b, interestedCount: 4, interested: false });
    expect(list.find((e) => e.id === 'b')!.interested).toBe(false);
    // Over: gone; an unknown finished one changes nothing.
    expect(mergeEvent(list, { ...a, status: 'completed' }).map((e) => e.id)).toEqual(['b']);
    expect(mergeEvent(list, { ...a, id: 'zz', status: 'canceled' }).map((e) => e.id)).toEqual(['b', 'a']);
  });

  it('applies only to loaded lists; deletes and Space removal', () => {
    s().applyEvent(a);
    expect(s().bySpace.s1).toBeUndefined();
    useEvents.setState({ bySpace: { s1: [a], s2: [makeEvent({ id: 'c', spaceId: 's2' })] } });
    s().applyEvent(b, { neutral: true });
    expect(names()).toEqual(['A', 'B']);
    s().applyDeleted('s1', 'a');
    expect(names()).toEqual(['B']);
    s().openModal('s2', { eventId: 'c' });
    s().dropSpace('s2');
    expect(s().bySpace.s2).toBeUndefined();
    expect(s().modal).toBeNull();
  });
});

describe('loading and mutations', () => {
  it('loads once (deduped), drops finished events, reloads when stale', async () => {
    const get = vi
      .spyOn(api, 'get')
      .mockResolvedValue([
        makeEvent({ id: 'b', name: 'B', startAt: '2026-10-26T00:00:00.000Z' }),
        makeEvent({ id: 'a', name: 'A', startAt: '2026-10-25T00:00:00.000Z' }),
        makeEvent({ id: 'x', name: 'X', status: 'canceled' }),
      ]);
    await Promise.all([s().load('s1'), s().load('s1')]);
    await s().load('s1');
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('/api/spaces/s1/events');
    expect(names()).toEqual(['A', 'B']);
    s().invalidate();
    expect(s().stale).toEqual({ s1: true });
    await s().load('s1');
    expect(get).toHaveBeenCalledTimes(2);
    expect(s().stale).toEqual({});
  });

  it('a late response of a previous session is dropped', async () => {
    let resolve!: (v: unknown) => void;
    vi.spyOn(api, 'get').mockReturnValue(new Promise((r) => (resolve = r)) as never);
    const p = s().load('s1');
    resetSessionState();
    resolve([makeEvent()]);
    await p;
    expect(s().bySpace.s1).toBeUndefined();
  });

  it('create, update and remove apply the response at once', async () => {
    useEvents.setState({ bySpace: { s1: [] } });
    const created = makeEvent({ id: 'n', name: 'New', interested: true });
    const post = vi.spyOn(api, 'post').mockResolvedValue(created);
    await s().create('s1', { name: 'New', entityType: 'voice', channelId: 'v1', startAt: created.startAt });
    expect(post).toHaveBeenCalledWith('/api/spaces/s1/events', expect.objectContaining({ name: 'New' }));
    expect(names()).toEqual(['New']);
    const patch = vi.spyOn(api, 'patch').mockResolvedValue({ ...created, status: 'completed' });
    await s().update('s1', 'n', { status: 'completed' });
    expect(patch).toHaveBeenCalledWith('/api/spaces/s1/events/n', { status: 'completed' });
    expect(names()).toEqual([]);
    useEvents.setState({ bySpace: { s1: [created] } });
    const del = vi.spyOn(api, 'delete').mockResolvedValue(undefined);
    await s().remove('s1', 'n');
    expect(del).toHaveBeenCalledWith('/api/spaces/s1/events/n');
    expect(names()).toEqual([]);
  });

  it('Interested is optimistic and reverts when the request fails', async () => {
    useEvents.setState({ bySpace: { s1: [makeEvent({ interestedCount: 3 })] } });
    let resolve!: (v: unknown) => void;
    const put = vi.spyOn(api, 'put').mockReturnValue(new Promise((r) => (resolve = r)) as never);
    const on = s().setInterested('s1', 'e1', true);
    expect(s().bySpace.s1![0]).toMatchObject({ interested: true, interestedCount: 4 });
    expect(put).toHaveBeenCalledWith('/api/spaces/s1/events/e1/interested');
    resolve(makeEvent({ interested: true, interestedCount: 7 }));
    await on;
    expect(s().bySpace.s1![0]).toMatchObject({ interested: true, interestedCount: 7 });

    vi.spyOn(api, 'delete').mockRejectedValue(new Error('offline'));
    await expect(s().setInterested('s1', 'e1', false)).rejects.toThrow('offline');
    expect(s().bySpace.s1![0]).toMatchObject({ interested: true, interestedCount: 7 });
  });
});

describe('helpers', () => {
  it('create needs MANAGE_CHANNELS; manage is the creator or MANAGE_SPACE', () => {
    expect(canCreateEvents(makeSpace({ myPermissions: PERM.MANAGE_CHANNELS }))).toBe(true);
    expect(canCreateEvents(makeSpace())).toBe(false);
    const ev = makeEvent({ creatorId: 'me' });
    expect(canManageEvent(makeSpace(), ev, 'me')).toBe(true);
    expect(canManageEvent(makeSpace(), ev, 'bob')).toBe(false);
    expect(canManageEvent(makeSpace({ myPermissions: PERM.MANAGE_SPACE }), ev, 'bob')).toBe(true);
    expect(canManageEvent(makeSpace({ myPermissions: PERM.MANAGE_CHANNELS }), ev, 'bob')).toBe(false);
    expect(canManageEvent(makeSpace(), makeEvent({ creatorId: null }), null)).toBe(false);
  });

  it('starts from 15 minutes before the start time; the link opens the Space on the event', () => {
    const start = Date.parse('2026-10-25T19:00:00.000Z');
    const ev = makeEvent({ startAt: new Date(start).toISOString() });
    expect(canStartEvent(ev, start - EVENT_START_EARLY_MS - 1)).toBe(false);
    expect(canStartEvent(ev, start - EVENT_START_EARLY_MS)).toBe(true);
    expect(canStartEvent({ ...ev, status: 'active' }, start)).toBe(false);
    expect(eventLink(ev, 'https://enbox.test')).toBe('https://enbox.test/spaces/s1?event=e1');
  });
});
