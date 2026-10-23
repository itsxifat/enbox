/** Sticker store: picker groups (deduped load, stale refetch), `space:stickers`, per-Space lists and mutations, lookups. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpaceSticker, SpaceStickerGroup } from '@enbox/shared';
import { makeSpace } from '@/features/spaces/testUtils';
import { api } from '@/lib/api';
import { findSticker, useStickers } from './stickers';
import { useSpaces } from './spaces';

const st = (id: string, spaceId: string, name: string): SpaceSticker => ({
  id,
  spaceId,
  name,
  description: null,
  emoji: null,
  url: `/uploads/${id}.png`,
  animated: false,
  createdBy: 'u1',
});

const GROUPS: SpaceStickerGroup[] = [
  { spaceId: 's1', spaceName: 'Alpha', iconUrl: null, stickers: [st('a', 's1', 'Wave')] },
  { spaceId: 's2', spaceName: 'Beta', iconUrl: null, stickers: [st('b', 's2', 'Bee')] },
];

beforeEach(() => {
  vi.restoreAllMocks();
  useStickers.setState({ groups: null, bySpace: {}, stale: false });
  useSpaces.setState({
    byId: { s3: makeSpace({ id: 's3', name: 'Gamma', iconUrl: '/uploads/g.png' }) },
    order: ['s3'],
  });
});

describe('sticker store', () => {
  it('loads my groups once (deduped), again when stale', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue(GROUPS);
    await Promise.all([useStickers.getState().loadMine(), useStickers.getState().loadMine()]);
    await useStickers.getState().loadMine();
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('/api/me/stickers');
    useStickers.getState().invalidate();
    await useStickers.getState().loadMine();
    expect(get).toHaveBeenCalledTimes(2);
    expect(useStickers.getState().stale).toBe(false);
  });

  it('space:stickers replaces a list, adds a group for a Space of mine, drops an emptied one', () => {
    useStickers.setState({ groups: GROUPS });
    const s = () => useStickers.getState();
    s().applySpaceStickers('s1', [st('a', 's1', 'Wave 2')]);
    expect(s().groups![0]!.stickers.map((x) => x.name)).toEqual(['Wave 2']);
    s().applySpaceStickers('s3', [st('c', 's3', 'Gem')]);
    expect(s().groups!.at(-1)).toMatchObject({
      spaceId: 's3',
      spaceName: 'Gamma',
      iconUrl: '/uploads/g.png',
    });
    s().applySpaceStickers('s2', []);
    expect(s().groups!.map((g) => g.spaceId)).toEqual(['s1', 's3']);
    // Lists not loaded on their own are not kept separately.
    expect(s().bySpace).toEqual({});
    expect(findSticker(s(), 'c')?.name).toBe('Gem');
    expect(findSticker(s(), 'c', 's1')).toBeNull();
  });

  it('a Space’s list: load, create, update, remove keep the list and the groups in step', async () => {
    useStickers.setState({ groups: GROUPS });
    vi.spyOn(api, 'get').mockResolvedValue([st('a', 's1', 'Wave')]);
    await useStickers.getState().loadSpace('s1');
    vi.spyOn(api, 'post').mockResolvedValue(st('n', 's1', 'Nod'));
    await useStickers.getState().create('s1', { name: 'Nod', mediaId: 'm1' });
    vi.spyOn(api, 'patch').mockResolvedValue({ ...st('a', 's1', 'Wave'), emoji: '👋' });
    await useStickers.getState().update('s1', 'a', { emoji: '👋' });
    expect(useStickers.getState().bySpace.s1!.map((x) => [x.name, x.emoji])).toEqual([
      ['Wave', '👋'],
      ['Nod', null],
    ]);
    const del = vi.spyOn(api, 'delete').mockResolvedValue(undefined);
    await useStickers.getState().remove('s1', 'n');
    expect(del).toHaveBeenCalledWith('/api/spaces/s1/stickers/n');
    expect(useStickers.getState().groups![0]!.stickers.map((x) => x.name)).toEqual(['Wave']);
    expect(findSticker(useStickers.getState(), 'a', 's1')?.emoji).toBe('👋');
    useStickers.getState().dropSpace('s1');
    expect(useStickers.getState().bySpace.s1).toBeUndefined();
    expect(useStickers.getState().groups!.map((g) => g.spaceId)).toEqual(['s2']);
  });
});
