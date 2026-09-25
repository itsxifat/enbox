/** SEC-2: turning "Desktop alerts" off unsubscribes Web Push on this device (and on again). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useAuth } from '@/stores/auth';
import { useUi } from '@/stores/ui';
import { makeMe } from '@/test/factories';
import { NotificationsPage } from './NotificationsPage';

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
