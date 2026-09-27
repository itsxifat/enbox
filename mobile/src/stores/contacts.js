/**
 * Contacts store (agent 1) — my saved contacts and the users I blocked.
 *
 * State
 * - `contacts`  saved contacts `{ userId, name, createdAt }` in server order (alphabetical);
 *               the profiles themselves live in the users store (upserted on load), so
 *               renders stay live on `user:changed`
 * - `blockedIds` users I blocked (newest first), `blockedLoaded`
 *
 * Actions
 * - `loadContacts({ force })`  GET /api/contacts (deduped; cached unless force)
 * - `addContact(req)`          POST /api/contacts (userId | username | phone, optional name)
 * - `renameContact(id, name)`  PATCH /api/contacts/:id (null = use their display name)
 * - `removeContact(id)`        DELETE /api/contacts/:id
 * - `loadBlocked({ force })`   GET /api/blocks
 * - `block(id)` / `unblock(id)` PUT / DELETE /api/blocks/:id
 * - `syncContacts()` / `syncBlocks()` refetch after `contacts:changed` / `blocks:changed`
 *   (another device, or the server) and patch the users store + direct-chat peers so saved
 *   names and blocked flags stay correct everywhere. Installed by realtime/users.ts.
 *
 * Every mutation also patches `isContact`/`contactName`/`isBlocked` in the users store and in
 * the `peer` of direct chats, so chat titles update immediately.
 *
 * Hooks: `useContactList()` (auto-loads; `{ user, name }[]` with live profiles),
 * `useBlockedUsers()` (auto-loads), `contactLabel(user)`.
 * Helpers: `groupByInitial(items, nameOf)` for alphabetical sections.
 */
import { useEffect, useMemo } from 'react';
import { create } from 'zustand';
import { userDisplayName } from '@enbox/shared';
import { api } from '@/lib/api';
import { registerSessionReset } from '@/lib/session';
import { useChats } from './chats';
import { useUsers } from './users';

const initialState = {
  contacts: [],
  loaded: false,
  loading: false,
  error: null,
  blockedIds: [],
  blockedLoaded: false,
  blockedLoading: false,
};

let contactsPromise = null;
let blockedPromise = null;
/** Bumped on logout so late responses of the previous session are dropped. */
let generation = 0;

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

function toEntry(c) {
  return { userId: c.user.id, name: c.name, createdAt: c.createdAt };
}

/** Patch a cached profile and the `peer` of every direct chat with that user. */
export function patchUserEverywhere(userId, patch) {
  const users = useUsers.getState();
  const cached = users.byId[userId];
  if (cached) users.upsertUsers([{ ...cached, ...patch }]);
  const { byId, patchChat } = useChats.getState();
  for (const chat of Object.values(byId)) {
    if (chat.type === 'direct' && chat.peer?.id === userId)
      patchChat(chat.id, { peer: { ...chat.peer, ...patch } });
  }
}

/** Apply a fresh profile (from the API) to the users store and direct-chat peers. */
function applyUser(user) {
  useUsers.getState().upsertUsers([user]);
  patchUserEverywhere(user.id, user);
}

function sortEntries(list) {
  const byId = useUsers.getState().byId;
  const nameOf = (e) => e.name ?? byId[e.userId]?.displayName ?? '';
  return [...list].sort((a, b) => collator.compare(nameOf(a), nameOf(b)));
}

export const useContacts = create((set, get) => ({
  ...initialState,

  loadContacts({ force = false } = {}) {
    if (get().loaded && !force) return Promise.resolve();
    if (contactsPromise) return contactsPromise;
    const gen = generation;
    set({ loading: true, error: null });
    contactsPromise = api
      .get('/api/contacts')
      .then((list) => {
        if (gen !== generation) return;
        useUsers.getState().upsertUsers(list.map((c) => c.user));
        set({ contacts: list.map(toEntry), loaded: true, loading: false });
      })
      .catch((e) => {
        if (gen === generation)
          set({
            loading: false,
            error: e instanceof Error ? e.message : 'Failed to load contacts',
          });
        throw e;
      })
      .finally(() => {
        contactsPromise = null;
      });
    return contactsPromise;
  },

  async addContact(req) {
    const contact = await api.post('/api/contacts', req);
    applyUser(contact.user);
    set((s) => ({
      contacts: sortEntries([
        ...s.contacts.filter((c) => c.userId !== contact.user.id),
        toEntry(contact),
      ]),
    }));
    return contact;
  },

  async renameContact(userId, name) {
    const contact = await api.patch(`/api/contacts/${userId}`, { name });
    applyUser(contact.user);
    set((s) => ({
      contacts: sortEntries(s.contacts.map((c) => (c.userId === userId ? toEntry(contact) : c))),
    }));
    return contact;
  },

  async removeContact(userId) {
    await api.delete(`/api/contacts/${userId}`);
    patchUserEverywhere(userId, { isContact: false, contactName: null });
    set((s) => ({ contacts: s.contacts.filter((c) => c.userId !== userId) }));
  },

  loadBlocked({ force = false } = {}) {
    if (get().blockedLoaded && !force) return Promise.resolve();
    if (blockedPromise) return blockedPromise;
    const gen = generation;
    set({ blockedLoading: true });
    blockedPromise = api
      .get('/api/blocks')
      .then((list) => {
        if (gen !== generation) return;
        useUsers.getState().upsertUsers(list);
        set({ blockedIds: list.map((u) => u.id), blockedLoaded: true, blockedLoading: false });
      })
      .catch((e) => {
        if (gen === generation) set({ blockedLoading: false });
        throw e;
      })
      .finally(() => {
        blockedPromise = null;
      });
    return blockedPromise;
  },

  async block(userId) {
    await api.put(`/api/blocks/${userId}`);
    patchUserEverywhere(userId, { isBlocked: true });
    set((s) => ({ blockedIds: [userId, ...s.blockedIds.filter((id) => id !== userId)] }));
    // Presence/about visibility changes with a block: refresh the profile.
    await refreshUser(userId);
  },

  async unblock(userId) {
    await api.delete(`/api/blocks/${userId}`);
    patchUserEverywhere(userId, { isBlocked: false });
    set((s) => ({ blockedIds: s.blockedIds.filter((id) => id !== userId) }));
    await refreshUser(userId);
  },

  async syncContacts() {
    const gen = generation;
    const list = await api.get('/api/contacts').catch(() => null);
    if (!list || gen !== generation) return;
    const now = new Set(list.map((c) => c.user.id));
    // Users that stopped being contacts (removed on another device).
    const users = useUsers.getState().byId;
    for (const u of Object.values(users)) {
      if (u.isContact && !now.has(u.id))
        patchUserEverywhere(u.id, { isContact: false, contactName: null });
    }
    for (const c of list) applyUser(c.user);
    set({ contacts: list.map(toEntry), loaded: true, loading: false, error: null });
  },

  async syncBlocks() {
    const gen = generation;
    const list = await api.get('/api/blocks').catch(() => null);
    if (!list || gen !== generation) return;
    const now = new Set(list.map((u) => u.id));
    const changed = [];
    for (const u of Object.values(useUsers.getState().byId)) {
      if (u.isBlocked !== now.has(u.id)) changed.push(u.id);
    }
    for (const u of list) applyUser(u);
    for (const id of changed) if (!now.has(id)) patchUserEverywhere(id, { isBlocked: false });
    set({ blockedIds: list.map((u) => u.id), blockedLoaded: true, blockedLoading: false });
    await Promise.all(changed.map((id) => refreshUser(id)));
  },
}));

