import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import type { ReactElement } from 'react';
import type { SpaceMember, UserProfile } from '@enbox/shared';
import type * as Cosmetics from '@/components/cosmetics';
import { api } from '@/lib/api';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useCalls } from '@/stores/calls';
import { useChats } from '@/stores/chats';
import { useSpaces } from '@/stores/spaces';
import { useUi } from '@/stores/ui';
import { makeSpace } from '@/features/spaces/testUtils';
import { makeChat, makeMe, makeMessage, makeUser } from '@/test/factories';
import { selfCardUser } from './model';
import { ProfileCard } from './ProfileCard';
import { useProfiles } from './profileStore';

// The effect art lands separately: render what the card asks of it.
vi.mock('@/components/cosmetics', async (importOriginal) => ({
  ...(await importOriginal<typeof Cosmetics>()),
  ProfileEffect: ({ id, play, replayKey }: { id?: string | null; play?: string; replayKey?: number }) =>
    id ? <div data-testid="profile-effect" data-id={id} data-play={play} data-replay={replayKey} /> : null,
}));

function Path() {
  return <p data-testid="path">{useLocation().pathname}</p>;
}

function renderCard(ui: ReactElement) {
  return render(
    <MemoryRouter initialEntries={['/contacts']}>
      <Path />
      <Routes>
        <Route path="*" element={ui} />
      </Routes>
    </MemoryRouter>,
  );
}

const bob = () =>
  makeUser({
    id: 'bob',
    username: 'bobstone',
    displayName: 'Bob Stone',
    contactName: 'Bobby',
    pronouns: 'he/him',
    bio: 'Climber.\nCoffee.',
    about: 'At the gym',
    bannerUrl: '/uploads/banner.webp',
    profileColor: '#112233',
    accentColor: '#445566',
    online: true,
    presenceState: 'idle',
    presenceNote: { text: 'Focus', emoji: '🎧', expiresAt: null },
    createdAt: '2025-01-15T00:00:00.000Z',
    isContact: true,
  });

const profileOf = (p: Partial<UserProfile> = {}): UserProfile => ({
  user: bob(),
  mutualSpaces: [],
  mutualFriends: [],
  mutualGroupCount: 0,
  note: null,
  ...p,
});

const openMore = () => fireEvent.click(screen.getByRole('button', { name: 'More' }));

beforeEach(() => {
  resetSessionState();
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
  useUi.setState({ toasts: [], dialogs: [] });
});

