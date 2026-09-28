/**
 * Settings → Notifications, Linked devices, Storage and data, Help (web features/settings:
 * NotificationsPage, DevicesPage, HelpPages).
 */
import { useCallback, useEffect, useState } from 'react';
import { Linking, Platform, View } from 'react-native';
import * as Application from 'expo-application';
import * as FileSystem from 'expo-file-system/legacy';
import { Image } from 'expo-image';
import {
  BellRing,
  ChevronDown,
  Database,
  Eye,
  HardDrive,
  Laptop,
  LogOut,
  MessageCircle,
  MonitorSmartphone,
  RefreshCw,
  Send,
  Server,
  Smartphone,
  Tablet,
  Trash2,
  Upload,
  UsersRound,
  Volume2,
} from 'lucide-react-native';
import { APP_NAME, formatBytes } from '@enbox/shared';
import { Icon, LogoMark, PhoneIcon } from '@/components/icons';
import {
  Button,
  EmptyState,
  ListItemSkeleton,
  Press,
  Spinner,
  T,
  confirm,
  toast,
} from '@/components/ui';
import { useBus } from '@/hooks/useBus';
import { api, errorMessage } from '@/lib/api';
import { getApiOrigin } from '@/lib/env';
import { formatRelativeShort, formatShortDate } from '@/lib/format';
import {
  checkNotificationPermission,
  notificationPermission,
  playSound,
  requestNotificationPermission,
  showNotification,
} from '@/lib/notify';
import { getServerConfig } from '@/lib/serverConfig';
import { useAuth, useMe } from '@/stores/auth';
import { useUi } from '@/stores/ui';
import { useTheme } from '@/theme';
import { updateSettings } from '../settingsApi';
import {
  SettingsGroup,
  SettingsHero,
  SettingsNote,
  SettingsRow,
  SettingsScroller,
  SwitchRow,
} from '../ui';

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

function permissionText(p) {
  if (p === 'unsupported') return 'Not supported on this device';
  if (p === 'denied') return 'Blocked in Android settings';
  if (p === 'granted') return 'Allowed · shown while Enbox is running';
  return 'Not enabled yet';
}

