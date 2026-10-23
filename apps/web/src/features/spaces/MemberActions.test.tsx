/** The member menu: Mod View for moderators; time out and kick ask for a reason; ban picks a message deletion window. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { PERM, type SpaceMember } from '@enbox/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { useSpaces } from '@/stores/spaces';
import { useUi } from '@/stores/ui';
import { useUsers } from '@/stores/users';
import { makeMe, makeUser } from '@/test/factories';
import { MemberActionsMenu } from './MemberActions';
import { makeSpace } from './testUtils';

const bob = {
  userId: 'bob',
  nickname: null,
  roleIds: [],
  joinedAt: '2026-01-01T00:00:00.000Z',
  timedOutUntil: null,
  serverMute: false,
  serverDeaf: false,
} as SpaceMember;

function menu(onClose = vi.fn()) {
  render(
    <MemoryRouter>
      <MemberActionsMenu
        space={useSpaces.getState().byId.s1!}
        member={bob}
        anchor={{ x: 0, y: 0 }}
        onClose={onClose}
      />
    </MemoryRouter>,
  );
  return onClose;
}

beforeEach(() => {
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
  useUi.setState({ toasts: [], dialogs: [] });
  useUsers.setState({ byId: { bob: makeUser({ id: 'bob', displayName: 'Bob' }) } });
  useSpaces.setState({ byId: { s1: makeSpace({ owner: true }) }, order: ['s1'], members: {} });
});

describe('the member menu', () => {
  it('moderators get Mod View next to Profile, then the actions', () => {
    menu();
    const items = screen.getAllByRole('menuitem').map((i) => i.textContent);
    expect(items.slice(0, 2)).toEqual(['Profile', 'Mod View']);
    expect(items).toEqual(expect.arrayContaining(['Time out Bob', 'Kick Bob', 'Ban Bob']));
  });

  it('kick asks for a reason, sent with the kick', async () => {
    const del = vi.spyOn(api, 'delete').mockResolvedValue(undefined as never);
    const onClose = menu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Kick Bob' }));
    const dialog = await screen.findByRole('dialog', { name: 'Kick Bob?' });
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'spam & ads' } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Kick' }));
    });
    expect(del).toHaveBeenCalledWith('/api/spaces/s1/members/bob?reason=spam%20%26%20ads');
    expect(onClose).toHaveBeenCalled();
  });

  it('time out picks a length and a reason', async () => {
    const patch = vi.spyOn(api, 'patch').mockResolvedValue(bob as never);
    menu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Time out Bob' }));
    const dialog = await screen.findByRole('dialog', { name: 'Time out Bob' });
    fireEvent.click(within(dialog).getByLabelText('1 day'));
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'heated' } });
    const t0 = Date.now();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Time out' }));
    });
    const [path, body] = patch.mock.calls[0]! as [
      string,
      { timedOutUntil: string; reason: string },
    ];
    expect(path).toBe('/api/spaces/s1/members/bob');
    expect(body.reason).toBe('heated');
    expect(Date.parse(body.timedOutUntil) - t0).toBeGreaterThan(86_400_000 - 2000);
  });

  it('ban sends the chosen message deletion window', async () => {
    const put = vi.spyOn(api, 'put').mockResolvedValue(undefined as never);
    menu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Ban Bob' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ban Bob?' });
    fireEvent.click(within(dialog).getByLabelText('Previous hour'));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Ban' }));
    });
    expect(put).toHaveBeenCalledWith('/api/spaces/s1/bans/bob', {
      reason: undefined,
      deleteMessageSeconds: 3600,
    });
  });

  it('a Time out Members moderator sees Mod View and time out, not kick or ban', () => {
    const base = makeSpace();
    const helpers = {
      ...base.roles[0]!,
      id: 'helpers',
      name: 'Helpers',
      position: 1,
      isDefault: false,
    };
    useSpaces.setState({
      byId: {
        s1: makeSpace({
          myPermissions: PERM.MODERATE_MEMBERS,
          roles: [...base.roles, { ...helpers, permissions: PERM.MODERATE_MEMBERS }],
          me: { roleIds: ['helpers'] },
        }),
      },
      order: ['s1'],
      members: {},
    });
    menu();
    const items = screen.getAllByRole('menuitem').map((i) => i.textContent);
    expect(items).toEqual(['Profile', 'Mod View', 'Time out Bob']);
  });
});
