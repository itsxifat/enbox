/**
 * Synced preferences ("Sync across clients" in Settings ▸ Chats, `syncPreferences`): the
 * appearance, accessibility and chat keys below follow me across devices through
 * `/api/me/preferences` (everyday.ts SyncedPreferences); device-specific ones (audio devices,
 * push to talk, volumes, sounds, notifications, wallpaper) never leave the device.
 *
 * - Down: my document loads after sign-in and on every `ready` (realtime/preferences.ts) and
 *   arrives as `me:preferences` from my other devices; a document applies (its valid,
 *   whitelisted keys over the local prefs) only when its `updatedAt` is newer than the last one
 *   applied, so the echo of my own save and late responses change nothing.
 * - Up: local changes of the synced keys are PATCHed after a short pause (one request in
 *   flight). Keys changed here and not saved yet are never overwritten by an incoming
 *   document, survive a reload (`enbox.ui.sync`) and are retried after a failure.
 * - A first device seeds the empty document with what it changed from the defaults.
 * - Sync off stops both directions on this device; turning it back on takes the document.
 */
import {
  BUBBLE_STYLES,
  CHAT_THEME_PRESETS,
  MESSAGE_ANIMATIONS,
  type SyncedPreferences,
} from '@enbox/shared';
import { isAppTheme, isCustomThemeColors } from '@/features/appearance/appThemes';
import { api, isApiError } from '@/lib/api';
import { registerSessionReset, sessionEpoch } from '@/lib/session';
import { storage } from '@/lib/storage';
import { useAuth } from './auth';
import {
  CHAT_FONT_MAX_PX,
  CHAT_FONT_MIN_PX,
  DEFAULT_PREFS,
  FONT_SIZES,
  MESSAGE_GROUP_SPACINGS,
  UI_DENSITIES,
  chatFontPx,
  useUi,
  type DevicePrefs,
  type ThemePref,
  type UiState,
} from './ui';

const oneOf =
  (values: readonly unknown[]) =>
  (v: unknown): boolean =>
    values.includes(v);
const bool = (v: unknown): boolean => typeof v === 'boolean';
const between =
  (min: number, max: number) =>
  (v: unknown): boolean =>
    typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

/** Trusted link domains sync while the list stays small (the document has a size cap). */
const MAX_SYNCED_DOMAINS = 200;
const domains = (v: unknown): boolean =>
  Array.isArray(v) &&
  v.length <= MAX_SYNCED_DOMAINS &&
  v.every((d) => typeof d === 'string' && d.length > 0 && d.length <= 253);

const THEMES: readonly ThemePref[] = ['light', 'ash', 'dark', 'onyx', 'system'];

/** The synced keys and what a valid value of each is (`theme` is UiState's, the rest prefs). */
const VALIDATORS = {
  theme: oneOf(THEMES),
  appTheme: isAppTheme,
  customThemeColors: isCustomThemeColors,
  chatTheme: oneOf(CHAT_THEME_PRESETS),
  bubbleStyle: oneOf(BUBBLE_STYLES),
  messageDisplay: oneOf(['cozy', 'compact']),
  compactShowAvatars: bool,
  uiDensity: oneOf(UI_DENSITIES),
  chatFontPx: (v: unknown) => v === null || between(CHAT_FONT_MIN_PX, CHAT_FONT_MAX_PX)(v),
  fontSize: oneOf(Object.keys(FONT_SIZES)),
  reduceMotion: oneOf(['system', 'on', 'off']),
  saturation: between(0, 1),
  saturateRoleColors: bool,
  contrast: oneOf(['system', 'on', 'off']),
  underlineLinks: bool,
  roleColors: oneOf(['names', 'dot', 'hidden']),
  stickerAnimation: oneOf(['always', 'interaction', 'never']),
  animateEmoji: bool,
  superReactionAnimations: bool,
  showSendButton: bool,
  messageGroupSpacing: oneOf(MESSAGE_GROUP_SPACINGS),
  emoticonConversion: bool,
  linkPreviews: bool,
  enterToSend: bool,
  messageAnimation: oneOf(MESSAGE_ANIMATIONS),
  autoplayAnimatedMedia: oneOf(['always', 'hover', 'never']),
  showNameStyles: bool,
  developerMode: bool,
  trustedLinkDomains: domains,
} satisfies Partial<Record<'theme' | keyof DevicePrefs, (v: unknown) => boolean>>;

export type SyncedKey = keyof typeof VALIDATORS;

/** Every key that follows me across devices (the whitelist). */
export const SYNCED_KEYS = Object.keys(VALIDATORS) as SyncedKey[];

