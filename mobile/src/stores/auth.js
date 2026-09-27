/**
 * Auth store — session token + the signed-in user.
 *
 * State
 * - `token`   session token (persisted in localStorage `enbox.token`)
 * - `user`    `UserSelf | null` (a snapshot is cached in `enbox.user` for offline boot)
 * - `status`  'booting' (resolving a stored token) | 'authenticated' | 'anonymous'
 * - `bootError` set while bootstrap retries because the server is unreachable
 *
 * Actions
 * - `bootstrap()`          token → GET /api/me. 401 → anonymous. Network/server error →
 *                          authenticated with the cached user, else keeps retrying.
 * - `login(req)`           POST /api/auth/login → authenticated (returns the user)
 * - `register(req)`        POST /api/auth/register → authenticated
 * - `logout({ remote })`   best-effort POST /api/auth/logout (+ push unsubscribe) unless
 *                          `remote: false`, then disconnects the socket and resets every
 *                          session store (see lib/session.ts)
 * - `setUser(user)` / `patchUser(partial)` update the cached profile (e.g. after PATCH /api/me)
 *
 * Realtime starts/stops automatically from the status (see realtime/index.ts).
 * Helpers: `useMe()` (UserSelf | null), `getMe()`, `getMyId()`.
 */
import { create } from 'zustand';

import { ApiError, api, setApiToken, setUnauthorizedHandler } from '@/lib/api';
import { deviceName } from '@/lib/device';
import { disablePush } from '@/lib/push';
import { resetSessionState } from '@/lib/session';
import { disconnectSocket, setSocketUnauthorizedHandler } from '@/lib/socket';
import { StorageKeys, storage } from '@/lib/storage';

let bootstrapping = null;
let loggingOut = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const useAuth = create((set, get) => {
  const startSession = ({ token, user }) => {
    setApiToken(token);
    storage.set(StorageKeys.token, token);
    storage.setJSON(StorageKeys.user, user);
    set({ token, user, status: 'authenticated', bootError: null });
    return user;
  };

  const clearSession = () => {
    setApiToken(null);
    storage.remove(StorageKeys.token);
    storage.remove(StorageKeys.user);
    disconnectSocket();
    resetSessionState();
    set({ token: null, user: null, status: 'anonymous', bootError: null });
  };

  return {
    token: null,
    user: null,
    status: 'booting',
    bootError: null,

    bootstrap() {
      if (bootstrapping) return bootstrapping;
      bootstrapping = (async () => {
        const token = storage.get(StorageKeys.token);
        if (!token) {
          set({ status: 'anonymous', token: null, user: null });
          return;
        }
        setApiToken(token);
        const cached = storage.getJSON(StorageKeys.user);
        set({ token, user: cached });

        for (let attempt = 0; ; attempt++) {
          try {
            const user = await api.get('/api/me');
            if (get().token !== token) return; // logged out meanwhile
            storage.setJSON(StorageKeys.user, user);
            set({ user, status: 'authenticated', bootError: null });
            return;
          } catch (e) {
            if (get().token !== token) return;
            if (e instanceof ApiError && e.status === 401) {
              clearSession();
              return;
            }
            if (cached) {
              // Offline / server hiccup: start with the cached profile; realtime resyncs later.
              set({ status: 'authenticated', bootError: null });
              void api
                .get('/api/me')
                .then((user) => get().token === token && get().setUser(user))
                .catch(() => undefined);
              return;
            }
            set({
              bootError:
                e instanceof ApiError && e.isNetworkError
                  ? 'Waiting for network…'
                  : 'Connecting to Enbox…',
            });
            await sleep(Math.min(15_000, 1_000 * 2 ** attempt));
          }
        }
      })().finally(() => {
        bootstrapping = null;
      });
      return bootstrapping;
    },

    async login(req) {
      const res = await api.post(
        '/api/auth/login',
        { ...req, deviceName: req.deviceName ?? deviceName() },
        { auth: false },
      );
      return startSession(res);
    },

    async register(req) {
      const res = await api.post(
        '/api/auth/register',
        { ...req, deviceName: req.deviceName ?? deviceName() },
        { auth: false },
      );
      return startSession(res);
    },

    logout({ remote = true } = {}) {
      if (loggingOut) return loggingOut;
      loggingOut = (async () => {
        if (remote && get().token) {
          await Promise.race([
            Promise.allSettled([
              disablePush(),
              api.post('/api/auth/logout', undefined, { timeoutMs: 4_000 }),
            ]),
            sleep(4_000),
          ]);
        }
        clearSession();
      })().finally(() => {
        loggingOut = null;
      });
      return loggingOut;
    },

    setUser(user) {
      storage.setJSON(StorageKeys.user, user);
      set({ user });
    },

    patchUser(partial) {
      const current = get().user;
      if (!current) return;
      get().setUser({
        ...current,
        ...partial,
        settings: { ...current.settings, ...partial.settings },
      });
    },
  };
});

// A rejected token (REST 401 or socket connect_error "unauthorized") logs out locally.
const onUnauthorized = () => {
  if (useAuth.getState().token) void useAuth.getState().logout({ remote: false });
};
setUnauthorizedHandler(onUnauthorized);
setSocketUnauthorizedHandler(onUnauthorized);

/** The signed-in user (null when anonymous). */
export const useMe = () => useAuth((s) => s.user);
export const getMe = () => useAuth.getState().user;
export const getMyId = () => useAuth.getState().user?.id ?? null;
