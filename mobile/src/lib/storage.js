/**
 * Synchronous key/value storage (the web client's localStorage API) for React Native.
 *
 * Reads come from an in-memory copy that `hydrateStorage()` fills from AsyncStorage (and the
 * session token from the encrypted SecureStore) once at startup, before any store reads it;
 * writes update the copy immediately and persist in the background. All Enbox keys are
 * prefixed with `enbox.`.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/** Storage keys used by the foundation. Feature code adds its own `enbox.<feature>.*` keys. */
export const StorageKeys = {
  token: 'enbox.token',
  user: 'enbox.user',
  ui: 'enbox.ui',
  server: 'enbox.server',
};

/** Kept in the Android keystore-backed SecureStore instead of AsyncStorage. */
const SECURE_KEYS = new Set([StorageKeys.token]);
const secureAvailable = Platform.OS !== 'web';
const secureName = (key) => key.replace(/[^A-Za-z0-9._-]/g, '_');

const cache = new Map();
let hydrated = false;
let hydrating = null;

function persist(key, value) {
  if (SECURE_KEYS.has(key) && secureAvailable) {
    const p =
      value === null
        ? SecureStore.deleteItemAsync(secureName(key))
        : SecureStore.setItemAsync(secureName(key), value);
    p.catch(() => undefined);
    return;
  }
  const p = value === null ? AsyncStorage.removeItem(key) : AsyncStorage.setItem(key, value);
  p.catch(() => undefined);
}

/** Load every `enbox.*` key into memory (call once before rendering). */
export function hydrateStorage() {
  if (hydrated) return Promise.resolve();
  if (hydrating) return hydrating;
  hydrating = (async () => {
    try {
      const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith('enbox.'));
      const pairs = await AsyncStorage.multiGet(keys);
      for (const [k, v] of pairs) if (v !== null && !cache.has(k)) cache.set(k, v);
    } catch {
      /* first run / storage unavailable */
    }
    for (const key of SECURE_KEYS) {
      try {
        const v = secureAvailable
          ? await SecureStore.getItemAsync(secureName(key))
          : await AsyncStorage.getItem(key);
        if (v !== null && !cache.has(key)) cache.set(key, v);
      } catch {
        /* keystore unavailable */
      }
    }
    hydrated = true;
  })();
  return hydrating;
}

export const storage = {
  get(key) {
    return cache.has(key) ? cache.get(key) : null;
  },
  set(key, value) {
    cache.set(key, value);
    persist(key, value);
  },
  remove(key) {
    cache.delete(key);
    persist(key, null);
  },
  getJSON(key) {
    const raw = storage.get(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  },
  setJSON(key, value) {
    storage.set(key, JSON.stringify(value));
  },
};

/** zustand `persist` adapter over the synchronous copy (see `createJSONStorage`). */
export const zustandStorage = {
  getItem: (name) => storage.get(name),
  setItem: (name, value) => storage.set(name, value),
  removeItem: (name) => storage.remove(name),
};
