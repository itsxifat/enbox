/** Security actions: pause and resume invites / DMs, the safety alerts channel and raid alerts; who sees what; `space:security`. */
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { PERM, type SpaceSecurity } from '@enbox/shared';
import { api } from '@/lib/api';
import type { AppSocket } from '@/lib/socket';
import { registerModerationHandlers } from '@/realtime/moderation';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useSpaces } from '@/stores/spaces';
import { useUi } from '@/stores/ui';
import { makeChat, makeMe } from '@/test/factories';
import { makeSpace } from '@/features/spaces/testUtils';
import { SecurityCard } from './SecurityCard';

const HOUR = 3600_000;
const later = (ms: number) => new Date(Date.now() + ms).toISOString();

function security(p: Partial<SpaceSecurity> = {}): SpaceSecurity {
  return {
    invitesPausedUntil: null,
    dmsPausedUntil: null,
    safetyAlertsChannelId: null,
    raidAlerts: true,
    ...p,
  };
}

function channel(id: string, name: string) {
  return {
    ...makeChat({ id, name, type: 'space_text' }),
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
  };
}

function seed(p: Parameters<typeof makeSpace>[0]) {
  useSpaces.setState({ byId: { s1: makeSpace(p) }, order: ['s1'], members: {} });
}

const card = () => render(<SecurityCard space={useSpaces.getState().byId.s1!} />);
const rerenderWith = (rerender: (ui: ReactElement) => void) =>
  rerender(<SecurityCard space={useSpaces.getState().byId.s1!} />);

beforeEach(() => {
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
  useUi.setState({ toasts: [], dialogs: [] });
  useChats.setState({
    byId: { general: channel('general', 'general'), alerts: channel('alerts', 'mod-alerts') },
  });
});

describe('the security card', () => {
  it('pauses invites for a chosen length and resumes DMs', async () => {
    seed({ owner: true, security: security({ dmsPausedUntil: later(2 * HOUR) }) });
    const patch = vi
      .spyOn(api, 'patch')
      .mockResolvedValueOnce(
        security({ invitesPausedUntil: later(6 * HOUR), dmsPausedUntil: later(2 * HOUR) }) as never,
      )
      .mockResolvedValueOnce(security({ invitesPausedUntil: later(6 * HOUR) }) as never);
    const { rerender } = card();
    const invites = screen.getByTestId('pause-Pause Invites');
    expect(invites).toHaveTextContent('No one can join with an invite');
    const dms = screen.getByTestId('pause-Pause DMs');
    expect(dms).toHaveTextContent(/DMs are paused until/);

    fireEvent.click(within(invites).getByRole('button', { name: 'Pause Invites' }));
    await act(async () => {
      fireEvent.click(await screen.findByRole('menuitem', { name: 'For 6 hours' }));
    });
    expect(patch).toHaveBeenCalledWith('/api/spaces/s1/security', { pauseInvitesSec: 21600 });
    expect(useSpaces.getState().byId.s1).toMatchObject({ invitesPaused: true });
    expect(useUi.getState().toasts.map((t) => t.message)).toEqual(['Invites paused']);
    rerenderWith(rerender);
    expect(screen.getByTestId('pause-Pause Invites')).toHaveTextContent(/Invites are paused until/);

    await act(async () => {
      fireEvent.click(
        within(screen.getByTestId('pause-Pause DMs')).getByRole('button', { name: 'Resume' }),
      );
    });
    expect(patch).toHaveBeenLastCalledWith('/api/spaces/s1/security', { pauseDmsSec: null });
    rerenderWith(rerender);
    expect(screen.getByTestId('pause-Pause DMs')).toHaveTextContent('Members who aren’t friends');
  });

  it('managers choose the alerts channel and switch raid alerts', async () => {
    seed({ owner: true, security: security() });
    const patch = vi
      .spyOn(api, 'patch')
      .mockResolvedValueOnce(security({ safetyAlertsChannelId: 'alerts' }) as never)
      .mockResolvedValueOnce(
        security({ safetyAlertsChannelId: 'alerts', raidAlerts: false }) as never,
      );
    card();
    const select = screen.getByLabelText('Safety alerts channel');
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['No alerts channel', '#general', '#mod-alerts']);
    await act(async () => {
      fireEvent.change(select, { target: { value: 'alerts' } });
    });
    expect(patch).toHaveBeenCalledWith('/api/spaces/s1/security', {
      safetyAlertsChannelId: 'alerts',
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('switch', { name: 'Raid alerts' }));
    });
    expect(patch).toHaveBeenLastCalledWith('/api/spaces/s1/security', { raidAlerts: false });
    expect(useSpaces.getState().byId.s1!.security).toMatchObject({ raidAlerts: false });
  });

  it('moderators with Time out Members pause, but don’t choose alerts; others see nothing', () => {
    seed({ myPermissions: PERM.MODERATE_MEMBERS, security: security() });
    const { unmount } = card();
    expect(screen.getByTestId('pause-Pause Invites')).toBeInTheDocument();
    expect(screen.queryByLabelText('Safety alerts channel')).toBeNull();
    expect(screen.queryByRole('switch', { name: 'Raid alerts' })).toBeNull();
    unmount();
    seed({ myPermissions: PERM.KICK_MEMBERS, security: null });
    const { container } = card();
    expect(container).toBeEmptyDOMElement();
  });

  it('a Space that came without the details fetches them', async () => {
    seed({ owner: true });
    const get = vi
      .spyOn(api, 'get')
      .mockResolvedValue(security({ invitesPausedUntil: later(HOUR) }) as never);
    card();
    await act(async () => undefined);
    expect(get).toHaveBeenCalledWith('/api/spaces/s1/security');
    expect(useSpaces.getState().byId.s1).toMatchObject({ invitesPaused: true });
  });
});

describe('space:security', () => {
  it('moderators get the details, everyone else whether invites are paused', () => {
    const handlers: Record<string, (p: unknown) => void> = {};
    registerModerationHandlers({
      on: (e: string, fn: (p: unknown) => void) => (handlers[e] = fn),
    } as unknown as AppSocket);
    const s = security({ invitesPausedUntil: later(HOUR) });

    seed({ owner: true, security: security() });
    handlers['space:security']!({ spaceId: 's1', security: s });
    expect(useSpaces.getState().byId.s1).toMatchObject({ invitesPaused: true, security: s });

    seed({ myPermissions: 0, security: null });
    handlers['space:security']!({ spaceId: 's1', security: s });
    expect(useSpaces.getState().byId.s1).toMatchObject({ invitesPaused: true, security: null });
    handlers['space:security']!({ spaceId: 's1', security: security() });
    expect(useSpaces.getState().byId.s1!.invitesPaused).toBe(false);
  });
});