async function refreshUser(userId) {
  try {
    await useUsers.getState().fetchUsers([userId], { force: true });
    const user = useUsers.getState().byId[userId];
    if (user) patchUserEverywhere(userId, user);
  } catch {
    /* best effort */
  }
}

registerSessionReset(() => {
  generation += 1;
  contactsPromise = null;
  blockedPromise = null;
  useContacts.setState({ ...initialState });
});

// ---------------------------------------------------------------------------
// Selectors & helpers
// ---------------------------------------------------------------------------

/** Name to show for a contact row: saved name → display name. */
export function contactLabel(user) {
  return userDisplayName(user);
}

/** My contacts with live profiles (auto-loads). Sorted alphabetically by shown name. */
export function useContactList() {
  const contacts = useContacts((s) => s.contacts);
  const loaded = useContacts((s) => s.loaded);
  const loading = useContacts((s) => s.loading);
  const error = useContacts((s) => s.error);
  const byId = useUsers((s) => s.byId);
  useEffect(() => {
    if (!loaded)
      void useContacts
        .getState()
        .loadContacts()
        .catch(() => undefined);
  }, [loaded]);
  const items = useMemo(() => {
    const out = [];
    for (const c of contacts) {
      const user = byId[c.userId];
      if (user && !user.isDeleted) out.push({ user, name: c.name });
    }
    return out.sort((a, b) => collator.compare(userDisplayName(a.user), userDisplayName(b.user)));
  }, [contacts, byId]);
  return { items, loaded, loading, error };
}

/** Users I blocked (auto-loads), newest first. */
export function useBlockedUsers() {
  const ids = useContacts((s) => s.blockedIds);
  const loaded = useContacts((s) => s.blockedLoaded);
  const byId = useUsers((s) => s.byId);
  useEffect(() => {
    if (!loaded)
      void useContacts
        .getState()
        .loadBlocked()
        .catch(() => undefined);
  }, [loaded]);
  const users = useMemo(() => ids.map((id) => byId[id]).filter((u) => !!u), [ids, byId]);
  return { users, loaded };
}

/** First letter of a name for alphabetical sections ('#' for digits, emoji, symbols). */
export function initialOf(name) {
  const first = Array.from(name.trim())[0] ?? '';
  const base = first.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase();
  return /^\p{L}$/u.test(base) ? base : '#';
}

/**
 * Group items into alphabetical sections (WhatsApp contact list). Items keep their order
 * inside a section; sections are sorted alphabetically with '#' last.
 */
export function groupByInitial(items, nameOf) {
  const groups = new Map();
  for (const item of items) {
    const letter = initialOf(nameOf(item));
    const list = groups.get(letter);
    if (list) list.push(item);
    else groups.set(letter, [item]);
  }
  const out = [...groups.entries()].map(([letter, list]) => ({ letter, items: list }));
  out.sort((a, b) =>
    a.letter === '#' ? 1 : b.letter === '#' ? -1 : collator.compare(a.letter, b.letter),
  );
  return out;
}

/** Case/diacritics-insensitive match of a contact against a search query. */
export function matchesUser(user, query) {
  const q = fold(query.trim().replace(/^@/, ''));
  if (!q) return true;
  const digits = query.replace(/[^\d]/g, '');
  return (
    fold(user.contactName ?? '').includes(q) ||
    fold(user.displayName).includes(q) ||
    user.username.includes(q) ||
    (!!user.phone && digits.length >= 3 && user.phone.replace(/[^\d]/g, '').includes(digits))
  );
}

function fold(s) {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}
