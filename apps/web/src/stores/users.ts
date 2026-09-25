/**
 * Users store — cache of other users' public profiles (`UserPublic`, viewer-specific) and
 * their presence.
 *
 * State: `byId: Record<ID, UserPublic>`, `presence: Record<ID, Presence>`
 *
 * Actions
 * - `upsertUsers(users)`         merge profiles (also seeds presence from `online/lastSeenAt`;
 *                                `online: null` = hidden by the user's privacy settings)
 * - `fetchUser(id, { force })`   GET /api/users/:id (deduped in flight; cached unless force)
 * - `fetchUsers(ids, { force })` batched POST /api/users/batch: ids requested in the same tick
 *                                are coalesced into one request (≤ MAX_USERS_BATCH per call);
 *                                cached ids are skipped unless force. Use it for ids found in
 *                                messages (`referencedUserIds(message)`).
 * - `invalidateUser(id)`         refetch if cached (on `user:changed`, batched), else no-op
 * - `setPresence(p)`             apply a `presence:update`
 * - `subscribePresence(ids)`     ref-counted `presence:subscribe` (ack seeds presence). New ids
 *                                are coalesced into one emit per flush (≤ MAX_USERS_BATCH ids),
 *                                kept under the server's per-socket limit
 *                                (USER_RATE_LIMITS.presenceSubscribe) and retried with back-off
 *                                when rejected (rate_limited, timeout); only acked ids count as
 *                                subscribed.
 * - `unsubscribePresence(ids)`   decrement; at zero the id lingers PRESENCE_LINGER_MS (a remount
 *                                — virtualized scrolling, tab switches — reuses it) before one
 *                                batched `presence:unsubscribe`
 * - `resubscribePresence()`      re-send all active subscriptions (called on every `ready`:
 *                                subscriptions are per socket)
 *
 * Responses of a previous session (logout while a request was in flight) are dropped.
 *
 * Hooks: `useUser(id)` (auto-fetches, batched), `usePresence(id)` (auto-subscribes while mounted),
 * `useUserName(id)` (contact name → display name, "You" for me).
 */
import { useEffect } from 'react';
import { create } from 'zustand';
import {
  MAX_USERS_BATCH,
  USER_RATE_LIMITS,
  userDisplayName,
  type ID,
  type Presence,
  type UserPublic,
} from '@enbox/shared';
import { api } from '@/lib/api';
import { registerSessionReset, sessionEpoch } from '@/lib/session';
import { emitWithAck, sendEvent, useConnection } from '@/lib/socket';
import { useAuth } from './auth';

export interface UsersState {
  byId: Record<ID, UserPublic>;
  presence: Record<ID, Presence>;

  upsertUsers(users: UserPublic[]): void;
  fetchUser(id: ID, opts?: { force?: boolean }): Promise<UserPublic>;
  fetchUsers(ids: Iterable<ID>, opts?: { force?: boolean }): Promise<void>;
  invalidateUser(id: ID): Promise<void>;
  setPresence(p: Presence): void;
  subscribePresence(ids: ID[]): Promise<void>;
  unsubscribePresence(ids: ID[]): void;
  resubscribePresence(): Promise<void>;
}

const inflight = new Map<ID, Promise<UserPublic>>();
/** userId → the pending batch that will load it. */
const inflightBatch = new Map<ID, Promise<void>>();
/** Ids collected during the current tick for the next POST /api/users/batch. */
let queued: { ids: Set<ID>; promise: Promise<void> } | null = null;

function enqueueBatch(ids: ID[]): Promise<void> {
  if (!queued) {
    const epoch = sessionEpoch();
    const batch = { ids: new Set<ID>(), promise: Promise.resolve() };
    batch.promise = new Promise<void>((resolve, reject) => {
      setTimeout(() => {
        if (queued === batch) queued = null;
        const list = [...batch.ids];
        const requests: Promise<void>[] = [];
        for (let i = 0; i < list.length; i += MAX_USERS_BATCH) {
          const userIds = list.slice(i, i + MAX_USERS_BATCH);
          requests.push(
            api.post<UserPublic[]>('/api/users/batch', { userIds }).then((users) => {
              // A late response of a previous session must not reach the next account's cache.
              if (epoch === sessionEpoch()) useUsers.getState().upsertUsers(users);
            }),
          );
        }
        Promise.all(requests)
          .then(() => resolve(), reject)
          .finally(() => {
            for (const id of list)
              if (inflightBatch.get(id) === batch.promise) inflightBatch.delete(id);
          });
      }, 0);
    });
    queued = batch;
  }
  const batch = queued;
  for (const id of ids) {
    batch.ids.add(id);
    inflightBatch.set(id, batch.promise);
  }
  return batch.promise;
}

