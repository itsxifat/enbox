import { afterEach, describe, expect, it } from 'vitest';
import { MUTE_FOREVER_ISO } from '@enbox/shared';
import { makeSpace } from '@/features/spaces/testUtils';
import { makeMessage } from '@/test/factories';
import { isSpaceMuted, mentionsMe, useSpaces } from './spaces';

const chat = { space: { spaceId: 's1' } } as Parameters<typeof mentionsMe>[1];

afterEach(() => useSpaces.setState({ byId: {}, order: [] }));

describe('mentionsMe', () => {
  it('counts my roles and @everyone unless I suppress them; mentions of me always count', () => {
    const role = makeMessage({ mentions: [], mentionRoleIds: ['mods'], mentionEveryone: false });
    const everyone = makeMessage({ mentions: [], mentionRoleIds: [], mentionEveryone: true });
    const direct = makeMessage({ mentions: ['me'], mentionRoleIds: [], mentionEveryone: false });

    useSpaces.setState({ byId: { s1: makeSpace({ me: { roleIds: ['mods'] } }) } });
    expect([mentionsMe(role, chat, 'me'), mentionsMe(everyone, chat, 'me'), mentionsMe(direct, chat, 'me')]).toEqual([true, true, true]);

    useSpaces.setState({ byId: { s1: makeSpace({ me: { roleIds: ['mods'], suppressRoles: true, suppressEveryone: true } }) } });
    expect([mentionsMe(role, chat, 'me'), mentionsMe(everyone, chat, 'me'), mentionsMe(direct, chat, 'me')]).toEqual([false, false, true]);
  });
});

describe('isSpaceMuted', () => {
  it('is muted until the mute ends', () => {
    const now = Date.parse('2026-10-22T12:00:00.000Z');
    expect(isSpaceMuted(makeSpace(), now)).toBe(false);
    expect(isSpaceMuted(makeSpace({ me: { mutedUntil: MUTE_FOREVER_ISO } }), now)).toBe(true);
    expect(isSpaceMuted(makeSpace({ me: { mutedUntil: '2026-10-22T11:00:00.000Z' } }), now)).toBe(false);
  });
});
