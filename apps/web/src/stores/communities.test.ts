import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Community } from '@enbox/shared';
import { linkableGroups } from '@/features/communities/AddGroupsView';
import { api } from '@/lib/api';
import { resetSessionState } from '@/lib/session';
import { makeChat } from '@/test/factories';
import { useChats } from './chats';
import { isCommunityAdmin, useCommunities } from './communities';

function makeCommunity(p: Partial<Community> = {}): Community {
  return {
    id: 'c1',
    name: 'Outdoors',
    description: null,
    avatarUrl: null,
    createdBy: 'me',
    createdAt: '2025-01-01T00:00:00.000Z',
    memberCount: 3,
    myRole: 'member',
    announcementChatId: 'ann',
    inviteCode: null,
    groups: [
      {
        chatId: 'ann',
        name: 'Outdoors',
        description: null,
        avatarUrl: null,
        memberCount: 3,
        isAnnouncement: true,
        isMember: true,
      },
      {
        chatId: 'g1',
        name: 'Hiking',
        description: null,
        avatarUrl: null,
        memberCount: 2,
        isAnnouncement: false,
        isMember: false,
      },
    ],
    ...p,
  };
}

describe('communities store', () => {
  beforeEach(() => {
    resetSessionState();
    vi.restoreAllMocks();
  });

  it('loads, upserts and removes communities', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([
      makeCommunity(),
      makeCommunity({ id: 'c2', name: 'Art' }),
    ]);
    await useCommunities.getState().loadCommunities();
    expect(useCommunities.getState().loaded).toBe(true);
    expect(Object.keys(useCommunities.getState().byId)).toEqual(['c1', 'c2']);
    useCommunities.getState().upsertCommunity(makeCommunity({ name: 'Renamed' }));
    expect(useCommunities.getState().byId.c1?.name).toBe('Renamed');
    useCommunities.getState().removeCommunity('c2');
    expect(useCommunities.getState().byId.c2).toBeUndefined();
  });

  it('dedupes concurrent loads', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue([]);
    await Promise.all([
      useCommunities.getState().loadCommunities(),
      useCommunities.getState().loadCommunities(),
    ]);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('drops a community the server no longer shows', async () => {
    useCommunities.getState().upsertCommunity(makeCommunity());
    const { ApiError } = await import('@/lib/api');
    vi.spyOn(api, 'get').mockRejectedValue(new ApiError('not_found', 'Not found', 404));
    await expect(useCommunities.getState().refreshCommunity('c1')).rejects.toThrow();
    expect(useCommunities.getState().byId.c1).toBeUndefined();
  });

  it('joining a group marks it joined and adds the chat', async () => {
    useCommunities.getState().upsertCommunity(makeCommunity());
    const chat = makeChat({ id: 'g1', name: 'Hiking', communityId: 'c1', memberCount: 3 });
    const post = vi.spyOn(api, 'post').mockResolvedValue(chat);
    await useCommunities.getState().joinGroup('c1', 'g1');
    expect(post).toHaveBeenCalledWith('/api/communities/c1/groups/g1/join');
    const g = useCommunities.getState().byId.c1!.groups.find((x) => x.chatId === 'g1')!;
    expect(g.isMember).toBe(true);
    expect(g.memberCount).toBe(3);
    expect(useChats.getState().byId.g1?.name).toBe('Hiking');
  });

  it('leaving removes the community and its announcement chat', async () => {
    useCommunities.getState().upsertCommunity(makeCommunity());
    useChats
      .getState()
      .upsertChat(makeChat({ id: 'ann', isAnnouncement: true, communityId: 'c1' }));
    vi.spyOn(api, 'post').mockResolvedValue(undefined);
    await useCommunities.getState().leaveCommunity('c1');
    expect(useCommunities.getState().byId.c1).toBeUndefined();
    expect(useChats.getState().byId.ann).toBeUndefined();
  });

  it('keeps the invite code after a reset', async () => {
    useCommunities
      .getState()
      .upsertCommunity(makeCommunity({ myRole: 'owner', inviteCode: 'old' }));
    vi.spyOn(api, 'post').mockResolvedValue({ code: 'new' });
    await useCommunities.getState().resetInvite('c1');
    expect(useCommunities.getState().byId.c1?.inviteCode).toBe('new');
  });

  it('knows who administers a community', () => {
    expect(isCommunityAdmin(makeCommunity({ myRole: 'owner' }))).toBe(true);
    expect(isCommunityAdmin(makeCommunity({ myRole: 'admin' }))).toBe(true);
    expect(isCommunityAdmin(makeCommunity())).toBe(false);
    expect(isCommunityAdmin(undefined)).toBe(false);
  });
});

describe('linkable groups', () => {
  it('lists active regular groups I admin that are not in a community', () => {
    const byId = Object.fromEntries(
      [
        makeChat({ id: 'a', name: 'B group', myRole: 'owner' }),
        makeChat({ id: 'b', name: 'A group', myRole: 'admin' }),
        makeChat({ id: 'c', myRole: 'member' }),
        makeChat({ id: 'd', myRole: 'owner', communityId: 'x' }),
        makeChat({ id: 'e', myRole: 'owner', isAnnouncement: true }),
        makeChat({ id: 'f', myRole: 'owner', membership: 'left' }),
        makeChat({ id: 'g', type: 'channel', myRole: 'owner' }),
      ].map((c) => [c.id, c]),
    );
    expect(linkableGroups(byId).map((c) => c.id)).toEqual(['b', 'a']);
  });
});
