import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { PERM, type ChatSummary, type Message } from '@enbox/shared';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { EMPTY_CHAT_MESSAGES, mergePage, useMessages } from '@/stores/messages';
import { useUsers } from '@/stores/users';
import { makeChat, makeMe, makeMessage, makeUser } from '@/test/factories';

const put = vi.fn();
const del = vi.fn();
const get = vi.fn();
vi.mock('@/lib/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  api: {
    put: (...a: unknown[]) => put(...a),
    delete: (...a: unknown[]) => del(...a),
    get: (...a: unknown[]) => get(...a),
    post: async () => undefined,
  },
}));

const { ReactionChips, ReactionsDialog } = await import('./Reactions');
const { canAddReaction } = await import('./reactions/reactionActions');
const { useEmojis } = await import('@/stores/emojis');

const BOB = makeUser({
  id: '00000000-0000-4000-8000-0000000000b0',
  displayName: 'Bob',
  username: 'bob',
});
const CAROL = makeUser({ id: '00000000-0000-4000-8000-0000000000c0', displayName: 'Carol' });
const CUSTOM_ID = '0f6c9a52-3b8e-4c1d-9e2f-7a6b5c4d3e21';
const enc = encodeURIComponent;
let me: string;

/** Renders the chips of the cached message (so store updates re-render them). */
function Chips({ chat }: { chat: ChatSummary }) {
  const m = useMessages((s) => s.byChat[chat.id]?.items[0]);
  return m ? <ReactionChips m={m} chat={chat} /> : null;
}

function setup(over: Partial<ChatSummary> = {}, message: Partial<Message> = {}) {
  const chat = makeChat({ id: 'chat-1', type: 'group', ...over });
  const m = makeMessage({
    id: 'm1',
    chatId: chat.id,
    reactions: [
      { emoji: '👍', count: 2, userIds: [me, BOB.id] },
      { emoji: '🎉', count: 1, userIds: [BOB.id] },
    ],
    myReactions: ['👍'],
    myReaction: '👍',
    ...message,
  });
  useChats.getState().upsertChat(chat);
  useMessages.setState({
    byChat: { [chat.id]: { ...EMPTY_CHAT_MESSAGES, items: mergePage([], [m]), loaded: true } },
  });
  render(<Chips chat={chat} />);
  return chat;
}

const chip = (name: RegExp) => screen.getByRole('button', { name });

