/** Settings → Profiles: the two-column editor, its draft, the pickers and the unsaved guard. */
import type * as Cosmetics from '@/components/cosmetics';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import type { UserSelf } from '@enbox/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { useSpaces } from '@/stores/spaces';
import { useUi } from '@/stores/ui';
import { makeSpace } from '@/features/spaces/testUtils';
import { makeMe } from '@/test/factories';
import { ProfilePage } from './ProfilePage';

// The per-Space editor is its own stream; here it only has to be embedded for the picked Space.
vi.mock('@/features/spaces/serverProfile/ServerProfileEditor', () => ({
  ServerProfileEditor: ({ spaceId }: { spaceId: string }) => (
    <div data-testid="server-profile-editor" data-space-id={spaceId} />
  ),
}));

// Effects are drawn by the cosmetics stream; a marker shows which one plays and how.
vi.mock('@/components/cosmetics', async (importOriginal) => {
  const actual = await importOriginal<typeof Cosmetics>();
  return {
    ...actual,
    ProfileEffect: ({ id, play }: { id: string | null | undefined; play?: string }) =>
      id ? <span data-testid="profile-effect" data-effect={id} data-play={play} /> : null,
  };
});

/** `api.patch` echoes the merged profile (what the server does). */
function mockPatch() {
  return vi.spyOn(api, 'patch').mockImplementation(async (_path: string, body: unknown) => {
    const me = useAuth.getState().user!;
    return { ...me, ...(body as Partial<UserSelf>) } as UserSelf;
  });
}

beforeEach(() => {
  useAuth.setState({
    user: makeMe({
      id: 'me',
      username: 'ada',
      displayName: 'Ada Lovelace',
      pronouns: 'she/her',
      bio: 'First programmer.',
      profileColor: '#112233',
      accentColor: null,
    }),
    token: 't',
    status: 'authenticated',
  });
  useUi.setState({ toasts: [] });
  useSpaces.setState({ byId: {}, order: [], loaded: true });
});

