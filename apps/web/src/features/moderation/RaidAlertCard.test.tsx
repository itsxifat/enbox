/** Raid alerts render as a card: the join activity, Pause Invites, Open Members (joined in the last hour) and Dismiss. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { PERM, type SpaceSecurity } from '@enbox/shared';
import { SystemPill } from '@/features/conversation/bubbles/SystemPill';
import { api } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useSpaces } from '@/stores/spaces';
import { useUi } from '@/stores/ui';
import { makeChat, makeMe, makeMessage } from '@/test/factories';
import { makeSpace } from '@/features/spaces/testUtils';

const alert = makeMessage({
  id: 'raid1',
  chatId: 'alerts',
  type: 'system',
  senderId: null,
  text: null,
  system: { kind: 'raid_alert', joins: 12, windowSec: 120 },
});

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname + loc.search}</p>;
}

function show() {
  return render(
    <MemoryRouter initialEntries={['/spaces/s1/alerts']}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <Where />
              <SystemPill m={alert} chat={{ type: 'space_text', isAnnouncement: false }} />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

const security = (p: Partial<SpaceSecurity> = {}): SpaceSecurity => ({
  invitesPausedUntil: null,
  dmsPausedUntil: null,
  safetyAlertsChannelId: 'alerts',
  raidAlerts: true,
  ...p,
});

beforeEach(() => {
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
  useUi.setState({ toasts: [], dialogs: [] });
  useChats.setState({
    byId: {
      alerts: {
        ...makeChat({ id: 'alerts', name: 'mod-alerts', type: 'space_text' }),
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
      },
    },
  });
  useSpaces.setState({
    byId: { s1: makeSpace({ owner: true, security: security() }) },
    order: ['s1'],
    members: {},
  });
});

describe('the raid alert card', () => {
  it('says what happened and pauses invites for the chosen length', async () => {
    const patch = vi
      .spyOn(api, 'patch')
      .mockResolvedValue(
        security({ invitesPausedUntil: new Date(Date.now() + 3600_000).toISOString() }) as never,
      );
    show();
    const card = screen.getByTestId('raid-alert');
    expect(card).toHaveTextContent('Safety alert');
    expect(card).toHaveTextContent('Unusual join activity: 12 members joined in 2 minutes');
    fireEvent.click(screen.getByRole('button', { name: 'Pause Invites' }));
    await waitFor(() => expect(useUi.getState().dialogs).toHaveLength(1));
    const dialog = useUi.getState().dialogs[0]!;
    expect(dialog.title).toBe('Pause Invites');
    expect(dialog.options?.map((o) => o.label)).toEqual([
      'For 1 hour',
      'For 6 hours',
      'For 12 hours',
      'For 24 hours',
    ]);
    await act(async () => useUi.getState().closeDialog(dialog.id, '3600'));
    expect(patch).toHaveBeenCalledWith('/api/spaces/s1/security', { pauseInvitesSec: 3600 });
    expect(useSpaces.getState().byId.s1!.invitesPaused).toBe(true);
    expect(await screen.findByRole('button', { name: /^Invites paused until/ })).toBeDisabled();
  });

  it('opens the Members page at the members who joined in the last hour', () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Open Members (joined in the last hour)' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/spaces/s1/settings/members?joined=1h');
  });

  it('Dismiss folds it into its one-line notice, and it stays so', () => {
    const { unmount } = show();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByTestId('raid-alert')).toBeNull();
    expect(
      screen.getByText('Unusual join activity: 12 members joined in 2 minutes'),
    ).toBeInTheDocument();
    unmount();
    show();
    expect(screen.queryByTestId('raid-alert')).toBeNull();
  });

  it('members who can’t act on it only get Dismiss', () => {
    useSpaces.setState({
      byId: { s1: makeSpace({ myPermissions: PERM.VIEW_CHANNEL, security: null }) },
      order: ['s1'],
      members: {},
    });
    show();
    expect(screen.getByTestId('raid-alert')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pause Invites' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Open Members/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
  });
});