function samePresence(a: Presence | undefined, b: Presence): boolean {
  return !!a && a.online === b.online && a.lastSeenAt === b.lastSeenAt;
}

export const useUsers = create<UsersState>((set, get) => ({
  byId: {},
  presence: {},

  upsertUsers(users) {
    if (!users.length) return;
    set((s) => {
      const byId = { ...s.byId };
      let presence = s.presence;
      for (const u of users) {
        byId[u.id] = { ...byId[u.id], ...u };
        const p: Presence = { userId: u.id, online: u.online, lastSeenAt: u.lastSeenAt };
        if (!samePresence(presence[u.id], p)) {
          if (presence === s.presence) presence = { ...presence };
          presence[u.id] = p;
        }
      }
      return { byId, presence };
    });
  },

  fetchUser(id, { force = false } = {}) {
    const cached = get().byId[id];
    if (cached && !force) return Promise.resolve(cached);
    const pending = inflight.get(id);
    if (pending) return pending;
    const epoch = sessionEpoch();
    const p: Promise<UserPublic> = api
      .get<UserPublic>(`/api/users/${id}`)
      .then((user) => {
        if (epoch !== sessionEpoch()) return user;
        get().upsertUsers([user]);
        return get().byId[id] ?? user;
      })
      .finally(() => {
        if (inflight.get(id) === p) inflight.delete(id);
      });
    inflight.set(id, p);
    return p;
  },

  fetchUsers(ids, { force = false } = {}) {
    const byId = get().byId;
    const waits: Promise<void>[] = [];
    const fresh: ID[] = [];
    for (const id of new Set(ids)) {
      if (!id || (!force && byId[id])) continue;
      const pending = inflightBatch.get(id);
      if (pending && !force) waits.push(pending);
      else fresh.push(id);
    }
    if (fresh.length) waits.push(enqueueBatch(fresh));
    return Promise.all(waits).then(() => undefined);
  },

  async invalidateUser(id) {
    if (!get().byId[id]) return;
    await get()
      .fetchUsers([id], { force: true })
      .catch(() => undefined);
  },

  setPresence(p) {
    if (samePresence(get().presence[p.userId], p)) return;
    set((s) => ({ presence: { ...s.presence, [p.userId]: p } }));
  },

  subscribePresence(ids) {
    for (const id of new Set(ids)) {
      if (!id) continue;
      const n = presenceRefs.get(id) ?? 0;
      presenceRefs.set(id, n + 1);
      if (n > 0) continue;
      // A lingering subscription is still live on the server: nothing to send.
      presenceLinger.delete(id);
      if (!presenceSent.has(id) && !presenceInflight.has(id)) presencePending.add(id);
    }
    if (!presencePending.size) return Promise.resolve();
    return schedulePresenceFlush(PRESENCE_FLUSH_DELAY_MS);
  },

  unsubscribePresence(ids) {
    for (const id of new Set(ids)) {
      const n = presenceRefs.get(id) ?? 0;
      if (n > 1) {
        presenceRefs.set(id, n - 1);
        continue;
      }
      presenceRefs.delete(id);
      if (n !== 1) continue;
      presencePending.delete(id);
      // Keep it subscribed for a while: virtualized rows and tab switches remount quickly.
      if (presenceSent.has(id)) presenceLinger.set(id, Date.now());
    }
    if (presenceLinger.size) scheduleLingerSweep();
  },

  async resubscribePresence() {
    // A new socket: the server holds no subscriptions and a fresh rate-limit window.
    resetPresenceTransport();
    for (const id of presenceRefs.keys()) presencePending.add(id);
    while (presencePending.size && !presenceTimer) {
      if (!(await flushPresence())) break;
    }
  },
}));

