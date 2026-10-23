import { describe, expect, it } from 'vitest';
import type { MemberRole } from '@enbox/shared';
import { makeChat, makeUser } from '@/test/factories';
import { canTransferGroupOwnership, roleLabel, sortMembers } from './members';
import { MUTE_OPTIONS, muteUntil } from './shared/chatActions';

const m = (name: string, role: MemberRole, id?: string) => ({
  user: makeUser({ displayName: name, ...(id ? { id } : {}) }),
  role,
  joinedAt: '2025-01-01T00:00:00.000Z',
});

describe('member lists', () => {
  it('sorts me first, then owner, admins and members alphabetically', () => {
    const list = [
      m('zoe', 'member'),
      m('Bob', 'admin'),
      m('amy', 'member'),
      m('Owner Olga', 'owner'),
      m('Me', 'member', 'me-id'),
      m('Al', 'admin'),
    ];
    expect(sortMembers(list, 'me-id').map((x) => x.user.displayName)).toEqual([
      'Me',
      'Owner Olga',
      'Al',
      'Bob',
      'amy',
      'zoe',
    ]);
    // Pure: input untouched.
    expect(list[0]!.user.displayName).toBe('zoe');
  });

  it('labels roles per context', () => {
    expect(roleLabel('owner', 'group')).toBe('Owner');
    expect(roleLabel('admin', 'group')).toBe('Group admin');
    expect(roleLabel('admin', 'channel')).toBe('Admin');
    expect(roleLabel('member', 'community')).toBeNull();
  });
});

describe('mute durations', () => {
  it('offers Discord’s durations and maps them to ISO times', () => {
    const now = Date.parse('2025-03-01T10:00:00.000Z');
    expect(MUTE_OPTIONS.map((o) => [o.value, o.label])).toEqual([
      ['15m', 'For 15 minutes'],
      ['60m', 'For 1 hour'],
      ['180m', 'For 3 hours'],
      ['480m', 'For 8 hours'],
      ['1440m', 'For 24 hours'],
      ['always', 'Until I turn it back on'],
    ]);
    expect(muteUntil('15m', now)).toBe('2025-03-01T10:15:00.000Z');
    expect(muteUntil('480m', now)).toBe('2025-03-01T18:00:00.000Z');
    expect(muteUntil('1440m', now)).toBe('2025-03-02T10:00:00.000Z');
    expect(muteUntil('always', now)).toMatch(/^9999-/);
  });
});

describe('canTransferGroupOwnership', () => {
  const owner = makeChat({ myRole: 'owner', membership: 'active', isAnnouncement: false });
  it('lets the owner hand over a regular group to a live account', () => {
    expect(canTransferGroupOwnership(owner, makeUser())).toBe(true);
    expect(canTransferGroupOwnership(owner, makeUser({ isDeleted: true }))).toBe(false);
    expect(canTransferGroupOwnership({ ...owner, myRole: 'admin' }, makeUser())).toBe(false);
  });
  it('is never offered in announcement groups (managed from the community)', () => {
    expect(canTransferGroupOwnership({ ...owner, isAnnouncement: true }, makeUser())).toBe(false);
  });
});
