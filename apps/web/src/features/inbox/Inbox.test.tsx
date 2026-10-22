import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import type { InboxMention, InboxMentionsPage, MessagePage, SpaceChannelInfo } from '@enbox/shared';
import { makeSpace } from '@/features/spaces/testUtils';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { DEFAULT_INBOX_FILTERS, useInbox } from '@/stores/inbox';
import { useSpaces } from '@/stores/spaces';
import { useUsers } from '@/stores/users';
import { makeChat, makeMe, makeMessage, makeUser } from '@/test/factories';

const get = vi.fn();
const post = vi.fn();
vi.mock('@/lib/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  api: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
  },
}));
const markChatRead = vi.fn();
vi.mock('@/realtime/chats', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  markChatRead: (...a: unknown[]) => markChatRead(...a),
}));

const { InboxButton } = await import('./InboxButton');

const info = (spaceId: string): SpaceChannelInfo => ({
  spaceId,
  categoryId: null,
  position: 0,
  topic: null,
  slowmodeSeconds: 0,
  nsfw: false,
  userLimit: null,
  bitrate: null,
  permissionsSynced: true,
  overwrites: [],
});

const alice = makeUser({ id: 'alice', displayName: 'Alice' });
const now = new Date().toISOString();
const general = makeChat({
  id: 'c1',
  type: 'space_text',
  name: 'general',
  space: info('s1'),
  lastSeq: 10,
  lastReadSeq: 7,
  unreadCount: 3,
  unreadMentionCount: 2,
  lastActivityAt: now,
});
const dm = makeChat({ id: 'd1', type: 'direct', name: null, peer: alice, lastSeq: 4, lastReadSeq: 3, unreadCount: 1, lastActivityAt: now });
const quiet = makeChat({ id: 'g2', type: 'group', name: 'Muted group', unreadCount: 5, mutedUntil: '2099-01-01T00:00:00.000Z' });

const inGeneral = (id: string, seq: number, text: string): InboxMention => ({
  message: makeMessage({ id, chatId: 'c1', seq, senderId: 'alice', text, createdAt: now }),
  chat: { id: 'c1', type: 'space_text', name: 'general', spaceId: 's1', spaceName: 'Rockets', spaceIconUrl: null, parentName: null },
});
const inGroup: InboxMention = {
  message: makeMessage({ id: 'm2', chatId: 'g9', seq: 3, senderId: 'alice', text: 'group ping', createdAt: now }),
  chat: { id: 'g9', type: 'group', name: 'Hikers', spaceId: null, spaceName: null, spaceIconUrl: null, parentName: null },
};

let pages: (query: Record<string, unknown>) => InboxMentionsPage;
const page = (items: InboxMention[], nextCursor: string | null = null): InboxMentionsPage => ({ items, nextCursor, users: [alice] });

function Where() {
  const loc = useLocation();
  return <output data-testid="location">{`${loc.pathname}${loc.search}`}</output>;
}

function renderInbox(path = '/spaces/s1/c1') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <InboxButton />
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

const button = () => screen.getByTestId('inbox-button');
const popout = () => screen.getByRole('dialog', { name: 'Inbox' });
const mentionCalls = () => get.mock.calls.filter((c) => c[0] === '/api/me/mentions').map((c) => (c[1] as { query: Record<string, unknown> }).query);

async function openInbox() {
  fireEvent.click(button());
  return popout();
}