// ---------------------------------------------------------------------------
// Presence subscriptions (per socket, see docs/ARCHITECTURE.md "Presence")
// ---------------------------------------------------------------------------

/** Delay that coalesces the subscriptions of rows mounting in the same frames into one emit. */
export const PRESENCE_FLUSH_DELAY_MS = 50;
/** How long an id stays subscribed after its last subscriber unmounted. */
export const PRESENCE_LINGER_MS = 30_000;
const PRESENCE_RETRY_MIN_MS = 5_000;
const PRESENCE_RETRY_MAX_MS = 60_000;
const PRESENCE_LIMIT = USER_RATE_LIMITS.presenceSubscribe;

/** userId → number of mounted subscribers in this tab. */
const presenceRefs = new Map<ID, number>();
/** Ids the server acknowledged on the current socket. */
const presenceSent = new Set<ID>();
/** Ids waiting for the next `presence:subscribe`. */
const presencePending = new Set<ID>();
/** Ids of the `presence:subscribe` awaiting its ack (not sent again meanwhile). */
const presenceInflight = new Set<ID>();
/** Subscribed ids without subscribers → when their last subscriber went away. */
const presenceLinger = new Map<ID, number>();
/** Emit times on the current socket (client-side view of the server's per-socket limit). */
let presenceEmits: number[] = [];
let presenceTimer: ReturnType<typeof setTimeout> | null = null;
let lingerTimer: ReturnType<typeof setTimeout> | null = null;
let presenceRetryMs = 0;
/** Bumped per socket (`ready`) and session: acks meant for an older socket are ignored. */
let presenceGen = 0;
let presenceWaiters: (() => void)[] = [];

function wantsPresence(id: ID): boolean {
  return (presenceRefs.get(id) ?? 0) > 0 || presenceLinger.has(id);
}

function settlePresenceWaiters(): void {
  const list = presenceWaiters;
  presenceWaiters = [];
  for (const fn of list) fn();
}

/** Flush pending subscriptions after `delayMs` (one timer at a time). Resolves after it ran. */
function schedulePresenceFlush(delayMs: number): Promise<void> {
  const done = new Promise<void>((resolve) => presenceWaiters.push(resolve));
  if (!presenceTimer) {
    presenceTimer = setTimeout(() => {
      presenceTimer = null;
      void flushPresence().then((sent) => {
        if (sent && presencePending.size && !presenceTimer) void schedulePresenceFlush(0);
      });
    }, delayMs);
  }
  return done;
}

/**
 * Send one `presence:subscribe` with up to MAX_USERS_BATCH pending ids. Returns false when
 * nothing was sent (offline, rate budget used up, or the emit failed — a retry is then
 * scheduled with back-off).
 */
async function flushPresence(): Promise<boolean> {
  // Not connected / rooms not joined yet: `resubscribePresence` sends everything on `ready`.
  if (!presencePending.size || !useConnection.getState().ready) {
    settlePresenceWaiters();
    return false;
  }
  const now = Date.now();
  presenceEmits = presenceEmits.filter((t) => now - t < PRESENCE_LIMIT.windowMs);
  if (presenceEmits.length >= PRESENCE_LIMIT.limit) {
    void schedulePresenceFlush(PRESENCE_LIMIT.windowMs - (now - presenceEmits[0]!) + 50);
    settlePresenceWaiters();
    return false;
  }
  const ids = [...presencePending].slice(0, MAX_USERS_BATCH);
  for (const id of ids) {
    presencePending.delete(id);
    presenceInflight.add(id);
  }
  presenceEmits.push(now);
  const gen = presenceGen;
  try {
    const list = await emitWithAck('presence:subscribe', { userIds: ids });
    if (gen !== presenceGen) return false;
    presenceRetryMs = 0;
    for (const id of ids) {
      presenceSent.add(id);
      // Everyone unmounted while the ack was in flight: linger like any other unmount.
      if (!wantsPresence(id)) presenceLinger.set(id, Date.now());
    }
    scheduleLingerSweep();
    const { setPresence } = useUsers.getState();
    for (const p of list) setPresence(p);
    return true;
  } catch {
    if (gen !== presenceGen) return false;
    // rate_limited / timeout / dropped: retry the ids still needed, with back-off.
    for (const id of ids) if (wantsPresence(id) && !presenceSent.has(id)) presencePending.add(id);
    presenceRetryMs = Math.min(
      PRESENCE_RETRY_MAX_MS,
      presenceRetryMs ? presenceRetryMs * 2 : PRESENCE_RETRY_MIN_MS,
    );
    if (presenceTimer) clearTimeout(presenceTimer);
    presenceTimer = null;
    if (presencePending.size) void schedulePresenceFlush(presenceRetryMs);
    return false;
  } finally {
    if (gen === presenceGen) for (const id of ids) presenceInflight.delete(id);
    settlePresenceWaiters();
  }
}