export function NotificationsPage() {
  const me = useMe();
  const prefs = useUi((s) => s.prefs);
  const [permission, setPermission] = useState(() => notificationPermission());
  const [enabling, setEnabling] = useState(false);

  useEffect(() => {
    void checkNotificationPermission().then(setPermission);
  }, []);

  if (!me) return null;
  const s = me.settings;

  const enable = async () => {
    setEnabling(true);
    useUi.getState().setPref('desktopNotifications', true);
    try {
      const p = await requestNotificationPermission();
      setPermission(p);
      if (p === 'granted') toast.success('Notifications are on for this device');
      else if (p === 'denied') {
        toast.info('Notifications are blocked. Allow them in Android settings.');
        void Linking.openSettings().catch(() => undefined);
      }
    } finally {
      setEnabling(false);
    }
  };

  const test = async () => {
    let p = await checkNotificationPermission();
    if (p === 'default') p = await requestNotificationPermission();
    setPermission(p);
    if (p !== 'granted') {
      toast.info('Notifications are blocked. Allow them in Android settings.');
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

      <SettingsGroup
        title="On this device"
        footer="Channels never send notifications. Muted chats stay silent until you unmute them."
      >
        <SettingsRow
          icon={BellRing}
          title="Notifications"
          description={permissionText(permission)}
          chevron={false}
          end={
            permission === 'granted' ? null : (
              <Button
                size="sm"
                variant="soft"
                loading={enabling}
                disabled={permission === 'unsupported'}
                onPress={() => void enable()}
              >
                Turn on
              </Button>
            )
          }
        />
        <SwitchRow
          icon={MonitorSmartphone}
          title="System alerts"
          description="Show notifications while Enbox is in the background"
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
          onPress={() => void test()}
          disabled={permission === 'unsupported'}
        />
      </SettingsGroup>
    </SettingsScroller>
  );
}

// ---------------------------------------------------------------------------
// Linked devices
// ---------------------------------------------------------------------------

function deviceIcon(s) {
  const text = `${s.deviceName} ${s.userAgent ?? ''}`;
  if (/iPad|Tablet/i.test(text)) return Tablet;
  if (/Android|iPhone|iOS|Mobile|okhttp/i.test(text)) return Smartphone;
  return Laptop;
}

function lastActive(s) {
  if (s.current) return 'Active now';
  const when = formatRelativeShort(s.lastActiveAt);
  return `Last active ${when.charAt(0).toLowerCase()}${when.slice(1)}`;
}

export function DevicesPage() {
  const { tw, c } = useTheme();
  const [sessions, setSessions] = useState(null);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [busyAll, setBusyAll] = useState(false);

  const load = useCallback(async () => {
    try {
      setSessions(await api.get('/api/auth/sessions'));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useBus('realtime:ready', () => void load());

  const revoke = async (s) => {
    if (s.current) {
      const ok = await confirm({
        title: 'Log out of this device?',
        confirmLabel: 'Log out',
        danger: true,
      });
      if (ok) await useAuth.getState().logout();
      return;
    }
    const ok = await confirm({
      title: `Log out ${s.deviceName}?`,
      message: 'That device will need your password to use Enbox again.',
      confirmLabel: 'Log out',
      danger: true,
    });
    if (!ok) return;
    setBusyId(s.id);
    try {
      await api.delete(`/api/auth/sessions/${s.id}`);
      setSessions((list) => list?.filter((x) => x.id !== s.id) ?? null);
      toast.success('Device logged out');
    } catch (e) {
      toast.error(e);
      void load();
    } finally {
      setBusyId(null);
    }
  };

  const revokeOthers = async () => {
    const ok = await confirm({
      title: 'Log out all other devices?',
      message: 'Every device except this one will be logged out.',
      confirmLabel: 'Log out all',
      danger: true,
    });
    if (!ok) return;
    setBusyAll(true);
    try {
      await api.delete('/api/auth/sessions');
      setSessions((list) => list?.filter((x) => x.current) ?? null);
      toast.success('All other devices were logged out');
    } catch (e) {
      toast.error(e);
    } finally {
      setBusyAll(false);
    }
  };

  const others = sessions?.filter((s) => !s.current).length ?? 0;

  return (
    <SettingsScroller>
      <SettingsHero icon={MonitorSmartphone} title="Use Enbox on other devices">
        Log in with your username and password on another phone, tablet or computer. Your chats stay
        in sync everywhere.
      </SettingsHero>

      {error && !sessions ? (
        <EmptyState
          compact
          title="Couldn't load your devices"
          description={error}
          action={
            <Button variant="soft" leftIcon={RefreshCw} onPress={() => void load()}>
              Try again
            </Button>
          }
        />
      ) : (
        <SettingsGroup
          title={sessions ? `Active sessions (${sessions.length})` : 'Active sessions'}
          footer="Tap a device to log it out. Changing your password also logs out every other device."
        >
          {!sessions ? (
            <ListItemSkeleton count={2} />
          ) : (
            sessions.map((s) => (
              <Press
                key={s.id}
                onPress={() => void revoke(s)}
                disabled={busyId === s.id}
                accessibilityLabel={`${s.deviceName}${s.current ? ' (this device)' : ''}. ${lastActive(s)}. Log out`}
                style={[
                  tw`flex-row items-center gap-4 rounded-lg px-4 py-3`,
                  busyId === s.id ? { opacity: 0.5 } : null,
                ]}
              >
                <View style={tw`size-11 items-center justify-center rounded-full bg-brand-soft`}>
                  <Icon icon={deviceIcon(s)} size={22} color={c['brand-ink']} />
                </View>
                <View style={tw`min-w-0 flex-1 gap-0.5`}>
                  <View style={tw`flex-row items-center gap-2`}>
                    <T numberOfLines={1} style={tw`shrink text-[16px]`}>
                      {s.deviceName}
                    </T>
                    {s.current ? (
                      <View style={tw`rounded-full bg-success-soft px-2 py-0.5`}>
                        <T style={tw`text-[11px] font-semibold text-success`}>This device</T>
                      </View>
                    ) : null}
                  </View>
                  <T numberOfLines={1} style={tw`text-[13.5px] text-muted`}>
                    {lastActive(s)}
                    {s.ip ? ` · ${s.ip}` : ''}
                  </T>
                  <T numberOfLines={1} style={tw`text-[12.5px] text-subtle`}>
                    Linked {formatShortDate(s.createdAt)}
                  </T>
                </View>
                <Icon icon={LogOut} size={18} color={c.subtle} />
              </Press>
            ))
          )}
        </SettingsGroup>
      )}

      {others > 0 ? (
        <View style={tw`px-4 pt-2`}>
          <Button
            variant="outline"
            fullWidth
            leftIcon={LogOut}
            loading={busyAll}
            onPress={() => void revokeOthers()}
            textStyle={tw`text-danger`}
          >
            Log out all other devices
          </Button>
        </View>
      ) : sessions ? (
        <SettingsNote>This is the only device logged in to your account.</SettingsNote>
      ) : null}
    </SettingsScroller>
  );
}

// ---------------------------------------------------------------------------
// Help + Storage
// ---------------------------------------------------------------------------

function useServerConfig() {
  const [config, setConfig] = useState(null);
  useEffect(() => {
    let alive = true;
    getServerConfig()
      .then((c) => alive && setConfig(c))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return config;
}

const FAQ = [
  {
    q: 'How do I start a chat?',
    a: 'Tap the new chat button, then pick a contact or search for someone by their exact @username or phone number (with country code). You can also add a contact to save them under a name you choose.',
  },
  {
    q: 'Who can see my last seen, photo and about?',
    a: 'You decide in Privacy: everyone, only your contacts, or nobody. If you hide your last seen, you can’t see other people’s either.',
  },
  {
    q: 'How do I use Enbox on another device?',
    a: 'Install the app or open Enbox in a browser on that device and log in with your username and password. Manage every signed-in device from Linked devices.',
  },
  {
    q: 'How do disappearing messages work?',
    a: 'When a timer is on, new messages vanish from the chat after 24 hours, 7 days or 90 days. Turn it on per chat from the contact or group info, or set a default for new chats in Privacy.',
  },
  {
    q: 'What happens when I block someone?',
    a: 'They can’t message or call you, and they no longer see your last seen, online status, photo or about. They aren’t notified.',
  },
  {
    q: 'Which server does the app use?',
    a: 'The server address is shown under “Server” on this page. Stock builds use the hosted Enbox; builds pointed at another server can switch it from the login screen after logging out.',
  },
];

function Faq({ q, a }) {
  const { tw, c } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View>
      <Press
        onPress={() => setOpen((v) => !v)}
        accessibilityState={{ expanded: open }}
        style={tw`min-h-14 flex-row items-center gap-3 rounded-lg px-4 py-3`}
      >
        <T style={tw`flex-1 text-[15.5px]`}>{q}</T>
        <Icon
          icon={ChevronDown}
          size={18}
          color={c.subtle}
          style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}
        />
      </Press>
      {open ? (
        <T style={[tw`px-4 pb-4 text-[14px] text-muted`, { lineHeight: 22.75 }]}>{a}</T>
      ) : null}
    </View>
  );
}

export function HelpPage() {
  const { tw, shadow } = useTheme();
  const config = useServerConfig();
  const appVersion = Application.nativeApplicationVersion;
  return (
    <SettingsScroller>
      <View style={tw`items-center gap-2 px-6 py-8`}>
        <View style={shadow.elevated}>
          <LogoMark size={72} />
        </View>
        <T style={tw`mt-3 text-xl font-semibold`}>{APP_NAME} for Android</T>
        <T style={tw`text-[14px] text-muted`}>
          {appVersion ? `App ${appVersion} · ` : ''}Server {config?.version ?? '…'}
        </T>
      </View>

      <SettingsGroup title="Help center">
        {FAQ.map((f) => (
          <Faq key={f.q} q={f.q} a={f.a} />
        ))}
      </SettingsGroup>

      <SettingsGroup title="Server">
        <SettingsRow
          icon={Server}
          title="Server address"
          description={getApiOrigin().replace(/^https?:\/\//, '')}
          chevron={false}
        />
      </SettingsGroup>

      <SettingsNote>
        {APP_NAME} is a messenger for chats, groups, communities, channels, status updates and
        calls. Messages are stored on your {APP_NAME} server and synced to every device you link.
      </SettingsNote>
    </SettingsScroller>
  );
}

async function dirSize(uri) {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) return 0;
    if (!info.isDirectory) return info.size ?? 0;
    const names = await FileSystem.readDirectoryAsync(uri);
    let total = 0;
    for (const n of names) total += await dirSize(`${uri.replace(/\/$/, '')}/${n}`);
    return total;
  } catch {
    return 0;
  }
}

export function StoragePage() {
  const { tw, c } = useTheme();
  const config = useServerConfig();
  const [usage, setUsage] = useState(null);
  const [clearing, setClearing] = useState(false);

  const refresh = useCallback(() => {
    if (Platform.OS === 'web' || !FileSystem.cacheDirectory) {
      setUsage(0);
      return;
    }
    void dirSize(FileSystem.cacheDirectory).then(setUsage);
  }, []);
  useEffect(refresh, [refresh]);

  const clear = async () => {
    const ok = await confirm({
      title: 'Clear cached media?',
      message:
        'Photos, videos and files you opened will download again when you view them. Your chats and settings are not affected.',
      confirmLabel: 'Clear',
    });
    if (!ok) return;
    setClearing(true);
    try {
      await Image.clearDiskCache();
      await Image.clearMemoryCache();
      if (FileSystem.cacheDirectory) {
        const names = await FileSystem.readDirectoryAsync(FileSystem.cacheDirectory);
        await Promise.all(
          names.map((n) =>
            FileSystem.deleteAsync(`${FileSystem.cacheDirectory}${n}`, { idempotent: true }).catch(
              () => undefined,
            ),
          ),
        );
      }
      toast.success('Cache cleared');
      refresh();
    } catch (e) {
      toast.error(e);
    } finally {
      setClearing(false);
    }
  };

  return (
    <SettingsScroller>
      <SettingsGroup title="This device">
        <View style={tw`flex-row items-center gap-3 px-4 py-4`}>
          <Icon icon={HardDrive} size={22} color={c.muted} />
          <View style={tw`flex-1`}>
            <T style={tw`text-[16px]`}>
              {usage === null ? 'Calculating…' : `${formatBytes(usage)} of cached media`}
            </T>
            <T style={tw`text-[13px] text-muted`}>Downloads and previews kept on this phone</T>
          </View>
        </View>
        <SettingsRow
          icon={Trash2}
          title="Clear cached media"
          description="Frees space; your chats stay on the server"
          onPress={() => void clear()}
          end={clearing ? <Spinner size={18} /> : undefined}
        />
      </SettingsGroup>
      <SettingsGroup title="Network">
        <SettingsRow
          icon={Upload}
          title="Maximum file size"
          description={config ? formatBytes(config.maxUploadBytes) : '…'}
        />
        <SettingsRow
          icon={Database}
          title="Media quality"
          description="Photos are optimized before sending. Send as a document to keep the original."
        />
      </SettingsGroup>
    </SettingsScroller>
  );
}
