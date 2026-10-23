/**
 * Super reactions on the web: the super chip next to the normal one, toggling it, its burst
 * (live arrivals and my own adds only, replayed on hover, never under reduced motion or with
 * the pref off), the menu item and toolbar button where reactions are allowed, the picker's
 * Super Reaction switch, and the Reactions list's super tabs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { PERM, QUICK_REACTIONS, type ChatSummary, type Message } from '@enbox/shared';
import type { MenuItem } from '@/components/ui';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { EMPTY_CHAT_MESSAGES, mergePage, useMessages } from '@/stores/messages';
import { DEFAULT_PREFS, useUi } from '@/stores/ui';
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

const { ReactionChips } = await import('./ReactionChips');
const { ReactionsModal } = await import('./ReactionsModal');
const { SuperReactToolButton, superReactionMenuItem } = await import('./superReactions');
const { handleReactionDelta } = await import('@/realtime/messages');

const BOB = makeUser({ id: '00000000-0000-4000-8000-0000000000b0', displayName: 'Bob' });
const CAROL = makeUser({ id: '00000000-0000-4000-8000-0000000000c0', displayName: 'Carol' });
const enc = encodeURIComponent;
const MEMBER = PERM.VIEW_CHANNEL | PERM.SEND_MESSAGES | PERM.ADD_REACTIONS;
let me: string;
let frames: FrameRequestCallback[] = [];

function fakeContext(): CanvasRenderingContext2D {
  const props: Record<string, unknown> = {};
  return new Proxy(props, {
    get: (target, key: string) => (key in target ? target[key] : () => undefined),
    set: (target, key: string, value) => {
      target[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

/** Run queued animation frames, 16 ms apart. */
function tick(n: number, clock = { now: 0 }) {
  for (let i = 0; i < n && frames.length; i++) {
    const cb = frames.shift()!;
    clock.now += 16;
    act(() => cb(clock.now));
  }
}

/** Renders the chips of the cached message (so store updates re-render them). */
function Chips({ chat }: { chat: ChatSummary }) {
  const m = useMessages((s) => s.byChat[chat.id]?.items[0]);
  return m ? <ReactionChips m={m} chat={chat} /> : null;
}

function seed(chat: ChatSummary, message: Partial<Message> = {}) {
  const m = makeMessage({
    id: 'm1',
    chatId: chat.id,
    reactions: [
      { emoji: '🔥', count: 3, userIds: [me, BOB.id], burstCount: 1, burstUserIds: [CAROL.id] },
    ],
    myReactions: ['🔥'],
    myReaction: '🔥',
    myBurstReactions: [],
    ...message,
  });
  useChats.getState().upsertChat(chat);
  useMessages.setState({
    byChat: { [chat.id]: { ...EMPTY_CHAT_MESSAGES, items: mergePage([], [m]), loaded: true } },
  });
  return m;
}

function setup(over: Partial<ChatSummary> = {}, message: Partial<Message> = {}) {
  const chat = makeChat({ id: 'chat-1', type: 'group', ...over });
  seed(chat, message);
  render(<Chips chat={chat} />);
  return chat;
}

const cached = () => useMessages.getState().byChat['chat-1']!.items[0]!;
const chip = (name: RegExp) => screen.getByRole('button', { name });
const burst = () => screen.queryByTestId('super-burst');

beforeEach(() => {
  const user = makeMe();
  me = user.id;
  frames = [];
  useAuth.setState({ user, status: 'authenticated', token: 't' });
  useUsers.getState().upsertUsers([BOB, CAROL]);
  useUi.setState({ prefs: { ...DEFAULT_PREFS } });
  put.mockResolvedValue(undefined);
  del.mockResolvedValue(undefined);
  get.mockResolvedValue([]);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => fakeContext() as unknown as ReturnType<HTMLCanvasElement['getContext']>,
  );
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    top: 100,
    left: 100,
    bottom: 116,
    right: 116,
    width: 16,
    height: 16,
    x: 100,
    y: 100,
    toJSON: () => ({}),
  } as DOMRect);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  put.mockReset();
  del.mockReset();
  get.mockReset();
  resetSessionState();
});

