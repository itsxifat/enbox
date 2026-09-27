/**
 * App start-up (the web client's main.tsx): load the persisted storage copy, then theme,
 * notification handlers, realtime binding and the auth bootstrap — in that order, because
 * every store reads its persisted state synchronously.
 */
import 'react-native-url-polyfill/auto';
import { hydrateStorage } from '@/lib/storage';

let booted = null;

export function bootApp() {
  if (booted) return booted;
  booted = (async () => {
    await hydrateStorage();
    // Imported after hydration: their module-level code reads the storage copy.
    const { initTheme } = await import('@/stores/ui');
    const { installNotificationHandlers } = await import('@/lib/notify');
    const { bindRealtimeToAuth } = await import('@/realtime');
    const { useAuth } = await import('@/stores/auth');
    const { getServerConfig } = await import('@/lib/serverConfig');
    const { hasApiOrigin } = await import('@/lib/env');
    initTheme();
    installNotificationHandlers();
    bindRealtimeToAuth();
    void useAuth.getState().bootstrap();
    if (hasApiOrigin()) void getServerConfig().catch(() => undefined);
  })();
  return booted;
}
