/** Members page: the table (signals, roles +N, count), filters and sorting as search queries, the bulk bar, Ban by ID, `?joined=` links. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { VirtuosoMockContext } from 'react-virtuoso';
import { type ModMember, type ModMemberPage, type SpaceRole } from '@enbox/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { useSpaces } from '@/stores/spaces';
import { useUi } from '@/stores/ui';
import { useUsers } from '@/stores/users';
import { makeMe, makeUser } from '@/test/factories';
import { makeSpace } from '@/features/spaces/testUtils';
import { MembersPage } from './MembersPage';

const DAY = 86_400_000;
const role = (id: string, name: string, position: number): SpaceRole => ({
  id,
  name,
  position,
  color: null,
  permissions: 0,
  hoist: false,
  mentionable: false,
  isDefault: false,
});
const ROLES: SpaceRole[] = [
  { ...role('everyone', '@everyone', 0), isDefault: true },
  role('r-admin', 'Admins', 4),
  role('r-mods', 'Mods', 3),
  role('r-vip', 'VIP', 2),
  role('r-low', 'Low', 1),
];

function member(id: string, name: string, p: Partial<ModMember> = {}): ModMember {
  return {
    userId: id,
    nickname: null,
    roleIds: [],
    joinedAt: new Date(Date.now() - 2 * DAY).toISOString(),
    timedOutUntil: null,
    serverMute: false,
    serverDeaf: false,
    user: makeUser({ id, displayName: name, username: name.toLowerCase() }),
    accountCreatedAt: new Date(Date.now() - 400 * DAY).toISOString(),
    ...p,
  };
}

const ANN = member('ann', 'Ann', {
  roleIds: ['r-mods', 'r-vip', 'r-low'],
  accountCreatedAt: new Date(Date.now() - 2 * DAY).toISOString(),
});
const BEN = member('ben', 'Ben', { timedOutUntil: new Date(Date.now() + 3600_000).toISOString() });
const CY = member('cy', 'Cy');

const page = (members: ModMember[], total = members.length): ModMemberPage => ({
  members,
  nextCursor: null,
  total,
});

let queries: Record<string, unknown>[] = [];

function renderPage(url = '/spaces/s1/settings/members') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <VirtuosoMockContext.Provider value={{ viewportHeight: 1000, itemHeight: 56 }}>
        <MembersPage space={useSpaces.getState().byId.s1!} />
      </VirtuosoMockContext.Provider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  queries = [];
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
  useUi.setState({ toasts: [], dialogs: [] });
  useUsers.setState({ byId: {} });
  useSpaces.setState({
    byId: { s1: makeSpace({ owner: true, roles: ROLES, security: null }) },
    order: ['s1'],
    members: {},
  });
  vi.spyOn(api, 'get').mockImplementation(async (path: string, opts?: { query?: unknown }) => {
    if (path !== '/api/spaces/s1/members/search') throw new Error(`unexpected ${path}`);
    queries.push((opts?.query ?? {}) as Record<string, unknown>);
    return page([ANN, BEN, CY], 3) as never;
  });
});

const lastQuery = () => queries[queries.length - 1]!;
const rowOf = (name: string) =>
  screen.getAllByTestId('mod-member-row').find((r) => within(r).queryByText(name))!;

describe('the members table', () => {
  it('lists members with their dates, roles (+N), signals and a count', async () => {
    renderPage();
    expect(await screen.findByText('Ann')).toBeInTheDocument();
    expect(screen.getByText('3 members')).toBeInTheDocument();
    expect(lastQuery()).toMatchObject({ sort: 'joined_desc', limit: 100 });
    const ann = rowOf('Ann');
    expect(within(ann).getByText('@ann')).toBeInTheDocument();
    expect(within(ann).getByText('Mods')).toBeInTheDocument();
    expect(within(ann).getByText('VIP')).toBeInTheDocument();
    expect(within(ann).getByText('+1')).toHaveAttribute('title', 'Low');
    expect(within(ann).getByText('New account')).toBeInTheDocument();
    expect(within(ann).getAllByText('2 days ago')).toHaveLength(2);
    expect(within(rowOf('Ben')).getByText('Timed out')).toBeInTheDocument();
    expect(within(rowOf('Cy')).queryByText('New account')).toBeNull();
    expect(within(rowOf('Cy')).getByText('1 year ago')).toBeInTheDocument();
  });

  it('filters and sorting become the search query', async () => {
    renderPage();
    await screen.findByText('Ann');
    const t0 = Date.now();

    fireEvent.click(screen.getByRole('button', { name: 'Timed out', pressed: false }));
    await waitFor(() => expect(lastQuery()).toMatchObject({ timedOut: 'true' }));

    fireEvent.click(screen.getByRole('button', { name: 'New accounts' }));
    await waitFor(() => expect(lastQuery().accountCreatedAfter).toBeDefined());
    expect(t0 - Date.parse(lastQuery().accountCreatedAfter as string)).toBeGreaterThanOrEqual(
      7 * DAY - 1000,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Joined' }));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Last 24 hours' }));
    await waitFor(() => expect(lastQuery().joinedAfter).toBeDefined());
    expect(t0 - Date.parse(lastQuery().joinedAfter as string)).toBeLessThan(DAY + 5000);

    fireEvent.click(screen.getByRole('button', { name: 'Roles' }));
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Mods' }));
    await waitFor(() => expect(lastQuery()).toMatchObject({ roleIds: 'r-mods' }));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'VIP' }));
    await waitFor(() => expect(lastQuery()).toMatchObject({ roleIds: 'r-mods,r-vip' }));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });

    fireEvent.click(screen.getByRole('button', { name: /^Sort:/ }));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Name' }));
    await waitFor(() => expect(lastQuery()).toMatchObject({ sort: 'name' }));

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(lastQuery()).toEqual({ sort: 'name', limit: 100 }));
  });

  it('a raid alert link (?joined=1h) starts with members who joined in the last hour', async () => {
    renderPage('/spaces/s1/settings/members?joined=1h');
    await screen.findByText('Ann');
    const after = Date.parse(queries[0]!.joinedAfter as string);
    expect(Date.now() - after).toBeLessThan(3600_000 + 5000);
    expect(screen.getByRole('button', { name: 'Joined: Last hour' })).toBeInTheDocument();
  });
});

describe('the bulk bar', () => {
  it('kicks the selected members with a reason and reports refusals', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({
      ok: ['ann'],
      failed: [{ userId: 'ben', reason: 'You can only kick members below your highest role' }],
    } as never);
    renderPage();
    await screen.findByText('Ann');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Ann' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Ben' }));
    const bar = screen.getByRole('toolbar', { name: 'Bulk actions' });
    expect(bar).toHaveTextContent('2 members selected');
    expect(within(bar).getByRole('button', { name: 'Add Role' })).toBeInTheDocument();

    fireEvent.click(within(bar).getByRole('button', { name: 'Kick' }));
    const dialog = await screen.findByRole('dialog', { name: 'Kick 2 members?' });
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'raid' } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Kick' }));
    });
    expect(post).toHaveBeenCalledWith('/api/spaces/s1/members/bulk', {
      action: 'kick',
      reason: 'raid',
      userIds: ['ann', 'ben'],
    });
    const toasts = useUi.getState().toasts.map((t) => t.message);
    expect(toasts).toEqual([
      'Kicked 1 member',
      '1 member couldn’t be kicked: You can only kick members below your highest role',
    ]);
    // The page reloads; the selection is gone.
    await waitFor(() => expect(screen.queryByRole('toolbar', { name: 'Bulk actions' })).toBeNull());
  });

  it('select all, then ban with a message deletion window; roles below mine go through a confirm', async () => {
    const post = vi
      .spyOn(api, 'post')
      .mockResolvedValue({ ok: ['ann', 'ben', 'cy'], failed: [] } as never);
    renderPage();
    await screen.findByText('Ann');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all members' }));
    const bar = screen.getByRole('toolbar', { name: 'Bulk actions' });
    expect(bar).toHaveTextContent('3 members selected');

    fireEvent.click(within(bar).getByRole('button', { name: 'Ban' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ban 3 members?' });
    fireEvent.click(within(dialog).getByLabelText('Previous 7 days'));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Ban' }));
    });
    expect(post).toHaveBeenLastCalledWith('/api/spaces/s1/members/bulk', {
      action: 'ban',
      deleteMessageSeconds: 604800,
      reason: undefined,
      userIds: ['ann', 'ben', 'cy'],
    });
    expect(useUi.getState().toasts.map((t) => t.message)).toEqual(['Banned 3 members']);

    await waitFor(() => expect(screen.queryByRole('toolbar')).toBeNull());
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Cy' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Role' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'VIP' }));
    await waitFor(() => expect(useUi.getState().dialogs).toHaveLength(1));
    const confirmDialog = useUi.getState().dialogs[0]!;
    expect(confirmDialog.title).toBe('Add VIP to 1 member?');
    await act(async () => useUi.getState().closeDialog(confirmDialog.id, 'confirm'));
    await waitFor(() =>
      expect(post).toHaveBeenLastCalledWith('/api/spaces/s1/members/bulk', {
        action: 'add_role',
        roleId: 'r-vip',
        userIds: ['cy'],
      }),
    );
  });
});

describe('Ban by ID', () => {
  it('needs a user ID, then bans it with a reason', async () => {
    const put = vi.spyOn(api, 'put').mockResolvedValue(undefined as never);
    renderPage();
    await screen.findByText('Ann');
    fireEvent.click(screen.getByRole('button', { name: 'Ban by ID' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ban by ID' });
    const ban = within(dialog).getByRole('button', { name: 'Ban' });
    fireEvent.change(within(dialog).getByLabelText('User ID'), { target: { value: 'nope' } });
    expect(within(dialog).getByText('That isn’t a user ID')).toBeInTheDocument();
    expect(ban).toBeDisabled();
    const id = '0f8c2a4e-1b3d-4c5e-9f60-7a8b9c0d1e2f';
    fireEvent.change(within(dialog).getByLabelText('User ID'), {
      target: { value: ` ${id.toUpperCase()} ` },
    });
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'alt account' } });
    await act(async () => {
      fireEvent.click(ban);
    });
    expect(put).toHaveBeenCalledWith(`/api/spaces/s1/bans/${id}`, {
      reason: 'alt account',
      deleteMessageSeconds: 0,
    });
    expect(screen.queryByRole('dialog', { name: 'Ban by ID' })).toBeNull();
  });
});
