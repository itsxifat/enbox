import { useEffect, useState } from 'react';
import {
  BellDot,
  BellRing,
  Eye,
  MessageCircle,
  MonitorSmartphone,
  Send,
  UsersRound,
  Volume2,
} from 'lucide-react';
import type { UserSettings } from '@enbox/shared';
import { PhoneIcon } from '@/components/icons';
import { Button, RadioGroup, toast } from '@/components/ui';
import {
  notificationPermission,
  playSound,
  requestNotificationPermission,
  showNotification,
  type PermissionState,
} from '@/lib/notify';
import {
  disablePush,
  enablePush,
  getServerConfig,
  pushSupported,
  type PushResult,
} from '@/lib/push';
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

const REACTION_CHOICES: {
  value: UserSettings['reactionNotifications'];
  label: string;
  description: string;
}[] = [
  { value: 'all', label: 'All messages', description: 'Reactions to any of your messages' },
  { value: 'dms', label: 'Direct messages only', description: 'Reactions in DMs and groups' },
  { value: 'off', label: 'Never', description: 'No notifications for reactions' },
];

function permissionText(p: PermissionState, pushAvailable: boolean | null): string {
  if (p === 'unsupported') return 'Not supported by this browser';
  if (p === 'denied') return 'Blocked in your browser settings';
  if (p === 'granted')
    return pushAvailable === false
      ? 'Allowed · shown while Enbox is open in a tab'
      : 'Allowed on this device';
  return 'Not enabled yet';
}

/**
 * Settings → Notifications: account toggles (server: messages, groups, calls, previews,
 * reactions) + this device (browser permission, desktop alerts, in-app banners, sounds).
 */
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
    // "Turn on" also turns this device's alerts back on (push follows that switch).
    useUi.getState().setPref('desktopNotifications', true);
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
          icon={PhoneIcon}
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

      <SettingsGroup title="Reactions" footer="When someone reacts to a message you sent.">
        <div className="px-3 py-1 lg:px-4">
          <RadioGroup
            aria-label="Reaction notifications"
            value={s.reactionNotifications}
            onChange={(v) => void updateSettings({ reactionNotifications: v })}
            options={REACTION_CHOICES}
          />
        </div>
      </SettingsGroup>

      <SettingsGroup
        title="On this device"
        footer="Channels never send notifications. Muted chats stay silent until you unmute them."
      >
        <SettingsRow
          icon={BellRing}
          title="Browser permission"
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
          onChange={(v) => {
            useUi.getState().setPref('desktopNotifications', v);
            // Web Push is shown by the service worker, which can't see this switch: the
            // subscription itself has to follow it.
            if (!pushSupported()) return;
            if (!v) void disablePush();
            else if (permission === 'granted' && pushAvailable) void enablePush();
          }}
        />
        <SwitchRow
          icon={BellDot}
          title="In-app banners"
          description="Show new messages from other chats at the top while Enbox is open"
          checked={prefs.inAppBanners}
          onChange={(v) => useUi.getState().setPref('inAppBanners', v)}
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