describe('ProfileCard: fields', () => {
  it('renders the banner, names, pronouns, state, status, bio, about, badges and member since', () => {
    const { container } = renderCard(<ProfileCard user={bob()} />);
    expect(screen.getByTestId('card-name')).toHaveTextContent('Bobby');
    expect(screen.getByText('~Bob Stone')).toBeInTheDocument();
    expect(screen.getByText('@bobstone')).toBeInTheDocument();
    expect(screen.getByTestId('card-pronouns')).toHaveTextContent('he/him');
    expect(screen.getByTestId('card-state')).toHaveTextContent('Idle');
    expect(screen.getByTestId('card-note')).toHaveTextContent('🎧 Focus');
    expect(screen.getByTestId('card-bio')).toHaveTextContent(/Climber\.\s*Coffee\./);
    expect(screen.getByTestId('card-about')).toHaveTextContent('At the gym');
    expect(screen.getByTestId('card-member-since')).toHaveTextContent('Jan 15, 2025');
    const badges = within(screen.getByTestId('badge-row'));
    expect(badges.getByRole('img', { name: 'Early Member' })).toBeInTheDocument();
    expect(badges.getByRole('img', { name: /^Supporter/ })).toBeInTheDocument();
    const banner = screen.getByTestId('card-banner');
    expect(banner.querySelector('img')).toHaveAttribute('src', '/uploads/banner.webp');
    expect(banner.style.background).toBe('rgb(17, 34, 51)');
    expect(banner.style.height).toBe('105px');
    expect(container.querySelector('[data-presence="idle"]')).toBeInTheDocument();
    // The card is the one place the animated avatar always plays.
    expect(container.querySelector('[data-testid="profile-card"] img')).toBeInTheDocument();
  });

  it('leaves out fields hidden by privacy (null) and falls back to the brand colour', () => {
    const { container } = renderCard(
      <ProfileCard
        user={makeUser({ id: 'u', displayName: 'Quiet Person', online: null, about: null })}
      />,
    );
    expect(screen.getByTestId('card-name')).toHaveTextContent('Quiet Person');
    expect(screen.queryByTestId('card-pronouns')).toBeNull();
    expect(screen.queryByTestId('card-bio')).toBeNull();
    expect(screen.queryByTestId('card-about')).toBeNull();
    expect(screen.queryByTestId('card-note')).toBeNull();
    expect(screen.queryByTestId('card-state')).toBeNull();
    expect(screen.getByTestId('card-banner').querySelector('img')).toBeNull();
    expect(screen.getByTestId('card-banner').style.background).toContain('var(--brand)');
    // No banner and no theme: the short header.
    expect(screen.getByTestId('card-banner').style.height).toBe('60px');
    expect(container.querySelector('[data-presence]')).toBeNull();
    expect(screen.getByTestId('profile-card')).not.toHaveAttribute('data-themed');
  });

  it('themes the surface from the profile colours with contrasting ink', () => {
    const { rerender } = renderCard(<ProfileCard user={bob()} />);
    const card = screen.getByTestId('profile-card');
    expect(card).toHaveAttribute('data-themed', 'light');
    expect(card.style.background).toContain('linear-gradient');
    expect(card.style.getPropertyValue('--fg')).toBe('#ffffff');
    rerender(
      <MemoryRouter>
        <ProfileCard user={makeUser({ id: 'sun', profileColor: '#ffe680', accentColor: '#fff4c2' })} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('profile-card')).toHaveAttribute('data-themed', 'dark');
    expect(screen.getByTestId('profile-card').style.getPropertyValue('--fg')).toBe('#060607');
  });

  it('renders the bio as markdown', () => {
    renderCard(<ProfileCard user={makeUser({ bio: 'I **love** `code`' })} />);
    const bio = screen.getByTestId('card-bio');
    expect(bio.querySelector('strong')).toHaveTextContent('love');
    expect(bio.querySelector('code')).toHaveTextContent('code');
  });

  it('prefers the live presence over the cached profile fields', () => {
    const { container } = renderCard(
      <ProfileCard
        user={bob()}
        presence={{ userId: 'bob', online: true, state: 'dnd', note: null, lastSeenAt: null }}
      />,
    );
    expect(screen.getByTestId('card-state')).toHaveTextContent('Do not disturb');
    expect(screen.queryByTestId('card-note')).toBeNull();
    expect(container.querySelector('[data-presence="dnd"]')).toBeInTheDocument();
  });

  it('hides an expired note', () => {
    renderCard(
      <ProfileCard
        user={makeUser({
          presenceNote: { text: 'Lunch', emoji: null, expiresAt: '2000-01-01T00:00:00.000Z' },
        })}
      />,
    );
    expect(screen.queryByTestId('card-note')).toBeNull();
  });

  it('plays the profile effect once on open and again on hover', () => {
    renderCard(<ProfileCard user={makeUser({ profileEffect: 'snowfall' })} />);
    const effect = screen.getByTestId('profile-effect');
    expect(effect).toHaveAttribute('data-play', 'once');
    expect(effect).toHaveAttribute('data-replay', '0');
    fireEvent.pointerEnter(screen.getByTestId('profile-card'));
    expect(screen.getByTestId('profile-effect')).toHaveAttribute('data-replay', '1');
  });

  it('shows the mutuals line and opens the matching full profile tab', () => {
    const onOpenFull = vi.fn();
    renderCard(
      <ProfileCard
        user={bob()}
        profile={profileOf({
          mutualFriends: [makeUser({ id: 'f1' }), makeUser({ id: 'f2' })],
          mutualSpaces: [{ id: 's1', name: 'Climbers', iconUrl: null, nickname: null }],
        })}
        onOpenFull={onOpenFull}
      />,
    );
    const line = screen.getByTestId('card-mutuals');
    expect(line).toHaveTextContent('2 Mutual Friends');
    expect(line).toHaveTextContent('1 Mutual Space');
    fireEvent.click(screen.getByRole('button', { name: '1 Mutual Space' }));
    expect(onOpenFull).toHaveBeenCalledWith('spaces');
  });
});

