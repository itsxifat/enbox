import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSIONS,
  ASSIGNABLE_PERMISSIONS,
  DEFAULT_EVERYONE_PERMISSIONS,
  PERM,
  RESERVED_PERMISSIONS,
  canActOn,
  canManageRole,
  computeBasePermissions,
  computeChannelPermissions,
  grantableBits,
  hasPerm,
  highestRolePosition,
  memberChannelPermissions,
  type OverwriteInput,
  type RoleInput,
} from './permissions.js';

const EVERYONE = 'e0000000-0000-4000-8000-000000000000';
const ADMIN = 'a0000000-0000-4000-8000-000000000000';
const MUTED = 'b0000000-0000-4000-8000-000000000000';
const STAFF = 'c0000000-0000-4000-8000-000000000000';
const OWNER = '10000000-0000-4000-8000-000000000000';
const ME = '20000000-0000-4000-8000-000000000000';

const roles: RoleInput[] = [
  { id: EVERYONE, permissions: DEFAULT_EVERYONE_PERMISSIONS, position: 0 },
  { id: MUTED, permissions: 0, position: 1 },
  { id: STAFF, permissions: PERM.KICK_MEMBERS, position: 2 },
  { id: ADMIN, permissions: PERM.ADMINISTRATOR, position: 3 },
];

function bits(
  memberRoleIds: string[],
  overwrites: OverwriteInput[] = [],
  opts: { viewerId?: string; voice?: boolean; timedOut?: boolean } = {},
) {
  return memberChannelPermissions(
    {
      ownerId: OWNER,
      viewerId: opts.viewerId ?? ME,
      everyoneRoleId: EVERYONE,
      roles,
      memberRoleIds,
    },
    { channelType: opts.voice ? 'space_voice' : 'space_text', overwrites, timedOut: opts.timedOut },
  );
}

