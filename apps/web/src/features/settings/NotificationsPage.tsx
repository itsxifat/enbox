import { useEffect, useState } from 'react';
import {
  BellRing,
  Eye,
  MessageCircle,
  MonitorSmartphone,
  Phone,
  Send,
  UsersRound,
  Volume2,
} from 'lucide-react';
import { Button, toast } from '@/components/ui';
import {
  notificationPermission,
  playSound,
  requestNotificationPermission,
  showNotification,
  type PermissionState,
} from '@/lib/notify';
import { enablePush, getServerConfig, pushSupported, type PushResult } from '@/lib/push';
import { useMe } from '@/stores/auth';
import { useUi } from '@/stores/ui';
import { updateSettings } from './settingsApi';
import { SettingsGroup, SettingsRow, SettingsScroller, SwitchRow } from './ui';

const PUSH_MESSAGES: Record<PushResult, string> = {
  subscribed: 'Push notifications are on for this device',
  unsupported:
    'This browser can’t receive push notifications. You’ll still be notified while Enbox is open.',
  denied: 'Notifications are blocked. Allow them in your browser’s site settings.',
  'no-key': 'This server isn’t set up for push. You’ll be notified while Enbox is open.',
  error: 'Couldn’t turn on push notifications. Please try again.',
};

function permissionText(p: PermissionState, pushAvailable: boolean | null): string {
  if (p === 'unsupported') return 'Not supported by this browser';
  if (p === 'denied') return 'Blocked in your browser settings';
  if (p === 'granted')
    return pushAvailable === false
      ? 'Allowed · shown while Enbox is open in a tab'
      : 'Allowed on this device';
  return 'Not enabled yet';
}

/** Settings → Notifications: account toggles (server) + this device (permission, sounds). */
export function NotificationsPage() {
  const me = useMe();
  const prefs = useUi((s) => s.prefs);
  const [permission, setPermission] = useState<PermissionState>(() => notificationPermission());
  const [pushAvailable, setPushAvailable] = useState<boolean | null>(null);
  const [enabling, setEnabling] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!pushSupported()) {
      setPushAvailable(false);
      return;
    }
    getServerConfig()
      .then((c) => alive && setPushAvailable(!!c.vapidPublicKey))
      .catch(() => alive && setPushAvailable(null));
    return () => {
      alive = false;
    };
  }, []);

  if (!me) return null;
  const s = me.settings;

  const enable = async () => {
    setEnabling(true);
    try {
      if (pushSupported() && pushAvailable) {
        const r = await enablePush();
        setPermission(notificationPermission());
        if (r === 'subscribed') toast.success(PUSH_MESSAGES[r]);
        else toast.info(PUSH_MESSAGES[r]);
      } else {
        const p = await requestNotificationPermission();
        setPermission(p);
        if (p === 'granted') toast.success('Notifications are on while Enbox is open');
        else if (p === 'denied') toast.info(PUSH_MESSAGES.denied);
      }
    } finally {
      setEnabling(false);
    }
  };

  const test = async () => {
    let p = notificationPermission();
    if (p === 'default') {
      p = await requestNotificationPermission();
      setPermission(p);
    }
    if (p !== 'granted') {
      toast.info(PUSH_MESSAGES.denied);
      return;
    }
    const shown = await showNotification(
      {
        title: 'Enbox',
        body: 'Notifications are working 🎉',
        tag: 'enbox:test',
        url: '/settings/notifications',
      },
      { force: true },
    );
    if (prefs.sounds) playSound('notification');
    if (!shown) toast.error('Couldn’t show a notification on this device');
  };

  return (
    <SettingsScroller>
      <SettingsGroup title="Messages">
        <SwitchRow
          icon={MessageCircle}
          title="Message notifications"
          description="New messages in personal chats"
          checked={s.messageNotifications}
          onChange={(v) => void updateSettings({ messageNotifications: v })}
        />
        <SwitchRow
          icon={UsersRound}
          title="Group notifications"
          description="New messages in groups and communities"
          checked={s.groupNotifications}
          onChange={(v) => void updateSettings({ groupNotifications: v })}
        />
        <SwitchRow
          icon={Phone}
          title="Call notifications"
          description="Incoming voice and video calls"
          checked={s.callNotifications}
          onChange={(v) => void updateSettings({ callNotifications: v })}
        />
        <SwitchRow
          icon={Eye}
          title="Show previews"
          description="Show message text inside notifications"
          checked={s.notificationPreviews}
          onChange={(v) => void updateSettings({ notificationPreviews: v })}
        />
      </SettingsGroup>

      <SettingsGroup
        title="On this device"
        footer="Channels never send notifications. Muted chats stay silent until you unmute them."
      >
        <SettingsRow
          icon={BellRing}
          title="Notifications"
          description={permissionText(permission, pushAvailable)}
          chevron={false}
          end={
            permission === 'granted' ? null : (
              <Button
                size="sm"
                variant="soft"
                loading={enabling}
                disabled={permission === 'unsupported' || permission === 'denied'}
                onClick={() => void enable()}
              >
                Turn on
              </Button>
            )
          }
        />
        <SwitchRow
          icon={MonitorSmartphone}
          title="Desktop alerts"
          description="Show system notifications while Enbox is in the background"
          checked={prefs.desktopNotifications}
          onChange={(v) => useUi.getState().setPref('desktopNotifications', v)}
        />
        <SwitchRow
          icon={Volume2}
          title="In-app sounds"
          description="Play sounds for incoming and sent messages"
          checked={prefs.sounds}
          onChange={(v) => {
            useUi.getState().setPref('sounds', v);
            if (v) playSound('message');
          }}
        />
        <SettingsRow
          icon={Send}
          title="Send a test notification"
          onClick={() => void test()}
          disabled={permission === 'unsupported'}
        />
      </SettingsGroup>
    </SettingsScroller>
  );
}
