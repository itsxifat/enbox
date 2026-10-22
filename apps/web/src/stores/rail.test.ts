import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RailEntry } from '@enbox/shared';
import { makeSpace } from '@/features/spaces/testUtils';
import { ApiError, api } from '@/lib/api';
import { makeMe } from '@/test/factories';
import { useAuth } from './auth';
import { applyRailDrop, moveInRail, normalizeRail, railItems, updateRailFolder, useRail } from './rail';

const space = (id: string, joinedAt = '2026-01-01T00:00:00.000Z') => makeSpace({ id, name: id.toUpperCase(), me: { joinedAt } });
const S = (id: string): RailEntry => ({ kind: 'space', id });
const F = (id: string, spaceIds: string[], p: { name?: string | null; color?: string | null } = {}): RailEntry => ({
  kind: 'folder',
  folder: { id, name: p.name ?? null, color: p.color ?? null, spaceIds },
});
/** A layout as a compact string: `a b [c d]`. */
const show = (layout: readonly RailEntry[]) =>
  layout.map((e) => (e.kind === 'space' ? e.id : `[${e.folder.spaceIds.join(' ')}]`)).join(' ');

const spaces = ['a', 'b', 'c', 'd', 'e'].map((id) => space(id));
const fid = () => 'new';

describe('normalizeRail / railItems', () => {
  it('Spaces missing from the layout go on top, newest join first; unknown and repeated ids drop', () => {
    const list = [
      space('a', '2026-01-01T00:00:00.000Z'),
      space('b', '2026-03-01T00:00:00.000Z'),
      space('c', '2026-02-01T00:00:00.000Z'),
      space('d'),
    ];
    expect(show(normalizeRail([S('d'), S('gone'), S('d')], list))).toBe('b c a d');
    expect(show(normalizeRail(undefined, list))).toBe('b c a d');
  });

  it('a folder left with one known Space dissolves; an empty one goes', () => {
    expect(show(normalizeRail([F('f1', ['a', 'gone']), F('f2', ['gone']), S('b'), F('f3', ['c', 'd'])], spaces))).toBe('e a b [c d]');
  });

  it('railItems carries the Spaces of each item', () => {
    const items = railItems([F('f1', ['b', 'a'], { name: 'Games' })], [space('a'), space('b')]);
    expect(items).toHaveLength(1);
    const [folder] = items;
    expect(folder!.kind === 'folder' && folder.spaces.map((s) => s.id)).toEqual(['b', 'a']);
    expect(folder!.kind === 'folder' && folder.folder.name).toBe('Games');
  });
});

describe('applyRailDrop', () => {
  const base = [S('a'), S('b'), F('f', ['c', 'd']), S('e')];

  it('reorders top-level Spaces (before / after / end)', () => {
    expect(show(applyRailDrop(base, 'e', { kind: 'before', targetId: 'a' }, fid))).toBe('e a b [c d]');
    expect(show(applyRailDrop(base, 'a', { kind: 'after', targetId: 'b' }, fid))).toBe('b a [c d] e');
    expect(show(applyRailDrop(base, 'a', { kind: 'end' }, fid))).toBe('b [c d] e a');
    expect(show(applyRailDrop(base, 'a', { kind: 'after', targetId: 'f' }, fid))).toBe('b [c d] a e');
  });

  it('dropping onto a top-level Space makes a folder of the two (the target first)', () => {
    const next = applyRailDrop(base, 'e', { kind: 'combine', spaceId: 'a' }, fid);
    expect(show(next)).toBe('[a e] b [c d]');
    expect(next[0]).toEqual(F('new', ['a', 'e']));
  });

  it('adds to a folder: into it (end or index), or next to one of its Spaces', () => {
    expect(show(applyRailDrop(base, 'a', { kind: 'into', folderId: 'f' }, fid))).toBe('b [c d a] e');
    expect(show(applyRailDrop(base, 'a', { kind: 'into', folderId: 'f', index: 0 }, fid))).toBe('b [a c d] e');
    expect(show(applyRailDrop(base, 'e', { kind: 'before', targetId: 'd' }, fid))).toBe('a b [c e d]');
    // Onto a Space inside a folder: next to it (folders do not nest).
    expect(show(applyRailDrop(base, 'e', { kind: 'combine', spaceId: 'c' }, fid))).toBe('a b [c e d]');
  });

  it('takes a Space out of a folder; a folder left with one Space dissolves', () => {
    const three = [S('a'), F('f', ['b', 'c', 'd'])];
    expect(show(applyRailDrop(three, 'c', { kind: 'before', targetId: 'a' }, fid))).toBe('c a [b d]');
    expect(show(applyRailDrop(base, 'c', { kind: 'end' }, fid))).toBe('a b d e c');
    expect(show(applyRailDrop(base, 'd', { kind: 'combine', spaceId: 'a' }, fid))).toBe('[a d] b c e');
  });

  it('reorders inside a folder', () => {
    expect(show(applyRailDrop(base, 'c', { kind: 'after', targetId: 'd' }, fid))).toBe('a b [d c] e');
  });

  it('moves a folder between top-level items, never into a folder or a Space', () => {
    expect(show(applyRailDrop(base, 'f', { kind: 'before', targetId: 'a' }, fid))).toBe('[c d] a b e');
    expect(show(applyRailDrop(base, 'f', { kind: 'end' }, fid))).toBe('a b e [c d]');
    expect(show(applyRailDrop(base, 'f', { kind: 'combine', spaceId: 'e' }, fid))).toBe('a b [c d] e');
    const two = [F('f', ['a', 'b']), F('g', ['c', 'd'])];
    expect(show(applyRailDrop(two, 'f', { kind: 'after', targetId: 'c' }, fid))).toBe('[c d] [a b]');
  });

  it('a drop onto itself (or into the dragged folder) changes nothing', () => {
    expect(applyRailDrop(base, 'a', { kind: 'combine', spaceId: 'a' }, fid)).toBe(base);
    expect(applyRailDrop(base, 'f', { kind: 'before', targetId: 'c' }, fid)).toBe(base);
    expect(applyRailDrop(base, 'zz', { kind: 'end' }, fid)).toBe(base);
  });
});

