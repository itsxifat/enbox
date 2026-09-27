/**
 * Notifications and UI sounds for the app.
 *
 *   await requestNotificationPermission();
 *   showNotification({ title, body, tag: `chat:${chatId}`, url: `/chats/${chatId}` });
 *   playSound('message');
 *   const stop = startLoop('ringtone'); ... stop();
 *
 * `showNotification` posts a local Android notification only while the app is in the
 * background (unless `force`); the same `tag` replaces an existing notification instead of
 * stacking. Tapping it navigates through the bus (`navigate`). The sounds are the web
 * client's WebAudio tones pre-rendered to WAV (scripts/generate-sounds.mjs).
 */
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import * as Notifications from 'expo-notifications';
import { AppState, Platform, Vibration } from 'react-native';
import { bus } from './bus';
import { registerSessionReset } from './session';

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

const native = Platform.OS !== 'web';
let handlerInstalled = false;

/** Foreground presentation + tap handling (call once at startup). */
export function installNotificationHandlers() {
  if (!native || handlerInstalled) return;
  handlerInstalled = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  if (Platform.OS === 'android') {
    void Notifications.setNotificationChannelAsync('messages', {
      name: 'Messages',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 180, 80, 180],
      lightColor: '#6d5dfc',
    }).catch(() => undefined);
    void Notifications.setNotificationChannelAsync('calls', {
      name: 'Calls',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 400, 200, 400],
      lightColor: '#6d5dfc',
    }).catch(() => undefined);
  }
  Notifications.addNotificationResponseReceivedListener((res) => {
    const url = res.notification.request.content.data?.url;
    if (typeof url === 'string') bus.emit('navigate', { to: url });
  });
}

export function notificationsSupported() {
  return native;
}

let permission = 'default';

export function notificationPermission() {
  return native ? permission : 'unsupported';
}

/** Ask for permission (Android 13+ shows the system prompt once). */
export async function requestNotificationPermission() {
  if (!native) return 'unsupported';
  try {
    const current = await Notifications.getPermissionsAsync();
    const res = current.granted ? current : await Notifications.requestPermissionsAsync();
    permission = res.granted ? 'granted' : res.canAskAgain ? 'default' : 'denied';
  } catch {
    permission = 'denied';
  }
  return permission;
}

/** The app is in the foreground (the user is looking at Enbox). */
export function isAppFocused() {
  return AppState.currentState === 'active';
}

/** Close every notification Enbox is showing (logout: previews must not stay in the tray). */
export async function closeAllNotifications() {
  if (!native) return;
  try {
    await Notifications.dismissAllNotificationsAsync();
  } catch {
    /* unsupported */
  }
}

registerSessionReset(() => void closeAllNotifications());

/**
 * Show a system notification when the app is in the background (or always with `force`).
 * Returns true if a notification was shown.
 */
export async function showNotification(n, opts = {}) {
  if (!native) return false;
  if (!opts.force && isAppFocused()) return false;
  if (permission !== 'granted') {
    const p = await Notifications.getPermissionsAsync().catch(() => null);
    if (!p?.granted) return false;
    permission = 'granted';
  }
  try {
    const identifier = n.tag ? n.tag.replace(/[^A-Za-z0-9:_-]/g, '_') : undefined;
    if (identifier) await Notifications.dismissNotificationAsync(identifier).catch(() => undefined);
    await Notifications.scheduleNotificationAsync({
      identifier,
      content: {
        title: n.title,
        body: n.body ?? '',
        data: { url: n.url ?? '/chats' },
        sound: n.silent ? undefined : 'default',
        ...(Platform.OS === 'android'
          ? { color: '#6d5dfc', channelId: n.tag?.startsWith('call') ? 'calls' : 'messages' }
          : {}),
      },
      trigger: null,
    });
    return true;
  } catch (e) {
    console.warn('[notify] failed to show notification', e);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Sounds
// ---------------------------------------------------------------------------

const SOURCES = {
  message: require('../../assets/sounds/message.wav'),
  sent: require('../../assets/sounds/sent.wav'),
  notification: require('../../assets/sounds/notification.wav'),
  end: require('../../assets/sounds/end.wav'),
  error: require('../../assets/sounds/error.wav'),
  ringtone: require('../../assets/sounds/ringtone.wav'),
  ringback: require('../../assets/sounds/ringback.wav'),
};

const players = {};
let audioModeSet = false;

function player(name) {
  if (!audioModeSet) {
    audioModeSet = true;
    void setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' }).catch(
      () => undefined,
    );
  }
  if (!players[name]) {
    try {
      players[name] = createAudioPlayer(SOURCES[name]);
    } catch {
      return null;
    }
  }
  return players[name];
}

/** Kept for the web client's startup call; native audio needs no unlock. */
export function installAudioUnlock() {}

/** Play a short UI sound. */
export function playSound(name) {
  const p = player(name);
  if (!p) return;
  try {
    p.loop = false;
    void p.seekTo(0);
    p.play();
  } catch {
    /* audio unavailable */
  }
}

/** Start a looping tone (ringtone / ringback). Returns a stop function. */
export function startLoop(name) {
  const p = player(name);
  let stopped = false;
  try {
    if (p) {
      p.loop = true;
      void p.seekTo(0);
      p.play();
    }
  } catch {
    /* audio unavailable */
  }
  return () => {
    if (stopped) return;
    stopped = true;
    try {
      p?.pause();
      p.loop = false;
    } catch {
      /* released */
    }
  };
}

/** Vibrate (Android). */
export function vibrate(pattern) {
  try {
    if (native) Vibration.vibrate(pattern);
  } catch {
    /* unsupported */
  }
}

/** Stop an ongoing vibration pattern (calls). */
export function cancelVibration() {
  try {
    if (native) Vibration.cancel();
  } catch {
    /* unsupported */
  }
}
