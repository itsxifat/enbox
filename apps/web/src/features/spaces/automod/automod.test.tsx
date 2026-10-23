/** AutoMod in conversations: a blocked send becomes the composer's notice; alerts render as a card with "Timeout member". */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AUTOMOD_BLOCKED_CODE, type ApiErrorCode, type ChatSummary, type SpaceMember } from '@enbox/shared';
import { ApiError, api } from '@/lib/api';
import { sendQueued } from '@/features/conversation/lib/outbox';
import { SystemPill } from '@/features/conversation/bubbles/SystemPill';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useMessages } from '@/stores/messages';
import { useSpaces } from '@/stores/spaces';
import { useUi } from '@/stores/ui';
import { useUsers } from '@/stores/users';
import { makeChat, makeMe, makeMessage, makeUser } from '@/test/factories';
import { makeSpace } from '../testUtils';
import { AutoModBlockedNotice } from './AutoModBlockedNotice';
import { useAutoModNotices } from './blocked';

function channel(id: string, name: string): ChatSummary {
  return {
    ...makeChat({ id, name, type: 'space_text' }),
    space: {
      spaceId: 's1',
      categoryId: null,
      position: 0,
      topic: null,
      slowmodeSeconds: 0,
      nsfw: false,
      userLimit: null,
      bitrate: null,
      permissionsSynced: true,
      overwrites: [],
    },
  };
}

beforeEach(() => {
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
  useUi.setState({ toasts: [], dialogs: [] });
  useAutoModNotices.setState({ byChat: {} });
  useMessages.setState({ byChat: {} });
  useChats.setState({ byId: { general: channel('general', 'general'), modlog: channel('modlog', 'mod-log') } });
  useUsers.setState({ byId: { bob: makeUser({ id: 'bob', displayName: 'Bob' }) } });
});

describe('a send AutoMod blocked', () => {
  it('drops the optimistic message and shows "Only you can see this" instead of a toast', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(
      new ApiError(AUTOMOD_BLOCKED_CODE as ApiErrorCode, 'Keep it friendly here', 403),
    );
    // The chat-list preview falls back by refetching the chat.
    vi.spyOn(api, 'get').mockRejectedValue(new ApiError('network_error', 'offline'));
    render(<AutoModBlockedNotice chatId="general" />);
    expect(screen.queryByTestId('automod-blocked-notice')).toBeNull();
    await act(async () => {
      expect(await sendQueued('general', { type: 'text', text: 'a rude word' })).toBeNull();
    });
    expect(useMessages.getState().byChat.general?.items ?? []).toHaveLength(0);
    expect(useUi.getState().toasts).toHaveLength(0);
    const notice = screen.getByTestId('automod-blocked-notice');
    expect(notice).toHaveTextContent('Your message was blocked');
    expect(notice).toHaveTextContent('Keep it friendly here');
    expect(notice).toHaveTextContent('a rude word');
    expect(notice).toHaveTextContent('Only you can see this');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss message' }));
    expect(screen.queryByTestId('automod-blocked-notice')).toBeNull();
  });

  it('other failures keep the failed bubble and the toast', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError('forbidden', 'Nope', 403));
    await sendQueued('general', { type: 'text', text: 'hello' });
    expect(useMessages.getState().byChat.general?.items[0]).toMatchObject({ text: 'hello', failed: true });
    expect(useUi.getState().toasts).toHaveLength(1);
    expect(useAutoModNotices.getState().byChat.general).toBeUndefined();
  });
});

describe('the alert card', () => {
  const alert = makeMessage({
    id: 'a1',
    chatId: 'modlog',
    type: 'system',
    senderId: null,
    text: null,
    system: {
      kind: 'automod_alert',
      ruleName: 'No scams',
      userId: 'bob',
      channelId: 'general',
      content: 'buy my scam now',
      action: 'blocked',
    },
  });
  const bob = { userId: 'bob', roleIds: [], nickname: null, timedOutUntil: null } as unknown as SpaceMember;

  function seed(owner: boolean) {
    useSpaces.setState({ byId: { s1: makeSpace({ owner }) }, order: ['s1'], members: { s1: { bob } } });
    render(<SystemPill m={alert} chat={{ type: 'space_text', isAnnouncement: false }} />);
  }

  it('shows the rule, the author and the message as sent', () => {
    seed(true);
    const card = screen.getByTestId('automod-alert');
    expect(card).toHaveAttribute('data-action', 'blocked');
    expect(card).toHaveTextContent('AutoMod');
    expect(card).toHaveTextContent('Blocked a message in #general');
    expect(card).toHaveTextContent('Bob');
    expect(screen.getByText('buy my scam now').tagName).toBe('BLOCKQUOTE');
    expect(card).toHaveTextContent('Rule: No scams');
  });

  it('"Timeout member" times the author out for the chosen length', async () => {
    seed(true);
    const patch = vi.spyOn(api, 'patch').mockResolvedValue({ ...bob, timedOutUntil: 'x' } as never);
    fireEvent.click(screen.getByRole('button', { name: 'Timeout member' }));
    await waitFor(() => expect(useUi.getState().dialogs).toHaveLength(1));
    const dialog = useUi.getState().dialogs[0]!;
    expect(dialog.title).toBe('Time out Bob');
    const t0 = Date.now();
    act(() => useUi.getState().closeDialog(dialog.id, '600'));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    const [path, body] = patch.mock.calls[0]!;
    expect(path).toBe('/api/spaces/s1/members/bob');
    const until = Date.parse((body as { timedOutUntil: string }).timedOutUntil);
    expect(until).toBeGreaterThanOrEqual(t0 + 600_000);
    expect(until).toBeLessThan(t0 + 610_000);
  });

  it('members who cannot moderate see no actions', () => {
    seed(false);
    expect(screen.getByTestId('automod-alert')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Timeout member' })).toBeNull();
  });
});
