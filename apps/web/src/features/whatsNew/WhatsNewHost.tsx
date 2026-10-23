import { Suspense, useEffect } from 'react';
import { useLocation } from 'react-router';
import { isSettingsPath } from '@/features/settings/SettingsLayer';
import { lazyNamed } from '@/lib/lazy';
import { useConnection } from '@/lib/socket';
import { useAuth } from '@/stores/auth';
import {
  WHATS_NEW_VERSION,
  markWhatsNewSeen,
  openWhatsNew,
  seenWhatsNew,
  shouldShowWhatsNew,
  useWhatsNew,
} from './store';

const WhatsNewModal = lazyNamed(() => import('./WhatsNewModal'), 'WhatsNewModal');

/**
 * Mounted once by AppShell (outside the page, so it sees the live route): opens What's New on
 * its own once after an update — when the app is connected and User Settings is not up — and
 * renders it whenever it is open. Marked seen as it opens, so a reload doesn't show it again.
 */
export function WhatsNewHost() {
  const open = useWhatsNew((s) => s.open);
  const ready = useConnection((s) => s.readyCount > 0);
  const createdAt = useAuth((s) => s.user?.createdAt);
  const settings = isSettingsPath(useLocation().pathname);

  useEffect(() => {
    if (!ready || !createdAt || settings) return;
    const seen = seenWhatsNew();
    if (seen !== null && seen >= WHATS_NEW_VERSION) return;
    markWhatsNewSeen();
    // A first look marks only the newest entry as new.
    if (shouldShowWhatsNew(seen, createdAt)) openWhatsNew(seen ?? WHATS_NEW_VERSION - 1);
  }, [ready, createdAt, settings]);

  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <WhatsNewModal />
    </Suspense>
  );
}
