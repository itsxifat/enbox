/**
 * SEC-2: turning "Desktop alerts" off unsubscribes Web Push on this device (and on again).
 * Reaction notifications (account), in-app banners (device) and the browser permission row.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useAuth } from '@/stores/auth';
import { useUi } from '@/stores/ui';
import { makeMe } from '@/test/factories';
import { NotificationsPage } from './NotificationsPage';

const patch = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  api: { patch: (...a: unknown[]) => patch(...a) },
}));

const push = vi.hoisted(() => ({
  enablePush: vi.fn(async () => 'subscribed' as const),
  disablePush: vi.fn(async () => undefined),
  getServerConfig: vi.fn(async () => ({ vapidPublicKey: 'key', maxUploadBytes: 1, version: '1' })),
  pushSupported: () => true,
}));
vi.mock('@/lib/push', () => push);

beforeEach(() => {
  vi.stubGlobal('Notification', { permission: 'granted' });
  useAuth.setState({ user: makeMe(), token: 't', status: 'authenticated' });
  useUi.getState().setPref('desktopNotifications', true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  push.enablePush.mockClear();
  push.disablePush.mockClear();
});

describe('NotificationsPage: Desktop alerts', () => {
  it('unsubscribes push when turned off and resubscribes when turned back on', async () => {
    render(<NotificationsPage />);
    const toggle = screen.getByRole('switch', { name: /Desktop alerts/ });
    // pushAvailable comes from /api/config (async).
    await waitFor(() => expect(push.getServerConfig).toHaveBeenCalled());
    await Promise.resolve();

    fireEvent.click(toggle);
    expect(useUi.getState().prefs.desktopNotifications).toBe(false);
    expect(push.disablePush).toHaveBeenCalledTimes(1);

    fireEvent.click(toggle);
    expect(useUi.getState().prefs.desktopNotifications).toBe(true);
    await waitFor(() => expect(push.enablePush).toHaveBeenCalledTimes(1));
  });
});

describe('NotificationsPage: reactions, banners and the browser permission', () => {
  afterEach(() => patch.mockReset());

  it('reaction notifications: DMs only by default; a choice is saved to my account', async () => {
    patch.mockImplementation(async (_path: string, body: object) => ({
      ...makeMe().settings,
      ...body,
    }));
    render(<NotificationsPage />);
    const group = screen.getByRole('group', { name: 'Reaction notifications' });
    expect(screen.getByRole('radio', { name: /Direct messages only/ })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: /All messages/ }));
    expect(patch).toHaveBeenCalledWith('/api/me/settings', { reactionNotifications: 'all' });
    await waitFor(() =>
      expect(useAuth.getState().user?.settings.reactionNotifications).toBe('all'),
    );
    expect(group).toBeInTheDocument();
  });

  it('in-app banners switch this device; the permission row says where it stands', async () => {
    render(<NotificationsPage />);
    const banners = screen.getByRole('switch', { name: /In-app banners/ });
    expect(banners).toBeChecked();
    fireEvent.click(banners);
    expect(useUi.getState().prefs.inAppBanners).toBe(false);
    fireEvent.click(banners);
    expect(useUi.getState().prefs.inAppBanners).toBe(true);
    expect(screen.getByText('Browser permission')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Allowed on this device')).toBeInTheDocument());
  });
});
