/** Roles page: hierarchy-aware reordering (keyboard), role styles with a live preview, contrast warning, role icons. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { PERM, type Space, type SpaceRole } from '@enbox/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { useSpaces } from '@/stores/spaces';
import { useUi } from '@/stores/ui';
import { makeMe } from '@/test/factories';
import { makeSpace } from '../testUtils';
import { MIN_NAME_CONTRAST, RolesPage, contrastRatio, planRoleMove } from './RolesPage';

const role = (p: Partial<SpaceRole> & Pick<SpaceRole, 'id' | 'name' | 'position'>): SpaceRole => ({
  color: null,
  permissions: 0,
  hoist: false,
  mentionable: false,
  isDefault: false,
  colorStyle: 'solid',
  colorSecondary: null,
  iconUrl: null,
  iconEmoji: null,
  ...p,
});

const ROLES: SpaceRole[] = [
  role({ id: 'everyone', name: '@everyone', position: 0, isDefault: true }),
  role({ id: 'mod', name: 'Mod', position: 3, color: '#e74c3c', permissions: PERM.MANAGE_ROLES }),
  role({ id: 'helper', name: 'Helper', position: 2, color: '#3498db' }),
  role({ id: 'member', name: 'Member', position: 1, color: '#2ecc71' }),
];

function seed(space: Space) {
  useSpaces.setState({ byId: { [space.id]: space }, order: [space.id], members: {} });
  return space;
}

beforeEach(() => {
  vi.restoreAllMocks();
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
  useUi.setState({ toasts: [] });
  document.documentElement.classList.remove('dark');
});

describe('planRoleMove', () => {
  const ordered = ROLES.filter((r) => !r.isDefault); // Mod 3, Helper 2, Member 1

  it('moves within my reach; nothing to do is null', () => {
    expect(planRoleMove(ordered, 2, 1, Infinity)).toEqual(['mod', 'member', 'helper']);
    expect(planRoleMove(ordered, 0, 2, Infinity)).toEqual(['helper', 'member', 'mod']);
    expect(planRoleMove(ordered, 1, 1, Infinity)).toBeNull();
  });

  it('refuses moving a role at/above my top, or onto it', () => {
    // My top is Mod (3): Helper/Member can swap, nothing can reach position 3.
    expect(planRoleMove(ordered, 2, 1, 3)).toEqual(['mod', 'member', 'helper']);
    expect(planRoleMove(ordered, 1, 0, 3)).toBe('forbidden');
    expect(planRoleMove(ordered, 0, 1, 3)).toBe('forbidden');
  });
});

describe('contrastRatio', () => {
  it('is WCAG’s ratio', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 0);
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5);
    expect(contrastRatio('#f1c40f', '#ffffff')!).toBeLessThan(MIN_NAME_CONTRAST);
    expect(contrastRatio('nope', '#ffffff')).toBeNull();
  });
});

describe('RolesPage', () => {
  it('owner: Alt+↓ moves a role, applied at once and saved as the full order', async () => {
    const space = seed(makeSpace({ owner: true, roles: ROLES }));
    const patch = vi.spyOn(api, 'patch').mockImplementation(async () => useSpaces.getState().byId.s1!.roles);
    render(<RolesPage space={space} />);
    const list = screen.getByTestId('role-list');
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Mod', 'Helper', 'Member']);
    fireEvent.keyDown(within(screen.getByTestId('role-row-mod')).getByRole('button', { name: 'Mod' }), {
      key: 'ArrowDown',
      altKey: true,
    });
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/api/spaces/s1/roles/positions', { roleIds: ['helper', 'mod', 'member'] }),
    );
    const pos = Object.fromEntries(useSpaces.getState().byId.s1!.roles.map((r) => [r.id, r.position]));
    expect(pos).toEqual({ everyone: 0, helper: 3, mod: 2, member: 1 });
  });

  it('a member with Manage Roles: roles at/above theirs are locked and cannot be passed', async () => {
    const space = seed(
      makeSpace({ roles: ROLES, myPermissions: PERM.MANAGE_ROLES, me: { roleIds: ['helper'] } }),
    );
    const patch = vi.spyOn(api, 'patch').mockResolvedValue(ROLES);
    render(<RolesPage space={space} />);
    // Only Member (below Helper) has a drag handle.
    expect(screen.queryByRole('button', { name: 'Drag Mod' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Drag Helper' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Drag Member' })).toBeInTheDocument();
    expect(within(screen.getByTestId('role-row-mod')).getByLabelText('Above your highest role')).toBeInTheDocument();
    // Member cannot move up onto Helper's place.
    fireEvent.keyDown(within(screen.getByTestId('role-row-member')).getByRole('button', { name: 'Member' }), {
      key: 'ArrowUp',
      altKey: true,
    });
    await waitFor(() => expect(useUi.getState().toasts.length).toBeGreaterThan(0));
    expect(patch).not.toHaveBeenCalled();
  });

  it('a failed reorder puts the old order back', async () => {
    const space = seed(makeSpace({ owner: true, roles: ROLES }));
    vi.spyOn(api, 'patch').mockRejectedValue(new Error('offline'));
    render(<RolesPage space={space} />);
    fireEvent.keyDown(within(screen.getByTestId('role-row-member')).getByRole('button', { name: 'Member' }), {
      key: 'ArrowUp',
      altKey: true,
    });
    await waitFor(() => expect(useUi.getState().toasts.length).toBeGreaterThan(0));
    expect(useSpaces.getState().byId.s1!.roles).toEqual(ROLES);
  });

  it('Role Style: gradient needs a second colour; Save sends the style fields', async () => {
    const space = seed(makeSpace({ owner: true, roles: ROLES }));
    const patch = vi.spyOn(api, 'patch').mockResolvedValue({ ...ROLES[1], colorStyle: 'gradient' });
    render(<RolesPage space={space} />);
    // Mod (highest) is selected first.
    expect(screen.getByLabelText('Role name')).toHaveValue('Mod');
    fireEvent.click(screen.getByRole('radio', { name: /Gradient/ }));
    expect(screen.getByRole('radio', { name: /Gradient/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('A gradient needs both colours.')).toBeInTheDocument();
    expect(screen.getByTestId('save-role')).toBeDisabled();
    fireEvent.click(within(screen.getByRole('group', { name: 'Secondary colour' })).getByRole('button', { name: '#9b59b6' }));
    expect(screen.queryByText('A gradient needs both colours.')).toBeNull();
    expect(within(screen.getByTestId('role-preview')).getByText('Me')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('save-role'));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/api/spaces/s1/roles/mod', { colorStyle: 'gradient', colorSecondary: '#9b59b6' }),
    );
  });

  it('warns when the colour is hard to read on the theme', () => {
    const space = seed(makeSpace({ owner: true, roles: ROLES }));
    render(<RolesPage space={space} />);
    expect(screen.queryByTestId('contrast-warning')).toBeNull();
    fireEvent.click(within(screen.getByRole('group', { name: 'Role colour' })).getByRole('button', { name: '#f1c40f' }));
    expect(screen.getByTestId('contrast-warning')).toHaveTextContent('light theme');
    // Holographic draws its own colours: no warning.
    fireEvent.click(screen.getByRole('radio', { name: /Holographic/ }));
    expect(screen.queryByTestId('contrast-warning')).toBeNull();
  });

  it('Role Icon: remove the image icon, set an emoji, one Save', async () => {
    const withIcon = ROLES.map((r) => (r.id === 'mod' ? { ...r, iconUrl: '/uploads/old.png' } : r));
    const space = seed(makeSpace({ owner: true, roles: withIcon }));
    const patch = vi.spyOn(api, 'patch').mockResolvedValue({ ...withIcon[1], iconUrl: null, iconEmoji: '⭐' });
    render(<RolesPage space={space} />);
    expect(within(screen.getByTestId('role-icon-preview')).getByRole('img')).toHaveAttribute('src', expect.stringContaining('/uploads/old.png'));
    fireEvent.click(screen.getByRole('button', { name: 'Remove icon' }));
    fireEvent.change(screen.getByLabelText('Role icon emoji'), { target: { value: '⭐' } });
    expect(within(screen.getByTestId('role-icon-preview')).getByRole('img', { name: 'Mod' })).toHaveTextContent('⭐');
    fireEvent.click(screen.getByTestId('save-role'));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/api/spaces/s1/roles/mod', { iconEmoji: '⭐', iconMediaId: null }),
    );
  });

  it('@everyone has no Display section', () => {
    const space = seed(makeSpace({ owner: true, roles: ROLES }));
    render(<RolesPage space={space} />);
    fireEvent.click(screen.getByRole('button', { name: '@everyone' }));
    expect(screen.queryByRole('radiogroup', { name: 'Role Style' })).toBeNull();
    expect(screen.queryByLabelText('Role icon emoji')).toBeNull();
  });
});