/** Whether `value` may be applied as `key` (whitelisted and well-formed). */
export function isSyncedValue(key: string, value: unknown): key is SyncedKey {
  return Object.hasOwn(VALIDATORS, key) && VALIDATORS[key as SyncedKey](value);
}

/** Changes are saved this long after the last one. */
export const SYNC_DEBOUNCE_MS = 1000;
/** A failed save is retried after this (and on the next `ready`). */
const RETRY_MS = 15_000;
const STORAGE_KEY = 'enbox.ui.sync';

interface SyncMeta {
  userId: string | null;
  /** `updatedAt` of the last document applied here. */
  appliedAt: string | null;
  /** Keys changed here and not saved yet. */
  pending: SyncedKey[];
}

let started = false;
let metaUserId: string | null = null;
let appliedAt: string | null = null;
/** The newest document seen this session (re-applied to keys whose save just finished). */
let latest: SyncedPreferences | null = null;
const pending = new Set<SyncedKey>();
const inflight = new Set<SyncedKey>();
let timer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let saving: Promise<void> | null = null;
let loading: Promise<void> | null = null;
/** Set while a document is being applied: those store changes are not mine to save. */
let applying = false;

function syncOn(): boolean {
  const auth = useAuth.getState();
  return useUi.getState().prefs.syncPreferences && auth.status === 'authenticated' && !!auth.user;
}

const newer = (a: string, b: string | null) => b === null || Date.parse(a) > Date.parse(b);
const sameValue = (a: unknown, b: unknown) =>
  Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b);

function valueOf(key: SyncedKey): unknown {
  const s = useUi.getState();
  if (key === 'theme') return s.theme;
  // Null means "the fontSize step": send the size it stands for (null would delete the key).
  if (key === 'chatFontPx') return s.prefs.chatFontPx ?? chatFontPx(s.prefs);
  return s.prefs[key];
}

function saveMeta(): void {
  if (!metaUserId) return;
  storage.setJSON(STORAGE_KEY, {
    userId: metaUserId,
    appliedAt,
    pending: [...pending, ...inflight],
  } satisfies SyncMeta);
}

/** The meta of the signed-in user (another account's is dropped). */
function adoptMeta(): void {
  const me = useAuth.getState().user?.id ?? null;
  if (!me || me === metaUserId) return;
  const saved = storage.getJSON<SyncMeta>(STORAGE_KEY);
  metaUserId = me;
  appliedAt = null;
  latest = null;
  pending.clear();
  if (saved?.userId === me) {
    appliedAt = typeof saved.appliedAt === 'string' ? saved.appliedAt : null;
    for (const k of saved.pending ?? []) if (Object.hasOwn(VALIDATORS, k)) pending.add(k);
  }
  saveMeta();
}

function clearTimers(): void {
  if (timer) clearTimeout(timer);
  if (retryTimer) clearTimeout(retryTimer);
  timer = null;
  retryTimer = null;
}

/** Apply the valid synced keys of `prefs` (all, or `only`), except the ones not saved yet. */
function apply(prefs: Record<string, unknown>, only: readonly SyncedKey[] = SYNCED_KEYS): void {
  const s = useUi.getState();
  const patch: Partial<Record<keyof DevicePrefs, unknown>> = {};
  let theme: ThemePref | null = null;
  for (const key of only) {
    if (pending.has(key) || inflight.has(key) || !Object.hasOwn(prefs, key)) continue;
    const value = prefs[key];
    if (!isSyncedValue(key, value)) continue;
    if (key === 'theme') {
      if (value !== s.theme) theme = value as ThemePref;
    } else if (!sameValue(value, s.prefs[key])) patch[key] = value;
  }
  if (!theme && Object.keys(patch).length === 0) return;
  applying = true;
  try {
    if (theme) s.setTheme(theme);
    if (Object.keys(patch).length) s.setPrefs(patch as Partial<DevicePrefs>);
  } finally {
    applying = false;
  }
}

/** First device of the account: save what it changed from the defaults. */
function seed(): void {
  const s = useUi.getState();
  for (const key of SYNCED_KEYS) {
    const current = key === 'theme' ? s.theme : s.prefs[key];
    const fallback = key === 'theme' ? 'dark' : DEFAULT_PREFS[key];
    if (!sameValue(current, fallback)) pending.add(key);
  }
  if (pending.size) {
    saveMeta();
    schedule(0);
  }
}