describe('ReactionChips', () => {
  beforeEach(() => {
    const user = makeMe();
    me = user.id;
    useAuth.setState({ user, status: 'authenticated', token: 't' });
    useUsers.getState().upsertUsers([BOB, CAROL]);
    put.mockResolvedValue(undefined);
    del.mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    put.mockReset();
    del.mockReset();
    get.mockReset();
    resetSessionState();
  });

  it('renders a chip per emoji with its count; mine is pressed; custom emoji are images', () => {
    setup(
      {},
      {
        reactions: [
          { emoji: '👍', count: 2, userIds: [me, BOB.id] },
          { emoji: `<:party:${CUSTOM_ID}>`, emojiId: CUSTOM_ID, count: 1, userIds: [BOB.id] },
        ],
      },
    );
    expect(chip(/^👍, 2 reactions, including yours/)).toHaveAttribute('aria-pressed', 'true');
    const custom = chip(/^:party:, 1 reaction$/);
    expect(custom).toHaveAttribute('aria-pressed', 'false');
    expect(custom).toHaveTextContent('1');
    expect(within(custom).getByRole('img')).toHaveAttribute(
      'src',
      expect.stringContaining(`/api/emojis/${CUSTOM_ID}`),
    );
  });

  it('a click removes mine (DELETE …/@me) or joins (PUT …/@me), optimistically', async () => {
    setup();
    fireEvent.click(chip(/^👍/));
    expect(del).toHaveBeenCalledWith(`/api/messages/m1/reactions/${enc('👍')}/@me`);
    expect(chip(/^👍, 1 reaction$/)).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(chip(/^🎉/));
    expect(put).toHaveBeenCalledWith(`/api/messages/m1/reactions/${enc('🎉')}/@me`);
    expect(chip(/^🎉, 2 reactions, including yours/)).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() =>
      expect(useMessages.getState().byChat['chat-1']!.items[0]!.myReactions).toEqual(['🎉']),
    );
  });

  it('rolls back when the server refuses', async () => {
    put.mockRejectedValue(new Error('nope'));
    setup();
    fireEvent.click(chip(/^🎉/));
    expect(chip(/^🎉, 2 reactions/)).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(chip(/^🎉, 1 reaction$/)).toHaveAttribute('aria-pressed', 'false'));
    expect(useMessages.getState().byChat['chat-1']!.items[0]!.reactions[1]).toEqual({
      emoji: '🎉',
      count: 1,
      userIds: [BOB.id],
    });
  });

  it('hovering a chip names who reacted', () => {
    vi.useFakeTimers();
    setup(
      {},
      {
        reactions: [{ emoji: '👍', count: 5, userIds: [BOB.id, me, CAROL.id, 'x1', 'x2'] }],
      },
    );
    fireEvent.pointerEnter(chip(/^👍/), { pointerType: 'mouse' });
    act(() => vi.advanceTimersByTime(400));
    expect(screen.getByRole('tooltip')).toHaveTextContent('You, Bob and 3 others reacted with 👍');
    fireEvent.pointerLeave(chip(/^👍/), { pointerType: 'mouse' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('right-click opens Reactions on that emoji; I can remove mine, not others', () => {
    setup();
    fireEvent.contextMenu(chip(/^🎉/));
    const dialog = screen.getByRole('dialog', { name: 'Reactions' });
    expect(within(dialog).getByRole('tab', { name: '🎉 1' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(within(dialog).getByText('Bob')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('tab', { name: '👍 2' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove my reaction' }));
    expect(del).toHaveBeenCalledWith(`/api/messages/m1/reactions/${enc('👍')}/@me`);
  });

  it("moderators remove someone else's reaction", async () => {
    setup({ myRole: 'admin' });
    fireEvent.contextMenu(chip(/^🎉/));
    fireEvent.click(screen.getByRole('button', { name: 'Remove the reaction of Bob' }));
    await waitFor(() =>
      expect(del).toHaveBeenCalledWith(`/api/messages/m1/reactions/${enc('🎉')}/${BOB.id}`),
    );
  });

  it('Space channels page the reactor list from the server', async () => {
    get.mockResolvedValue([BOB, CAROL]);
    setup(
      { type: 'space_text', spacePermissions: PERM.VIEW_CHANNEL | PERM.ADD_REACTIONS },
      { reactions: [{ emoji: '👍', count: 2, userIds: [] }], myReactions: [], myReaction: null },
    );
    fireEvent.contextMenu(chip(/^👍/));
    const dialog = screen.getByRole('dialog', { name: 'Reactions' });
    expect(await within(dialog).findByText('Carol')).toBeInTheDocument();
    expect(within(dialog).getByText('Bob')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith(`/api/messages/m1/reactions/${enc('👍')}`, {
      query: { after: undefined, limit: 100 },
    });
  });

  it('without ADD_REACTIONS there is no "+" chip, but joining an emoji still works', () => {
    setup(
      { type: 'space_text', spacePermissions: PERM.VIEW_CHANNEL },
      { reactions: [{ emoji: '👍', count: 1, userIds: [] }], myReactions: [], myReaction: null },
    );
    expect(screen.queryByRole('button', { name: 'Add reaction' })).not.toBeInTheDocument();
    fireEvent.click(chip(/^👍/));
    expect(put).toHaveBeenCalledWith(`/api/messages/m1/reactions/${enc('👍')}/@me`);
  });

  it("another Space's custom emoji needs USE_EXTERNAL_EMOJI to be added, not to be joined", () => {
    const space = {
      spaceId: 'space-1',
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
    const own = {
      id: CUSTOM_ID,
      spaceId: 'space-1',
      name: 'home',
      url: '/x.png',
      animated: false,
      createdBy: null,
    };
    useEmojis.setState({ byId: { [CUSTOM_ID]: own } });
    const other = '<:away:5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d>';
    const bits = PERM.VIEW_CHANNEL | PERM.ADD_REACTIONS;
    const denied = makeChat({ type: 'space_text', space, spacePermissions: bits });
    const allowed = makeChat({
      type: 'space_text',
      space,
      spacePermissions: bits | PERM.USE_EXTERNAL_EMOJI,
    });
    const m = makeMessage({ id: 'm1', reactions: [], myReactions: [] });
    expect(canAddReaction(denied, m, `<:home:${CUSTOM_ID}>`)).toBe(true);
    expect(canAddReaction(denied, m, other)).toBe(false);
    expect(canAddReaction(allowed, m, other)).toBe(true);
    const joined = { ...m, reactions: [{ emoji: other, count: 1, userIds: [] }] };
    expect(canAddReaction(denied, joined, other)).toBe(true);
  });
});

describe('ReactionsDialog', () => {
  beforeEach(() => {
    const user = makeMe();
    me = user.id;
    useAuth.setState({ user, status: 'authenticated', token: 't' });
  });
  afterEach(() => resetSessionState());

  it('former members cannot remove their reaction', () => {
    const chat = makeChat({ type: 'group', membership: 'left' });
    const m = makeMessage({
      id: 'm1',
      chatId: chat.id,
      reactions: [{ emoji: '👍', count: 1, userIds: [me] }],
      myReactions: ['👍'],
    });
    render(<ReactionsDialog m={m} chat={chat} open onClose={() => undefined} />);
    expect(screen.getByRole('dialog', { name: 'Reactions' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove my reaction' })).not.toBeInTheDocument();
  });

  it('broadcast channels show counts only', () => {
    const chat = makeChat({
      type: 'channel',
      channelSettings: { isPublic: true, reactions: 'all' },
    });
    const m = makeMessage({
      id: 'm1',
      chatId: chat.id,
      reactions: [{ emoji: '🦄', count: 4, userIds: [] }],
    });
    render(<ReactionsDialog m={m} chat={chat} open onClose={() => undefined} />);
    expect(screen.getByText(/4 people reacted with 🦄/)).toBeInTheDocument();
  });
});
