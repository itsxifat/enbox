import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import type { ReactElement } from 'react';
import { api } from '@/lib/api';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useCalls } from '@/stores/calls';
import { useChats } from '@/stores/chats';
import { useUi } from '@/stores/ui';
import { makeChat, makeMe, makeUser } from '@/test/factories';
import { selfCardUser } from './model';
import { ProfileCard } from './ProfileCard';

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

beforeEach(() => {
  resetSessionState();
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
  useUi.setState({ toasts: [], dialogs: [] });
});

describe('ProfileCard: fields', () => {
  it('renders the banner, names, pronouns, state, note, bio, about and member since', () => {
    const { container } = renderCard(<ProfileCard user={bob()} />);
    expect(screen.getByTestId('card-name')).toHaveTextContent('Bobby');
    expect(screen.getByText('~Bob Stone')).toBeInTheDocument();
    expect(screen.getByText(/@bobstone/)).toBeInTheDocument();
    expect(screen.getByTestId('card-pronouns')).toHaveTextContent('he/him');
    expect(screen.getByTestId('card-state')).toHaveTextContent('Idle');
    expect(screen.getByTestId('card-note')).toHaveTextContent('🎧 Focus');
    expect(screen.getByTestId('card-bio')).toHaveTextContent('Climber. Coffee.');
    expect(screen.getByTestId('card-about')).toHaveTextContent('At the gym');
    expect(screen.getByTestId('card-member-since')).toHaveTextContent('January 2025');
    const banner = screen.getByTestId('card-banner');
    expect(banner.querySelector('img')).toHaveAttribute('src', '/uploads/banner.webp');
    expect(banner.style.background).toContain('#112233');
    expect(container.querySelector('[data-presence="idle"]')).toBeInTheDocument();
    // The card is the one place the animated avatar always plays.
    expect(container.querySelector('[data-testid="profile-card"] img')).toBeInTheDocument();
  });

  it('leaves out fields hidden by privacy (null) and falls back to the brand gradient', () => {
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
    expect(container.querySelector('[data-presence]')).toBeNull();
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

  it('lists groups in common and opens one', () => {
    const onNavigate = vi.fn();
    const groups = [makeChat({ id: 'g1', name: 'Hiking' }), makeChat({ id: 'g2', name: 'Work' })];
    const { rerender } = renderCard(
      <ProfileCard user={bob()} commonGroups={null} onNavigate={onNavigate} />,
    );
    expect(screen.queryByTestId('card-common-groups')).toBeNull();
    rerender(
      <MemoryRouter initialEntries={['/contacts']}>
        <Path />
        <ProfileCard user={bob()} commonGroups={groups} onNavigate={onNavigate} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('card-common-groups')).toHaveTextContent('2 groups in common');
    fireEvent.click(screen.getByRole('button', { name: 'Hiking' }));
    expect(onNavigate).toHaveBeenCalled();
    expect(screen.getByTestId('path')).toHaveTextContent('/chats/g1');
  });
});

describe('ProfileCard: actions', () => {
  it('Message opens (creates) the direct chat and navigates to it', async () => {
    const onNavigate = vi.fn();
    const post = vi
      .spyOn(api, 'post')
      .mockResolvedValue(makeChat({ id: 'd1', type: 'direct', name: null, peer: bob() }));
    renderCard(<ProfileCard user={bob()} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Message' }));
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/chats/d1'));
    expect(post).toHaveBeenCalledWith('/api/chats/direct', { userId: 'bob' });
    expect(onNavigate).toHaveBeenCalled();
    expect(useChats.getState().byId.d1).toBeDefined();
  });

  it('offers Edit contact / Add to contacts, Block / Unblock and the full profile link', () => {
    const onEditContact = vi.fn();
    const { rerender } = renderCard(<ProfileCard user={bob()} onEditContact={onEditContact} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit contact' }));
    expect(onEditContact).toHaveBeenCalledWith(expect.objectContaining({ id: 'bob' }));
    expect(screen.getByRole('link', { name: 'View full profile' })).toHaveAttribute(
      'href',
      '/u/bobstone',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Block' }));
    expect(useUi.getState().dialogs).toHaveLength(1);

    rerender(
      <MemoryRouter>
        <ProfileCard
          user={makeUser({ ...bob(), isContact: false, contactName: null, isBlocked: true })}
          onEditContact={onEditContact}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: 'Add to contacts' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unblock' })).toBeInTheDocument();
    // Blocked: no calls.
    expect(screen.queryByRole('button', { name: 'Voice call' })).toBeNull();
  });

  it('call buttons follow the cached direct chat permissions and start a call', async () => {
    const user = bob();
    const chat = makeChat({ id: 'd1', type: 'direct', name: null, peer: user });
    useChats
      .getState()
      .upsertChat({ ...chat, permissions: { ...chat.permissions, canCall: false } });
    const { unmount } = renderCard(<ProfileCard user={user} />);
    expect(screen.queryByRole('button', { name: 'Voice call' })).toBeNull();
    unmount();

    useChats
      .getState()
      .upsertChat({ ...chat, permissions: { ...chat.permissions, canCall: true } });
    const startCall = vi.fn(async () => undefined);
    useCalls.setState({ startCall });
    const onNavigate = vi.fn();
    renderCard(<ProfileCard user={user} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Video call' }));
    await waitFor(() => expect(startCall).toHaveBeenCalledWith('d1', 'video'));
    expect(onNavigate).toHaveBeenCalled();
  });

  it('my own card: availability, custom status and Edit profile', () => {
    const onSetStatus = vi.fn();
    const me = makeMe({
      id: 'me',
      presenceNote: { text: 'Heads down', emoji: '🎧', expiresAt: null },
    });
    renderCard(<ProfileCard user={selfCardUser(me)} self onSetStatus={onSetStatus} />);
    expect(screen.getByRole('button', { name: 'Availability: Online' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Message' })).toBeNull();
    fireEvent.click(screen.getByTestId('set-status'));
    expect(onSetStatus).toHaveBeenCalled();
    expect(screen.getByTestId('set-status')).toHaveTextContent('🎧 Heads down');
    fireEvent.click(screen.getByRole('button', { name: 'Edit profile' }));
    expect(screen.getByTestId('path')).toHaveTextContent('/settings/profile');
  });

  it('preview mode shows no actions; a deleted account shows a notice only', () => {
    const { rerender } = renderCard(<ProfileCard user={selfCardUser(makeMe())} self preview />);
    expect(screen.queryByRole('button')).toBeNull();
    rerender(
      <MemoryRouter>
        <ProfileCard user={makeUser({ isDeleted: true, displayName: 'Gone' })} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('card-name')).toHaveTextContent('Deleted account');
    expect(screen.getByText('This account was deleted.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Message' })).toBeNull();
  });
});
