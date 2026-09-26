/** Settings → Profile → Bio / Pronouns / Profile colours: validation, optimistic save, payloads. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { UpdateProfileRequest, UserSelf } from '@enbox/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { useUi } from '@/stores/ui';
import { makeMe } from '@/test/factories';
import { BioPage } from './BioPage';
import { ColoursPage } from './ColoursPage';
import { PronounsPage } from './PronounsPage';

/** `api.patch` echoes the merged profile (what the server does). */
function mockPatch() {
  return vi.spyOn(api, 'patch').mockImplementation(async (_path: string, body: unknown) => {
    const me = useAuth.getState().user!;
    return { ...me, ...(body as Partial<UserSelf>) } as UserSelf;
  });
}

beforeEach(() => {
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
  useUi.setState({ toasts: [] });
});

const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('BioPage', () => {
  it('saves the trimmed bio (optimistically) and previews it live', async () => {
    const patch = mockPatch();
    wrap(<BioPage />);
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByTestId('bio-input'), {
      target: { value: '  Climber.\nCoffee.  ' },
    });
    expect(screen.getByTestId('card-bio')).toHaveTextContent('Climber. Coffee.');
    fireEvent.click(save);
    // Optimistic: the cached profile changes before the response.
    expect(useAuth.getState().user?.bio).toBe('Climber.\nCoffee.');
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/api/me', { bio: 'Climber.\nCoffee.' }),
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled());
  });

  it('clearing the bio sends an empty string', async () => {
    useAuth.setState({ user: makeMe({ id: 'me', bio: 'Old bio' }) });
    const patch = mockPatch();
    wrap(<BioPage />);
    fireEvent.change(screen.getByTestId('bio-input'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/api/me', { bio: '' }));
    expect(screen.queryByTestId('card-bio')).toBeNull();
  });
});

describe('PronounsPage', () => {
  it('a suggestion fills the field; Save sends it, Remove sends null', async () => {
    const patch = mockPatch();
    wrap(<PronounsPage />);
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'they/them' }));
    expect(screen.getByTestId('pronouns-input')).toHaveValue('they/them');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/api/me', { pronouns: 'they/them' }));
    expect(useAuth.getState().user?.pronouns).toBe('they/them');

    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(patch).toHaveBeenLastCalledWith('/api/me', { pronouns: null }));
    expect(useAuth.getState().user?.pronouns).toBeNull();
  });
});

describe('ColoursPage', () => {
  it('validates hex input, normalises it and saves both colours', async () => {
    const patch = mockPatch();
    wrap(<ColoursPage />);
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    const profile = screen.getByTestId('profile-color-input');
    fireEvent.change(profile, { target: { value: 'blue' } });
    expect(screen.getByText('Use a #rrggbb colour')).toBeInTheDocument();
    expect(save).toBeDisabled();
    fireEvent.change(profile, { target: { value: '#ABCDEF' } });
    expect(screen.queryByText('Use a #rrggbb colour')).toBeNull();
    expect(profile).toHaveValue('#abcdef');
    // The preview follows.
    const banner = screen.getByTestId('card-banner');
    expect(banner.style.background).toContain('#abcdef');
    fireEvent.click(screen.getByRole('group', { name: 'Accent colour presets' }).children[1]!);
    fireEvent.click(save);
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/api/me', {
        profileColor: '#abcdef',
        accentColor: '#0e7fc0',
      }),
    );
    const body = patch.mock.calls[0]![1] as UpdateProfileRequest;
    expect(body.profileColor).toBe('#abcdef');
    expect(useAuth.getState().user?.accentColor).toBe('#0e7fc0');
  });

  it('a valid colour edited into an invalid one blocks Save and leaves the preview', () => {
    mockPatch();
    wrap(<ColoursPage />);
    const save = screen.getByRole('button', { name: 'Save' });
    const profile = screen.getByTestId('profile-color-input');
    fireEvent.change(profile, { target: { value: '#6d5dfc' } });
    expect(save).toBeEnabled();
    expect(screen.getByTestId('card-banner').style.background).toContain('#6d5dfc');
    fireEvent.change(profile, { target: { value: '#6d5df' } });
    expect(screen.getByText('Use a #rrggbb colour')).toBeInTheDocument();
    expect(save).toBeDisabled();
    expect(screen.getByTestId('card-banner').style.background).not.toContain('#6d5dfc');
  });

  it('"Use default" clears both colours', async () => {
    useAuth.setState({
      user: makeMe({ id: 'me', profileColor: '#112233', accentColor: '#445566' }),
    });
    const patch = mockPatch();
    wrap(<ColoursPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Use default' }));
    expect(screen.getByTestId('profile-color-input')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/api/me', { profileColor: null, accentColor: null }),
    );
  });
});
