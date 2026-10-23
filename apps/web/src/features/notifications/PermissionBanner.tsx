/**
 * The "enable desktop notifications" bar across the top while the browser has not been asked
 * yet (permission `default`) and Desktop alerts are on: Enable asks (and subscribes this
 * device to push); ✕ hides it for good on this device.
 */
import { useEffect, useState } from 'react';
import { BellRing, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { notificationPermission, requestNotificationPermission } from '@/lib/notify';
import { enablePush, pushSupported } from '@/lib/push';
import { storage } from '@/lib/storage';
import { toast, useUi } from '@/stores/ui';

export const PERMISSION_BAR_DISMISSED_KEY = 'enbox.notifications.permissionBarDismissed';

/** Same chip as the connection banner (full-bleed on phones, a rounded card on desktop). */
const CHIP =
  'flex shrink-0 items-center justify-center gap-2 px-4 pt-[max(6px,env(safe-area-inset-top))] pb-1.5 text-[13px] font-medium lg:mx-2 lg:mt-2 lg:rounded-xl lg:py-1.5';

export function PermissionBanner() {
  const desktop = useUi((s) => s.prefs.desktopNotifications);
  const [permission, setPermission] = useState(() => notificationPermission());
  const [dismissed, setDismissed] = useState(
    () => storage.get(PERMISSION_BAR_DISMISSED_KEY) === '1',
  );
  const [busy, setBusy] = useState(false);

  // Allowed or blocked in the browser's site settings meanwhile.
  useEffect(() => {
    const sync = () => setPermission(notificationPermission());
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);

  if (permission !== 'default' || dismissed || !desktop) return null;

  const enable = async () => {
    setBusy(true);
    try {
      if (pushSupported()) await enablePush();
      else await requestNotificationPermission();
    } finally {
      const p = notificationPermission();
      setPermission(p);
      setBusy(false);
      if (p === 'denied')
        toast.info('Notifications are blocked. Allow them in your browser’s site settings.');
    }
  };

  return (
    <div
      role="status"
      className={cn(CHIP, 'bg-brand-soft text-brand-ink')}
      data-testid="notification-permission-bar"
    >
      <BellRing size={16} className="shrink-0" aria-hidden />
      <span className="min-w-0 truncate">
        Enbox needs your permission to enable desktop notifications.
      </span>
      <button
        type="button"
        onClick={() => void enable()}
        disabled={busy}
        className="ml-1 h-6 shrink-0 rounded-full border border-current px-3 text-[12.5px] font-semibold transition-colors hover:bg-brand/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-60"
      >
        Enable
      </button>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => {
          storage.set(PERMISSION_BAR_DISMISSED_KEY, '1');
          setDismissed(true);
        }}
        className="flex size-6 shrink-0 items-center justify-center rounded-full hover:bg-brand/10 focus-visible:outline-2 focus-visible:outline-brand"
      >
        <X size={14} aria-hidden />
      </button>
    </div>
  );
}