describe('permissions', () => {
  it('flags use bits 0..30 only; reserved ones are not assignable', () => {
    for (const v of Object.values(PERM)) expect(v > 0 && v <= 1 << 30).toBe(true);
    expect(ALL_PERMISSIONS).toBe(0x7fffffff);
    expect(ASSIGNABLE_PERMISSIONS & RESERVED_PERMISSIONS).toBe(0);
  });

  it('(1) a plain member with no overwrites can send but not pin', () => {
    const b = bits([]);
    expect(hasPerm(b, PERM.SEND_MESSAGES)).toBe(true);
    expect(hasPerm(b, PERM.MANAGE_MESSAGES)).toBe(false);
    // Voice bits are dropped in a text channel, text-only bits in a voice channel.
    expect(hasPerm(b, PERM.CONNECT)).toBe(false);
    const v = bits([], [], { voice: true });
    expect([hasPerm(v, PERM.CONNECT), hasPerm(v, PERM.SEND_MESSAGES)]).toEqual([true, false]);
  });

  it('(2) an announcements channel: @everyone cannot send, administrators can', () => {
    const ow: OverwriteInput[] = [
      { targetType: 'role', targetId: EVERYONE, allow: 0, deny: PERM.SEND_MESSAGES },
    ];
    expect(hasPerm(bits([], ow), PERM.SEND_MESSAGES)).toBe(false);
    expect(hasPerm(bits([], ow), PERM.VIEW_CHANNEL)).toBe(true);
    expect(hasPerm(bits([ADMIN], ow), PERM.SEND_MESSAGES)).toBe(true);
  });

  it('(3) a member overwrite wins over a role deny', () => {
    const ow: OverwriteInput[] = [
      { targetType: 'role', targetId: MUTED, allow: 0, deny: PERM.SEND_MESSAGES },
      { targetType: 'member', targetId: ME, allow: PERM.SEND_MESSAGES, deny: 0 },
    ];
    expect(hasPerm(bits([MUTED], ow), PERM.SEND_MESSAGES)).toBe(true);
    expect(hasPerm(bits([MUTED], ow, { viewerId: 'someone-else' }), PERM.SEND_MESSAGES)).toBe(
      false,
    );
  });

  it('(4) a staff-only channel: without VIEW_CHANNEL everything is 0', () => {
    const ow: OverwriteInput[] = [
      { targetType: 'role', targetId: EVERYONE, allow: 0, deny: PERM.VIEW_CHANNEL },
      { targetType: 'role', targetId: STAFF, allow: PERM.VIEW_CHANNEL, deny: 0 },
    ];
    expect(bits([], ow)).toBe(0);
    expect(hasPerm(bits([STAFF], ow), PERM.SEND_MESSAGES)).toBe(true);
  });

  it('role allows and denies combine as OR(deny) then OR(allow): an allow on any role wins', () => {
    const ow: OverwriteInput[] = [
      { targetType: 'role', targetId: MUTED, allow: 0, deny: PERM.ADD_REACTIONS },
      { targetType: 'role', targetId: STAFF, allow: PERM.ADD_REACTIONS, deny: 0 },
    ];
    expect(hasPerm(bits([MUTED, STAFF], ow), PERM.ADD_REACTIONS)).toBe(true);
    expect(hasPerm(bits([MUTED], ow), PERM.ADD_REACTIONS)).toBe(false);
  });

  it('(5) a timed-out member keeps only view/read; owners and administrators are immune', () => {
    const b = bits([STAFF], [], { timedOut: true });
    expect(hasPerm(b, PERM.VIEW_CHANNEL)).toBe(true);
    expect(hasPerm(b, PERM.SEND_MESSAGES)).toBe(false);
    expect(hasPerm(b, PERM.ADD_REACTIONS)).toBe(false);
    expect(hasPerm(bits([ADMIN], [], { timedOut: true }), PERM.SEND_MESSAGES)).toBe(true);
    expect(hasPerm(bits([], [], { viewerId: OWNER, timedOut: true }), PERM.SEND_MESSAGES)).toBe(
      true,
    );
  });

  it('the owner and ADMINISTRATOR bypass overwrites', () => {
    const ow: OverwriteInput[] = [
      { targetType: 'role', targetId: EVERYONE, allow: 0, deny: PERM.VIEW_CHANNEL },
    ];
    expect(hasPerm(bits([], ow, { viewerId: OWNER }), PERM.VIEW_CHANNEL)).toBe(true);
    expect(hasPerm(bits([ADMIN], ow), PERM.MANAGE_MESSAGES)).toBe(true);
    expect(
      computeBasePermissions({
        ownerId: OWNER,
        viewerId: ME,
        everyoneRoleId: EVERYONE,
        roles,
        memberRoleIds: [ADMIN],
      }),
    ).toBe(ALL_PERMISSIONS);
  });

  it('channel overwrites never grant Space-wide bits', () => {
    const ow: OverwriteInput[] = [
      {
        targetType: 'member',
        targetId: ME,
        allow: PERM.KICK_MEMBERS | PERM.ADMINISTRATOR,
        deny: 0,
      },
    ];
    const b = computeChannelPermissions(DEFAULT_EVERYONE_PERMISSIONS, {
      channelType: 'space_text',
      overwrites: ow,
      everyoneRoleId: EVERYONE,
      memberRoleIds: [],
      viewerId: ME,
    });
    expect(hasPerm(b, PERM.KICK_MEMBERS)).toBe(false);
    expect(hasPerm(b, PERM.ADMINISTRATOR)).toBe(false);
  });

  it('custom emoji bits are assignable; USE_EXTERNAL_EMOJI is implicit unless a channel denies it', () => {
    expect(ASSIGNABLE_PERMISSIONS & PERM.MANAGE_EMOJI).toBe(PERM.MANAGE_EMOJI);
    expect(ASSIGNABLE_PERMISSIONS & PERM.USE_EXTERNAL_EMOJI).toBe(PERM.USE_EXTERNAL_EMOJI);
    expect(hasPerm(DEFAULT_EVERYONE_PERMISSIONS, PERM.USE_EXTERNAL_EMOJI)).toBe(true);
    // A Space from before the bit existed: @everyone never got it, and it still holds.
    const legacy: RoleInput[] = [{ id: EVERYONE, permissions: PERM.VIEW_CHANNEL | PERM.SEND_MESSAGES, position: 0 }];
    const base = computeBasePermissions({ ownerId: OWNER, viewerId: ME, everyoneRoleId: EVERYONE, roles: legacy, memberRoleIds: [] });
    expect(hasPerm(base, PERM.USE_EXTERNAL_EMOJI)).toBe(true);
    expect(hasPerm(base, PERM.MANAGE_EMOJI)).toBe(false);
    const channel = (overwrites: OverwriteInput[], memberRoleIds: string[] = []) =>
      computeChannelPermissions(base, { channelType: 'space_text', overwrites, everyoneRoleId: EVERYONE, memberRoleIds, viewerId: ME });
    expect(hasPerm(channel([]), PERM.USE_EXTERNAL_EMOJI)).toBe(true);
    const deny: OverwriteInput = { targetType: 'role', targetId: EVERYONE, allow: 0, deny: PERM.USE_EXTERNAL_EMOJI };
    expect(hasPerm(channel([deny]), PERM.USE_EXTERNAL_EMOJI)).toBe(false);
    const staffAllow: OverwriteInput = { targetType: 'role', targetId: STAFF, allow: PERM.USE_EXTERNAL_EMOJI, deny: 0 };
    expect(hasPerm(channel([deny, staffAllow], [STAFF]), PERM.USE_EXTERNAL_EMOJI)).toBe(true);
    // Voice channels drop it with the other text bits.
    expect(hasPerm(bits([], [], { voice: true }), PERM.USE_EXTERNAL_EMOJI)).toBe(false);
  });

  it('hierarchy: act only from strictly above; the owner is above everyone and untouchable', () => {
    const admin = highestRolePosition(roles, [ADMIN]);
    const staff = highestRolePosition(roles, [STAFF, MUTED]);
    const owner = highestRolePosition(roles, [], true);
    expect([admin, staff, owner]).toEqual([3, 2, Number.POSITIVE_INFINITY]);
    expect(canActOn(admin, staff, false)).toBe(true);
    expect(canActOn(staff, staff, false)).toBe(false);
    expect(canActOn(owner, admin, false)).toBe(true);
    expect(canActOn(owner, owner, true)).toBe(false);
    expect([canManageRole(admin, 2), canManageRole(admin, 3), canManageRole(owner, 3)]).toEqual([
      true,
      false,
      true,
    ]);
    expect(grantableBits(PERM.SEND_MESSAGES | PERM.KICK_MEMBERS)).toBe(
      PERM.SEND_MESSAGES | PERM.KICK_MEMBERS,
    );
    expect(grantableBits(PERM.ADMINISTRATOR)).toBe(ASSIGNABLE_PERMISSIONS);
  });
});