function scheduleLingerSweep(): void {
  if (lingerTimer || !presenceLinger.size) return;
  let oldest = Infinity;
  for (const since of presenceLinger.values()) oldest = Math.min(oldest, since);
  lingerTimer = setTimeout(
    () => {
      lingerTimer = null;
      const now = Date.now();
      const gone: ID[] = [];
      for (const [id, since] of presenceLinger) {
        if (now - since < PRESENCE_LINGER_MS) continue;
        presenceLinger.delete(id);
        if (presenceSent.delete(id)) gone.push(id);
      }
      for (let i = 0; i < gone.length; i += MAX_USERS_BATCH)
        sendEvent('presence:unsubscribe', { userIds: gone.slice(i, i + MAX_USERS_BATCH) });
      scheduleLingerSweep();
    },
    Math.max(0, oldest + PRESENCE_LINGER_MS - Date.now()),
  );
}

/** Forget everything tied to the current socket (its subscriptions die with it). */
function resetPresenceTransport(): void {
  presenceGen++;
  if (presenceTimer) clearTimeout(presenceTimer);
  if (lingerTimer) clearTimeout(lingerTimer);
  presenceTimer = null;
  lingerTimer = null;
  presenceSent.clear();
  presencePending.clear();
  presenceInflight.clear();
  presenceLinger.clear();
  presenceEmits = [];
  presenceRetryMs = 0;
  settlePresenceWaiters();
}

registerSessionReset(() => {
  inflight.clear();
  inflightBatch.clear();
  queued = null;
  presenceRefs.clear();
  resetPresenceTransport();
  useUsers.setState({ byId: {}, presence: {} });
});

/** Cached user (fetches on mount when missing; mounts in the same tick share one batch request). */
export function useUser(id: ID | null | undefined): UserPublic | undefined {
  const user = useUsers((s) => (id ? s.byId[id] : undefined));
  useEffect(() => {
    if (id && !user)
      void useUsers
        .getState()
        .fetchUsers([id])
        .catch(() => undefined);
  }, [id, user]);
  return user;
}

/** Live presence for a user; subscribes while the component is mounted. */
export function usePresence(id: ID | null | undefined): Presence | undefined {
  const presence = useUsers((s) => (id ? s.presence[id] : undefined));
  useEffect(() => {
    if (!id) return;
    const { subscribePresence, unsubscribePresence } = useUsers.getState();
    void subscribePresence([id]);
    return () => unsubscribePresence([id]);
  }, [id]);
  return presence;
}

/** Display name for a user id: "You" for me, contact name, display name, or "Unknown". */
export function useUserName(id: ID | null | undefined, opts: { you?: string } = {}): string {
  const me = useAuth((s) => s.user?.id);
  const user = useUser(id && id !== me ? id : null);
  if (!id) return 'Unknown';
  if (id === me) return opts.you ?? 'You';
  return userDisplayName(user);
}

/** Non-hook name resolver (for `systemEventText`, `messagePreviewText`...). */
export function nameOf(id: ID, opts: { you?: string } = {}): string {
  if (id === useAuth.getState().user?.id) return opts.you ?? 'You';
  const u = useUsers.getState().byId[id];
  return u ? userDisplayName(u) : 'Someone';
}
