/**
 * Browser notifications and UI sounds (generated with WebAudio — no binary assets).
 *
 *   await requestNotificationPermission();
 *   showNotification({ title, body, tag: `chat:${chatId}`, url: `/chats/${chatId}` });
 *   playSound('message');
 *   const stop = startLoop('ringtone'); ... stop();
 *
 * `showNotification` only shows when the app is hidden/unfocused (unless `force`), and
 * prefers the service worker registration (required on Android). Same `tag` replaces an
 * existing notification instead of stacking.
 */
import { bus } from './bus';
import { registerSessionReset } from './session';

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export type PermissionState = NotificationPermission | 'unsupported';

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function notificationPermission(): PermissionState {
  return notificationsSupported() ? Notification.permission : 'unsupported';
}

/** Ask for permission (must be called from a user gesture in most browsers). */
export async function requestNotificationPermission(): Promise<PermissionState> {
  if (!notificationsSupported()) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

/** The page is visible and focused (the user is looking at Enbox). */
export function isAppFocused(): boolean {
  return document.visibilityState === 'visible' && document.hasFocus();
}

export interface AppNotification {
  title: string;
  body?: string;
  /** Collapses notifications with the same tag (e.g. `chat:<id>`). */
  tag?: string;
  /** In-app path to open on click, e.g. `/chats/<id>`. */
  url?: string;
  icon?: string;
  silent?: boolean;
}

/** Shown with `new Notification()` (no SW registration): getNotifications() can't list them. */
const pageNotifications = new Set<Notification>();

/**
 * Close every notification Enbox is showing on this device (logout: message previews must
 * not stay in the tray after the session ends).
 */
export async function closeAllNotifications(): Promise<void> {
  for (const n of pageNotifications) n.close();
  pageNotifications.clear();
  try {
    const reg =
      'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
    const list = (await reg?.getNotifications()) ?? [];
    for (const n of list) n.close();
  } catch {
    /* unsupported */
  }
}

registerSessionReset(() => void closeAllNotifications());

/**
 * Show a system notification when the app is not focused (or always with `force`).
 * Returns true if a notification was shown.
 */
export async function showNotification(
  n: AppNotification,
  opts: { force?: boolean } = {},
): Promise<boolean> {
  if (notificationPermission() !== 'granted') return false;
  if (!opts.force && isAppFocused()) return false;
  const options: NotificationOptions = {
    body: n.body,
    tag: n.tag,
    icon: n.icon ?? '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    silent: n.silent,
    data: { url: n.url ?? '/chats' },
  };
  try {
    const reg =
      'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
    if (reg) {
      await reg.showNotification(n.title, options);
      return true;
    }
    const notification = new Notification(n.title, options);
    pageNotifications.add(notification);
    notification.onclose = () => pageNotifications.delete(notification);
    notification.onclick = () => {
      window.focus();
      if (n.url) bus.emit('navigate', { to: n.url });
      notification.close();
    };
    return true;
  } catch (e) {
    console.warn('[notify] failed to show notification', e);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Sounds
// ---------------------------------------------------------------------------

export type SoundName = 'message' | 'sent' | 'notification' | 'end' | 'error';
export type LoopName = 'ringtone' | 'ringback';

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) {
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  return ctx;
}

/**
 * Browsers only allow audio after a user gesture. Call once at startup; it resumes the
 * AudioContext on the first pointer/key interaction.
 */
export function installAudioUnlock(): void {
  const unlock = () => {
    const a = audio();
    if (a && a.state !== 'suspended') {
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
    }
  };
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
}

interface Tone {
  /** Frequencies played together (Hz). */
  freqs: number[];
  /** Start offset (s) relative to the sequence start. */
  at: number;
  /** Duration (s). */
  dur: number;
  gain?: number;
  type?: OscillatorType;
  /** Optional glide target for the first frequency. */
  glideTo?: number;
}

function playTones(tones: Tone[], volume = 0.25): void {
  const a = audio();
  if (!a || a.state !== 'running') return;
  const master = a.createGain();
  master.gain.value = volume;
  master.connect(a.destination);
  const t0 = a.currentTime + 0.01;
  let end = t0;
  for (const tone of tones) {
    const start = t0 + tone.at;
    const stop = start + tone.dur;
    end = Math.max(end, stop);
    const env = a.createGain();
    const peak = tone.gain ?? 1;
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(peak, start + Math.min(0.015, tone.dur / 4));
    env.gain.exponentialRampToValueAtTime(0.0001, stop);
    env.connect(master);
    for (const [i, f] of tone.freqs.entries()) {
      const osc = a.createOscillator();
      osc.type = tone.type ?? 'sine';
      osc.frequency.setValueAtTime(f, start);
      if (i === 0 && tone.glideTo) osc.frequency.exponentialRampToValueAtTime(tone.glideTo, stop);
      osc.connect(env);
      osc.start(start);
      osc.stop(stop + 0.02);
    }
  }
  setTimeout(() => master.disconnect(), (end - a.currentTime + 0.2) * 1000);
}

const SOUNDS: Record<SoundName, { tones: Tone[]; volume: number }> = {
  message: {
    volume: 0.22,
    tones: [
      { freqs: [880], at: 0, dur: 0.09 },
      { freqs: [1318.5], at: 0.1, dur: 0.16 },
    ],
  },
  sent: {
    volume: 0.12,
    tones: [{ freqs: [620], glideTo: 980, at: 0, dur: 0.08, type: 'triangle' }],
  },
  notification: {
    volume: 0.2,
    tones: [
      { freqs: [1046.5], at: 0, dur: 0.12 },
      { freqs: [1568], at: 0.12, dur: 0.2 },
    ],
  },
  end: {
    volume: 0.2,
    tones: [
      { freqs: [660], at: 0, dur: 0.14 },
      { freqs: [440], at: 0.16, dur: 0.24 },
    ],
  },
  error: {
    volume: 0.18,
    tones: [{ freqs: [220, 233], at: 0, dur: 0.25, type: 'square', gain: 0.4 }],
  },
};

/** Play a short UI sound (no-op until audio is unlocked by a user gesture). */
export function playSound(name: SoundName): void {
  const s = SOUNDS[name];
  playTones(s.tones, s.volume);
}

const LOOPS: Record<LoopName, { tones: Tone[]; period: number; volume: number }> = {
  // Incoming call: two quick two-tone bursts, then a pause.
  ringtone: {
    period: 2.4,
    volume: 0.3,
    tones: [
      { freqs: [659.3, 830.6], at: 0, dur: 0.35 },
      { freqs: [659.3, 830.6], at: 0.45, dur: 0.35 },
    ],
  },
  // Outgoing "ringing" tone heard by the caller.
  ringback: { period: 4, volume: 0.15, tones: [{ freqs: [440, 480], at: 0, dur: 1.4 }] },
};

/** Start a looping tone (ringtone / ringback). Returns a stop function. */
export function startLoop(name: LoopName): () => void {
  const loop = LOOPS[name];
  const tick = () => playTones(loop.tones, loop.volume);
  tick();
  const id = window.setInterval(tick, loop.period * 1000);
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    window.clearInterval(id);
  };
}

/** Vibrate on supporting devices (Android). */
export function vibrate(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* unsupported */
  }
}
