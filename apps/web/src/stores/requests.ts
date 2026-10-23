/**
 * Message requests store: DMs from people who aren't my friends wait here instead of the chat
 * list (docs/design/discord-parity.md W7-C).
 *
 * State
 * - `byId`    chatId → ChatSummary with `request` 'pending' or 'ignored' (GET
 *             /api/chats/requests, and `?state=ignored`)
 * - `loaded`  both lists were fetched once (or failed): the conversation view stops waiting
 *
 * Actions
 * - `load()`          both lists (every socket `ready`, the Requests page); changes that
 *                     arrive while it is in flight are kept, and only the latest load applies
 * - `upsert(chat)`    a request arrived or changed (`chat:request`, a POST /chats/direct answer)
 * - `remove(chatId)`  accepted, or gone
 * - `removed(chatId)` `chat:request-removed`: a pending one left (accepted, or ignored on
 *                     another device: the Ignored list is refetched); one I just ignored stays
 * - `markIgnored(chatId)` my Ignore, before the server answers
 *
 * Request summaries never enter the chats store: `takeRequests` (called by its upserts)
 * hands them here, and an ordinary summary of a request means it was accepted.
 *
 * Selectors: `usePendingRequests()`, `useIgnoredRequests()` (newest first),
 * `usePendingRequestCount()`, `useRequestChat(id)`.
 */
import { useMemo } from 'react';
import { create } from 'zustand';
import type { ChatSummary, ID, UserPublic } from '@enbox/shared';
import { api } from '@/lib/api';
import { registerSessionReset, sessionEpoch } from '@/lib/session';
import { useUsers } from './users';

export interface RequestsState {
  byId: Record<ID, ChatSummary>;
  loaded: boolean;
  load(): Promise<void>;
  upsert(chat: ChatSummary): void;
  remove(chatId: ID): void;
  removed(chatId: ID): void;
  markIgnored(chatId: ID): void;
}

/** What happened while a load was in flight (replayed onto its snapshot). */
interface Flight {
  upserted: Map<ID, ChatSummary>;
  removed: Set<ID>;
}

const flights = new Set<Flight>();
let loadSeq = 0;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

function peersOf(chats: ChatSummary[]): UserPublic[] {
  return chats.flatMap((c) => (c.peer ? [c.peer] : []));
}

export const useRequests = create<RequestsState>((set, get) => ({
  byId: {},
  loaded: false,

  load() {
    const seq = ++loadSeq;
    const epoch = sessionEpoch();
    const flight: Flight = { upserted: new Map(), removed: new Set() };
    flights.add(flight);
    return Promise.all([
      api.get<ChatSummary[]>('/api/chats/requests'),
      api.get<ChatSummary[]>('/api/chats/requests', { query: { state: 'ignored' } }),
    ]).then(
      ([pending, ignored]) => {
        flights.delete(flight);
        if (epoch !== sessionEpoch() || seq !== loadSeq) return;
        const all = [...pending, ...ignored];
        useUsers.getState().upsertUsers(peersOf(all));
        const byId: Record<ID, ChatSummary> = {};
        for (const c of all) byId[c.id] = c;
        for (const id of flight.removed) delete byId[id];
        for (const [id, c] of flight.upserted) byId[id] = c;
        set({ byId, loaded: true });
      },
      () => {
        flights.delete(flight);
        // Offline or failing: show what we have (the next `ready` loads again).
        if (epoch === sessionEpoch() && seq === loadSeq) set({ loaded: true });
      },
    );
  },

  upsert(chat) {
    if (!chat.request) return;
    for (const f of flights) {
      f.upserted.set(chat.id, chat);
      f.removed.delete(chat.id);
    }
    set((s) => ({ byId: { ...s.byId, [chat.id]: chat } }));
  },

  remove(chatId) {
    for (const f of flights) {
      f.removed.add(chatId);
      f.upserted.delete(chatId);
    }
    if (!get().byId[chatId]) return;
    set((s) => {
      const byId = { ...s.byId };
      delete byId[chatId];
      return { byId };
    });
  },

  removed(chatId) {
    if (get().byId[chatId]?.request !== 'pending') return;
    get().remove(chatId);
    // Accepted elsewhere, its chat:upsert came first; so it was ignored on another device.
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      void get().load();
    }, 300);
  },

  markIgnored(chatId) {
    const chat = get().byId[chatId];
    if (chat && chat.request !== 'ignored') get().upsert({ ...chat, request: 'ignored' });
  },
}));

registerSessionReset(() => {
  flights.clear();
  loadSeq++;
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = null;
  useRequests.setState({ byId: {}, loaded: false });
});

/**
 * Route summaries between the stores (the chats store calls it on every upsert): requests
 * come here, and an ordinary summary of a request means it was accepted (it leaves). Returns
 * the summaries that belong in the chat list.
 */
export function takeRequests(chats: ChatSummary[]): ChatSummary[] {
  const s = useRequests.getState();
  if (!chats.some((c) => c.request || s.byId[c.id])) return chats;
  const listed: ChatSummary[] = [];
  for (const c of chats) {
    if (c.request) {
      s.upsert(c);
      continue;
    }
    if (s.byId[c.id]) s.remove(c.id);
    listed.push(c);
  }
  return listed;
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

/** Newest message first. */
export function selectRequests(
  byId: Record<ID, ChatSummary>,
  state: 'pending' | 'ignored',
): ChatSummary[] {
  return Object.values(byId)
    .filter((c) => c.request === state)
    .sort((a, b) =>
      a.lastActivityAt < b.lastActivityAt ? 1 : a.lastActivityAt > b.lastActivityAt ? -1 : 0,
    );
}

export function usePendingRequests(): ChatSummary[] {
  const byId = useRequests((s) => s.byId);
  return useMemo(() => selectRequests(byId, 'pending'), [byId]);
}

export function useIgnoredRequests(): ChatSummary[] {
  const byId = useRequests((s) => s.byId);
  return useMemo(() => selectRequests(byId, 'ignored'), [byId]);
}

/** Pending requests (the Home sidebar badge). */
export function usePendingRequestCount(): number {
  return useRequests((s) => {
    let n = 0;
    for (const c of Object.values(s.byId)) if (c.request === 'pending') n++;
    return n;
  });
}

/** A request chat by id (the conversation view shows requests too). */
export function useRequestChat(id: ID | null | undefined): ChatSummary | undefined {
  return useRequests((s) => (id ? s.byId[id] : undefined));
}

export function getRequestChat(id: ID): ChatSummary | undefined {
  return useRequests.getState().byId[id];
}