describe('moveInRail (Alt+Shift+↑/↓)', () => {
  const base = [S('a'), F('f', ['b', 'c']), S('d')];

  it('swaps top-level items (a folder counts as one)', () => {
    expect(show(moveInRail(base, 'd', -1))).toBe('a d [b c]');
    expect(show(moveInRail(base, 'a', 1))).toBe('[b c] a d');
    expect(show(moveInRail(base, 'f', 1))).toBe('a d [b c]');
    expect(moveInRail(base, 'a', -1)).toBe(base);
  });

  it('moves inside a folder, and out of it past either end', () => {
    expect(show(moveInRail(base, 'b', 1))).toBe('a [c b] d');
    expect(show(moveInRail(base, 'b', -1))).toBe('a b c d');
    expect(show(moveInRail([F('f', ['a', 'b', 'c'])], 'c', 1))).toBe('[a b] c');
  });
});

describe('updateRailFolder', () => {
  it('renames and recolours one folder', () => {
    const next = updateRailFolder([F('f', ['a', 'b']), S('c')], 'f', { name: 'Work', color: '#ff0000' });
    expect(next[0]).toEqual(F('f', ['a', 'b'], { name: 'Work', color: '#ff0000' }));
    expect(next[1]).toEqual(S('c'));
  });
});

describe('rail store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useAuth.setState({ user: makeMe({ id: 'me', railLayout: [S('a')] }), token: 't', status: 'authenticated' });
    useRail.setState({ layout: [S('a')], open: {} });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('applies edits at once, saves once (debounced), then follows the server copy', async () => {
    const put = vi
      .spyOn(api, 'put')
      .mockImplementation((async (_path: string, body?: unknown) => (body as { items: RailEntry[] }).items) as never);
    useRail.getState().setLayout([S('b'), S('a')]);
    useRail.getState().setLayout([S('c'), S('b'), S('a')]);
    expect(show(useRail.getState().layout)).toBe('c b a');
    expect(put).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(put).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledWith('/api/me/rail-layout', { items: [S('c'), S('b'), S('a')] });
    expect(useAuth.getState().user?.railLayout).toEqual([S('c'), S('b'), S('a')]);
    // Another device's change (me:updated) converges.
    useAuth.getState().setUser({ ...useAuth.getState().user!, railLayout: [S('a'), S('c')] });
    expect(show(useRail.getState().layout)).toBe('a c');
  });

  it('ignores the server copy while a save waits, reverts when the save fails', async () => {
    const put = vi.spyOn(api, 'put').mockRejectedValue(new Error('nope'));
    useRail.getState().setLayout([S('b'), S('a')]);
    useAuth.getState().setUser({ ...useAuth.getState().user!, railLayout: [S('z')] });
    expect(show(useRail.getState().layout)).toBe('b a');
    await vi.advanceTimersByTimeAsync(500);
    expect(put).toHaveBeenCalledTimes(1);
    expect(show(useRail.getState().layout)).toBe('z');
  });

  it('rate-limited (or offline): keeps my order and saves it again later', async () => {
    const put = vi
      .spyOn(api, 'put')
      .mockRejectedValueOnce(new ApiError('rate_limited', 'Slow down', 429))
      .mockImplementation((async (_path: string, body?: unknown) => (body as { items: RailEntry[] }).items) as never);
    useRail.getState().setLayout([S('b'), S('a')]);
    await vi.advanceTimersByTimeAsync(500);
    expect(put).toHaveBeenCalledTimes(1);
    expect(show(useRail.getState().layout)).toBe('b a');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(put).toHaveBeenCalledTimes(2);
    expect(useAuth.getState().user?.railLayout).toEqual([S('b'), S('a')]);
  });

  it('folder open state is per device', () => {
    useRail.getState().toggleFolder('f');
    expect(useRail.getState().open).toEqual({ f: true });
    expect(JSON.parse(localStorage.getItem('enbox.rail.openFolders')!)).toEqual({ f: true });
    useRail.getState().toggleFolder('f');
    expect(useRail.getState().open).toEqual({});
  });
});
