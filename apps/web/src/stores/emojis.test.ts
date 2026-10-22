/** Emoji store: picker groups, per-Space lists, the id index, `space:emojis`, mutations and URLs. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PERM, type SpaceEmoji, type SpaceEmojiGroup } from '@enbox/shared';
import { pickerGroups } from '@/features/conversation/EmojiPickerPanel';
import { makeSpace } from '@/features/spaces/testUtils';
import { api } from '@/lib/api';
import { resetSessionState } from '@/lib/session';
import { emojiImageUrl, useEmojis } from './emojis';
import { useSpaces } from './spaces';

const e = (id: string, spaceId: string, name: string, animated = false): SpaceEmoji => ({
  id,
  spaceId,
  name,
  url: `/uploads/${name}.${animated ? 'gif' : 'png'}`,
  animated,
  createdBy: 'u1',
});

const GROUPS: SpaceEmojiGroup[] = [
  { spaceId: 's1', spaceName: 'Alpha', iconUrl: null, emojis: [e('e1', 's1', 'blob'), e('e2', 's1', 'party', true)] },
  { spaceId: 's2', spaceName: 'Beta', iconUrl: '/uploads/beta.png', emojis: [e('e3', 's2', 'bee')] },
];

beforeEach(() => {
  useEmojis.setState({ groups: null, bySpace: {}, byId: {}, stale: false });
  useSpaces.setState({
    byId: { s1: makeSpace({ id: 's1', name: 'Alpha' }), s3: makeSpace({ id: 's3', name: 'Gamma', iconUrl: '/uploads/g.png' }) },
    order: ['s1', 's3'],
    members: {},
  });
});

describe('emoji store', () => {
  it('loads my groups once and indexes every emoji by id', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue(GROUPS);
    await Promise.all([useEmojis.getState().loadMine(), useEmojis.getState().loadMine()]);
    await useEmojis.getState().loadMine();
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('/api/me/emojis');
    expect(Object.keys(useEmojis.getState().byId).sort()).toEqual(['e1', 'e2', 'e3']);
    // Stale (reconnect, a Space joined): fetched again.
    useEmojis.getState().invalidate();
    await useEmojis.getState().loadMine();
    expect(get).toHaveBeenCalledTimes(2);
    expect(useEmojis.getState().stale).toBe(false);
  });

  it('space:emojis replaces a Space’s list in the groups, adds a new group, drops an emptied one', () => {
    useEmojis.setState({ groups: GROUPS });
    const s = () => useEmojis.getState();
    s().applySpaceEmojis('s1', [e('e1', 's1', 'blob_2')]);
    expect(s().groups!.find((g) => g.spaceId === 's1')!.emojis.map((x) => x.name)).toEqual(['blob_2']);
    expect(s().byId.e2).toBeUndefined();
    // A Space of mine that had no emoji gets a group from the spaces store.
    s().applySpaceEmojis('s3', [e('e9', 's3', 'gem')]);
    expect(s().groups!.at(-1)).toMatchObject({ spaceId: 's3', spaceName: 'Gamma', iconUrl: '/uploads/g.png' });
    s().applySpaceEmojis('s2', []);
    expect(s().groups!.map((g) => g.spaceId)).toEqual(['s1', 's3']);
    // Lists not loaded on their own are not kept separately.
    expect(s().bySpace).toEqual({});
    s().dropSpace('s1');
    expect(s().groups!.map((g) => g.spaceId)).toEqual(['s3']);
    expect(s().byId.e1).toBeUndefined();
  });

  it('a Space’s list (settings): load, create, rename, remove update the list and the groups', async () => {
    useEmojis.setState({ groups: GROUPS });
    vi.spyOn(api, 'get').mockResolvedValue([e('e1', 's1', 'blob'), e('e2', 's1', 'party', true)]);
    const list = await useEmojis.getState().loadSpace('s1');
    expect(list).toHaveLength(2);
    const post = vi.spyOn(api, 'post').mockResolvedValue(e('e4', 's1', 'wave'));
    await useEmojis.getState().create('s1', 'wave', 'm1');
    expect(post).toHaveBeenCalledWith('/api/spaces/s1/emojis', { name: 'wave', mediaId: 'm1' });
    const patch = vi.spyOn(api, 'patch').mockResolvedValue(e('e1', 's1', 'blobby'));
    await useEmojis.getState().rename('s1', 'e1', 'blobby');
    expect(patch).toHaveBeenCalledWith('/api/spaces/s1/emojis/e1', { name: 'blobby' });
    const del = vi.spyOn(api, 'delete').mockResolvedValue(undefined);
    await useEmojis.getState().remove('s1', 'e2');
    expect(del).toHaveBeenCalledWith('/api/spaces/s1/emojis/e2');
    const names = ['blobby', 'wave'];
    expect(useEmojis.getState().bySpace.s1!.map((x) => x.name)).toEqual(names);
    expect(useEmojis.getState().groups![0]!.emojis.map((x) => x.name)).toEqual(names);
    expect(useEmojis.getState().byId.e4!.name).toBe('wave');
  });

  it('logout clears everything', () => {
    useEmojis.setState({ groups: GROUPS, byId: { e1: GROUPS[0]!.emojis[0]! } });
    resetSessionState();
    expect(useEmojis.getState()).toMatchObject({ groups: null, bySpace: {}, byId: {} });
  });

  it('image URLs: the known file, else the redirect; the still of an animated one', () => {
    const known = e('e1', 's1', 'blob');
    expect(emojiImageUrl(known, { known })).toBe('/uploads/blob.png');
    expect(emojiImageUrl({ id: 'x1', animated: false })).toBe('/api/emojis/x1');
    const party = e('e2', 's1', 'party', true);
    expect(emojiImageUrl(party, { known: party })).toBe('/uploads/party.gif');
    expect(emojiImageUrl(party, { known: party, still: true })).toBe('/api/emojis/e2?static=1');
  });

  it('picker groups: the current Space first; only it where external emoji are denied', () => {
    expect(pickerGroups(GROUPS, false)).toEqual([]);
    expect(pickerGroups(GROUPS, true).map((g) => g.spaceId)).toEqual(['s1', 's2']);
    const chat = (spacePermissions: number) => ({ space: { spaceId: 's2' } as never, spacePermissions });
    expect(pickerGroups(GROUPS, chat(PERM.VIEW_CHANNEL | PERM.USE_EXTERNAL_EMOJI)).map((g) => g.spaceId)).toEqual(['s2', 's1']);
    expect(pickerGroups(GROUPS, chat(PERM.VIEW_CHANNEL)).map((g) => g.spaceId)).toEqual(['s2']);
    expect(pickerGroups(GROUPS, { space: null, spacePermissions: null }).map((g) => g.spaceId)).toEqual(['s1', 's2']);
  });
});
