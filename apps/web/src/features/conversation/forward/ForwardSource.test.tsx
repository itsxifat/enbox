/**
 * Where a forwarded copy came from: the original's time, plus its chat when I know it — a
 * button that jumps to the original (looked up when it isn't loaded).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ForwardSource as Source, Space, SpaceChannelInfo } from '@enbox/shared';
import { ApiError } from '@/lib/api';
import { bus } from '@/lib/bus';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useMessages } from '@/stores/messages';
import { useSpaces } from '@/stores/spaces';
import { toast } from '@/stores/ui';
import { makeChat, makeMe, makeMessage, makeUser } from '@/test/factories';
import { useConversationUi } from '../state';

const get = vi.fn();
vi.mock('@/lib/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  api: { get: (...a: unknown[]) => get(...a), post: async () => [] },
}));

const { ForwardSource, forwardTime } = await import('./ForwardSource');

const SPACE_ID = '0b9c6f1e-2a4b-4c6d-8e9f-0123456789ab';
const CHANNEL_ID = '1c2d3e4f-5a6b-4c7d-8e9f-0123456789ab';
const ORIGINAL_ID = '2d3e4f5a-6b7c-4d8e-9f0a-0123456789ab';
const at = new Date(2026, 9, 22, 15, 14).toISOString();

const channelInfo: SpaceChannelInfo = {
  spaceId: SPACE_ID,
  categoryId: null,
  position: 0,
  topic: null,
  slowmodeSeconds: 0,
  nsfw: false,
  userLimit: null,
  bitrate: null,
  permissionsSynced: true,
  overwrites: [],
};
const general = makeChat({
  id: CHANNEL_ID,
  type: 'space_text',
  name: 'general',
  space: channelInfo,
});

const copyOf = (src: Partial<Source> = {}) =>
  makeMessage({
    id: 'copy',
    chatId: 'elsewhere',
    forwardCount: 1,
    forwardedFrom: {
      chatId: CHANNEL_ID,
      messageId: ORIGINAL_ID,
      spaceId: SPACE_ID,
      createdAt: at,
      ...src,
    },
  });

let navigations: string[] = [];
let off: () => void = () => undefined;

beforeEach(() => {
  useAuth.setState({ user: makeMe(), token: 't', status: 'authenticated' });
  useChats.setState({ byId: {}, openChatId: null });
  useSpaces.setState({ byId: {} });
  useMessages.setState({ byChat: {} });
  navigations = [];
  off = bus.on('navigate', ({ to }) => void navigations.push(to));
});

afterEach(() => {
  cleanup();
  off();
  get.mockReset();
});

describe('ForwardSource', () => {
  it('shows only the time when I don’t know the chat', () => {
    render(<ForwardSource m={copyOf()} />);
    const line = screen.getByTestId('forward-source');
    expect(within(line).queryByRole('button')).toBeNull();
    expect(line).toHaveTextContent(forwardTime(at));
    expect(line.querySelector('time')).toHaveAttribute('dateTime', at);
  });

  it('shows nothing for a copy without a source', () => {
    render(<ForwardSource m={makeMessage({ forwardCount: 1 })} />);
    expect(screen.queryByTestId('forward-source')).toBeNull();
  });

  it('names the channel and its Space, and jumps there (the original looked up)', async () => {
    useChats.setState({ byId: { [CHANNEL_ID]: general } });
    useSpaces.setState({ byId: { [SPACE_ID]: { id: SPACE_ID, name: 'Rockets' } as Space } });
    get.mockResolvedValue(makeMessage({ id: ORIGINAL_ID, chatId: CHANNEL_ID, seq: 42 }));
    render(<ForwardSource m={copyOf()} />);
    fireEvent.click(screen.getByRole('button', { name: '#general · Rockets' }));
    await waitFor(() =>
      expect(navigations).toEqual([`/spaces/${SPACE_ID}/${CHANNEL_ID}?m=42&mid=${ORIGINAL_ID}`]),
    );
    expect(get).toHaveBeenCalledWith(`/api/messages/${ORIGINAL_ID}`);
  });

  it('a DM shows its name; a loaded original in the open chat scrolls there', () => {
    const dm = makeChat({ id: 'dm', type: 'direct', peer: makeUser({ displayName: 'Maya' }) });
    useChats.setState({ byId: { dm }, openChatId: 'dm' });
    useMessages.setState({
      byChat: {
        dm: {
          items: [makeMessage({ id: 'orig', chatId: 'dm', seq: 7 })],
          hasMoreBefore: false,
          hasMoreAfter: false,
          loaded: true,
        } as never,
      },
    });
    render(<ForwardSource m={copyOf({ chatId: 'dm', messageId: 'orig', spaceId: null })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Maya' }));
    expect(useConversationUi.getState().jump).toMatchObject({
      chatId: 'dm',
      seq: 7,
      messageId: 'orig',
    });
    expect(get).not.toHaveBeenCalled();
    expect(navigations).toEqual([]);
  });

  it('says so when the original can’t be seen', async () => {
    const error = vi.spyOn(toast, 'error');
    useChats.setState({ byId: { [CHANNEL_ID]: general } });
    get.mockRejectedValue(new ApiError('not_found', 'Message not found', 404));
    render(<ForwardSource m={copyOf()} />);
    // The Space isn't loaded: just the channel.
    fireEvent.click(screen.getByRole('button', { name: '#general' }));
    await waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        "Message not found or you can't see it",
        expect.anything(),
      ),
    );
    expect(navigations).toEqual([]);
  });

  it('formats the time like "Oct 22, 3:14 PM", with the year when it isn’t this one', () => {
    const now = new Date(2026, 11, 1);
    // ICU puts a narrow no-break space before AM/PM (`\s` matches it).
    const fmt = (iso: string) => forwardTime(iso, now, 'en-US').replace(/\s/g, ' ');
    expect(fmt(at)).toBe('Oct 22, 3:14 PM');
    expect(fmt(new Date(2025, 0, 5, 9, 5).toISOString())).toBe('Jan 5, 2025, 9:05 AM');
  });
});
