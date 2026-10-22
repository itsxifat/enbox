import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import type { Contact, FriendRequest, FriendRequests, UserPublic } from '@enbox/shared';
import { ApiError, api } from '@/lib/api';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useFriends } from '@/stores/friends';
import { useUi } from '@/stores/ui';
import { useUsers } from '@/stores/users';
import { makeMe, makeUser } from '@/test/factories';
import { FriendsPage } from './FriendsPage';
import { HomeSidebar } from './HomeSidebar';

const ada = makeUser({ id: 'ada', displayName: 'Ada', username: 'ada', isContact: true });
const bo = makeUser({ id: 'bo', displayName: 'Bo', username: 'bo', isContact: true });
const cy = makeUser({ id: 'cy', displayName: 'Cy', username: 'cy' });
const dee = makeUser({ id: 'dee', displayName: 'Dee', username: 'dee' });
const eve = makeUser({ id: 'eve', displayName: 'Eve', username: 'eve', isBlocked: true });

const contact = (user: UserPublic): Contact => ({ user, name: null, createdAt: '2026-01-01T00:00:00.000Z' });
const req = (user: UserPublic, direction: FriendRequest['direction']): FriendRequest => ({
  user,
  direction,
  createdAt: '2026-10-01T00:00:00.000Z',
});

let requests: FriendRequests;
let get: MockInstance<typeof api.get>;

function Where() {
  const loc = useLocation();
  return <span data-testid="where">{loc.pathname + loc.search}</span>;
}

