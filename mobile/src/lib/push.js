/**
 * Push notifications. The server delivers Web Push (VAPID) to browsers; the Android app has
 * no web push endpoint, so it shows local notifications for socket events while it runs
 * (lib/notify.js). These stubs keep the web client's call sites.
 */
export async function disablePush() {}
export async function syncPushSubscription() {
  return 'unsupported';
}
export function pushSupported() {
  return false;
}
