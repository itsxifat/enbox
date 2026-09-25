import { describe, expect, it } from 'vitest';
import type { MemberRole } from '@enbox/shared';
import { makeUser } from '@/test/factories';
import { roleLabel, sortMembers } from './members';
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
  it('maps choices to ISO times', () => {
    const now = Date.parse('2025-03-01T10:00:00.000Z');
    expect(muteUntil('8h', now)).toBe('2025-03-01T18:00:00.000Z');
    expect(muteUntil('1w', now)).toBe('2025-03-08T10:00:00.000Z');
    expect(muteUntil('always', now)).toMatch(/^9999-/);
    expect(MUTE_OPTIONS.map((o) => o.value)).toEqual(['8h', '1w', 'always']);
  });
});