describe('super reaction chips', () => {
  it('shows the super chip before the normal one, each with its own count', () => {
    setup();
    const buttons = within(screen.getByRole('group', { name: 'Reactions' })).getAllByRole('button');
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
      '🔥, 1 Super Reaction',
      '🔥, 2 reactions, including yours',
      'Add reaction',
    ]);
    expect(buttons[0]).toHaveAttribute('aria-pressed', 'false');
    expect(buttons[0]).toHaveTextContent('1');
    expect(buttons[1]).toHaveAttribute('aria-pressed', 'true');
    // Loaded with the message: no burst.
    expect(burst()).not.toBeInTheDocument();
  });

  it('a click adds my super reaction (PUT ?burst=true) optimistically, and it bursts', async () => {
    setup();
    fireEvent.click(chip(/^🔥, 1 Super Reaction/));
    expect(put).toHaveBeenCalledWith(`/api/messages/m1/reactions/${enc('🔥')}/@me?burst=true`);
    expect(chip(/^🔥, 2 Super Reactions, including yours/)).toHaveAttribute('aria-pressed', 'true');
    expect(cached()).toMatchObject({
      reactions: [{ emoji: '🔥', count: 4, burstCount: 2, burstUserIds: [CAROL.id, me] }],
      myReactions: ['🔥'],
      myBurstReactions: ['🔥'],
    });
    expect(burst()).toBeInTheDocument();
    tick(90);
    expect(burst()).not.toBeInTheDocument();
    // And the normal chip is untouched by it.
    expect(chip(/^🔥, 2 reactions, including yours/)).toBeInTheDocument();
    // A second click takes it back (DELETE ?burst=true, after the add it queues behind).
    fireEvent.click(chip(/^🔥, 2 Super Reactions/));
    expect(cached().myBurstReactions).toEqual([]);
    await waitFor(() =>
      expect(del).toHaveBeenCalledWith(`/api/messages/m1/reactions/${enc('🔥')}/@me?burst=true`),
    );
    expect(chip(/^🔥, 1 Super Reaction$/)).toHaveAttribute('aria-pressed', 'false');
  });

  it('rolls back when the server refuses (the hourly limit)', async () => {
    put.mockRejectedValue(new Error('too many'));
    setup();
    fireEvent.click(chip(/^🔥, 1 Super Reaction/));
    await waitFor(() =>
      expect(chip(/^🔥, 1 Super Reaction$/)).toHaveAttribute('aria-pressed', 'false'),
    );
    expect(cached().reactions[0]).toEqual({
      emoji: '🔥',
      count: 3,
      userIds: [me, BOB.id],
      burstCount: 1,
      burstUserIds: [CAROL.id],
    });
  });

  it('a super reaction that comes in live bursts; hover replays it', () => {
    setup({}, { reactions: [{ emoji: '🎉', count: 1, userIds: [BOB.id] }] });
    act(() =>
      handleReactionDelta(
        {
          chatId: 'chat-1',
          messageId: 'm1',
          emoji: '🎉',
          emojiId: null,
          userId: CAROL.id,
          burst: true,
        },
        true,
      ),
    );
    expect(chip(/^🎉, 1 Super Reaction$/)).toBeInTheDocument();
    expect(burst()).toBeInTheDocument();
    tick(90);
    expect(burst()).not.toBeInTheDocument();
    fireEvent.pointerEnter(chip(/^🎉, 1 Super Reaction$/), { pointerType: 'mouse' });
    expect(burst()).toBeInTheDocument();
    // A normal reaction coming in doesn't burst anything.
    tick(90);
    act(() =>
      handleReactionDelta(
        { chatId: 'chat-1', messageId: 'm1', emoji: '🎉', emojiId: null, userId: CAROL.id },
        true,
      ),
    );
    expect(chip(/^🎉, 2 reactions$/)).toBeInTheDocument();
    expect(burst()).not.toBeInTheDocument();
  });

  it('a chip scrolled out of view skips its burst', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: -400,
      left: 100,
      bottom: -384,
      right: 116,
      width: 16,
      height: 16,
      x: 100,
      y: -400,
      toJSON: () => ({}),
    } as DOMRect);
    setup();
    fireEvent.click(chip(/^🔥, 1 Super Reaction/));
    expect(chip(/^🔥, 2 Super Reactions/)).toBeInTheDocument();
    expect(burst()).not.toBeInTheDocument();
    expect(frames).toEqual([]);
  });

  it('no burst under reduced motion or with the animations pref off', () => {
    useUi.setState({ prefs: { ...DEFAULT_PREFS, superReactionAnimations: false } });
    setup();
    fireEvent.click(chip(/^🔥, 1 Super Reaction/));
    expect(chip(/^🔥, 2 Super Reactions/)).toBeInTheDocument();
    fireEvent.pointerEnter(chip(/^🔥, 2 Super Reactions/), { pointerType: 'mouse' });
    expect(burst()).not.toBeInTheDocument();
    act(() => useUi.setState({ prefs: { ...DEFAULT_PREFS, reduceMotion: 'on' } }));
    fireEvent.pointerEnter(chip(/^🔥, 2 Super Reactions/), { pointerType: 'mouse' });
    expect(burst()).not.toBeInTheDocument();
  });

  it('the tooltip says Super Reaction and names the super reactors', () => {
    vi.useFakeTimers();
    setup();
    fireEvent.pointerEnter(chip(/^🔥, 1 Super Reaction/), { pointerType: 'mouse' });
    act(() => vi.advanceTimersByTime(400));
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('Super Reaction');
    expect(tip).toHaveTextContent('Carol reacted with 🔥');
    fireEvent.pointerLeave(chip(/^🔥, 1 Super Reaction/), { pointerType: 'mouse' });
    fireEvent.pointerEnter(chip(/^🔥, 2 reactions/), { pointerType: 'mouse' });
    act(() => vi.advanceTimersByTime(400));
    expect(screen.getByRole('tooltip')).toHaveTextContent('You and Bob reacted with 🔥');
    expect(screen.getByRole('tooltip')).not.toHaveTextContent('Super Reaction');
  });

  it('the Reactions list has a tab for the super reactions of each emoji', () => {
    setup();
    fireEvent.contextMenu(chip(/^🔥, 1 Super Reaction/));
    const dialog = screen.getByRole('dialog', { name: 'Reactions' });
    expect(within(dialog).getByRole('tab', { name: 'Super Reactions 🔥 1' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(within(dialog).getByText('Carol')).toBeInTheDocument();
    expect(within(dialog).queryByText('Bob')).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('tab', { name: '🔥 2' }));
    expect(within(dialog).getByText('Bob')).toBeInTheDocument();
  });
});

