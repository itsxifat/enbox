/** Spaces store: per-Space profiles and role styles (useSpaceAuthor, top roles, cache sync). */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { SpaceMember, SpaceRole } from '@enbox/shared';
import { makeSpace } from '@/features/spaces/testUtils';
import { makeMe } from '@/test/factories';
import { useAuth } from './auth';
import { topColoredRole, topIconRole, useSpaceAuthor, useSpaces } from './spaces';

const role = (p: Partial<SpaceRole> & Pick<SpaceRole, 'id' | 'position'>): SpaceRole => ({
  name: p.id,
  color: null,
  permissions: 0,
  hoist: false,
  mentionable: false,
  isDefault: false,
  ...p,
});

const ROLES = [
  role({ id: 'everyone', position: 0, isDefault: true }),
  role({ id: 'holo', position: 4, colorStyle: 'holographic' }),
  role({ id: 'grad', position: 3, color: '#ff0000', colorSecondary: '#0000ff', colorStyle: 'gradient', iconEmoji: '⭐' }),
  role({ id: 'icon', position: 2, iconUrl: '/uploads/i.png' }),
  role({ id: 'plain', position: 1, color: '#00ff00' }),
];

const member = (p: Partial<SpaceMember> = {}): SpaceMember => ({
  userId: 'bob',
  nickname: null,
  roleIds: [],
  joinedAt: '2026-01-01T00:00:00.000Z',
  timedOutUntil: null,
  serverMute: false,
  serverDeaf: false,
  ...p,
});

beforeEach(() => useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' }));
afterEach(() => useSpaces.setState({ byId: {}, order: [], members: {} }));

describe('top roles', () => {
  const space = makeSpace({ roles: ROLES });

  it('a holographic role counts as coloured even without colours', () => {
    expect(topColoredRole(space, ['plain', 'holo'])?.id).toBe('holo');
    expect(topColoredRole(space, ['plain', 'icon'])?.id).toBe('plain');
    expect(topColoredRole(space, ['icon'])).toBeNull();
  });

  it('topIconRole: the highest role with an image or emoji icon', () => {
    expect(topIconRole(space, ['plain', 'icon', 'grad'])?.id).toBe('grad');
    expect(topIconRole(space, ['plain', 'icon'])?.id).toBe('icon');
    expect(topIconRole(space, ['plain', 'holo'])).toBeNull();
  });
});

describe('useSpaceAuthor', () => {
  it('nickname, full role style, icon role and the per-Space profile', () => {
    useSpaces.setState({
      byId: { s1: makeSpace({ roles: ROLES }) },
      members: { s1: { bob: member({ nickname: 'Bobby', roleIds: ['grad', 'icon'], bio: 'Space bio', avatarUrl: '/uploads/b.jpg' }) } },
    });
    const { result } = renderHook(() => useSpaceAuthor('s1', 'bob'));
    expect(result.current).toMatchObject({
      nickname: 'Bobby',
      color: '#ff0000',
      role: { color: '#ff0000', colorSecondary: '#0000ff', colorStyle: 'gradient' },
      iconRole: { id: 'grad' },
      profile: { bio: 'Space bio', avatarUrl: '/uploads/b.jpg', nameplate: null },
    });
  });

  it('me before my member row loads: from space.me', () => {
    useSpaces.setState({
      byId: { s1: makeSpace({ roles: ROLES, me: { nickname: 'Me There', roleIds: ['holo'], pronouns: 'she/her' } }) },
      members: { s1: {} },
    });
    const { result } = renderHook(() => useSpaceAuthor('s1', 'me'));
    expect(result.current).toMatchObject({
      nickname: 'Me There',
      role: { colorStyle: 'holographic' },
      profile: { pronouns: 'she/her' },
    });
  });
});

describe('cache sync', () => {
  it('space:upsert (or my PATCH) updates my cached member; others stay', () => {
    const space = makeSpace();
    useSpaces.setState({
      byId: { s1: space },
      members: { s1: { me: member({ userId: 'me' }), bob: member() } },
    });
    const bob = useSpaces.getState().members.s1!.bob;
    useSpaces.getState().upsertSpace({ ...space, me: { ...space.me, nickname: 'N', bio: 'B', nameplate: 'ocean' } });
    const s = useSpaces.getState();
    expect(s.members.s1!.me).toMatchObject({ nickname: 'N', bio: 'B', nameplate: 'ocean' });
    expect(s.members.s1!.bob).toBe(bob);
  });

  it('space:member-updated for me updates space.me', () => {
    useSpaces.setState({ byId: { s1: makeSpace() }, members: { s1: {} } });
    useSpaces.getState().upsertMembers('s1', [member({ userId: 'me', bio: 'From elsewhere', avatarDecoration: 'halo' })]);
    expect(useSpaces.getState().byId.s1!.me).toMatchObject({ bio: 'From elsewhere', avatarDecoration: 'halo' });
  });
});