/** A document from the server (a load, my save's response, or `me:preferences`). */
export function receivePreferences(doc: SyncedPreferences): void {
  if (!syncOn() || !doc || typeof doc.prefs !== 'object' || doc.prefs === null) return;
  adoptMeta();
  if (!doc.updatedAt) {
    if (!latest) seed();
    return;
  }
  if (latest?.updatedAt && !newer(doc.updatedAt, latest.updatedAt)) return;
  latest = doc;
  if (!newer(doc.updatedAt, appliedAt)) return;
  appliedAt = doc.updatedAt;
  saveMeta();
  apply(doc.prefs);
}

function schedule(delay = SYNC_DEBOUNCE_MS): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void flushPreferences(), delay);
}

/** Save the pending keys now (after the save in flight, if any). */
export function flushPreferences(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  if (saving) return saving.then(() => (pending.size ? flushPreferences() : undefined));
  if (!syncOn() || pending.size === 0) return Promise.resolve();
  const keys = [...pending];
  const body: Record<string, unknown> = {};
  for (const key of keys) {
    const value = valueOf(key);
    if (isSyncedValue(key, value)) body[key] = value;
  }
  pending.clear();
  // Nothing sendable (e.g. a trusted domain list over the cap): those keys stay local.
  if (Object.keys(body).length === 0) {
    saveMeta();
    return Promise.resolve();
  }
  for (const key of keys) inflight.add(key);
  const epoch = sessionEpoch();
  saving = api
    .patch<SyncedPreferences>('/api/me/preferences', body)
    .then(
      (doc) => {
        if (epoch !== sessionEpoch()) return;
        inflight.clear();
        saveMeta();
        receivePreferences(doc);
        // A newer document arrived meanwhile: it may have changed these keys after my save.
        if (latest && latest !== doc) apply(latest.prefs, keys);
      },
      (error: unknown) => {
        if (epoch !== sessionEpoch()) return;
        inflight.clear();
        // Invalid or too big for the server: retrying cannot help, the keys stay local.
        const rejected = isApiError(error) && error.status === 400;
        if (!rejected) for (const key of keys) pending.add(key);
        saveMeta();
        if (!rejected) retryLater();
      },
    )
    .finally(() => {
      saving = null;
    });
  return saving;
}

function retryLater(): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (pending.size) void flushPreferences();
  }, RETRY_MS);
}

/**
 * Load my document (after sign-in, on every `ready`): unsaved keys go up first (the answer is
 * the merged document), otherwise a GET. Failures wait for the next `ready`.
 */
export function loadSyncedPreferences(): Promise<void> {
  if (!syncOn()) return Promise.resolve();
  adoptMeta();
  loading ??= (async () => {
    const epoch = sessionEpoch();
    try {
      if (pending.size) {
        await flushPreferences();
        return;
      }
      const doc = await api.get<SyncedPreferences>('/api/me/preferences');
      if (epoch === sessionEpoch()) receivePreferences(doc);
    } catch {
      // Offline or the server is away: the next `ready` loads again.
    } finally {
      loading = null;
    }
  })();
  return loading;
}

function onStoreChange(s: UiState, prev: UiState): void {
  if (applying) return;
  if (s.prefs.syncPreferences !== prev.prefs.syncPreferences) {
    clearTimers();
    pending.clear();
    latest = null;
    appliedAt = null;
    saveMeta();
    // Back on: this device takes the document (or seeds an empty one).
    if (s.prefs.syncPreferences) void loadSyncedPreferences();
    return;
  }
  if (!syncOn()) return;
  adoptMeta();
  let changed = false;
  if (s.theme !== prev.theme) {
    pending.add('theme');
    changed = true;
  }
  if (s.prefs !== prev.prefs)
    for (const key of SYNCED_KEYS)
      if (key !== 'theme' && !sameValue(s.prefs[key], prev.prefs[key])) {
        pending.add(key);
        changed = true;
      }
  if (!changed) return;
  saveMeta();
  schedule();
}

/** Forget everything (logout, tests): nothing pending, no document applied. */
export function resetPreferencesSync(): void {
  clearTimers();
  pending.clear();
  inflight.clear();
  latest = null;
  appliedAt = null;
  metaUserId = null;
  saving = null;
  loading = null;
  storage.remove(STORAGE_KEY);
}

/** Keys changed here and not saved yet (tests, diagnostics). */
export function pendingPreferenceKeys(): SyncedKey[] {
  return [...pending, ...inflight];
}

/** Watch the store for changes to save (idempotent; realtime/preferences.ts starts it). */
export function startPreferencesSync(): void {
  if (started) return;
  started = true;
  useUi.subscribe(onStoreChange);
  registerSessionReset(resetPreferencesSync);
  if (typeof document !== 'undefined')
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && pending.size) void flushPreferences();
    });
  if (typeof window !== 'undefined')
    window.addEventListener('online', () => {
      if (pending.size) schedule(0);
    });
}
