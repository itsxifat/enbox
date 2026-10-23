/**
 * Ignore store (W7-F) — the people I ignore. Silent: they are never told. Their messages
 * collapse behind "Ignored message — Show" (`MessageContent`), their typing is hidden and they
 * raise no desktop notifications; the server drops their pushes.
 *
 * State
 * - `ids`       users I ignore, newest first (`byId` for lookups); `loaded`
 * - `revealed`  messageId → true: ignored messages I chose to show (this session only)
 *
 * Actions
 * - `load({ force })`  GET /api/me/ignores (deduped unless `force`; the latest request wins).
 *                      Runs on first use (`useIsIgnored`, `useIgnoredUsers`) and on every
 *                      socket `ready` (realtime/ignores.ts).
 * - `apply(userIds)`   `ignores:changed` — my whole list, changed on any of my devices
 * - `ignore(id)` / `unignore(id)`  PUT / DELETE /api/users/:id/ignore (optimistic, rolled
 *                      back on failure; ignoring also clears their typing indicators)
 * - `reveal(messageId)`
 *
 * Hooks / helpers: `useIsIgnored(userId)`, `isIgnored(userId)` (non-hook, for realtime
 * handlers and menus), `useIsRevealed(messageId)`, `useIgnoredUsers()`, `useIgnoredCount()`.
 */
import { useEffect, useMemo } from 'react';
import { create } from 'zustand';
import type { ID, UserPublic } from '@enbox/shared';
import { api } from '@/lib/api';
import { registerSessionReset } from '@/lib/session';
import { useChats } from './chats';
import { useUsers } from './users';

export interface IgnoresState {
  ids: ID[];
  byId: Record<ID, true>;
  loaded: boolean;
  revealed: Record<ID, true>;

  load(opts?: { force?: boolean }): Promise<void>;
  apply(userIds: ID[]): void;
  ignore(userId: ID): Promise<void>;
  unignore(userId: ID): Promise<void>;
  reveal(messageId: ID): void;
}

const initialState = {
  ids: [] as ID[],
  byId: {} as Record<ID, true>,
  loaded: false,
  revealed: {} as Record<ID, true>,
};

const toById = (ids: readonly ID[]) =>
  Object.fromEntries(ids.map((id) => [id, true as const])) as Record<ID, true>;

let loadPromise: Promise<void> | null = null;
/** Bumped by every load and every local change: an older response must not win. */
let requestSeq = 0;
/** Bumped on logout so late responses of the previous session are dropped. */
let generation = 0;
/** The first-use load was started (the `ready` resync reloads anyway). */
let requested = false;

/** Their typing indicators go at once (new ones are dropped by realtime/chats.ts). */
function clearTypingOf(userIds: readonly ID[]): void {
  const chats = useChats.getState();
  for (const [chatId, typers] of Object.entries(chats.typing))
    for (const id of userIds) if (typers[id]) chats.setTyping(chatId, id, 'idle');
}

export const useIgnores = create<IgnoresState>((set, get) => ({
  ...initialState,

  load({ force = false } = {}) {
    if (get().loaded && !force) return Promise.resolve();
    if (loadPromise && !force) return loadPromise;
    const gen = generation;
    const seq = ++requestSeq;
    const promise = api
      .get<UserPublic[]>('/api/me/ignores')
      .then((list) => {
        if (gen !== generation || seq !== requestSeq) return;
        if (!Array.isArray(list)) throw new Error('Unexpected ignore list');
        useUsers.getState().upsertUsers(list);
        get().apply(list.map((u) => u.id));
      })
      .finally(() => {
        if (loadPromise === promise) loadPromise = null;
      });
    loadPromise = promise;
    return promise;
  },

  apply(userIds) {
    const before = get().byId;
    requestSeq += 1;
    set({ ids: [...userIds], byId: toById(userIds), loaded: true });
    clearTypingOf(userIds.filter((id) => !before[id]));
  },

  async ignore(userId) {
    const prev = get().ids;
    requestSeq += 1;
    const ids = [userId, ...prev.filter((id) => id !== userId)];
    set({ ids, byId: toById(ids) });
    clearTypingOf([userId]);
    try {
      await api.put(`/api/users/${userId}/ignore`);
    } catch (e) {
      if (get().ids === ids) set({ ids: prev, byId: toById(prev) });
      throw e;
    }
  },

  async unignore(userId) {
    const prev = get().ids;
    requestSeq += 1;
    const ids = prev.filter((id) => id !== userId);
    set({ ids, byId: toById(ids) });
    try {
      await api.delete(`/api/users/${userId}/ignore`);
    } catch (e) {
      if (get().ids === ids) set({ ids: prev, byId: toById(prev) });
      throw e;
    }
  },

  reveal(messageId) {
    if (!get().revealed[messageId])
      set((s) => ({ revealed: { ...s.revealed, [messageId]: true } }));
  },
}));

registerSessionReset(() => {
  generation += 1;
  loadPromise = null;
  requested = false;
  useIgnores.setState({ ...initialState });
});

/** Start the first-use load once per session (failures wait for the next `ready`). */
function ensureLoaded(): void {
  if (requested || useIgnores.getState().loaded) return;
  requested = true;
  void useIgnores
    .getState()
    .load()
    .catch(() => undefined);
}

/** Do I ignore this user? (Non-hook: realtime handlers, menu builders.) */
export function isIgnored(userId: ID | null | undefined): boolean {
  return !!userId && !!useIgnores.getState().byId[userId];
}

/** Do I ignore this user? Loads my list on first use. */
export function useIsIgnored(userId: ID | null | undefined): boolean {
  const ignored = useIgnores((s) => !!userId && !!s.byId[userId]);
  useEffect(ensureLoaded, []);
  return ignored;
}

/** How many people I ignore (loads my list on first use). */
export function useIgnoredCount(): { count: number; loaded: boolean } {
  const count = useIgnores((s) => s.ids.length);
  const loaded = useIgnores((s) => s.loaded);
  useEffect(ensureLoaded, []);
  return { count, loaded };
}

/** I chose to show this ignored message. */
export function useIsRevealed(messageId: ID): boolean {
  return useIgnores((s) => !!s.revealed[messageId]);
}

/** The users I ignore with live profiles, newest first (loads the list and missing profiles). */
export function useIgnoredUsers(): { users: UserPublic[]; loaded: boolean } {
  const ids = useIgnores((s) => s.ids);
  const loaded = useIgnores((s) => s.loaded);
  const byId = useUsers((s) => s.byId);
  useEffect(ensureLoaded, []);
  useEffect(() => {
    const missing = ids.filter((id) => !useUsers.getState().byId[id]);
    if (missing.length)
      void useUsers
        .getState()
        .fetchUsers(missing)
        .catch(() => undefined);
  }, [ids]);
  const users = useMemo(
    () => ids.map((id) => byId[id]).filter((u): u is UserPublic => !!u && !u.isDeleted),
    [ids, byId],
  );
  return { users, loaded };
}
