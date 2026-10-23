/**
 * Thread UI: the starter card, the Threads popout (lists, search, Create), the thread panel
 * (header, menu per permission, starter message, locked / archived footers), the "New Thread"
 * flow, the sidebar rows, the message menu item and the `?thread=` deep link. The message list
 * and the composer are stubbed (they have their own tests).
 */
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router';
import { PERM, type ChatSummary, type Message, type ThreadInfo, type ThreadsPage } from '@enbox/shared';
import { useConversationUi } from '@/features/conversation/state';
import { makeSpace } from '@/features/spaces/testUtils';
import { api } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useMessages, type ChatMessages } from '@/stores/messages';
import { useSidePanel } from '@/stores/sidePanel';
import { useSpaces } from '@/stores/spaces';
import { NEW_THREAD_ID, useThreads } from '@/stores/threads';
import { DEFAULT_PREFS, useUi } from '@/stores/ui';
import { useUsers } from '@/stores/users';
import { makeChat, makeMe, makeMessage, makeUser } from '@/test/factories';
import { threadMessageAction } from './actions';
import { SidebarThreads } from './SidebarThreads';
import { ThreadPanel } from './ThreadPanel';
import { ThreadsButton, ThreadsPopout } from './ThreadsButton';
import { ThreadStarterCard } from './ThreadStarterCard';
import { typingText } from './TypingLine';

vi.mock('@/features/conversation/MessageList', () => ({
  MessageList: ({ chat, initialTarget }: { chat: ChatSummary; initialTarget: { seq: number } | null }) => (
    <div data-testid="message-list" data-chat-id={chat.id} data-target={initialTarget?.seq ?? ''} />
  ),
}));
vi.mock('@/features/conversation/composer/Composer', () => ({
  Composer: ({ chat }: { chat: ChatSummary }) => <div data-testid="composer" data-chat-id={chat.id} />,
}));

const MEMBER = PERM.VIEW_CHANNEL | PERM.SEND_MESSAGES | PERM.ADD_REACTIONS;
const MOD = MEMBER | PERM.MANAGE_MESSAGES;