describe('the Reactions list (super tabs)', () => {
  it('Space channels page the super reactors; I remove my own super reaction', async () => {
    get.mockResolvedValue([BOB, makeUser({ id: me })]);
    const chat = makeChat({ id: 'chat-1', type: 'space_text', spacePermissions: MEMBER });
    const m = seed(chat, {
      reactions: [{ emoji: '👀', count: 2, userIds: [], burstCount: 2 }],
      myReactions: [],
      myBurstReactions: ['👀'],
    });
    render(<ReactionsModal chat={chat} m={m} initialEmoji="👀" initialBurst onClose={() => {}} />);
    const dialog = screen.getByRole('dialog', { name: 'Reactions' });
    expect(
      within(dialog)
        .getAllByRole('tab')
        .map((t) => t.getAttribute('aria-label')),
    ).toEqual(['Super Reactions 👀 2']);
    expect(await within(dialog).findByText('Bob')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith(`/api/messages/m1/reactions/${enc('👀')}`, {
      query: { after: undefined, limit: 100, burst: 'true' },
    });
    // Members can't remove Bob's; my own goes (DELETE ?burst=true).
    expect(
      within(dialog).queryByRole('button', { name: 'Remove the Super Reaction of Bob' }),
    ).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove my Super Reaction' }));
    await waitFor(() =>
      expect(del).toHaveBeenCalledWith(`/api/messages/m1/reactions/${enc('👀')}/@me?burst=true`),
    );
    expect(cached()).toMatchObject({
      reactions: [{ emoji: '👀', count: 1, userIds: [], burstCount: 1 }],
      myBurstReactions: [],
    });
  });

  it('broadcast channels count super reactions anonymously', () => {
    const chat = makeChat({
      id: 'chat-1',
      type: 'channel',
      channelSettings: { isPublic: true, reactions: 'all' },
    });
    const m = seed(chat, {
      reactions: [{ emoji: '🦄', count: 5, userIds: [], burstCount: 2 }],
      myReactions: [],
      myBurstReactions: ['🦄'],
    });
    render(<ReactionsModal chat={chat} m={m} initialEmoji="🦄" initialBurst onClose={() => {}} />);
    expect(screen.getByText(/2 Super Reactions with 🦄, you included/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '🦄 3' }));
    expect(screen.getByText(/3 people reacted with 🦄\./)).toBeInTheDocument();
  });
});