function renderPage() {
  const router = createMemoryRouter(
    [
      { path: '/settings/profile', element: <ProfilePage /> },
      { path: '/settings/profile/about', element: <p>About page</p> },
      { path: '/collectibles', element: <p>Collectibles route</p> },
    ],
    { initialEntries: ['/settings/profile'] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

const bar = () => screen.queryByRole('region', { name: 'Unsaved changes' });
const saveButton = () => screen.getByRole('button', { name: 'Save Changes' });

describe('Settings → Profiles', () => {
  it('has Main and Per-server tabs and a live preview fed by the draft', () => {
    renderPage();
    expect(screen.getByRole('tab', { name: 'Main Profile' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: 'Per-server Profiles' })).toBeInTheDocument();
    const preview = screen.getByTestId('profile-preview');
    expect(preview.querySelector('[data-testid="profile-card"]')).toBeInTheDocument();
    expect(preview).toHaveTextContent('Ada Lovelace');
    expect(preview).toHaveTextContent('First programmer.');
    expect(screen.getByTestId('sample-message')).toHaveTextContent('Ada Lovelace');
    expect(screen.getByTestId('sample-member')).toHaveTextContent('Ada Lovelace');
    expect(bar()).toBeNull();

    fireEvent.change(screen.getByTestId('display-name-input'), { target: { value: 'Countess' } });
    expect(screen.getByTestId('profile-preview')).toHaveTextContent('Countess');
    expect(screen.getByTestId('sample-message')).toHaveTextContent('Countess');
    expect(bar()).toBeInTheDocument();
  });

  it('shows a live n/190 counter for About Me', () => {
    renderPage();
    expect(screen.getByTestId('bio-counter')).toHaveTextContent('17/190');
    fireEvent.change(screen.getByTestId('bio-input'), { target: { value: 'Hi' } });
    expect(screen.getByTestId('bio-counter')).toHaveTextContent('2/190');
    expect(screen.getByTestId('profile-preview')).toHaveTextContent('Hi');
  });

  it('saves nothing until Save Changes, then sends one PATCH with only the changed fields', async () => {
    const patch = mockPatch();
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'they/them' }));
    fireEvent.change(screen.getByTestId('bio-input'), { target: { value: '  Engines.  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change Decoration' }));
    const picker = screen.getByRole('dialog', { name: 'Choose an Avatar Decoration' });
    fireEvent.click(within(picker).getByRole('radio', { name: 'Orbit' }));
    fireEvent.click(within(picker).getByRole('button', { name: 'Apply' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('decoration-field-current')).toHaveTextContent('Orbit');
    expect(patch).not.toHaveBeenCalled();

    fireEvent.click(saveButton());
    await waitFor(() => expect(bar()).toBeNull());
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith('/api/me', {
      pronouns: 'they/them',
      bio: 'Engines.',
      avatarDecoration: 'orbit',
    });
    expect(useAuth.getState().user).toMatchObject({
      pronouns: 'they/them',
      avatarDecoration: 'orbit',
    });
    expect(useUi.getState().toasts.at(-1)?.message).toBe('Profile saved');
  });

  it('a cleared display name falls back to the username', async () => {
    const patch = mockPatch();
    renderPage();
    const input = screen.getByTestId('display-name-input');
    expect(input).toHaveAttribute('placeholder', 'ada');
    fireEvent.change(input, { target: { value: '' } });
    expect(screen.getByTestId('sample-message')).toHaveTextContent('ada');
    fireEvent.click(saveButton());
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/api/me', { displayName: 'ada' }));
  });

  it('Reset throws the draft away', () => {
    const patch = mockPatch();
    renderPage();
    fireEvent.change(screen.getByTestId('pronouns-input'), { target: { value: 'any pronouns' } });
    fireEvent.click(within(bar()!).getByRole('button', { name: 'Reset' }));
    expect(bar()).toBeNull();
    expect(screen.getByTestId('pronouns-input')).toHaveValue('she/her');
    expect(patch).not.toHaveBeenCalled();
  });

  it('effect and nameplate pickers return their choice to the draft and preview', async () => {
    const patch = mockPatch();
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Change Effect' }));
    let picker = screen.getByRole('dialog', { name: 'Choose a Profile Effect' });
    fireEvent.click(within(picker).getByRole('radio', { name: 'Aurora' }));
    fireEvent.click(within(picker).getByRole('button', { name: 'Apply' }));
    const effect = within(screen.getByTestId('profile-preview')).getByTestId('profile-effect');
    expect(effect).toHaveAttribute('data-effect', 'aurora');
    expect(effect).toHaveAttribute('data-play', 'loop');

    fireEvent.click(screen.getByRole('button', { name: 'Change Nameplate' }));
    picker = screen.getByRole('dialog', { name: 'Choose a Nameplate' });
    fireEvent.click(within(picker).getByRole('radio', { name: 'Galaxy' }));
    fireEvent.click(within(picker).getByRole('button', { name: 'Apply' }));
    expect(screen.getByTestId('nameplate-field-current')).toHaveTextContent('Galaxy');

    fireEvent.click(saveButton());
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/api/me', {
        profileEffect: 'aurora',
        nameplate: 'galaxy',
      }),
    );
  });

  it('display name style: fonts, effects, one or two colours and Remove style', async () => {
    const patch = mockPatch();
    renderPage();
    const field = screen.getByTestId('name-style-field');
    const fonts = within(field).getByRole('group', { name: 'Font' });
    // Every font tile renders my name.
    expect(within(fonts).getAllByRole('button')).toHaveLength(12);
    expect(within(fonts).getByRole('button', { name: 'Pixel font' })).toHaveTextContent(
      'Ada Lovelace',
    );
    fireEvent.click(within(fonts).getByRole('button', { name: 'Pixel font' }));
    expect(within(fonts).getByRole('button', { name: 'Pixel font' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(field).queryByLabelText('End colour')).toBeNull();

    const effects = within(field).getByRole('group', { name: 'Effect' });
    fireEvent.click(within(effects).getByRole('button', { name: 'Gradient' }));
    expect(within(field).getByLabelText('Start colour')).toBeInTheDocument();
    fireEvent.change(within(field).getByLabelText('End colour'), { target: { value: '#00FF00' } });

    fireEvent.click(saveButton());
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/api/me', {
        nameStyle: { font: 'pixel', effect: 'gradient', colors: ['#8e80fd', '#00ff00'] },
      }),
    );

    // Back to one colour for a non-gradient effect; Remove style clears it.
    fireEvent.click(within(effects).getByRole('button', { name: 'Neon' }));
    expect(within(field).queryByLabelText('End colour')).toBeNull();
    fireEvent.click(within(field).getByRole('button', { name: 'Remove style' }));
    fireEvent.click(saveButton());
    await waitFor(() => expect(patch).toHaveBeenLastCalledWith('/api/me', { nameStyle: null }));
  });

  it('profile theme: swatches and pickers, and Reset theme', async () => {
    const patch = mockPatch();
    renderPage();
    const theme = screen.getByTestId('theme-field');
    fireEvent.click(
      within(within(theme).getByRole('group', { name: 'Primary colour presets' })).getByRole(
        'button',
        { name: '#0e7fc0' },
      ),
    );
    fireEvent.change(within(theme).getByLabelText('Accent colour'), {
      target: { value: '#ABCDEF' },
    });
    // The banner area (no banner image) previews the theme gradient.
    expect(screen.getByTestId('banner-drop').style.background).toContain('#0e7fc0');
    expect(screen.getByTestId('banner-drop').style.background).toContain('#abcdef');
    fireEvent.click(saveButton());
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/api/me', {
        profileColor: '#0e7fc0',
        accentColor: '#abcdef',
      }),
    );
    fireEvent.click(within(theme).getByRole('button', { name: 'Reset theme' }));
    fireEvent.click(saveButton());
    await waitFor(() =>
      expect(patch).toHaveBeenLastCalledWith('/api/me', { profileColor: null, accentColor: null }),
    );
  });

  it('avatar: Remove is staged until Save; dropping an image opens the crop flow', async () => {
    useAuth.setState({ user: { ...useAuth.getState().user!, avatarUrl: '/uploads/a.jpg' } });
    const patch = mockPatch();
    URL.createObjectURL = vi.fn(() => 'blob:test');
    URL.revokeObjectURL = vi.fn();
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Avatar' }));
    expect(screen.queryByRole('button', { name: 'Remove Avatar' })).toBeNull();
    expect(patch).not.toHaveBeenCalled();
    fireEvent.click(saveButton());
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/api/me', { avatarMediaId: null }));

    const drop = screen.getByTestId('avatar-drop');
    fireEvent.drop(drop, {
      dataTransfer: {
        files: [new File(['x'], 'notes.txt', { type: 'text/plain' })],
        types: ['Files'],
      },
    });
    expect(screen.queryByRole('dialog', { name: 'Crop your photo' })).toBeNull();
    fireEvent.drop(drop, {
      dataTransfer: { files: [new File(['x'], 'me.png', { type: 'image/png' })], types: ['Files'] },
    });
    expect(await screen.findByRole('dialog', { name: 'Crop your photo' })).toBeInTheDocument();
  });

  it('dropping an image on the banner opens the banner crop flow', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:test');
    URL.revokeObjectURL = vi.fn();
    renderPage();
    const drop = screen.getByTestId('banner-drop');
    fireEvent.dragEnter(drop, { dataTransfer: { files: [], types: ['Files'] } });
    expect(drop).toHaveAttribute('data-over', 'true');
    fireEvent.drop(drop, {
      dataTransfer: { files: [new File(['x'], 'b.jpg', { type: 'image/jpeg' })], types: ['Files'] },
    });
    expect(await screen.findByRole('dialog', { name: 'Crop your banner' })).toBeInTheDocument();
    expect(drop).not.toHaveAttribute('data-over');
  });

  it('leaving with unsaved changes is blocked and shakes the bar', async () => {
    const router = renderPage();
    fireEvent.change(screen.getByTestId('pronouns-input'), { target: { value: 'xe/xem' } });
    fireEvent.click(screen.getByTestId('collectibles-link'));
    await waitFor(() => expect(bar()).toHaveAttribute('data-alert', 'true'));
    expect(router.state.location.pathname).toBe('/settings/profile');

    // The other tab is blocked too.
    fireEvent.click(screen.getByRole('tab', { name: 'Per-server Profiles' }));
    expect(screen.getByRole('tab', { name: 'Main Profile' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    // (A completed data-router navigation needs a fetch Request that jsdom can't build, so
    // the unblocked case is covered by the guard staying off without changes.)
    fireEvent.click(within(bar()!).getByRole('button', { name: 'Reset' }));
    expect(bar()).toBeNull();
  });

  it('Per-server Profiles: a Space picker over my Spaces embeds that Space’s editor', () => {
    useSpaces.setState({
      byId: {
        s1: makeSpace({ id: 's1', name: 'Book Club' }),
        s2: makeSpace({ id: 's2', name: 'Climbing' }),
      },
      order: ['s1', 's2'],
      loaded: true,
    });
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'Per-server Profiles' }));
    const picker = screen.getByLabelText('Choose a Space');
    expect(
      within(picker)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Book Club', 'Climbing']);
    expect(screen.getByTestId('server-profile-editor')).toHaveAttribute('data-space-id', 's1');
    fireEvent.change(picker, { target: { value: 's2' } });
    expect(screen.getByTestId('server-profile-editor')).toHaveAttribute('data-space-id', 's2');
  });

  it('Per-server Profiles without Spaces says so', () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'Per-server Profiles' }));
    expect(screen.getByText('No Spaces yet')).toBeInTheDocument();
  });

  it('keeps the account rows (username, phone, about) that Settings → Account links to', () => {
    renderPage();
    expect(screen.getByTestId('profile-username')).toHaveTextContent('@ada');
    expect(screen.getByTestId('profile-phone')).toHaveTextContent('Not added');
    expect(screen.getByTestId('profile-about')).toHaveAttribute('href', '/settings/profile/about');
  });
});
