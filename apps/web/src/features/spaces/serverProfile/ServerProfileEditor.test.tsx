/** Per-server profile editor: draft behind the unsaved-changes bar, one PATCH with the changed fields, live caches. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { PERM, type Space, type SpaceMember, type UpdateMyMemberRequest } from '@enbox/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { useSpaces } from '@/stores/spaces';
import { useUi } from '@/stores/ui';
import { makeMe } from '@/test/factories';
import { makeSpace } from '../testUtils';
import { ServerProfileEditor } from './ServerProfileEditor';

const member = (p: Partial<SpaceMember> = {}): SpaceMember => ({
  userId: 'me',
  nickname: null,
  roleIds: [],
  joinedAt: '2026-01-01T00:00:00.000Z',
  timedOutUntil: null,
  serverMute: false,
  serverDeaf: false,
  ...p,
});

function seed(space: Space) {
  useSpaces.setState({ byId: { [space.id]: space }, order: [space.id], members: { [space.id]: { me: member(space.me) } } });
}

/** `PATCH members/me` echoes my Space with the body merged into `me` (what the server does for these fields). */
function mockPatch() {
  return vi.spyOn(api, 'patch').mockImplementation(async (_path: string, body: unknown) => {
    const cur = useSpaces.getState().byId.s1!;
    return { ...cur, me: { ...cur.me, ...(body as UpdateMyMemberRequest) } } as Space;
  });
}

const wrap = () =>
  render(
    <MemoryRouter>
      <ServerProfileEditor spaceId="s1" />
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.restoreAllMocks();
  useAuth.setState({ user: makeMe({ id: 'me', displayName: 'Main Me', pronouns: 'they/them' }), token: 't', status: 'authenticated' });
  useUi.setState({ toasts: [] });
});

describe('ServerProfileEditor', () => {
  it('stages edits behind the bar and saves them in one PATCH; caches update', async () => {
    seed(makeSpace({ myPermissions: PERM.CHANGE_NICKNAME }));
    const patch = mockPatch();
    wrap();
    expect(screen.queryByTestId('unsaved-bar')).toBeNull();
    expect(screen.getAllByText('Using main profile').length).toBeGreaterThan(3);

    fireEvent.change(screen.getByLabelText('Server Nickname'), { target: { value: 'Raid Lead' } });
    fireEvent.change(screen.getByLabelText('Pronouns'), { target: { value: 'she/her' } });
    fireEvent.change(screen.getByLabelText('About Me'), { target: { value: 'Tank main' } });
    fireEvent.click(within(screen.getByRole('group', { name: 'Primary presets' })).getByRole('button', { name: '#0e7fc0' }));
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Avatar Decoration' })).getByRole('radio', { name: 'Halo' }));
    expect(screen.getByTestId('unsaved-bar')).toBeInTheDocument();
    expect(patch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(screen.queryByTestId('unsaved-bar')).toBeNull());
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith('/api/spaces/s1/members/me', {
      nickname: 'Raid Lead',
      pronouns: 'she/her',
      bio: 'Tank main',
      profileColor: '#0e7fc0',
      avatarDecoration: 'halo',
    });
    const s = useSpaces.getState();
    expect(s.byId.s1!.me).toMatchObject({ nickname: 'Raid Lead', pronouns: 'she/her', avatarDecoration: 'halo' });
    // My cached member (message authors, member list) follows at once.
    expect(s.members.s1!.me).toMatchObject({ nickname: 'Raid Lead', bio: 'Tank main', profileColor: '#0e7fc0' });
  });

  it('"Reset to main profile" clears an override (null); the bar\'s Reset discards edits', async () => {
    seed(makeSpace({ myPermissions: PERM.CHANGE_NICKNAME, me: { bio: 'Server bio', nameplate: 'galaxy' } }));
    const patch = mockPatch();
    wrap();
    expect(screen.getByLabelText('About Me')).toHaveValue('Server bio');
    fireEvent.click(screen.getByTestId('reset-bio'));
    expect(screen.getByLabelText('About Me')).toHaveValue('');
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Nameplate' })).getByRole('radio', { name: /Use main profile/ }));

    // Reset on the bar puts both back.
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.getByLabelText('About Me')).toHaveValue('Server bio');
    expect(within(screen.getByRole('radiogroup', { name: 'Nameplate' })).getByRole('radio', { name: 'Galaxy' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByTestId('unsaved-bar')).toBeNull();

    fireEvent.click(screen.getByTestId('reset-nameplate'));
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/api/spaces/s1/members/me', { nameplate: null }));
    await waitFor(() => expect(useSpaces.getState().members.s1!.me!.nameplate).toBeNull());
  });

  it('arrow keys move through a cosmetic grid and select', () => {
    seed(makeSpace());
    wrap();
    const grid = screen.getByRole('radiogroup', { name: 'Profile Effect' });
    const main = within(grid).getByRole('radio', { name: /Use main profile/ });
    expect(main).toHaveAttribute('aria-checked', 'true');
    main.focus();
    fireEvent.keyDown(main, { key: 'ArrowRight' });
    const first = within(grid).getAllByRole('radio')[1]!;
    expect(first).toHaveAttribute('aria-checked', 'true');
    expect(first).toHaveFocus();
    expect(screen.getByTestId('unsaved-bar')).toBeInTheDocument();
  });

  it('without Change Nickname the nickname field is read-only; a failed save keeps the draft', async () => {
    seed(makeSpace({ myPermissions: 0 }));
    vi.spyOn(api, 'patch').mockRejectedValue(new Error('nope'));
    wrap();
    expect(screen.getByLabelText('Server Nickname')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Pronouns'), { target: { value: 'he/him' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(useUi.getState().toasts.length).toBeGreaterThan(0));
    expect(screen.getByTestId('unsaved-bar')).toBeInTheDocument();
    expect(screen.getByLabelText('Pronouns')).toHaveValue('he/him');
  });

  it('a Space I am not in shows a notice', () => {
    useSpaces.setState({ byId: {}, members: {} });
    wrap();
    expect(screen.getByText('Space not available')).toBeInTheDocument();
  });
});
