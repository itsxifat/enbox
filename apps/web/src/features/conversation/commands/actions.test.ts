/**
 * The commands that send no message: /nick sets my Space nickname (updateMyMember), /thread
 * creates a thread of the channel and opens it beside it; failures and over-long names are
 * toasts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '@/lib/api';
import { resetSessionState } from '@/lib/session';
import { useSidePanel } from '@/stores/sidePanel';
import { useUi } from '@/stores/ui';
import { makeChat } from '@/test/factories';
import { setNickname, startThread } from './actions';

const updateMyMember = vi.hoisted(() => vi.fn());
vi.mock('@/features/spaces/actions', () => ({ updateMyMember }));

const space = { spaceId: 's1', categoryId: null, position: 0, overwrites: [] } as never;
const channel = makeChat({ id: 'c1', type: 'space_text', name: 'general', space });
const lastToast = () => useUi.getState().toasts.at(-1)?.message;

beforeEach(() => {
  updateMyMember.mockReset().mockResolvedValue(undefined);
  useUi.setState({ toasts: [] });
});

afterEach(() => {
  resetSessionState();
  useSidePanel.setState({ panel: null });
});

describe('/nick', () => {
  it('sets my nickname in the Space, or resets it', async () => {
    await setNickname(channel, 'Captain');
    expect(updateMyMember).toHaveBeenCalledWith('s1', { nickname: 'Captain' });
    expect(lastToast()).toBe('Your nickname is now “Captain”');
    await setNickname(channel, '');
    expect(updateMyMember).toHaveBeenLastCalledWith('s1', { nickname: null });
    expect(lastToast()).toBe('Your nickname was reset');
  });

  it('says why it failed; too long never asks', async () => {
    updateMyMember.mockRejectedValue(
      new ApiError('forbidden', 'You cannot change your nickname', 403),
    );
    await setNickname(channel, 'Captain');
    expect(lastToast()).toBe('You cannot change your nickname');
    updateMyMember.mockClear();
    await setNickname(channel, 'x'.repeat(33));
    expect(updateMyMember).not.toHaveBeenCalled();
    expect(lastToast()).toBe('Nicknames can be up to 32 characters');
  });
});

describe('/thread', () => {
  it('creates the thread and opens it beside the channel', async () => {
    const thread = makeChat({ id: 't1', type: 'space_thread', name: 'Plans', space });
    const post = vi.spyOn(api, 'post').mockResolvedValue(thread as never);
    await startThread(channel, 'Plans');
    expect(post).toHaveBeenCalledWith('/api/chats/c1/threads', { name: 'Plans' });
    expect(useSidePanel.getState().panel).toEqual({
      kind: 'thread',
      threadId: 't1',
      parentId: 'c1',
    });
  });

  it('a refusal is a toast', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(
      new ApiError('forbidden', 'You cannot start threads in this channel', 403),
    );
    await startThread(channel, 'Plans');
    expect(lastToast()).toBe('You cannot start threads in this channel');
    expect(useSidePanel.getState().panel).toBeNull();
  });
});
