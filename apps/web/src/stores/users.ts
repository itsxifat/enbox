/**
 * Users store — cache of other users' public profiles (`UserPublic`, viewer-specific) and
 * their presence.
 *
 * State: `byId: Record<ID, UserPublic>`, `presence: Record<ID, Presence>`
 *
 * Actions
 * - `upsertUsers(users)`         merge profiles (also seeds presence from `online/lastSeenAt`)
 * - `fetchUser(id, { force })`   GET /api/users/:id (deduped in flight; cached unless force)
 * - `invalidateUser(id)`         refetch if cached (on `user:changed`), else no-op
 * - `setPresence(p)`             apply a `presence:update`
 * - `subscribePresence(ids)`     ref-counted `presence:subscribe` (ack seeds presence)
 * - `unsubscribePresence(ids)`   decrement; emits `presence:unsubscribe` at zero
 * - `resubscribePresence()`      re-send all active subscriptions (called on reconnect)
 *
 * Hooks: `useUser(id)` (auto-fetches), `usePresence(id)` (auto-subscribes while mounted),
 * `useUserName(id)` (contact name → display name, "You" for me).
 */
import { useEffect } from 'react';
import { create } from 'zustand';
import { userDisplayName, type ID, type Presence, type UserPublic } from '@enbox/shared';
import { api } from '@/lib/api';
import { registerSessionReset } from '@/lib/session';
import { emitWithAck, isSocketConnected, sendEvent } from '@/lib/socket';
import { useAuth } from './auth';

export interface UsersState {
  byId: Record<ID, UserPublic>;
  presence: Record<ID, Presence>;

  upsertUsers(users: UserPublic[]): void;
  fetchUser(id: ID, opts?: { force?: boolean }): Promise<UserPublic>;
  invalidateUser(id: ID): Promise<void>;
  setPresence(p: Presence): void;
  subscribePresence(ids: ID[]): Promise<void>;
  unsubscribePresence(ids: ID[]): void;
  resubscribePresence(): Promise<void>;
}

const inflight = new Map<ID, Promise<UserPublic>>();
/** userId → number of active presence subscribers in this tab. */
const presenceRefs = new Map<ID, number>();

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
        if (u.online !== undefined || u.lastSeenAt !== undefined) {
          const p: Presence = {
            userId: u.id,
            online: u.online ?? presence[u.id]?.online ?? false,
            lastSeenAt:
              u.lastSeenAt !== undefined ? u.lastSeenAt : (presence[u.id]?.lastSeenAt ?? null),
          };
          if (!samePresence(presence[u.id], p)) {
            if (presence === s.presence) presence = { ...presence };
            presence[u.id] = p;
          }
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
    const p = api
      .get<UserPublic>(`/api/users/${id}`)
      .then((user) => {
        get().upsertUsers([user]);
        return get().byId[id] ?? user;
      })
      .finally(() => inflight.delete(id));
    inflight.set(id, p);
    return p;
  },

  async invalidateUser(id) {
    if (!get().byId[id]) return;
    await get()
      .fetchUser(id, { force: true })
      .catch(() => undefined);
  },

  setPresence(p) {
    if (samePresence(get().presence[p.userId], p)) return;
    set((s) => ({ presence: { ...s.presence, [p.userId]: p } }));
  },

  async subscribePresence(ids) {
    const fresh: ID[] = [];
    for (const id of new Set(ids)) {
      const n = presenceRefs.get(id) ?? 0;
      presenceRefs.set(id, n + 1);
      if (n === 0) fresh.push(id);
    }
    if (!fresh.length || !isSocketConnected()) return;
    try {
      const list = await emitWithAck('presence:subscribe', { userIds: fresh });
      for (const p of list) get().setPresence(p);
    } catch {
      /* resubscribed on reconnect */
    }
  },

  unsubscribePresence(ids) {
    const gone: ID[] = [];
    for (const id of new Set(ids)) {
      const n = presenceRefs.get(id) ?? 0;
      if (n <= 1) {
        presenceRefs.delete(id);
        if (n === 1) gone.push(id);
      } else presenceRefs.set(id, n - 1);
    }
    if (gone.length) sendEvent('presence:unsubscribe', { userIds: gone });
  },

  async resubscribePresence() {
    const ids = [...presenceRefs.keys()];
    for (let i = 0; i < ids.length; i += 500) {
      try {
        const list = await emitWithAck('presence:subscribe', { userIds: ids.slice(i, i + 500) });
        for (const p of list) get().setPresence(p);
      } catch {
        /* next reconnect */
      }
    }
  },
}));

registerSessionReset(() => {
  inflight.clear();
  presenceRefs.clear();
  useUsers.setState({ byId: {}, presence: {} });
});

/** Cached user (fetches on mount when missing). */
export function useUser(id: ID | null | undefined): UserPublic | undefined {
  const user = useUsers((s) => (id ? s.byId[id] : undefined));
  useEffect(() => {
    if (id && !user)
      void useUsers
        .getState()
        .fetchUser(id)
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
