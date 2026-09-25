import { afterEach, describe, expect, it } from 'vitest';
import { computeChatPermissions } from '@enbox/shared';
import { resetSessionState } from '@/lib/session';
import { makeChat, makeMe, makeUser } from '@/test/factories';
import { useAuth } from './auth';
import { useChats } from './chats';
import { patchUserEverywhere } from './contacts';

function seedDirect() {
  const me = makeMe();
  useAuth.setState({ user: me });
  const bob = makeUser({ displayName: 'Bob' });
  const base = makeChat({
    id: 'direct-1',
    type: 'direct',
    name: null,
    peer: bob,
    myRole: 'member',
  });
  const chat = { ...base, permissions: computeChatPermissions(base, me.id) };
  useChats.setState({ byId: { [chat.id]: chat }, loaded: true });
  return { me, bob, chat };
}

describe('direct chat permissions follow the peer', () => {
  afterEach(() => resetSessionState());

  it('patching the peer as deleted (user:changed) drops send and call permissions', () => {
    const { bob, chat } = seedDirect();
    expect(useChats.getState().byId[chat.id]!.permissions.canSend).toBe(true);
    useChats.getState().patchChat(chat.id, { peer: { ...bob, isDeleted: true } });
    const after = useChats.getState().byId[chat.id]!;
    expect(after.peer?.isDeleted).toBe(true);
    expect(after.permissions.canSend).toBe(false);
    expect(after.permissions.canCall).toBe(false);
  });

  it('patchUserEverywhere recomputes them too (block / unblock)', () => {
    const { bob, chat } = seedDirect();
    patchUserEverywhere(bob.id, { isBlocked: true });
    expect(useChats.getState().byId[chat.id]!.permissions.canSend).toBe(false);
    patchUserEverywhere(bob.id, { isBlocked: false });
    expect(useChats.getState().byId[chat.id]!.permissions.canCall).toBe(true);
  });

  it('keeps explicit permissions and leaves unrelated patches alone', () => {
    const { chat } = seedDirect();
    const custom = { ...chat.permissions, canPin: false };
    useChats.getState().patchChat(chat.id, { peer: chat.peer, permissions: custom });
    expect(useChats.getState().byId[chat.id]!.permissions.canPin).toBe(false);
    useChats.getState().patchChat(chat.id, { unreadCount: 3 });
    expect(useChats.getState().byId[chat.id]!.permissions).toBe(custom);
  });
});
