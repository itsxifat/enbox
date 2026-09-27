import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { useAuth } from '@/stores/auth';
import { makeMe } from '@/test/factories';
import { ProfilePage } from './ProfilePage';

beforeEach(() => {
  useAuth.setState({
    user: makeMe({
      id: 'me',
      username: 'ada',
      displayName: 'Ada Lovelace',
      pronouns: 'she/her',
      bio: 'First programmer.\nLoves engines.',
      profileColor: '#112233',
      accentColor: null,
    }),
    token: 't',
    status: 'authenticated',
  });
});

function renderPage() {
  return render(
    <MemoryRouter>
      <ProfilePage />
    </MemoryRouter>,
  );
}

describe('Settings → Profile', () => {
  it('shows a live preview card of my profile at the top', () => {
    renderPage();
    const preview = screen.getByTestId('profile-preview');
    expect(preview.querySelector('[data-testid="profile-card"]')).toBeInTheDocument();
    expect(preview).toHaveTextContent('Ada Lovelace');
    expect(preview).toHaveTextContent('she/her');
    expect(preview).toHaveTextContent('First programmer.');
    // Preview mode: no actions on the card (the availability picker lives on the real card).
    expect(preview.querySelector('[data-testid="availability-picker"]')).toBeNull();
    const banner = preview.querySelector<HTMLElement>('[data-testid="card-banner"]');
    expect(banner?.style.background).toContain('#112233');
  });

  it('mounts the banner and photo editors', () => {
    renderPage();
    expect(screen.getByRole('button', { name: 'Add banner' })).toBeInTheDocument();
    expect(screen.getByTestId('banner-file-input')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add profile photo' })).toBeInTheDocument();
    expect(screen.getByTestId('avatar-file-input')).toBeInTheDocument();
  });

  it('has rows for pronouns, bio and colours that link to their pages', () => {
    renderPage();
    expect(screen.getByTestId('profile-pronouns')).toHaveAttribute(
      'href',
      '/settings/profile/pronouns',
    );
    expect(screen.getByTestId('profile-pronouns')).toHaveTextContent('she/her');
    expect(screen.getByTestId('profile-bio')).toHaveAttribute('href', '/settings/profile/bio');
    expect(screen.getByTestId('profile-bio')).toHaveTextContent('First programmer.');
    expect(screen.getByTestId('profile-colours')).toHaveAttribute(
      'href',
      '/settings/profile/colours',
    );
    expect(screen.getByTestId('profile-colours')).toHaveTextContent('#112233');
    expect(screen.getByTestId('profile-colours')).toHaveTextContent('Default');
    // The existing rows stay (settings.spec.ts relies on them).
    expect(screen.getByTestId('profile-name')).toHaveTextContent('Ada Lovelace');
    expect(screen.getByTestId('profile-about')).toHaveAttribute('href', '/settings/profile/about');
    expect(screen.getByTestId('profile-username')).toHaveTextContent('@ada');
    expect(screen.getByTestId('profile-phone')).toHaveTextContent('Not added');
  });

  it('shows placeholders when the new fields are unset', () => {
    useAuth.setState({ user: makeMe({ id: 'me' }) });
    renderPage();
    expect(screen.getByTestId('profile-pronouns')).toHaveTextContent('Add your pronouns');
    expect(screen.getByTestId('profile-bio')).toHaveTextContent('Tell people about yourself');
    expect(screen.getByTestId('profile-colours')).toHaveTextContent('Default');
  });
});