describe('Add Super Reaction (menu and toolbar)', () => {
  /** A submenu's entries: emoji items, then 'View More' (falsy entries dropped). */
  const entries = (item: MenuItem | null) =>
    (item?.submenu ?? []).filter((e): e is MenuItem => !!e && e !== 'separator');
  const labels = (item: MenuItem | null) =>
    entries(item).map((e) => (typeof e.label === 'string' ? e.label : 'emoji'));

  it('the menu item offers recent emoji and View More, and super-reacts', async () => {
    localStorage.setItem('enbox:recent-reactions', JSON.stringify(['🔥', '🎉']));
    const chat = makeChat({ id: 'chat-1', type: 'space_text', spacePermissions: MEMBER });
    const m = seed(chat, { reactions: [], myReactions: [], myBurstReactions: [] });
    const openPicker = vi.fn();
    const item = superReactionMenuItem(chat, m, openPicker)!;
    expect(item.label).toBe('Add Super Reaction');
    expect(labels(item)).toEqual(['emoji', 'emoji', 'emoji', 'emoji', 'View More']);
    entries(item).at(-1)!.onSelect!();
    expect(openPicker).toHaveBeenCalled();
    entries(item)[0]!.onSelect!();
    expect(put).toHaveBeenCalledWith(`/api/messages/m1/reactions/${enc('🔥')}/@me?burst=true`);
    expect(cached()).toMatchObject({
      reactions: [{ emoji: '🔥', count: 1, userIds: [], burstCount: 1 }],
      myBurstReactions: ['🔥'],
    });
  });

  it('hides where reactions are not allowed; quick-only and join-only keep their short lists', () => {
    const m = makeMessage({ id: 'm1', reactions: [], myReactions: [] });
    const joined = { ...m, reactions: [{ emoji: '👍', count: 1, userIds: [] }] };
    const none = makeChat({
      type: 'channel',
      channelSettings: { isPublic: true, reactions: 'none' },
    });
    const quick = makeChat({
      type: 'channel',
      channelSettings: { isPublic: true, reactions: 'quick' },
    });
    const joinOnly = makeChat({ type: 'space_text', spacePermissions: PERM.VIEW_CHANNEL });
    const group = makeChat({ type: 'group' });
    const noop = () => undefined;
    expect(superReactionMenuItem(none, m, noop)).toBeNull();
    expect(
      superReactionMenuItem(group, { ...m, deletedAt: '2025-01-01T00:00:00.000Z' }, noop),
    ).toBeNull();
    expect(
      superReactionMenuItem(makeChat({ type: 'group', membership: 'left' }), m, noop),
    ).toBeNull();
    expect(superReactionMenuItem(joinOnly, m, noop)).toBeNull();
    expect(labels(superReactionMenuItem(joinOnly, joined, noop))).toEqual(['emoji']);
    expect(labels(superReactionMenuItem(quick, m, noop))).toEqual(
      QUICK_REACTIONS.map(() => 'emoji'),
    );
  });

  it('the toolbar button opens the picker in super mode; its switch goes back to normal', () => {
    const chat = makeChat({ id: 'chat-1', type: 'space_text', spacePermissions: MEMBER });
    const m = seed(chat, { reactions: [], myReactions: [] });
    const onOpenChange = vi.fn();
    render(<SuperReactToolButton chat={chat} m={m} onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add Super Reaction' }));
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    const dialog = screen.getByRole('dialog', { name: 'Choose a Super Reaction' });
    const toggle = within(dialog).getByRole('switch', { name: 'Super Reaction' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(toggle);
    expect(screen.getByRole('dialog', { name: 'Choose a reaction' })).toBeInTheDocument();
  });

  it('no toolbar button where the full picker does not apply', () => {
    const m = makeMessage({ id: 'm1', reactions: [{ emoji: '👍', count: 1, userIds: [] }] });
    const joinOnly = makeChat({ type: 'space_text', spacePermissions: PERM.VIEW_CHANNEL });
    const quick = makeChat({
      type: 'channel',
      channelSettings: { isPublic: true, reactions: 'quick' },
    });
    const { container } = render(
      <>
        <SuperReactToolButton chat={joinOnly} m={m} />
        <SuperReactToolButton chat={quick} m={m} />
      </>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