function renderPage(entry = '/chats') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route
          path="/chats"
          element={
            <>
              <FriendsPage />
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

const tab = (name: RegExp) => screen.getByRole('tab', { name });

beforeEach(() => {
  resetSessionState();
  vi.restoreAllMocks();
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
  useUi.setState({ toasts: [], dialogs: [] });
  requests = { incoming: [req(cy, 'incoming')], outgoing: [req(dee, 'outgoing')] };
  get = vi.spyOn(api, 'get').mockImplementation((path: string) => {
    const routes: Record<string, unknown> = {
      '/api/contacts': [contact(ada), contact(bo)],
      '/api/blocks': [eve],
      '/api/friends/requests': requests,
    };
    if (!(path in routes)) return Promise.reject(new Error(`unexpected GET ${path}`));
    return Promise.resolve(structuredClone(routes[path]) as never);
  });
  // No socket here: presence comes from the cache below.
  vi.spyOn(useUsers.getState(), 'subscribePresence').mockResolvedValue();
  vi.spyOn(useUsers.getState(), 'unsubscribePresence').mockReturnValue();
});

afterEach(() => vi.restoreAllMocks());

async function ready() {
  await waitFor(() => expect(get).toHaveBeenCalledWith('/api/friends/requests'));
  act(() =>
    useUsers.getState().setPresence({ userId: 'ada', online: true, state: 'online', note: null, lastSeenAt: null }),
  );
}

describe('FriendsPage tabs', () => {
  it('Online shows friends who are online, All every friend, Blocked the blocked users', async () => {
    renderPage();
    await ready();
    expect(tab(/^Online/)).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('Online — 1')).toBeInTheDocument();
    expect(screen.getAllByTestId('friend-row')).toHaveLength(1);
    expect(screen.getByText('Ada')).toBeInTheDocument();

    fireEvent.click(tab(/^All/));
    expect(screen.getByText('All friends — 2')).toBeInTheDocument();
    expect(screen.getAllByTestId('friend-row').map((r) => r.textContent)).toEqual([
      expect.stringContaining('Ada'),
      expect.stringContaining('Bo'),
    ]);

    fireEvent.click(tab(/^Blocked/));
    expect(await screen.findByText('Blocked — 1')).toBeInTheDocument();
    expect(screen.getByTestId('friend-row')).toHaveTextContent('Eve');
    expect(screen.getByTestId('friend-row')).toHaveTextContent('Blocked');
  });

  it('every list has a search box; no match says so', async () => {
    renderPage();
    await ready();
    fireEvent.click(tab(/^All/));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search friends' }), { target: { value: 'bo' } });
    expect(screen.getByText('All friends — 1')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search friends' }), { target: { value: 'zed' } });
    expect(screen.getByText('No one with that name')).toBeInTheDocument();
  });

  it('Pending lists incoming and sent requests, with the incoming count on the tab', async () => {
    renderPage();
    await ready();
    expect(tab(/^Pending/)).toHaveTextContent('Pending1');
    fireEvent.click(tab(/^Pending/));
    const incoming = screen.getByRole('region', { name: 'Incoming friend requests' });
    const sent = screen.getByRole('region', { name: 'Sent friend requests' });
    expect(within(incoming).getByText('Incoming — 1')).toBeInTheDocument();
    expect(within(incoming).getByText('Cy')).toBeInTheDocument();
    expect(within(incoming).getByText('Incoming Friend Request')).toBeInTheDocument();
    expect(within(sent).getByText('Sent — 1')).toBeInTheDocument();
    expect(within(sent).getByText('Dee')).toBeInTheDocument();
    expect(within(sent).queryByRole('button', { name: 'Accept' })).toBeNull();
  });

  it('Accept, Ignore and Cancel call their routes and the rows go', async () => {
    requests = {
      incoming: [req(cy, 'incoming'), req(makeUser({ id: 'fay', displayName: 'Fay' }), 'incoming')],
      outgoing: [req(dee, 'outgoing')],
    };
    const post = vi.spyOn(api, 'post').mockResolvedValue(undefined);
    const del = vi.spyOn(api, 'delete').mockResolvedValue(undefined);
    renderPage('/chats?friends=pending');
    await ready();
    expect(await screen.findByText('Incoming — 2')).toBeInTheDocument();

    const rowOf = (name: string) => screen.getByText(name).closest('[data-testid="pending-row"]') as HTMLElement;
    fireEvent.click(within(rowOf('Cy')).getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/friends/requests/cy/accept'));
    await waitFor(() => expect(screen.queryByText('Cy')).toBeNull());
    expect(useUsers.getState().byId.cy?.isContact).toBe(true);

    fireEvent.click(within(rowOf('Fay')).getByRole('button', { name: 'Ignore' }));
    await waitFor(() => expect(del).toHaveBeenCalledWith('/api/friends/requests/fay'));
    fireEvent.click(within(rowOf('Dee')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(del).toHaveBeenCalledWith('/api/friends/requests/dee'));
    expect(await screen.findByText('No pending friend requests')).toBeInTheDocument();
    expect(tab(/^Pending/)).toHaveTextContent(/^Pending$/);
  });

  it('?friends=pending opens Pending and leaves the URL', async () => {
    renderPage('/chats?friends=pending');
    await ready();
    expect(tab(/^Pending/)).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/chats$/));
  });

  it('Remove Friend asks first, then deletes the friendship', async () => {
    const del = vi.spyOn(api, 'delete').mockResolvedValue(undefined);
    renderPage();
    await ready();
    fireEvent.click(tab(/^All/));
    const row = screen.getAllByTestId('friend-row')[1]!;
    fireEvent.click(within(row).getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove Friend' }));
    const dialog = useUi.getState().dialogs[0]!;
    expect(dialog).toMatchObject({ title: 'Remove ‘Bo’', confirmLabel: 'Remove Friend', danger: true });
    act(() => useUi.getState().closeDialog(dialog.id, 'confirm'));
    await waitFor(() => expect(del).toHaveBeenCalledWith('/api/friends/bo'));
    await waitFor(() => expect(screen.getByText('All friends — 1')).toBeInTheDocument());
  });
});

describe('Add Friend', () => {
  it('sends by username and says so in green', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ status: 'sent' });
    renderPage();
    await ready();
    fireEvent.click(screen.getByTestId('add-friend-tab'));
    expect(screen.getByText('You can add friends with their Enbox username.')).toBeInTheDocument();
    const input = screen.getByTestId('add-friend-input');
    const button = screen.getByRole('button', { name: 'Send Friend Request' });
    expect(button).toBeDisabled();
    fireEvent.change(input, { target: { value: ' @zoe ' } });
    fireEvent.click(button);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/friends/requests', { username: 'zoe' }));
    const result = await screen.findByTestId('add-friend-result');
    expect(result).toHaveTextContent('Success! Your friend request to zoe was sent.');
    expect(result).toHaveClass('text-success');
    expect(input).toHaveValue('');
  });

  it('a request they had sent me first makes us friends', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({ status: 'accepted' });
    renderPage('/chats?friends=add');
    await ready();
    fireEvent.change(screen.getByTestId('add-friend-input'), { target: { value: 'cy' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send Friend Request' }));
    expect(await screen.findByTestId('add-friend-result')).toHaveTextContent('Success! You and cy are now friends.');
  });

  it('shows the server error in red', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(
      new ApiError('not_found', "Hm, didn't work. Double check the username.", 404),
    );
    renderPage('/chats?friends=add');
    await ready();
    fireEvent.change(screen.getByTestId('add-friend-input'), { target: { value: 'nobody' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send Friend Request' }));
    const result = await screen.findByTestId('add-friend-result');
    expect(result).toHaveTextContent("Hm, didn't work. Double check the username.");
    expect(result).toHaveClass('text-danger');
    // Typing again clears it.
    fireEvent.change(screen.getByTestId('add-friend-input'), { target: { value: 'nobody2' } });
    expect(screen.queryByTestId('add-friend-result')).toBeNull();
  });
});

describe('pending badge on Home', () => {
  it('the Friends row shows the incoming count, live', async () => {
    render(
      <MemoryRouter initialEntries={['/chats']}>
        <HomeSidebar />
      </MemoryRouter>,
    );
    const friends = screen.getByRole('link', { name: /^Friends/ });
    expect(friends).not.toHaveTextContent(/\d/);
    act(() => useFriends.setState({ incoming: [{ userId: 'cy', createdAt: '' }, { userId: 'x', createdAt: '' }] }));
    expect(screen.getByRole('link', { name: /^Friends/ })).toHaveTextContent('2');
    expect(screen.getByLabelText('2 pending friend requests')).toBeInTheDocument();
  });
});
