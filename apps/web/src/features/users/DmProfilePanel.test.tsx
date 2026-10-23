/**
 * The DM profile panel and the DM header's toolbar: the person (name, username, pronouns, About
 * Me, Member Since), Mutual Spaces and Mutual Friends that expand, my note, View Full Profile;
 * the "Show User Profile" toggle (remembered on the device) and when the panel stays hidden.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { ChatSummary, UserProfile } from '@enbox/shared';
import { ConversationHeader } from '@/features/conversation/ConversationHeader';
import { useFullProfileRequest } from '@/features/profile/open';
import { api } from '@/lib/api';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useSidePanel } from '@/stores/sidePanel';
import { useUsers } from '@/stores/users';
import { makeChat, makeMe, makeUser } from '@/test/factories';
import { DmProfileDock } from './DmProfilePanel';
import { useDmProfilePanel } from './profilePanel';

// Desktop and wide: every media query matches.
window.matchMedia = (query: string): MediaQueryList =>
  ({
    matches: true,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }) as MediaQueryList;
vi.mock('@/features/conversation/pins/PinsPopout', () => ({ PinsButton: () => null }));
vi.mock('@/features/search/HeaderSearch', () => ({ HeaderSearch: () => null }));
vi.mock('@/features/inbox/InboxButton', () => ({ InboxButton: () => null }));

const ann = makeUser({
  id: 'ann',
  username: 'ann',
  displayName: 'Ann',
  pronouns: 'she/her',
  bio: 'Climbs things',
  isContact: true,
  createdAt: '2025-01-15T00:00:00.000Z',
});
const bo = makeUser({ id: 'bo', username: 'bo', displayName: 'Bo' });
const profile: UserProfile = {
  user: ann,
  mutualSpaces: [{ id: 'sp1', name: 'Climbers', iconUrl: null, nickname: 'Boulder Ann' }],
  mutualFriends: [bo],
  mutualGroupCount: 0,
  note: 'Met at the gym',
};
const dm = (p: Partial<ChatSummary> = {}) =>
  makeChat({ id: 'd1', type: 'direct', name: null, peer: ann, memberCount: 2, ...p });

function renderDock(chat: ChatSummary) {
  useChats.getState().upsertChat(chat);
  return render(
    <MemoryRouter>
      <DmProfileDock chat={chat} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  resetSessionState();
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
  useUsers.getState().upsertUsers([ann, bo]);
  useDmProfilePanel.setState({ open: true });
  vi.spyOn(useUsers.getState(), 'subscribePresence').mockResolvedValue();
  vi.spyOn(useUsers.getState(), 'unsubscribePresence').mockReturnValue();
  vi.spyOn(api, 'get').mockImplementation(async (path: string) =>
    path === '/api/users/ann/profile' ? profile : [],
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  useSidePanel.setState({ panel: null });
});

describe('the DM profile panel', () => {
  it('shows the person, About Me and Member Since, and my note', async () => {
    renderDock(dm());
    const panel = screen.getByRole('complementary', { name: "Ann's profile" });
    expect(within(panel).getByTestId('dm-profile-name')).toHaveTextContent('Ann');
    expect(panel).toHaveTextContent('ann • she/her');
    expect(within(panel).getByTestId('dm-profile-bio')).toHaveTextContent('Climbs things');
    expect(within(panel).getByTestId('card-member-since')).toHaveTextContent('Member Since');
    await waitFor(() => expect(within(panel).getByLabelText('Note')).toHaveValue('Met at the gym'));
  });

  it('Mutual Spaces and Mutual Friends show their counts and expand into lists', async () => {
    renderDock(dm());
    const spaces = await screen.findByRole('button', { name: 'Mutual Spaces — 1' });
    expect(spaces).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(spaces);
    expect(
      within(screen.getByRole('list', { name: 'Mutual Spaces' })).getByText('Climbers'),
    ).toBeInTheDocument();
    expect(screen.getByText('Boulder Ann')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mutual Friends — 1' }));
    expect(
      within(screen.getByRole('list', { name: 'Mutual Friends' })).getByText('Bo'),
    ).toBeInTheDocument();
    // One list open at a time.
    expect(screen.queryByRole('list', { name: 'Mutual Spaces' })).toBeNull();
  });

  it('View Full Profile opens the full profile', () => {
    renderDock(dm());
    fireEvent.click(screen.getByRole('button', { name: 'View Full Profile' }));
    expect(useFullProfileRequest.getState().req).toEqual({ userId: 'ann' });
  });

  it('stays hidden when toggled off, while search results are open, and outside one-to-one DMs', () => {
    useDmProfilePanel.setState({ open: false });
    const { unmount } = renderDock(dm());
    expect(screen.queryByTestId('dm-profile-panel')).toBeNull();
    unmount();
    useDmProfilePanel.setState({ open: true });
    useSidePanel.setState({
      panel: { kind: 'search', scope: { kind: 'chat', chatId: 'd1' }, query: 'x' },
    });
    const second = renderDock(dm());
    expect(screen.queryByTestId('dm-profile-panel')).toBeNull();
    second.unmount();
    useSidePanel.setState({ panel: null });
    renderDock(makeChat({ id: 'g1', type: 'group', isGroupDm: true }));
    expect(screen.queryByTestId('dm-profile-panel')).toBeNull();
  });
});

describe('the DM header toolbar', () => {
  function renderHeader(chat: ChatSummary) {
    useChats.getState().upsertChat(chat);
    return render(
      <MemoryRouter initialEntries={[`/chats/${chat.id}`]}>
        <ConversationHeader chat={chat} onOpenInfo={() => undefined} />
      </MemoryRouter>,
    );
  }

  it('Start Voice Call, Start Video Call and Show User Profile, which is remembered', () => {
    renderHeader(dm());
    expect(screen.getByRole('button', { name: 'Start Voice Call' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start Video Call' })).toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: 'Hide User Profile' });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    act(() => fireEvent.click(toggle));
    expect(useDmProfilePanel.getState().open).toBe(false);
    expect(localStorage.getItem('enbox.dmProfilePanel')).toBe('0');
    expect(screen.getByRole('button', { name: 'Show User Profile' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('no profile toggle in a group DM or a DM with myself', () => {
    const { unmount } = renderHeader(makeChat({ id: 'g1', type: 'group', isGroupDm: true }));
    expect(screen.queryByRole('button', { name: /User Profile/ })).toBeNull();
    unmount();
    renderHeader(
      dm({ id: 'self', peer: makeUser({ id: 'me', username: 'me', displayName: 'Me' }) }),
    );
    expect(screen.queryByRole('button', { name: /User Profile/ })).toBeNull();
  });
});
