/**
 * The Inbox's Bookmarks and Reminders tabs: saved messages newest first with where they are,
 * Jump, Remove; reminders upcoming first, then done ones greyed, a fired one highlighted and
 * counted on the button until seen; live updates from the bookmarks store.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import type { Bookmark, InboxMentionsPage, SpaceChannelInfo } from '@enbox/shared';
import { useBookmarks } from '@/features/bookmarks/store';
import { makeSpace } from '@/features/spaces/testUtils';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useSpaces } from '@/stores/spaces';
import { useUsers } from '@/stores/users';
import { makeChat, makeMe, makeMessage, makeUser } from '@/test/factories';

const get = vi.fn();
const del = vi.fn();
vi.mock('@/lib/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  api: {
    get: (...a: unknown[]) => get(...a),
    delete: (...a: unknown[]) => del(...a),
    post: async () => [],
  },
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
const general = makeChat({ id: 'c1', type: 'space_text', name: 'general', space: info('s1') });
const hikers = makeChat({ id: 'g9', type: 'group', name: 'Hikers' });
const hour = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const saved = (id: string, chatId: string, p: Partial<Bookmark> = {}): Bookmark => ({
  messageId: id,
  chatId,
  createdAt: hour(-10),
  remindAt: null,
  remindedAt: null,
  message: makeMessage({ id, chatId, seq: 9, senderId: 'alice', text: `text of ${id}` }),
  ...p,
});

const inSpace = saved('b1', 'c1', { createdAt: hour(-1) });
const upcoming = saved('b2', 'g9', { createdAt: hour(-2), remindAt: hour(2) });
const fired = saved('b3', 'g9', { createdAt: hour(-3), remindAt: hour(-1), remindedAt: hour(-1) });
const gone = saved('b4', 'g9', { createdAt: hour(-4), message: null });

function Where() {
  const loc = useLocation();
  return <output data-testid="location">{`${loc.pathname}${loc.search}`}</output>;
}

function renderInbox() {
  return render(
    <MemoryRouter initialEntries={['/chats']}>
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
const dialog = () => screen.getByRole('dialog', { name: 'Inbox' });
const cards = () => within(dialog()).queryAllByTestId('inbox-bookmark');
const ids = () => cards().map((c) => c.dataset.messageId);
async function openTab(name: 'Bookmarks' | RegExp) {
  fireEvent.click(button());
  fireEvent.click(within(dialog()).getByRole('tab', { name }));
  return dialog();
}

describe('Inbox: Bookmarks and Reminders', () => {
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
    useChats.setState({ byId: { c1: general, g9: hikers } });
    useUsers.getState().upsertUsers([alice]);
    useBookmarks.setState({
      byId: { b1: inSpace, b2: upcoming, b3: fired, b4: gone },
      loaded: true,
      loadedAt: Date.now(),
    });
    get.mockImplementation(async (path: string) => {
      if (path === '/api/me/mentions')
        return { items: [], nextCursor: null, users: [] } satisfies InboxMentionsPage;
      throw new Error(`unexpected GET ${path}`);
    });
    del.mockResolvedValue(undefined);
  });
  afterEach(() => {
    resetSessionState();
    get.mockReset();
    del.mockReset();
  });

  it('Bookmarks: newest first, where each one is; Jump opens it, ✕ removes it', async () => {
    renderInbox();
    await openTab('Bookmarks');
    expect(ids()).toEqual(['b1', 'b2', 'b3', 'b4']);
    const [first] = cards();
    expect(within(first!).getByText('general')).toBeInTheDocument();
    expect(within(first!).getByText('Rockets')).toBeInTheDocument();
    expect(within(first!).getByText('text of b1')).toBeInTheDocument();
    expect(within(cards()[1]!).getByText('Hikers')).toBeInTheDocument();
    expect(
      within(cards()[3]!).getByText('This message is no longer available'),
    ).toBeInTheDocument();
    expect(within(cards()[3]!).queryByRole('button', { name: 'Jump' })).toBeNull();

    fireEvent.click(within(cards()[1]!).getByRole('button', { name: 'Remove bookmark' }));
    expect(del).toHaveBeenCalledWith('/api/messages/b2/bookmark');
    expect(ids()).toEqual(['b1', 'b3', 'b4']);

    fireEvent.click(within(first!).getByRole('button', { name: 'Jump' }));
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/spaces/s1/c1?m=9&mid=b1'),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Reminders: upcoming first, then done; a fired one counts until I have seen it', async () => {
    renderInbox();
    expect(button()).toHaveAccessibleName('Inbox, 1 reminder');
    fireEvent.click(button());
    const tab = within(dialog()).getByRole('tab', { name: /Reminders/ });
    expect(tab).toHaveTextContent('1');
    fireEvent.click(tab);
    expect(ids()).toEqual(['b2', 'b3']);
    expect(within(cards()[0]!).getByText(/^Reminder: /)).toBeInTheDocument();
    // Seen now (the badge drops it), still highlighted while the tab is open.
    expect(within(cards()[1]!).getByText('Due')).toBeInTheDocument();
    expect(cards()[1]!).not.toHaveClass('opacity-60');
    expect(button()).toHaveAccessibleName('Inbox');

    // The other one fires while I look: highlighted too, and seen.
    act(() =>
      useBookmarks.getState().upsert({ ...upcoming, remindedAt: new Date().toISOString() }),
    );
    expect(ids()).toEqual(['b2', 'b3']);
    expect(within(cards()[0]!).getByText('Due')).toBeInTheDocument();
    expect(button()).toHaveAccessibleName('Inbox');

    // Opened again later: done ones are greyed.
    fireEvent.keyDown(window, { key: 'Escape' });
    await openTab(/Reminders/);
    expect(cards().every((c) => c.classList.contains('opacity-60'))).toBe(true);
  });

  it('follows the store: saved elsewhere shows up, removed elsewhere goes', async () => {
    renderInbox();
    await openTab('Bookmarks');
    act(() => useBookmarks.getState().upsert(saved('b5', 'g9', { createdAt: hour(0) })));
    expect(ids()[0]).toBe('b5');
    act(() => useBookmarks.getState().remove('b1'));
    expect(ids()).toEqual(['b5', 'b2', 'b3', 'b4']);
  });
});