function spaceInfo(): NonNullable<ChatSummary['space']> {
  return {
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
}

const channel = (bits = MEMBER) =>
  makeChat({ id: 'general', type: 'space_text', name: 'general', space: spaceInfo(), spacePermissions: bits });

function thread(p: Partial<ChatSummary> = {}, info: Partial<ThreadInfo> = {}): ChatSummary {
  return makeChat({
    id: 't1',
    type: 'space_thread',
    name: 'Plans',
    space: spaceInfo(),
    spacePermissions: MEMBER,
    lastSeq: 2,
    lastReadSeq: 2,
    lastActivityAt: new Date().toISOString(),
    thread: {
      parentId: 'general',
      starterMessageId: 'm1',
      ownerId: 'owner',
      archived: false,
      locked: false,
      autoArchiveMinutes: 4320,
      messageCount: 2,
      ...info,
    },
    ...p,
  });
}

const starter = (p: Partial<Message> = {}) =>
  makeMessage({ id: 'm1', chatId: 'general', seq: 1, senderId: 'owner', text: 'shall we plan?', ...p });

function seed(opts: { bits?: number; threads?: ChatSummary[] } = {}) {
  const bits = opts.bits ?? MEMBER;
  const space = makeSpace({
    id: 's1',
    roles: [{ id: 'everyone', name: '@everyone', color: null, position: 0, permissions: bits, hoist: false, mentionable: false, isDefault: true }],
  });
  useSpaces.setState({ byId: { s1: space }, order: ['s1'], loaded: true, channelsLoaded: { s1: true } });
  useChats.setState({
    byId: Object.fromEntries([channel(bits), ...(opts.threads ?? [])].map((c) => [c.id, c])),
    loaded: true,
  });
}

function seedWindow(chatId: string, items: Message[]) {
  useMessages.setState((s) => ({
    byChat: { ...s.byChat, [chatId]: { items, loaded: true, hasMoreBefore: false, hasMoreAfter: false } as unknown as ChatMessages },
  }));
}

function Where() {
  const loc = useLocation();
  return <span data-testid="where">{`${loc.pathname}${loc.search}`}</span>;
}

function inChannel(node: ReactNode, at = '/spaces/s1/general') {
  return render(
    <MemoryRouter initialEntries={[at]}>
      <Routes>
        <Route
          path="/spaces/:spaceId/:chatId"
          element={
            <>
              {node}
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useAuth.setState({ user: makeMe({ id: 'me', displayName: 'Me' }), token: 't', status: 'authenticated' });
  useUsers.setState({ byId: { owner: makeUser({ id: 'owner', displayName: 'Olive' }) } });
  vi.spyOn(api, 'get').mockResolvedValue({ threads: [], nextCursor: null } satisfies ThreadsPage as never);
  vi.spyOn(api, 'post').mockResolvedValue([] as never);
});

afterEach(() => {
  useChats.setState({ byId: {}, loaded: false });
  useMessages.setState({ byChat: {} });
  useSpaces.setState({ byId: {}, order: [], channelsLoaded: {}, members: {} });
  useThreads.setState({ lists: {}, draft: null, recent: [], starters: {}, followed: {} });
  useSidePanel.setState({ panel: null });
  useConversationUi.setState({ jump: null });
});

describe('ThreadStarterCard', () => {
  it('shows the thread under its starter message and opens it beside the channel', () => {
    seed();
    const m = starter({ thread: { id: 't1', name: 'Plans', messageCount: 3, lastMessageAt: new Date().toISOString(), archived: false } });
    render(<ThreadStarterCard message={m} />);
    const card = screen.getByTestId('thread-starter-card');
    expect(card).toHaveTextContent('Plans');
    expect(card).toHaveTextContent('3 Messages');
    fireEvent.click(card);
    expect(useSidePanel.getState().panel).toEqual({ kind: 'thread', threadId: 't1', parentId: 'general' });
    expect(useThreads.getState().starters.t1?.id).toBe('m1');
    expect(useThreads.getState().recent[0]).toBe('t1');
  });

  it('follows the live thread (count, name) once it is loaded', () => {
    seed({ threads: [thread({ name: 'Plans v2' }, { messageCount: 7 })] });
    const m = starter({ thread: { id: 't1', name: 'Plans', messageCount: 3, lastMessageAt: null, archived: false } });
    render(<ThreadStarterCard message={m} />);
    expect(screen.getByTestId('thread-starter-card')).toHaveTextContent('Plans v2');
    expect(screen.getByTestId('thread-starter-card')).toHaveTextContent('7 Messages');
  });
});

describe('Threads popout', () => {
  it('lists active threads with creator and count, filters by name, Create starts a draft', async () => {
    seed({ threads: [thread(), thread({ id: 't2', name: 'Release notes' }, { messageCount: 1, starterMessageId: null })] });
    const onClose = vi.fn();
    render(<ThreadsPopout chat={channel()} onClose={onClose} />);
    expect(api.get).toHaveBeenCalledWith('/api/chats/general/threads', expect.anything());
    const rows = screen.getAllByTestId('thread-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent(/Olive/);
    expect(screen.getByText('1 Message')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search threads' }), { target: { value: 'release' } });
    expect(screen.getAllByTestId('thread-row').map((r) => r.textContent)).toEqual([expect.stringContaining('Release notes')]);
    fireEvent.click(screen.getByRole('button', { name: 'Create Thread' }));
    expect(onClose).toHaveBeenCalled();
    expect(useSidePanel.getState().panel).toEqual({ kind: 'thread', threadId: NEW_THREAD_ID, parentId: 'general' });
    expect(useThreads.getState().draft).toMatchObject({ parentId: 'general', messageId: null });
  });

  it('the Archived tab loads the archived page; a row opens its thread', async () => {
    seed();
    vi.mocked(api.get).mockImplementation(async (_p, opts) =>
      (opts as { query?: { archived?: string } })?.query?.archived
        ? { threads: [thread({ id: 'a1', name: 'Old plans' }, { archived: true })], nextCursor: null }
        : { threads: [], nextCursor: null },
    );
    const onClose = vi.fn();
    render(<ThreadsPopout chat={channel()} onClose={onClose} />);
    expect(await screen.findByText('There are no active threads.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Archived' }));
    const row = await screen.findByText('Old plans');
    fireEvent.click(row);
    expect(useSidePanel.getState().panel).toEqual({ kind: 'thread', threadId: 'a1', parentId: 'general' });
  });

  it('no Create without SEND_MESSAGES in the channel', () => {
    seed({ bits: PERM.VIEW_CHANNEL });
    render(<ThreadsPopout chat={channel(PERM.VIEW_CHANNEL)} onClose={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Create Thread' })).toBeNull();
  });
});

describe('Thread panel', () => {
  it('shows the header, the starter message and the thread’s conversation', () => {
    seed({ threads: [thread()] });
    seedWindow('general', [starter()]);
    seedWindow('t1', []);
    inChannel(<ThreadPanel threadId="t1" parentId="general" />);
    const panel = screen.getByTestId('thread-panel');
    expect(within(panel).getByRole('heading', { name: 'Plans' })).toBeInTheDocument();
    expect(within(panel).getByTestId('thread-starter')).toHaveTextContent('shall we plan?');
    expect(within(panel).getByTestId('message-list')).toHaveAttribute('data-chat-id', 't1');
    expect(within(panel).getByTestId('composer')).toHaveAttribute('data-chat-id', 't1');
  });

  it('a member can follow it and copy its link; a moderator can archive, lock and delete', () => {
    seed({ threads: [thread()] });
    seedWindow('t1', []);
    const { unmount } = inChannel(<ThreadPanel threadId="t1" parentId="general" />);
    fireEvent.click(screen.getByRole('button', { name: 'Thread options' }));
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Follow Thread', 'Copy Link']);
    unmount();

    seed({ bits: MOD, threads: [thread({ spacePermissions: MOD })] });
    seedWindow('t1', []);
    inChannel(<ThreadPanel threadId="t1" parentId="general" />);
    fireEvent.click(screen.getByRole('button', { name: 'Thread options' }));
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'Follow Thread',
      'Archive Thread',
      'Lock Thread',
      'Edit Thread Name',
      'Copy Link',
      'Delete Thread',
    ]);
    const patch = vi.spyOn(api, 'patch').mockResolvedValue(thread({}, { locked: true }) as never);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Lock Thread' }));
    expect(patch).toHaveBeenCalledWith('/api/threads/t1', { locked: true });
  });

  it('the creator renames it from the header', async () => {
    seed({ threads: [thread({}, { ownerId: 'me' })] });
    seedWindow('t1', []);
    const patch = vi.spyOn(api, 'patch').mockResolvedValue(thread({ name: 'Plans 2' }, { ownerId: 'me' }) as never);
    inChannel(<ThreadPanel threadId="t1" parentId="general" />);
    fireEvent.click(screen.getByRole('button', { name: 'Thread options' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit Thread Name' }));
    const input = screen.getByRole('textbox', { name: 'Thread name' });
    fireEvent.change(input, { target: { value: 'Plans 2' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(patch).toHaveBeenCalledWith('/api/threads/t1', { name: 'Plans 2' });
    await waitFor(() => expect(useChats.getState().byId.t1?.name).toBe('Plans 2'));
  });

  it('locked: members get the locked footer instead of the composer; archived shows the revive note', () => {
    seed({ threads: [thread({}, { locked: true })] });
    seedWindow('t1', []);
    const { unmount } = inChannel(<ThreadPanel threadId="t1" parentId="general" />);
    expect(screen.queryByTestId('composer')).toBeNull();
    expect(screen.getByTestId('thread-locked-footer')).toBeInTheDocument();
    unmount();

    seed({ threads: [thread({}, { archived: true })] });
    seedWindow('t1', []);
    inChannel(<ThreadPanel threadId="t1" parentId="general" />);
    expect(screen.getByTestId('composer')).toBeInTheDocument();
    expect(screen.getByTestId('thread-archived-note')).toBeInTheDocument();
  });

  it('a jump requested as the panel opens (search, Inbox) loads the thread around that message', async () => {
    seed({ threads: [thread()] });
    vi.mocked(api.get).mockResolvedValue({ messages: [], hasMoreBefore: false, hasMoreAfter: false, users: [] } as never);
    useSidePanel.getState().open({ kind: 'thread', threadId: 't1', parentId: 'general' });
    useConversationUi.getState().requestJump('t1', 42, 'mx');
    inChannel(<ThreadPanel threadId="t1" parentId="general" />);
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(
        '/api/chats/t1/messages',
        expect.objectContaining({ query: expect.objectContaining({ around: 42 }) }),
      ),
    );
    expect(await screen.findByTestId('message-list')).toHaveAttribute('data-target', '42');
    // The list itself consumes the request (scroll + highlight); it is still pending for it.
    expect(useConversationUi.getState().jump).toMatchObject({ chatId: 't1', seq: 42 });
  });

  it('Reply in the channel beside it keeps the focus in the channel’s composer', async () => {
    seed({ threads: [thread()] });
    seedWindow('t1', []);
    inChannel(
      <>
        <div data-testid="conversation" data-chat-id="general">
          <textarea aria-label="Channel message" />
        </div>
        <ThreadPanel threadId="t1" parentId="general" />
      </>,
    );
    act(() => useConversationUi.getState().setReply('general', starter()));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Channel message' })));
    useConversationUi.setState({ reply: {} });
  });

  it('closes when another channel opens; a jump that lands on its channel afterwards keeps it', () => {
    seed({ threads: [thread()] });
    seedWindow('t1', []);
    useSidePanel.getState().open({ kind: 'thread', threadId: 't1', parentId: 'general' });
    // Opened while another channel is on screen (an Inbox jump), then the route lands on it.
    const ui = inChannel(
      <>
        <ThreadPanel threadId="t1" parentId="general" />
        <Go to="/spaces/s1/general" />
      </>,
      '/spaces/s1/random',
    );
    expect(useSidePanel.getState().panel).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'go' }));
    expect(useSidePanel.getState().panel).not.toBeNull();
    ui.unmount();

    inChannel(
      <>
        <ThreadPanel threadId="t1" parentId="general" />
        <Go to="/spaces/s1/random" />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'go' }));
    expect(useSidePanel.getState().panel).toBeNull();
  });
});

describe('Thread panel: typing, forum tags, Developer Mode', () => {
  afterEach(() => {
    useChats.getState().clearTyping();
    useUi.setState({ prefs: { ...DEFAULT_PREFS } });
  });

  it('shows who is typing in the thread (Space nicknames first), and only in that thread', () => {
    seed({ threads: [thread()] });
    seedWindow('t1', []);
    useUsers.setState((s) => ({ byId: { ...s.byId, bob: makeUser({ id: 'bob', displayName: 'Bob' }) } }));
    inChannel(<ThreadPanel threadId="t1" parentId="general" />);
    expect(screen.queryByTestId('typing-line')).toBeNull();

    act(() => useChats.getState().setTyping('general', 'bob', 'typing'));
    expect(screen.queryByTestId('typing-line')).toBeNull();
    act(() => useChats.getState().setTyping('t1', 'owner', 'typing'));
    expect(screen.getByTestId('typing-line')).toHaveTextContent('Olive is typing…');
    act(() => useChats.getState().setTyping('t1', 'bob', 'typing'));
    expect(screen.getByTestId('typing-line')).toHaveTextContent('Olive and Bob are typing…');
    act(() => useChats.getState().setTyping('t1', 'owner', 'idle'));
    act(() => useSpaces.setState({ members: { s1: { bob: { userId: 'bob', nickname: 'Bobby', roleIds: [] } as never } } }));
    act(() => useChats.getState().setTyping('t1', 'bob', 'typing'));
    expect(screen.getByTestId('typing-line')).toHaveTextContent('Bobby is typing…');
    act(() => useChats.getState().setTyping('t1', 'bob', 'idle'));
    expect(screen.queryByTestId('typing-line')).toBeNull();
  });

  it('typing wording', () => {
    expect(typingText(['Ann'])).toBe('Ann is typing…');
    expect(typingText(['Ann', 'Bo', 'Cy'])).toBe('Ann, Bo and Cy are typing…');
    expect(typingText(['Ann', 'Bo', 'Cy', 'Di'])).toBe('Several people are typing…');
    expect(typingText([])).toBe('');
  });

  it('a forum post shows the tags it wears in the panel header', () => {
    const forum = makeChat({
      id: 'ideas',
      type: 'space_forum',
      name: 'ideas',
      space: {
        ...spaceInfo(),
        forum: {
          tags: [
            { id: 'bug', name: 'Bug', emoji: null, moderated: false },
            { id: 'idea', name: 'Idea', emoji: null, moderated: false },
            { id: 'done', name: 'Done', emoji: null, moderated: true },
          ],
          settings: { layout: 'list', defaultSort: 'activity', requireTag: false, defaultReaction: null, guidelines: null },
        },
      },
      spacePermissions: MEMBER,
    });
    seed({ threads: [forum, thread({ name: 'Dark mode' }, { parentId: 'ideas', starterMessageId: null, appliedTags: ['done', 'idea', 'gone'] })] });
    seedWindow('t1', []);
    inChannel(<ThreadPanel threadId="t1" parentId="ideas" />, '/spaces/s1/ideas');
    const tags = within(screen.getByTestId('thread-panel-header')).getByTestId('thread-post-tags');
    // The forum's order; a deleted tag's id is skipped.
    expect(within(tags).getAllByTestId('forum-tag').map((t) => t.textContent)).toEqual(['Idea', 'Done']);
  });

  it('a forum post’s menu, per role: moderators pin, lock and close; its author closes and deletes while unlocked', () => {
    const forum = (bits: number) =>
      makeChat({
        id: 'ideas',
        type: 'space_forum',
        name: 'ideas',
        space: {
          ...spaceInfo(),
          forum: { tags: [], settings: { layout: 'list', defaultSort: 'activity', requireTag: false, defaultReaction: null, guidelines: null } },
        },
        spacePermissions: bits,
      });
    const post = (bits: number, info: Partial<ThreadInfo> = {}) =>
      thread({ name: 'Dark mode', spacePermissions: bits }, { parentId: 'ideas', starterMessageId: null, ...info });
    const menu = () => {
      fireEvent.click(screen.getByRole('button', { name: 'Thread options' }));
      return screen.getAllByRole('menuitem').map((i) => i.textContent);
    };
    const open = (bits: number, info: Partial<ThreadInfo> = {}) => {
      seed({ bits, threads: [forum(bits), post(bits, info)] });
      seedWindow('t1', []);
      return inChannel(<ThreadPanel threadId="t1" parentId="ideas" />, '/spaces/s1/ideas');
    };

    let view = open(MOD, { pinned: true, archived: true, following: true });
    const header = screen.getByTestId('thread-panel-header');
    expect(within(header).getByLabelText('Pinned')).toBeInTheDocument();
    expect(within(header).getByLabelText('Closed')).toBeInTheDocument();
    expect(menu()).toEqual([
      'Unfollow Post',
      'Reopen Post',
      'Lock Post',
      'Unpin Post',
      'Edit Title',
      'Copy Link',
      'Delete Post',
    ]);
    const patch = vi.spyOn(api, 'patch').mockResolvedValue(post(MOD, { archived: true }) as never);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Unpin Post' }));
    expect(patch).toHaveBeenCalledWith('/api/threads/t1', { pinned: false });
    view.unmount();

    view = open(MEMBER, { ownerId: 'me' });
    expect(menu()).toEqual(['Follow Post', 'Close Post', 'Edit Title', 'Copy Link', 'Delete Post']);
    view.unmount();
    view = open(MEMBER, { ownerId: 'me', locked: true });
    expect(screen.getByTestId('thread-locked-footer')).toHaveTextContent('This post is locked.');
    expect(menu()).toEqual(['Follow Post', 'Copy Link']);
    view.unmount();
    open(MEMBER);
    expect(menu()).toEqual(['Follow Post', 'Copy Link']);
  });

  it('a thread shows no tags', () => {
    seed({ threads: [thread()] });
    seedWindow('t1', []);
    inChannel(<ThreadPanel threadId="t1" parentId="general" />);
    expect(screen.queryByTestId('thread-post-tags')).toBeNull();
  });

  it('Developer Mode adds Copy Thread ID, which copies the id', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    useUi.getState().setPref('developerMode', true);
    seed({ threads: [thread()] });
    seedWindow('t1', []);
    inChannel(<ThreadPanel threadId="t1" parentId="general" />);
    fireEvent.click(screen.getByRole('button', { name: 'Thread options' }));
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'Follow Thread',
      'Copy Link',
      'Copy Thread ID',
    ]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy Thread ID' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('t1'));
  });
});

function Go({ to }: { to: string }) {
  const nav = useNavigate();
  return (
    <button type="button" onClick={() => nav(to)}>
      go
    </button>
  );
}

describe('New Thread', () => {
  it('from a message: prefilled name, the starter shown, the first message creates the thread', async () => {
    seed();
    const m = starter();
    seedWindow('general', [m]);
    act(() => useThreads.getState().startDraft('general', m));
    vi.mocked(api.post).mockImplementation(async (path, body) =>
      path === '/api/chats/general/threads'
        ? thread({ id: 't9', name: (body as { name: string }).name }, { messageCount: 0 })
        : makeMessage({ id: 'r1', chatId: 't9', seq: 1, senderId: 'me', text: 'first!', clientId: (body as { clientId: string }).clientId }),
    );
    inChannel(<ThreadPanel threadId={NEW_THREAD_ID} parentId="general" />);
    expect(screen.getByRole('heading', { name: 'New Thread' })).toBeInTheDocument();
    expect(screen.getByTestId('thread-name-input')).toHaveValue('shall we plan?');
    expect(screen.getByTestId('thread-starter')).toHaveTextContent('shall we plan?');
    fireEvent.change(screen.getByTestId('thread-name-input'), { target: { value: 'Plans' } });
    fireEvent.change(screen.getByTestId('thread-first-message'), { target: { value: 'first!' } });
    fireEvent.keyDown(screen.getByTestId('thread-first-message'), { key: 'Enter' });
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/api/chats/general/threads', { name: 'Plans', messageId: 'm1' }),
    );
    await waitFor(() => expect(useSidePanel.getState().panel).toEqual({ kind: 'thread', threadId: 't9', parentId: 'general' }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/api/chats/t9/messages', expect.objectContaining({ text: 'first!' })),
    );
  });

  it('the message menu offers Create Thread in text channels, Open Thread when one exists, nothing in threads', () => {
    const c = channel();
    const m = starter();
    expect(threadMessageAction(c, m)).toMatchObject({ label: 'Create Thread' });
    const withThread = starter({ thread: { id: 't1', name: 'Plans', messageCount: 0, lastMessageAt: null, archived: false } });
    expect(threadMessageAction(c, withThread)).toMatchObject({ label: 'Open Thread' });
    expect(threadMessageAction(thread() as ChatSummary, m)).toBeNull();
    expect(threadMessageAction(channel(PERM.VIEW_CHANNEL), m)).toBeNull();
    expect(threadMessageAction(c, starter({ type: 'system' }))).toBeNull();
  });
});

describe('Sidebar threads and links', () => {
  const rows = () => screen.queryAllByTestId('sidebar-thread-row').map((r) => r.textContent);

  it('nests my active threads under the channel, unread ones bold; a click opens it', async () => {
    seed({
      threads: [
        thread({ id: 'mine', name: 'Mine', lastSeq: 5, lastReadSeq: 3 }, { ownerId: 'me', following: true }),
        thread({ id: 'theirs', name: 'Theirs', lastSeq: 5, lastReadSeq: 0 }),
        thread({ id: 'done', name: 'Done' }, { ownerId: 'me', archived: true, following: true }),
      ],
    });
    // Unmounted before the stores reset (else the sidebar would load again into the next test).
    const { unmount } = inChannel(<SidebarThreads channel={channel()} />);
    await waitFor(() => expect(useThreads.getState().followed.s1).toEqual([]));
    expect(rows()).toEqual(['Mine']);
    const row = screen.getByTestId('sidebar-thread-row');
    expect(row).toHaveAttribute('data-unread', 'true');
    fireEvent.click(row);
    expect(useSidePanel.getState().panel).toEqual({ kind: 'thread', threadId: 'mine', parentId: 'general' });
    unmount();
  });

  it('once the Space’s followed list is in, only what I follow; Follow and Unfollow change it at once', async () => {
    const plans = thread({ id: 't1', name: 'Plans', createdAt: '2026-10-20T09:00:00.000Z' }, { ownerId: 'me' });
    const ideas = thread({ id: 't2', name: 'Ideas', createdAt: '2026-10-20T10:00:00.000Z' }, { following: true });
    seed({ threads: [plans, ideas] });
    seedWindow('t1', []);
    vi.mocked(api.get).mockImplementation(async (path: string) =>
      (path === '/api/spaces/s1/followed-threads' ? { threads: [ideas] } : { threads: [], nextCursor: null }) as never,
    );
    const { unmount } = inChannel(
      <>
        <SidebarThreads channel={channel()} />
        <ThreadPanel threadId="t1" parentId="general" />
      </>,
    );
    // Until the list is in, the ones I own or read show too.
    expect(rows()).toEqual(['Plans', 'Ideas']);
    await waitFor(() => expect(rows()).toEqual(['Ideas']));
    expect(api.get).toHaveBeenCalledWith('/api/spaces/s1/followed-threads');

    const put = vi.spyOn(api, 'put').mockResolvedValue({ ...plans, thread: { ...plans.thread!, following: true } } as never);
    fireEvent.click(screen.getByRole('button', { name: 'Thread options' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Follow Thread' }));
    expect(rows()).toEqual(['Plans', 'Ideas']);
    expect(put).toHaveBeenCalledWith('/api/threads/t1/follow');
    await waitFor(() => expect(useThreads.getState().followed.s1).toEqual(['t1', 't2']));

    const del = vi.spyOn(api, 'delete').mockResolvedValue(undefined as never);
    fireEvent.click(screen.getByRole('button', { name: 'Thread options' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Unfollow Thread' }));
    expect(rows()).toEqual(['Ideas']);
    expect(del).toHaveBeenCalledWith('/api/threads/t1/follow');

    // Another device of mine follows it again (thread:follow).
    act(() => useThreads.getState().applyFollow({ threadId: 't1', parentId: 'general', spaceId: 's1', following: true }));
    expect(rows()).toEqual(['Plans', 'Ideas']);
    unmount();
  });

  it('a refused follow is undone', async () => {
    seed({ threads: [thread({ id: 't1', name: 'Plans' })] });
    useThreads.setState({ followed: { s1: [] } });
    vi.spyOn(api, 'put').mockRejectedValue(new Error('nope'));
    await expect(useThreads.getState().setFollowing('t1', true)).rejects.toThrow('nope');
    expect(useChats.getState().byId.t1?.thread?.following).toBe(false);
    expect(useThreads.getState().followed.s1).toEqual([]);
  });

  it('a forum nests the posts I follow, never the others', async () => {
    const forum = makeChat({ id: 'ideas', type: 'space_forum', name: 'ideas', space: spaceInfo(), spacePermissions: MEMBER });
    seed({
      threads: [
        forum,
        thread({ id: 'p1', name: 'Followed post' }, { parentId: 'ideas', starterMessageId: null, following: true }),
        thread({ id: 'p2', name: 'Read post', lastReadSeq: 2 }, { parentId: 'ideas', starterMessageId: null, ownerId: 'me' }),
      ],
    });
    const { unmount } = inChannel(<SidebarThreads channel={forum} />, '/spaces/s1/ideas');
    expect(screen.getByRole('list', { name: 'Posts in ideas' })).toBeInTheDocument();
    expect(rows()).toEqual(['Followed post']);
    await waitFor(() => expect(useThreads.getState().followed.s1).toEqual([]));
    expect(rows()).toEqual(['Followed post']);
    unmount();
  });

  it('?thread= on the channel URL opens the thread beside it and leaves the URL', async () => {
    seed({ threads: [thread()] });
    seedWindow('t1', []);
    inChannel(<ThreadsButton chat={channel()} />, '/spaces/s1/general?thread=t1');
    expect(useSidePanel.getState().panel).toEqual({ kind: 'thread', threadId: 't1', parentId: 'general' });
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/spaces\/s1\/general$/));
  });

  it('a thread opened as a page moves to its channel with the panel', async () => {
    seed({ threads: [thread()] });
    inChannel(<ThreadsButton chat={thread()} />, '/spaces/s1/t1');
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/spaces/s1/general'));
  });
});