describe('Inbox', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );
    useAuth.setState({ user: makeMe({ id: 'me', displayName: 'Me' }) });
    useSpaces.setState({
      byId: { s1: makeSpace({ id: 's1', name: 'Rockets' }) },
      order: ['s1'],
      loaded: true,
      channelsLoaded: { s1: true },
    });
    useChats.setState({ byId: { c1: general, d1: dm, g2: quiet } });
    useUsers.getState().upsertUsers([alice]);
    useInbox.setState({ filters: { ...DEFAULT_INBOX_FILTERS } });
    pages = () => page([inGeneral('m1', 9, 'hey there'), inGroup]);
    get.mockImplementation(async (path: string, opts?: { query?: Record<string, unknown> }) => {
      if (path === '/api/me/mentions') return pages(opts?.query ?? {});
      if (path === '/api/chats/c1/messages') {
        const res: MessagePage = {
          messages: [
            makeMessage({ id: 'r6', chatId: 'c1', seq: 6, senderId: 'alice', text: 'already read' }),
            makeMessage({ id: 'r8', chatId: 'c1', seq: 8, senderId: 'alice', text: 'fresh news' }),
          ],
          hasMoreBefore: true,
          hasMoreAfter: false,
          users: [alice],
        };
        return res;
      }
      if (path === '/api/chats/d1/messages')
        return { messages: [makeMessage({ id: 'r4', chatId: 'd1', seq: 4, senderId: 'alice', text: 'dm hello' })], hasMoreBefore: false, hasMoreAfter: false, users: [alice] };
      throw new Error(`unexpected GET ${path}`);
    });
    post.mockResolvedValue([]);
  });

  afterEach(() => {
    resetSessionState();
    get.mockReset();
    post.mockReset();
    markChatRead.mockReset();
  });

  it('shows a red dot while I have unread mentions', () => {
    renderInbox();
    expect(button()).toHaveAccessibleName('Inbox, 2 unread mentions');
    act(() => useChats.getState().patchChat('c1', { unreadMentionCount: 0 }));
    expect(button()).toHaveAccessibleName('Inbox');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens on Mentions with channel cards; switches to Unreads', async () => {
    renderInbox();
    const dialog = await openInbox();
    expect(within(dialog).getByRole('tab', { name: 'Mentions' })).toHaveAttribute('aria-selected', 'true');
    expect(await within(dialog).findByText('hey there')).toBeInTheDocument();
    expect(mentionCalls()[0]).toMatchObject({ limit: 25, everyone: true, roles: true });
    expect(mentionCalls()[0]).not.toHaveProperty('spaceId');
    const cards = within(dialog).getAllByTestId('inbox-mention-card');
    expect(cards).toHaveLength(2);
    expect(within(cards[0]!).getByText('general')).toBeInTheDocument();
    expect(within(cards[0]!).getByText('Rockets')).toBeInTheDocument();
    expect(within(cards[0]!).getByText('Alice')).toBeInTheDocument();
    expect(within(cards[1]!).getByText('Hikers')).toBeInTheDocument();
    expect(within(cards[1]!).getByText('group ping')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('tab', { name: 'Unreads' }));
    expect(within(dialog).getByRole('tab', { name: 'Unreads' })).toHaveAttribute('aria-selected', 'true');
    expect(within(dialog).queryByText('hey there')).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Mark all as read' })).toBeInTheDocument();
  });

  it('Jump opens the message in its channel and closes the Inbox', async () => {
    renderInbox('/chats');
    const dialog = await openInbox();
    const row = (await within(dialog).findByText('hey there')).closest('[data-testid="inbox-mention"]') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Jump' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/spaces/s1/c1?m=9&mid=m1'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('✕ dismisses a mention on this device, for good', async () => {
    renderInbox();
    let dialog = await openInbox();
    const row = (await within(dialog).findByText('hey there')).closest('[data-testid="inbox-mention"]') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Dismiss mention' }));
    expect(within(dialog).queryByText('hey there')).not.toBeInTheDocument();
    expect(within(dialog).getByText('group ping')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('enbox.inbox.dismissed.me') ?? '[]')).toEqual(['m1']);
    // Closed and opened again: the server still sends it, the Inbox still hides it.
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    dialog = await openInbox();
    expect(await within(dialog).findByText('group ping')).toBeInTheDocument();
    expect(within(dialog).queryByText('hey there')).not.toBeInTheDocument();
  });

  it('filters change the query', async () => {
    renderInbox();
    const dialog = await openInbox();
    await within(dialog).findByText('hey there');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Filter mentions' }));
    const menu = screen.getByRole('menu', { name: 'Mention filters' });
    const everyone = within(menu).getByRole('menuitemcheckbox', { name: 'Include @everyone and @here' });
    expect(everyone).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(everyone);
    await waitFor(() => expect(mentionCalls().at(-1)).toMatchObject({ everyone: false, roles: true }));
    fireEvent.click(within(menu).getByRole('menuitemcheckbox', { name: 'Include role mentions' }));
    await waitFor(() => expect(mentionCalls().at(-1)).toMatchObject({ everyone: false, roles: false }));
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'This Space only' }));
    await waitFor(() => expect(mentionCalls().at(-1)).toMatchObject({ spaceId: 's1' }));
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'All Spaces' }));
    await waitFor(() => expect(mentionCalls().at(-1)).not.toHaveProperty('spaceId'));
    // Remembered on this device.
    expect(JSON.parse(localStorage.getItem('enbox.inbox.filters') ?? '{}')).toEqual({ everyone: false, roles: false, thisSpace: false });
  });

  it('outside a Space, This Space only is unavailable', async () => {
    renderInbox('/chats/d1');
    const dialog = await openInbox();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Filter mentions' }));
    expect(screen.getByRole('menuitemradio', { name: /This Space only/ })).toBeDisabled();
  });

  it('pages on with the cursor; an empty inbox is all caught up', async () => {
    pages = (q) => (q.before === 'cur-1' ? page([inGeneral('m3', 2, 'older one')]) : page([inGeneral('m1', 9, 'hey there')], 'cur-1'));
    renderInbox();
    const dialog = await openInbox();
    expect(await within(dialog).findByText('older one')).toBeInTheDocument();
    expect(within(dialog).getByText('hey there')).toBeInTheDocument();
    expect(mentionCalls().map((q) => q.before)).toEqual([undefined, 'cur-1']);
    // Same channel, consecutive: one card.
    expect(within(dialog).getAllByTestId('inbox-mention-card')).toHaveLength(1);

    fireEvent.keyDown(window, { key: 'Escape' });
    pages = () => page([]);
    const again = await openInbox();
    expect(await within(again).findByText('You’re all caught up!')).toBeInTheDocument();
  });

  it('Unreads: unread, unmuted chats by Space with their new messages; mark as read', async () => {
    renderInbox();
    const dialog = await openInbox();
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Unreads' }));
    const space = within(dialog).getByRole('region', { name: 'Rockets' });
    const card = within(space).getByTestId('inbox-unread');
    expect(within(card).getByText('general')).toBeInTheDocument();
    // Only the messages after my read marker (seq 7).
    expect(await within(card).findByText('fresh news')).toBeInTheDocument();
    expect(within(card).queryByText('already read')).not.toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/api/chats/c1/messages', { query: { limit: 3 } });
    const dms = within(dialog).getByRole('region', { name: 'Direct Messages' });
    expect(await within(dms).findByText('dm hello')).toBeInTheDocument();
    expect(within(dialog).queryByText('Muted group')).not.toBeInTheDocument();

    fireEvent.click(within(card).getByRole('button', { name: 'Mark general as read' }));
    expect(markChatRead).toHaveBeenCalledWith('c1', { force: true });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mark all as read' }));
    expect(markChatRead.mock.calls.slice(1).map((c) => c[0]).sort()).toEqual(['c1', 'd1']);

    // Once read, a chat leaves the list; nothing left: all caught up.
    act(() => {
      useChats.getState().patchChat('c1', { unreadCount: 0, unreadMentionCount: 0, lastReadSeq: 10 });
      useChats.getState().patchChat('d1', { unreadCount: 0, lastReadSeq: 4 });
    });
    expect(within(dialog).getByText('You’re all caught up!')).toBeInTheDocument();
  });

  it('Ctrl+I toggles the Inbox; Escape closes it', async () => {
    renderInbox();
    fireEvent.keyDown(window, { key: 'i', ctrlKey: true });
    expect(popout()).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'i', ctrlKey: true });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'i', ctrlKey: true });
    expect(popout()).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // A plain "i" (typing) does nothing.
    fireEvent.keyDown(window, { key: 'i' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await act(async () => undefined);
  });
});