describe('ProfileCard: Space context', () => {
  const member = (p: Partial<SpaceMember> = {}): SpaceMember => ({
    userId: 'bob',
    nickname: 'Boulder Bob',
    roleIds: ['mod', 'crew'],
    joinedAt: '2026-02-03T00:00:00.000Z',
    timedOutUntil: null,
    serverMute: false,
    serverDeaf: false,
    ...p,
  });
  const seed = (m: SpaceMember, opts: { owner?: boolean } = {}) =>
    useSpaces.setState({
      byId: {
        s1: makeSpace({
          id: 's1',
          name: 'Climbers',
          ownerId: opts.owner ? 'me' : 'bob',
          owner: opts.owner,
          roles: [
            { id: 'everyone', name: '@everyone', color: null, position: 0, permissions: 0, hoist: false, mentionable: false, isDefault: true },
            { id: 'crew', name: 'Crew', color: '#22aa66', position: 1, permissions: 0, hoist: false, mentionable: false, isDefault: false },
            { id: 'mod', name: 'Mods', color: '#aa2266', position: 2, permissions: 0, hoist: true, mentionable: false, isDefault: false },
          ],
        }),
      },
      members: { s1: { bob: m } },
    });

  it('shows the nickname, roles (highest first), the owner crown and both join dates', () => {
    seed(member());
    renderCard(<ProfileCard user={bob()} spaceId="s1" />);
    expect(screen.getByTestId('card-name')).toHaveTextContent('Boulder Bob');
    expect(screen.getByText('~Bob Stone')).toBeInTheDocument();
    const roles = within(screen.getByTestId('card-roles'));
    expect(roles.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Mods', 'Crew']);
    // Without MANAGE_ROLES: no ×, no +.
    expect(roles.queryByRole('button')).toBeNull();
    expect(screen.getByRole('img', { name: 'Space Owner' })).toBeInTheDocument();
    expect(screen.getByTestId('card-member-since')).toHaveTextContent('Jan 15, 2025');
    expect(screen.getByTestId('card-space-joined')).toHaveTextContent('Feb 3, 2026');
  });

  it('per-Space overrides win; "View Main Profile" switches back', () => {
    seed(member({ bio: 'Space bio', pronouns: 'they/them', profileColor: '#ffe680', bannerUrl: '/uploads/space-banner.webp' }));
    renderCard(<ProfileCard user={bob()} spaceId="s1" />);
    expect(screen.getByTestId('card-bio')).toHaveTextContent('Space bio');
    expect(screen.getByTestId('card-pronouns')).toHaveTextContent('they/them');
    expect(screen.getByTestId('card-banner').querySelector('img')).toHaveAttribute('src', '/uploads/space-banner.webp');
    expect(screen.getByTestId('profile-card')).toHaveAttribute('data-themed', 'dark');

    fireEvent.click(screen.getByRole('button', { name: 'View Main Profile' }));
    expect(screen.getByTestId('card-bio')).toHaveTextContent(/Climber/);
    expect(screen.getByTestId('card-pronouns')).toHaveTextContent('he/him');
    expect(screen.getByTestId('card-name')).toHaveTextContent('Bobby');
    expect(screen.getByTestId('profile-card')).toHaveAttribute('data-themed', 'light');
    fireEvent.click(screen.getByRole('button', { name: 'View Space Profile' }));
    expect(screen.getByTestId('card-bio')).toHaveTextContent('Space bio');
  });

  it('no overrides: no toggle', () => {
    seed(member());
    renderCard(<ProfileCard user={bob()} spaceId="s1" />);
    expect(screen.queryByRole('button', { name: 'View Main Profile' })).toBeNull();
  });

  it('with MANAGE_ROLES, roles below mine can be removed and added', async () => {
    seed(member({ roleIds: ['crew'] }), { owner: true });
    const put = vi.spyOn(api, 'put').mockResolvedValue(member({ roleIds: ['crew', 'mod'] }));
    const del = vi.spyOn(api, 'delete').mockResolvedValue(member({ roleIds: [] }));
    renderCard(<ProfileCard user={bob()} spaceId="s1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Add role' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Mods' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/api/spaces/s1/members/bob/roles/mod'));
    await waitFor(() =>
      expect(within(screen.getByTestId('card-roles')).getAllByRole('listitem')[0]).toHaveTextContent('Mods'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove role Crew' }));
    await waitFor(() => expect(del).toHaveBeenCalledWith('/api/spaces/s1/members/bob/roles/crew'));
  });
});

describe('ProfileCard: actions', () => {
  it('"Message @name" opens (creates) the direct chat, sends the text and goes there', async () => {
    const onNavigate = vi.fn();
    const post = vi.spyOn(api, 'post').mockImplementation(async (path: string, body?: unknown) => {
      if (path === '/api/chats/direct')
        return makeChat({ id: 'd1', type: 'direct', name: null, peer: bob() });
      return makeMessage({ chatId: 'd1', text: (body as { text: string }).text });
    });
    renderCard(<ProfileCard user={bob()} onNavigate={onNavigate} />);
    const input = screen.getByRole('textbox', { name: 'Message @Bobby' });
    fireEvent.change(input, { target: { value: '  See you at the wall  ' } });
    fireEvent.submit(input);
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/chats/d1'));
    expect(post).toHaveBeenCalledWith('/api/chats/direct', { userId: 'bob' });
    expect(post).toHaveBeenCalledWith(
      '/api/chats/d1/messages',
      expect.objectContaining({ type: 'text', text: 'See you at the wall' }),
    );
    expect(onNavigate).toHaveBeenCalled();
    expect(useChats.getState().byId.d1).toBeDefined();
  });

  it('Enter on an empty message field only opens the chat', async () => {
    const post = vi
      .spyOn(api, 'post')
      .mockResolvedValue(makeChat({ id: 'd1', type: 'direct', name: null, peer: bob() }));
    renderCard(<ProfileCard user={bob()} />);
    fireEvent.submit(screen.getByRole('textbox', { name: 'Message @Bobby' }));
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/chats/d1'));
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('where I may not send (I blocked them) the text is not sent; the chat still opens', async () => {
    const chat = makeChat({ id: 'd1', type: 'direct', name: null, peer: bob() });
    const post = vi
      .spyOn(api, 'post')
      .mockResolvedValue({ ...chat, permissions: { ...chat.permissions, canSend: false } });
    renderCard(<ProfileCard user={{ ...bob(), isBlocked: true }} />);
    const input = screen.getByRole('textbox', { name: 'Message @Bobby' });
    fireEvent.change(input, { target: { value: 'Hello?' } });
    fireEvent.submit(input);
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/chats/d1'));
    expect(post).toHaveBeenCalledTimes(1);
    expect(useUi.getState().toasts.at(-1)).toMatchObject({ message: 'Unblock them to send a message.' });
  });

  it('the "..." menu: full profile, contact, copy username / id, block / unblock', async () => {
    const onEditContact = vi.fn();
    const onOpenFull = vi.fn();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { rerender } = renderCard(
      <ProfileCard user={bob()} onEditContact={onEditContact} onOpenFull={onOpenFull} />,
    );
    openMore();
    fireEvent.click(screen.getByRole('menuitem', { name: 'View Full Profile' }));
    expect(onOpenFull).toHaveBeenCalled();
    openMore();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit contact' }));
    expect(onEditContact).toHaveBeenCalledWith(expect.objectContaining({ id: 'bob' }));
    openMore();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy Username' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('bobstone'));
    openMore();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy User ID' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('bob'));
    openMore();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Block' }));
    expect(useUi.getState().dialogs).toHaveLength(1);

    rerender(
      <MemoryRouter>
        <ProfileCard
          user={makeUser({ ...bob(), isContact: false, contactName: null, isBlocked: true })}
          onEditContact={onEditContact}
        />
      </MemoryRouter>,
    );
    // Not a contact: a quick "Add to contacts" button on the banner too.
    expect(screen.getByRole('button', { name: 'Add to contacts' })).toBeInTheDocument();
    openMore();
    expect(screen.getByRole('menuitem', { name: 'Unblock' })).toBeInTheDocument();
    // Blocked: no calls.
    expect(screen.queryByRole('menuitem', { name: 'Voice call' })).toBeNull();
  });

  it('calls follow the cached direct chat permissions and start a call', async () => {
    const user = bob();
    const chat = makeChat({ id: 'd1', type: 'direct', name: null, peer: user });
    useChats
      .getState()
      .upsertChat({ ...chat, permissions: { ...chat.permissions, canCall: false } });
    const { unmount } = renderCard(<ProfileCard user={user} />);
    openMore();
    expect(screen.queryByRole('menuitem', { name: 'Voice call' })).toBeNull();
    unmount();

    useChats
      .getState()
      .upsertChat({ ...chat, permissions: { ...chat.permissions, canCall: true } });
    const startCall = vi.fn(async () => undefined);
    useCalls.setState({ startCall });
    const onNavigate = vi.fn();
    renderCard(<ProfileCard user={user} onNavigate={onNavigate} />);
    openMore();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Video call' }));
    await waitFor(() => expect(startCall).toHaveBeenCalledWith('d1', 'video'));
    expect(onNavigate).toHaveBeenCalled();
  });

  it('the avatar opens the full profile', () => {
    const onOpenFull = vi.fn();
    renderCard(<ProfileCard user={bob()} onOpenFull={onOpenFull} />);
    fireEvent.click(screen.getByRole('button', { name: 'View full profile of Bobby' }));
    expect(onOpenFull).toHaveBeenCalled();
  });

  it('my private note: shows the saved one, saves on blur (optimistic) and rolls back on error', async () => {
    useProfiles.setState({ notes: { bob: 'Met at the gym' } });
    const put = vi.spyOn(api, 'put').mockResolvedValueOnce({ note: 'Owes me lunch' });
    renderCard(<ProfileCard user={bob()} />);
    const field = screen.getByRole('textbox', { name: 'Note' });
    expect(field).toHaveValue('Met at the gym');
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: 'Owes me lunch ' } });
    fireEvent.blur(field);
    expect(useProfiles.getState().notes.bob).toBe('Owes me lunch');
    expect(put).toHaveBeenCalledWith('/api/users/bob/note', { note: 'Owes me lunch' });
    await waitFor(() => expect(useProfiles.getState().notes.bob).toBe('Owes me lunch'));

    put.mockRejectedValueOnce(new Error('nope'));
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: '' } });
    fireEvent.blur(field);
    expect(useProfiles.getState().notes.bob).toBeNull();
    await waitFor(() => expect(useProfiles.getState().notes.bob).toBe('Owes me lunch'));
    await waitFor(() => expect(field).toHaveValue('Owes me lunch'));
    expect(useUi.getState().toasts.length).toBeGreaterThan(0);
  });

  it('a note typed when the card closes without a blur is still saved', async () => {
    const put = vi.spyOn(api, 'put').mockResolvedValue({ note: 'Climbs 7a' });
    const { unmount } = renderCard(<ProfileCard user={bob()} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), { target: { value: 'Climbs 7a' } });
    act(() => unmount());
    await waitFor(() => expect(put).toHaveBeenCalledWith('/api/users/bob/note', { note: 'Climbs 7a' }));
  });

  it('my own card: availability, custom status and Edit profile', () => {
    const onSetStatus = vi.fn();
    const me = makeMe({
      id: 'me',
      presenceNote: { text: 'Heads down', emoji: '🎧', expiresAt: null },
    });
    renderCard(<ProfileCard user={selfCardUser(me)} self onSetStatus={onSetStatus} />);
    expect(screen.getByRole('button', { name: 'Availability: Online' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /^Message/ })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Note' })).toBeNull();
    fireEvent.click(screen.getByTestId('set-status'));
    expect(onSetStatus).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('set-status')).toHaveTextContent('🎧 Heads down');
    // The status bubble edits it too.
    fireEvent.click(screen.getByRole('button', { name: 'Edit custom status: 🎧 Heads down' }));
    expect(onSetStatus).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'Edit profile' }));
    expect(screen.getByTestId('path')).toHaveTextContent('/settings/profile');
  });

  it('preview mode shows no actions and loops the effect; a deleted account shows a notice only', () => {
    const { rerender } = renderCard(
      <ProfileCard user={{ ...selfCardUser(makeMe()), profileEffect: 'confetti', avatarDecoration: 'halo' }} self preview />,
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByTestId('profile-effect')).toHaveAttribute('data-play', 'loop');
    rerender(
      <MemoryRouter>
        <ProfileCard user={makeUser({ isDeleted: true, displayName: 'Gone' })} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('card-name')).toHaveTextContent('Deleted account');
    expect(screen.getByText('This account was deleted.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
  });
});
