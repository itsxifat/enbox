/**
 * SEC-2: the "Desktop alerts" device switch controls the Web Push subscription.
 * SEC-3: logout unsubscribes locally first and closes the notifications already shown.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUi } from '@/stores/ui';
import { api } from './api';
import { closeAllNotifications, showNotification } from './notify';
import { disablePush, syncPushSubscription } from './push';
import { resetSessionState } from './session';

const shown: { close: () => void }[] = [];

const sub = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
  toJSON: () => ({
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
    keys: { p256dh: 'p', auth: 'a' },
  }),
  unsubscribe: vi.fn(async () => true),
};
const reg = {
  pushManager: {
    getSubscription: vi.fn(async () => sub),
    subscribe: vi.fn(async () => sub),
  },
  getNotifications: vi.fn(async () => shown),
};

vi.mock('./sw', () => ({ getServiceWorkerRegistration: async () => reg }));

beforeEach(() => {
  vi.stubGlobal('PushManager', function PushManager() {});
  vi.stubGlobal('Notification', { permission: 'granted' });
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { getRegistration: async () => reg, ready: Promise.resolve(reg) },
  });
  vi.spyOn(api, 'get').mockResolvedValue({ vapidPublicKey: 'BAAA' } as never);
  sub.unsubscribe.mockClear();
  shown.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (navigator as unknown as Record<string, unknown>).serviceWorker;
  useUi.getState().setPref('desktopNotifications', true);
});

describe('push subscription follows "Desktop alerts"', () => {
  it('the silent sync (login) does not re-subscribe while alerts are off', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue(undefined as never);
    useUi.getState().setPref('desktopNotifications', false);
    expect(await syncPushSubscription()).toBe('denied');
    expect(post).not.toHaveBeenCalled();
  });

  it('subscribes when alerts are on and permission was granted', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue(undefined as never);
    expect(await syncPushSubscription()).toBe('subscribed');
    expect(post).toHaveBeenCalledWith('/api/push/subscriptions', {
      endpoint: sub.endpoint,
      keys: { p256dh: 'p', auth: 'a' },
    });
  });
});

describe('disablePush (logout, alerts off)', () => {
  it('unsubscribes the browser first, even when the DELETE never completes', async () => {
    const del = vi.spyOn(api, 'delete').mockReturnValue(new Promise(() => undefined) as never);
    void disablePush();
    await vi.waitFor(() => expect(sub.unsubscribe).toHaveBeenCalled());
    expect(del).toHaveBeenCalledWith(
      '/api/push/subscriptions',
      { endpoint: sub.endpoint },
      { timeoutMs: 4_000 },
    );
  });
});

describe('notifications tray', () => {
  it('logout closes the notifications Enbox is showing', async () => {
    const n = { close: vi.fn() };
    shown.push(n);
    resetSessionState();
    await vi.waitFor(() => expect(n.close).toHaveBeenCalled());
  });

  it('also closes notifications created without a service worker', async () => {
    delete (navigator as unknown as Record<string, unknown>).serviceWorker;
    const created: { close: ReturnType<typeof vi.fn> }[] = [];
    vi.stubGlobal(
      'Notification',
      Object.assign(
        function FakeNotification(this: { close: () => void; onclose: unknown }) {
          this.close = vi.fn();
          created.push(this as never);
        },
        { permission: 'granted' },
      ),
    );
    expect(await showNotification({ title: 'Ann', body: 'secret preview' }, { force: true })).toBe(
      true,
    );
    await closeAllNotifications();
    expect(created[0]!.close).toHaveBeenCalled();
  });
});
