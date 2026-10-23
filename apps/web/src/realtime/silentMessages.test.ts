/**
 * @silent messages (MESSAGE_FLAGS.SILENT) arrive like any other — unread and mention counts
 * move — but play no sound and show no desktop notification.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGE_FLAGS } from '@enbox/shared';
import type * as NotifyModule from '@/lib/notify';
import { isAppFocused, playSound, showNotification } from '@/lib/notify';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useUi } from '@/stores/ui';
import { useUsers } from '@/stores/users';
import { makeChat, makeMe, makeMessage, makeUser } from '@/test/factories';
import { handleNewMessage } from './messages';

vi.mock('@/lib/notify', async (importOriginal) => {
  const actual = await importOriginal<typeof NotifyModule>();
  return {
    ...actual,
    isAppFocused: vi.fn(() => false),
    playSound: vi.fn(),
    showNotification: vi.fn(async () => true),
  };
});

const ALICE = '00000000-0000-4000-8000-0000000000a1';

describe('@silent messages', () => {
  beforeEach(() => {
    useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
    useUi.getState().setPref('desktopNotifications', true);
    useUi.getState().setPref('sounds', true);
    useUsers.setState({ byId: { [ALICE]: makeUser({ id: ALICE, displayName: 'Alice' }) } });
    vi.mocked(showNotification).mockClear();
    vi.mocked(playSound).mockClear();
  });

  afterEach(() => {
    useChats.setState({ byId: {}, openChatId: null });
    useUsers.setState({ byId: {} });
  });

  it('no notification and no sound, but the unread and mention counts move', async () => {
    useChats.getState().upsertChat(makeChat({ id: 'g1', type: 'group', name: 'Club' }));
    handleNewMessage(
      makeMessage({
        id: 'm1',
        chatId: 'g1',
        seq: 1,
        senderId: ALICE,
        text: 'quiet',
        mentions: ['me'],
        flags: MESSAGE_FLAGS.SILENT,
      }),
    );
    await Promise.resolve();
    expect(showNotification).not.toHaveBeenCalled();
    expect(playSound).not.toHaveBeenCalled();
    expect(useChats.getState().byId.g1).toMatchObject({ unreadCount: 1, unreadMentionCount: 1 });
    // While I'm looking at Enbox: not even the sound.
    vi.mocked(isAppFocused).mockReturnValue(true);
    handleNewMessage(
      makeMessage({ id: 'm2', chatId: 'g1', seq: 2, senderId: ALICE, flags: MESSAGE_FLAGS.SILENT }),
    );
    expect(playSound).not.toHaveBeenCalled();
    vi.mocked(isAppFocused).mockReturnValue(false);
  });

  it('a normal message still notifies', async () => {
    useChats.getState().upsertChat(makeChat({ id: 'g2', type: 'group', name: 'Club' }));
    handleNewMessage(makeMessage({ id: 'm3', chatId: 'g2', seq: 1, senderId: ALICE, text: 'hi' }));
    await vi.waitFor(() => expect(showNotification).toHaveBeenCalled());
  });
});
