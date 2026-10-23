/**
 * The Pinned Messages popout: pins from the API newest first, Jump, Unpin for members who may
 * pin, the empty state per chat type, reloads for pins it hasn't loaded, and the header
 * button (which seeds the cached pin ids in Space channels).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { PERM, type ChatSummary, type Message } from '@enbox/shared';
import { api } from '@/lib/api';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useUsers } from '@/stores/users';
import { makeChat, makeMe, makeMessage, makeUser } from '@/test/factories';
import { useConversationUi } from '../state';
import { PinsButton, PinsPopout } from './PinsPopout';

const MEMBER = PERM.VIEW_CHANNEL | PERM.SEND_MESSAGES;
const MOD = MEMBER | PERM.MANAGE_MESSAGES;

const space: NonNullable<ChatSummary['space']> = {
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
};
const channel = (bits = MOD) =>
  makeChat({ id: 'general', type: 'space_text', name: 'general', space, spacePermissions: bits });

const pin = (id: string, seq: number, text: string): Message =>
  makeMessage({ id, chatId: 'general', seq, senderId: 'olive', text });
const first = pin('p1', 2, 'first pin');
const second = pin('p2', 5, 'second pin');

const cards = () => screen.queryAllByTestId('pin-card');
const cardTexts = () =>
  cards().map((c) => (c.textContent?.includes('second') ? 'second' : 'first'));

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
  useUsers.setState({ byId: { olive: makeUser({ id: 'olive', displayName: 'Olive' }) } });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetSessionState();
  useChats.setState({ byId: {}, pins: {} });
  useConversationUi.setState({ jump: null });
});

describe('Pinned Messages popout', () => {
  it('lists the pins from the API, newest pin first, as message cards', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue([first, second] as never);
    render(<PinsPopout chat={channel()} onClose={() => undefined} />);
    expect(await screen.findAllByTestId('pin-card')).toHaveLength(2);
    expect(get).toHaveBeenCalledWith('/api/chats/general/pins');
    expect(cardTexts()).toEqual(['second', 'first']);
    expect(within(cards()[0]!).getByText('second pin')).toBeInTheDocument();
    // The author (avatar and name open the profile card).
    expect(within(cards()[0]!).getAllByRole('button', { name: 'Profile of Olive' })).toHaveLength(
      2,
    );
  });

  it('Jump scrolls the conversation to the message and closes the popout', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([first, second] as never);
    const onClose = vi.fn();
    render(<PinsPopout chat={channel()} onClose={onClose} />);
    await screen.findAllByTestId('pin-card');
    fireEvent.click(within(cards()[1]!).getByRole('button', { name: 'Jump' }));
    expect(onClose).toHaveBeenCalled();
    expect(useConversationUi.getState().jump).toMatchObject({
      chatId: 'general',
      seq: 2,
      messageId: 'p1',
    });
  });

  it('Unpin removes the pin; only members who may pin see it', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([first, second] as never);
    const del = vi.spyOn(api, 'delete').mockResolvedValue([first] as never);
    const { unmount } = render(<PinsPopout chat={channel(MOD)} onClose={() => undefined} />);
    await screen.findAllByTestId('pin-card');
    fireEvent.click(within(cards()[0]!).getByRole('button', { name: 'Unpin message' }));
    await vi.waitFor(() => expect(cards()).toHaveLength(1));
    expect(del).toHaveBeenCalledWith('/api/chats/general/pins/p2');
    expect(cardTexts()).toEqual(['first']);
    unmount();

    render(<PinsPopout chat={channel(MEMBER)} onClose={() => undefined} />);
    await screen.findAllByTestId('pin-card');
    expect(screen.queryByRole('button', { name: 'Unpin message' })).toBeNull();
  });

  it('the empty state names the kind of chat', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([] as never);
    const { unmount } = render(<PinsPopout chat={channel()} onClose={() => undefined} />);
    expect(
      await screen.findByText('This channel doesn’t have any pinned messages… yet.'),
    ).toBeInTheDocument();
    unmount();
    render(
      <PinsPopout
        chat={makeChat({ id: 'dm', type: 'direct', peer: makeUser({ id: 'olive' }) })}
        onClose={() => undefined}
      />,
    );
    expect(
      await screen.findByText('This direct message doesn’t have any pinned messages… yet.'),
    ).toBeInTheDocument();
  });

  it('loads again when a pin it has not loaded arrives (chat:pins)', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValueOnce([first] as never);
    render(<PinsPopout chat={channel()} onClose={() => undefined} />);
    expect(await screen.findAllByTestId('pin-card')).toHaveLength(1);
    get.mockResolvedValueOnce([first, second] as never);
    act(() => useChats.getState().setPins('general', ['p1', 'p2']));
    await vi.waitFor(() => expect(cards()).toHaveLength(2));
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('the header button opens it; in Space channels it seeds the cached pin ids', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([first, second] as never);
    render(<PinsButton chat={channel()} />);
    await vi.waitFor(() => expect(useChats.getState().pins.general).toEqual(['p1', 'p2']));
    fireEvent.click(screen.getByRole('button', { name: 'Pinned Messages' }));
    const popout = screen.getByRole('dialog', { name: 'Pinned Messages' });
    expect(await within(popout).findAllByTestId('pin-card')).toHaveLength(2);
  });
});
