/**
 * Web Push subscription (VAPID). No-op when unsupported, when the service worker is not
 * enabled, when the server has no `vapidPublicKey`, or when permission is not granted.
 *
 *   const result = await enablePush();          // from a user gesture (asks permission)
 *   await syncPushSubscription();              // silent: re-register if already granted
 *   await disablePush();                       // unsubscribe + DELETE on the server
 *
 * The device pref `desktopNotifications` ("Desktop alerts") controls the subscription: the
 * service worker can't read it and the server pushes to every subscription, so turning it
 * off unsubscribes, and the silent sync never re-subscribes while it is off.
 */
import { useUi } from '@/stores/ui';
import type { ApiResponse } from './api';
import { api } from './api';
import { notificationPermission, requestNotificationPermission } from './notify';
import { getServiceWorkerRegistration } from './sw';

export type PushResult = 'subscribed' | 'unsupported' | 'denied' | 'no-key' | 'error';

let configPromise: Promise<ApiResponse<'GET /api/config'>> | null = null;

/** Cached `GET /api/config` (public). */
export function getServerConfig(): Promise<ApiResponse<'GET /api/config'>> {
  if (!configPromise) {
    configPromise = api
      .get<ApiResponse<'GET /api/config'>>('/api/config', { auth: false })
      .catch((e: unknown) => {
        configPromise = null;
        throw e;
      });
  }
  return configPromise;
}

export function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window;
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function subscribe(): Promise<PushResult> {
  const reg = await getServiceWorkerRegistration();
  if (!reg) return 'unsupported';
  let key: string | null;
  try {
    key = (await getServerConfig()).vapidPublicKey;
  } catch {
    return 'error';
  }
  if (!key) return 'no-key';
  try {
    await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });
    }
    const json = sub.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) return 'error';
    await api.post('/api/push/subscriptions', {
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    });
    return 'subscribed';
  } catch (e) {
    console.warn('[push] subscribe failed', e);
    return 'error';
  }
}

/** Ask for notification permission (user gesture) and subscribe this device. */
export async function enablePush(): Promise<PushResult> {
  if (!pushSupported()) return 'unsupported';
  const perm = await requestNotificationPermission();
  if (perm === 'unsupported') return 'unsupported';
  if (perm !== 'granted') return 'denied';
  return subscribe();
}

/**
 * Silently (re)register the subscription if permission was already granted — unless the
 * user turned "Desktop alerts" off on this device.
 */
export async function syncPushSubscription(): Promise<PushResult> {
  if (!pushSupported()) return 'unsupported';
  if (!useUi.getState().prefs.desktopNotifications) return 'denied';
  if (notificationPermission() !== 'granted') return 'denied';
  return subscribe();
}

/**
 * Unsubscribe this device (best effort; used on logout and from settings). The browser
 * subscription goes first, so nothing more is delivered even if the DELETE never completes
 * (the server drops the row when the push service answers 404/410).
 */
export async function disablePush(): Promise<void> {
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    const endpoint = sub.endpoint;
    await sub.unsubscribe().catch(() => false);
    await api
      .delete('/api/push/subscriptions', { endpoint }, { timeoutMs: 4_000 })
      .catch(() => undefined);
  } catch {
    /* ignore */
  }
}
