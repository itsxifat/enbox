/** Mod View: the member's profile, roles (inline), key permissions, messages (Jump), history, voice (Disconnect) and the actions with reasons. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { PERM, type ModView, type SpaceRole } from '@enbox/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useSpaces } from '@/stores/spaces';
import { useUi } from '@/stores/ui';
import { useUsers } from '@/stores/users';
import { makeChat, makeMe, makeMessage, makeUser } from '@/test/factories';
import { makeSpace } from '@/features/spaces/testUtils';
import { ModViewPanel } from './ModView';

const DAY = 86_400_000;
const role = (id: string, name: string, position: number, permissions = 0): SpaceRole => ({
  id,
  name,
  position,
  color: null,
  permissions,
  hoist: false,
  mentionable: false,
  isDefault: false,
});
const ROLES: SpaceRole[] = [
  { ...role('everyone', '@everyone', 0), isDefault: true },
  role('r-mods', 'Mods', 3, PERM.KICK_MEMBERS | PERM.MANAGE_MESSAGES),
  role('r-vip', 'VIP', 2),
  role('r-low', 'Low', 1),
];

function view(p: Partial<ModView> = {}): ModView {
  return {
    member: {
      userId: 'bob',
      nickname: 'Bobby',
      roleIds: ['r-mods', 'r-low'],
      joinedAt: new Date(Date.now() - 3 * DAY).toISOString(),
      timedOutUntil: null,
      serverMute: false,
      serverDeaf: false,
      user: makeUser({ id: 'bob', displayName: 'Bob', username: 'bob' }),
      accountCreatedAt: new Date(Date.now() - 2 * 365 * DAY).toISOString(),
    },
    recentMessages: [
      makeMessage({
        id: 'm2',
        chatId: 'general',
        seq: 9,
        senderId: 'bob',
        text: 'second thoughts',
      }),
      makeMessage({ id: 'm1', chatId: 'general', seq: 5, senderId: 'bob', text: 'first words' }),
    ],
    messageCount30d: 12,
    auditEntries: [
      {
        action: 'member.timeout',
        actorId: 'mod',
        reason: 'spamming links',
        createdAt: new Date(Date.now() - DAY).toISOString(),
      },
      {
        action: 'member.join',
        actorId: 'bob',
        reason: null,
        createdAt: new Date(Date.now() - 3 * DAY).toISOString(),
      },
    ],
    voiceChannelId: 'lounge',
    ...p,
  };
}

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname + loc.search}</p>;
}

function renderPanel(onClose = vi.fn()) {
  render(
    <MemoryRouter initialEntries={['/spaces/s1/settings/members']}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <Where />
              <ModViewPanel space={useSpaces.getState().byId.s1!} userId="bob" onClose={onClose} />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
  return onClose;
}

const space = (chat: { id: string; name: string; type: 'space_text' | 'space_voice' }) => ({
  ...makeChat({ id: chat.id, name: chat.name, type: chat.type }),
  space: {
    spaceId: 's1',
    categoryId: null,
    position: 0,
    topic: null,
    slowmodeSeconds: 0,
    nsfw: false,
    userLimit: null,
    bitrate: null,
    permissionsSynced: true,
    overwrites: [],
  },
});

beforeEach(() => {
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
  useUi.setState({ toasts: [], dialogs: [] });
  useUsers.setState({ byId: { mod: makeUser({ id: 'mod', displayName: 'Moderator' }) } });
  useChats.setState({
    byId: {
      general: space({ id: 'general', name: 'general', type: 'space_text' }),
      lounge: space({ id: 'lounge', name: 'Lounge', type: 'space_voice' }),
    },
  });
  useSpaces.setState({
    byId: { s1: makeSpace({ owner: true, roles: ROLES }) },
    order: ['s1'],
    members: {},
  });
});

describe('Mod View', () => {
  it('shows who they are, their roles, key permissions, messages, history and voice', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(view() as never);
    renderPanel();
    const panel = await screen.findByTestId('mod-view');
    await within(panel).findByText('Bobby');
    expect(api.get).toHaveBeenCalledWith('/api/spaces/s1/members/bob/mod-view');
    expect(panel).toHaveTextContent('@bob');
    expect(within(panel).getByRole('region', { name: 'Member since' })).toHaveTextContent(
      '3 days ago',
    );
    expect(within(panel).getByRole('region', { name: 'Joined Enbox' })).toHaveTextContent(
      '2 years ago',
    );

    const roles = within(panel).getByRole('region', { name: 'Roles' });
    expect(roles).toHaveTextContent('Mods');
    expect(roles).toHaveTextContent('Low');
    expect(within(roles).getByRole('button', { name: 'Add role' })).toBeInTheDocument();

    const perms = within(panel).getByRole('region', { name: 'Permissions' });
    expect(perms).toHaveTextContent('Kick Members');
    expect(perms).toHaveTextContent('Manage Messages');
    expect(perms).not.toHaveTextContent('Ban Members');

    const messages = within(panel).getByRole('region', { name: 'Messages' });
    expect(messages).toHaveTextContent('12 messages in the last 30 days');
    const items = within(messages).getAllByRole('listitem');
    expect(items.map((i) => i.textContent)).toEqual([
      expect.stringContaining('second thoughts'),
      expect.stringContaining('first words'),
    ]);
    expect(items[0]).toHaveTextContent('#general');

    const history = within(panel).getByRole('region', { name: 'History' });
    expect(history).toHaveTextContent('Timeout changed by Moderator');
    expect(history).toHaveTextContent('Reason: spamming links');
    expect(history).toHaveTextContent('Joined the Space');
    expect(history).not.toHaveTextContent('Joined the Space by');

    const voice = within(panel).getByRole('region', { name: 'Voice' });
    expect(voice).toHaveTextContent('Lounge');
    const post = vi.spyOn(api, 'post').mockResolvedValue(undefined as never);
    await act(async () => {
      fireEvent.click(within(voice).getByRole('button', { name: 'Disconnect' }));
    });
    expect(post).toHaveBeenCalledWith('/api/spaces/s1/voice-states/bob/disconnect');
    expect(within(panel).queryByRole('region', { name: 'Voice' })).toBeNull();
  });

  it('roles change inline: remove one, add one below my highest role', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(view() as never);
    const del = vi
      .spyOn(api, 'delete')
      .mockResolvedValue({ ...view().member, roleIds: ['r-mods'] } as never);
    const put = vi
      .spyOn(api, 'put')
      .mockResolvedValue({ ...view().member, roleIds: ['r-mods', 'r-vip'] } as never);
    renderPanel();
    const panel = await screen.findByTestId('mod-view');
    const roles = await within(panel).findByRole('region', { name: 'Roles' });
    await act(async () => {
      fireEvent.click(within(roles).getByRole('button', { name: 'Remove Low' }));
    });
    expect(del).toHaveBeenCalledWith('/api/spaces/s1/members/bob/roles/r-low');
    await waitFor(() => expect(roles).not.toHaveTextContent('Low'));
    fireEvent.click(within(roles).getByRole('button', { name: 'Add role' }));
    await act(async () => {
      fireEvent.click(await screen.findByRole('menuitem', { name: 'VIP' }));
    });
    expect(put).toHaveBeenCalledWith('/api/spaces/s1/members/bob/roles/r-vip');
  });

  it('Jump opens the message in its channel', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(view() as never);
    const onClose = renderPanel();
    const panel = await screen.findByTestId('mod-view');
    const messages = await within(panel).findByRole('region', { name: 'Messages' });
    await act(async () => {
      fireEvent.click(within(messages).getAllByRole('button', { name: 'Jump' })[1]!);
    });
    expect(onClose).toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent('/spaces/s1/general?m=5&mid=m1'),
    );
  });

  it('time out with a reason; kick and ban ask first', async () => {
    const timedOut = {
      ...view().member,
      timedOutUntil: new Date(Date.now() + 3600_000).toISOString(),
    };
    // The panel reloads after the timeout (fresh history).
    vi.spyOn(api, 'get')
      .mockResolvedValueOnce(view() as never)
      .mockResolvedValue(view({ member: timedOut }) as never);
    const patch = vi.spyOn(api, 'patch').mockResolvedValue(timedOut as never);
    renderPanel();
    const panel = await screen.findByTestId('mod-view');
    fireEvent.click(await within(panel).findByRole('button', { name: 'Time out' }));
    const dialog = await screen.findByRole('dialog', { name: 'Time out Bobby' });
    fireEvent.click(within(dialog).getByLabelText('1 hour'));
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'cool down' } });
    const t0 = Date.now();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Time out' }));
    });
    expect(patch).toHaveBeenCalledWith('/api/spaces/s1/members/bob', {
      timedOutUntil: expect.any(String),
      reason: 'cool down',
    });
    const until = Date.parse((patch.mock.calls[0]![1] as { timedOutUntil: string }).timedOutUntil);
    expect(until - t0).toBeGreaterThanOrEqual(3600_000 - 1000);
    expect(until - t0).toBeLessThan(3600_000 + 5000);
    // Now timed out: the action becomes Remove timeout.
    expect(
      await within(panel).findByRole('button', { name: 'Remove timeout' }),
    ).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole('button', { name: 'Kick' }));
    expect(await screen.findByRole('dialog', { name: 'Kick Bobby?' })).toBeInTheDocument();
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Kick Bobby?' })).getByRole('button', {
        name: 'Cancel',
      }),
    );
    fireEvent.click(within(panel).getByRole('button', { name: 'Ban' }));
    const ban = await screen.findByRole('dialog', { name: 'Ban Bobby?' });
    expect(within(ban).getByRole('group', { name: 'Delete message history' })).toBeInTheDocument();
  });

  it('a member I cannot see or moderate: the error, then Try again', async () => {
    const get = vi
      .spyOn(api, 'get')
      .mockRejectedValueOnce(new Error('You cannot moderate members in this Space'))
      .mockResolvedValueOnce(view({ voiceChannelId: null }) as never);
    renderPanel();
    expect(
      await screen.findByText('You cannot moderate members in this Space'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Bobby')).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('region', { name: 'Voice' })).toBeNull();
  });
});
