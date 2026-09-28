/**
 * Runtime environment. Unlike the web client (same-origin), the Android app talks to an
 * absolute server origin: `EXPO_PUBLIC_API_URL` at build time (falling back to the hosted
 * Enbox at PRODUCTION_ORIGIN, so a stock build connects without asking), overridable from
 * the sign-in screen ("Server", shown only when a custom server is set) and persisted in
 * `enbox.server`.
 *
 *   getApiOrigin()             // 'https://enbox.dev' (no trailing slash)
 *   setApiOrigin('http://192.168.1.20:4000')
 *   isDefaultOrigin()          // true while the app talks to the built-in server
 */
import { Platform } from 'react-native';
import { storage, StorageKeys } from './storage';

/** The hosted Enbox every stock build talks to unless EXPO_PUBLIC_API_URL overrides it. */
export const PRODUCTION_ORIGIN = 'https://enbox.dev';

export function normalizeOrigin(value) {
  let v = (value ?? '').trim();
  if (!v) return '';
  if (!/^https?:\/\//i.test(v)) v = `http://${v}`;
  try {
    const u = new URL(v);
    // `new URL().origin` is unreliable on Hermes: rebuild it.
    return `${u.protocol}//${u.host}`.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

/**
 * Build-time default: EXPO_PUBLIC_API_URL, else the web page's own origin (web preview),
 * else the hosted Enbox.
 */
function defaultOrigin() {
  const fromEnv = normalizeOrigin(process.env.EXPO_PUBLIC_API_URL);
  if (fromEnv) return fromEnv;
  if (Platform.OS === 'web' && typeof window !== 'undefined') return window.location.origin;
  return PRODUCTION_ORIGIN;
}

let origin = null;

/** The API/socket origin ('' until one is configured). */
export function getApiOrigin() {
  if (origin === null) origin = normalizeOrigin(storage.get(StorageKeys.server)) || defaultOrigin();
  return origin;
}

/** Point the app at another server (persisted). Pass '' to go back to the default. */
export function setApiOrigin(value) {
  const next = normalizeOrigin(value);
  if (next) storage.set(StorageKeys.server, next);
  else storage.remove(StorageKeys.server);
  origin = next || defaultOrigin();
  return origin;
}

export function hasApiOrigin() {
  return !!getApiOrigin();
}

/** True while no custom server overrides the build-time default. */
export function isDefaultOrigin() {
  return getApiOrigin() === defaultOrigin();
}

export const IS_PROD = !__DEV__;
