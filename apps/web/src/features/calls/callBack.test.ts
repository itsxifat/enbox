import { describe, expect, it } from 'vitest';
import { computeChatPermissions } from '@enbox/shared';
import { makeChat, makeUser } from '@/test/factories';
import { canCallBack } from './callBack';

const withPerms = (p: Parameters<typeof makeChat>[0]) => {
  const c = makeChat(p);
  return { ...c, permissions: computeChatPermissions(c, 'me') };
};

describe('canCallBack', () => {
  it('allows active chats that permit calls', () => {
    expect(canCallBack(withPerms({ type: 'direct', peer: makeUser() }))).toBe(true);
    expect(canCallBack(withPerms({ type: 'group' }))).toBe(true);
  });

  it('hides call back for deleted or blocked peers, left groups and unknown chats', () => {
    expect(canCallBack(withPerms({ type: 'direct', peer: makeUser({ isDeleted: true }) }))).toBe(
      false,
    );
    expect(canCallBack(withPerms({ type: 'direct', peer: makeUser({ isBlocked: true }) }))).toBe(
      false,
    );
    expect(canCallBack(withPerms({ type: 'group', membership: 'left' }))).toBe(false);
    expect(canCallBack(undefined)).toBe(false);
  });
});
