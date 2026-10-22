/** Test helpers for Spaces (unit tests only). */
import { ALL_PERMISSIONS, type Space } from '@enbox/shared';

/** A Space as its member `me` sees it; `owner: true` makes me the owner with every bit. */
export function makeSpace(
  p: Partial<Omit<Space, 'me'>> & { me?: Partial<Space['me']>; owner?: boolean } = {},
): Space {
  const { me, owner, ...rest } = p;
  return {
    id: 's1',
    name: 'Space',
    description: null,
    iconUrl: null,
    iconAnimatedUrl: null,
    bannerUrl: null,
    ownerId: owner ? 'me' : 'owner',
    memberCount: 2,
    large: false,
    systemChannelId: null,
    rulesChannelId: null,
    afkChannelId: null,
    afkTimeoutSec: 300,
    defaultNotifyLevel: 'mentions',
    systemFlags: 0,
    verificationLevel: 0,
    explicitFilter: 0,
    isDiscoverable: false,
    vanityCode: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    roles: [
      { id: 'everyone', name: '@everyone', color: null, position: 0, permissions: 0, hoist: false, mentionable: false, isDefault: true },
    ],
    categories: [],
    me: {
      roleIds: [],
      nickname: null,
      joinedAt: '2026-01-01T00:00:00.000Z',
      timedOutUntil: null,
      serverMute: false,
      serverDeaf: false,
      notifyLevel: null,
      mutedUntil: null,
      suppressEveryone: false,
      suppressRoles: false,
      hideMutedChannels: false,
      ...me,
    },
    myPermissions: owner ? ALL_PERMISSIONS : 0,
    unread: false,
    unreadMentionCount: 0,
    ...rest,
  };
}
