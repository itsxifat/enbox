/** The member list: role groups, Online and Offline, status lines, and paging for large Spaces. */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { VirtuosoMockContext } from 'react-virtuoso';
import type { Presence, Space, SpaceMember, SpaceMemberPage, SpaceRole, VoiceState } from '@enbox/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useSpaces } from '@/stores/spaces';
import { useUsers } from '@/stores/users';
import { useVoice } from '@/stores/voice';
import { makeChat, makeMe, makeUser } from '@/test/factories';
import { MemberList, memberRows } from './MemberList';
import { makeSpace } from './testUtils';

const MODS: SpaceRole = { id: 'mods', name: 'Mods', color: null, position: 2, permissions: 0, hoist: true, mentionable: false, isDefault: false };
const FANS: SpaceRole = { id: 'fans', name: 'Fans', color: null, position: 1, permissions: 0, hoist: true, mentionable: false, isDefault: false };

const member = (userId: string, roleIds: string[] = []): SpaceMember => ({
  userId,
  nickname: null,
  roleIds,
  joinedAt: '2026-01-01T00:00:00.000Z',
  timedOutUntil: null,
  serverMute: false,
  serverDeaf: false,
});

const presence = (userId: string, online: boolean, note: Presence['note'] = null): Presence => ({
  userId,
  online,
  state: online ? 'online' : 'offline',
  note,
  lastSeenAt: null,
});

describe('memberRows', () => {
  const space = { roles: [MODS, FANS] };
  const list = [member('ann', ['mods']), member('bob', ['fans']), member('cat'), member('dan')];
  const online = new Set(['ann', 'cat']);
  const view = (rows: ReturnType<typeof memberRows>) => rows.map((r) => (r.kind === 'header' ? `${r.label} — ${r.count}` : r.member.userId));

  it('splits online members by hoisted role, then Online, then everyone offline', () => {
    expect(view(memberRows(space, list, (id) => online.has(id), true))).toEqual([
      'Mods — 1',
      'ann',
      'Online — 1',
      'cat',
      'Offline — 2',
      'bob',
      'dan',
    ]);
  });

  it('a large Space keeps the role groups and Members, online or not', () => {
    expect(view(memberRows(space, list, (id) => online.has(id), false))).toEqual([
      'Mods — 1',
      'ann',
      'Fans — 1',
      'bob',
      'Members — 2',
      'cat',
      'dan',
    ]);
  });
});

describe('MemberList', () => {
  const pages: Record<string, SpaceMemberPage> = {
    first: { members: [member('ann', ['mods']), member('bob')], nextCursor: 'n1' },
    n1: { members: [member('cat'), member('me')], nextCursor: null },
  };
  let get: MockInstance<typeof api.get>;
  let post: MockInstance<typeof api.post>;

  beforeEach(() => {
    useAuth.setState({ user: makeMe({ id: 'me', displayName: 'Mia' }), token: 't', status: 'authenticated' });
    get = vi.spyOn(api, 'get').mockImplementation((async (_path: string, opts?: { query?: { after?: string } }) =>
      pages[opts?.query?.after ?? 'first']) as never);
    // Bob's cached presence is old: the fresh one says he went offline.
    post = vi.spyOn(api, 'post').mockResolvedValue([presence('ann', true), presence('bob', false)] as never);
    useUsers.setState({
      byId: Object.fromEntries(
        [
          makeUser({ id: 'ann', displayName: 'Ann' }),
          makeUser({ id: 'bob', displayName: 'Bob' }),
          makeUser({ id: 'cat', displayName: 'Cat' }),
          makeUser({ id: 'me', displayName: 'Mia' }),
        ].map((u) => [u.id, u]),
      ),
      presence: {
        ann: presence('ann', true),
        bob: presence('bob', true),
        cat: presence('cat', false, { text: 'Away', emoji: null, expiresAt: null }),
        me: presence('me', true, { text: 'Raiding', emoji: '🎮', expiresAt: null }),
      },
      subscribePresence: async () => undefined,
      unsubscribePresence: () => undefined,
      fetchUsers: async () => undefined,
    });
    const lounge: VoiceState = {
      userId: 'ann',
      spaceId: 's1',
      channelId: 'v1',
      selfMute: false,
      selfDeaf: false,
      selfVideo: false,
      selfStream: false,
      serverMute: false,
      serverDeaf: false,
      joinedAt: '2026-10-23T10:00:00.000Z',
    };
    useVoice.setState({ byUser: { ann: lounge } });
    useChats.setState({ byId: { v1: makeChat({ id: 'v1', type: 'space_voice', name: 'Lounge' }) } });
  });
  afterEach(() => {
    useSpaces.setState({ byId: {}, members: {} });
    useVoice.setState({ byUser: {} });
    useChats.setState({ byId: {} });
  });

  function renderList(space: Space, viewportHeight: number) {
    useSpaces.setState({ byId: { [space.id]: space }, members: {} });
    return render(
      <VirtuosoMockContext.Provider value={{ viewportHeight, itemHeight: 44 }}>
        <MemberList spaceId={space.id} />
      </VirtuosoMockContext.Provider>,
    );
  }

  const groups = () => screen.queryAllByTestId('member-group').map((g) => g.textContent);

  it('a small Space loads every member and splits them into roles, Online and Offline, with status lines', async () => {
    renderList(makeSpace({ id: 's1', roles: [...makeSpace().roles, MODS], memberCount: 4 }), 4000);
    await waitFor(() => expect(groups()).toEqual(['Mods — 1', 'Online — 1', 'Offline — 2']));
    expect(get).toHaveBeenCalledTimes(2);
    expect(post).toHaveBeenCalledWith('/api/users/presence', { userIds: ['ann', 'bob'] });

    const rows = screen.getAllByTestId('space-member-row');
    // Ann (Mods) is in voice; I'm online with a custom status; Bob and Cat are offline (no status).
    ['Ann', 'Mia', 'Bob', 'Cat'].forEach((name, i) => expect(within(rows[i]!).getByText(name)).toBeInTheDocument());
    expect(rows.map((r) => within(r).queryByTestId('member-status')?.textContent ?? null)).toEqual([
      'In Lounge',
      '🎮 Raiding',
      null,
      null,
    ]);
    expect(rows[2]).toHaveClass('opacity-60');
    expect(rows[1]).not.toHaveClass('opacity-60');
  });

  it('a large Space pages as it scrolls and keeps its role groups and Members', async () => {
    renderList(makeSpace({ id: 's1', roles: [...makeSpace().roles, MODS], memberCount: 5_000, large: true }), 100);
    await waitFor(() => expect(groups()).toEqual(['Mods — 1', 'Members — 1']));
    expect(get).toHaveBeenCalledTimes(1);
    expect(post).not.toHaveBeenCalled();
  });
});
