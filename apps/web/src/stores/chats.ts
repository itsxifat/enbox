/**
 * Chats store — the viewer's chat list (`ChatSummary`, viewer-specific) plus per-chat
 * ephemeral state (typing, pins) and which conversation is open.
 *
 * State
 * - `byId`        Record<ID, ChatSummary> — every chat from GET /api/chats (incl. archived,
 *                 left and channels; excludes chats deleted-for-me)
 * - `loaded` / `loading` / `error`
 * - `typing`      chatId → userId → { state: 'typing'|'recording', expiresAt }
 * - `pins`        chatId → pinned message ids (from `chat:pins`; seed via GET …/pins)
 * - `openChatId`  the conversation currently on screen (set by ConversationPane) — used to
 *                 suppress unread increments/notifications and to send read receipts
 *
 * Actions
 * - `loadChats({ fresh })`   GET /api/chats (replaces the list). Concurrent calls share one
 *                            request; `fresh: true` (the reconnect resync) never reuses a request
 *                            that was already in flight — it issues a new one after it. Changes
 *                            applied while the request is in flight (socket events, REST
 *                            responses, optimistic patches) are replayed onto the snapshot, so a
 *                            chat added/removed or a message received meanwhile isn't undone.
 * - `refreshChat(id)`        GET /api/chats/:id (deduped), upserts; removes on 404
 * - `upsertChat(chat)` / `upsertChats(chats)` merge a full summary (`mergeChatUpsert`: a summary
 *                            built before messages we already applied keeps the newer preview
 *                            and unread counts)
 * - `patchChat(id, partial)` absolute patch; a direct chat's `permissions` are recomputed when
 *                            the `peer` changes (deleted/blocked peer)
 * - `mutateChat(id, fn)`     patch computed from the current summary (`fn(chat) → partial |
 *                            null`); use it for relative changes (counters, watermarks)
 * - `removeChat(id)`
 * - `applyChatUpdate(id, changes)` apply a viewer-neutral `chat:updated` (merges the changes,
 *                            recomputes `permissions` with `computeChatPermissions`, and drops
 *                            `inviteCode` when no longer allowed)
 * - `setTyping(chatId, userId, state)` auto-expires after TYPING_TIMEOUT_MS; 'idle' clears
 * - `clearTyping()` drop every typing indicator (on reconnect)
 * - `setPins(chatId, ids)`, `forgetPins(chatId)` (re-seeded by the pinned bar),
 *   `resetPins(keepChatId?)` (reconnect), `setOpenChat(id | null)`
 *
 * Responses of a previous session (logout while a request was in flight) are dropped.
 *
 * Selectors / hooks
 * - `selectSortedChats(byId, opts)` pure; `useSortedChats(opts)` memoized hook:
 *   pinned first, then `lastActivityAt` desc. opts: { archived?: boolean (default false),
 *   filter?: 'all'|'unread'|'groups'|'favorites' (= pinned), kind?: 'chats'|'channels'|'all' (default 'chats' =
 *   excludes channels, which live in the Updates tab), query?: string }
 * - `filterChats(sorted, opts)` filter an already sorted list (keeps the order)
 * - `useChat(id)`, `getChat(id)`, `useTypingUsers(chatId)`, `useUnreadChatsCount()`
 */
import { useMemo } from 'react';
import { create } from 'zustand';
import {
  TYPING_TIMEOUT_MS,
  chatTitle,
  computeChatPermissions,
  isMuted,
  type ChatInfoChanges,
  type ChatSummary,
  type ID,
  type TypingState,
  type UserPublic,
} from '@enbox/shared';
import { ApiError, api } from '@/lib/api';
import { registerSessionReset, sessionEpoch } from '@/lib/session';
import { useAuth } from './auth';
import { useUsers } from './users';

export interface TypingEntry {
  state: Exclude<TypingState, 'idle'>;
  expiresAt: number;
}

export interface ChatsState {
  byId: Record<ID, ChatSummary>;
  loaded: boolean;
  loading: boolean;
  error: string | null;
  typing: Record<ID, Record<ID, TypingEntry>>;
  pins: Record<ID, ID[]>;
  openChatId: ID | null;

  loadChats(opts?: { fresh?: boolean }): Promise<void>;
  refreshChat(id: ID): Promise<ChatSummary | null>;
  upsertChat(chat: ChatSummary): void;
  upsertChats(chats: ChatSummary[]): void;
  patchChat(id: ID, partial: Partial<ChatSummary>): void;
  mutateChat(id: ID, fn: (chat: ChatSummary) => Partial<ChatSummary> | null): void;
  applyChatUpdate(id: ID, changes: ChatInfoChanges): void;
  removeChat(id: ID): void;
  setTyping(chatId: ID, userId: ID, state: TypingState): void;
  clearTyping(): void;
  setPins(chatId: ID, messageIds: ID[]): void;
  forgetPins(chatId: ID): void;
  resetPins(keepChatId?: ID | null): void;
  setOpenChat(id: ID | null): void;
}

const initialState = {
  byId: {} as Record<ID, ChatSummary>,
  loaded: false,
  loading: false,
  error: null as string | null,
  typing: {} as Record<ID, Record<ID, TypingEntry>>,
  pins: {} as Record<ID, ID[]>,
  openChatId: null as ID | null,
};

/** One chat-list change: the next summary from the current one (undefined = removed/absent). */
interface ChatOp {
  id: ID;
  apply(chat: ChatSummary | undefined): ChatSummary | undefined;
}

const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();
const refreshing = new Map<ID, Promise<ChatSummary | null>>();
let loadingPromise: Promise<void> | null = null;
/** A `fresh` load queued behind the request in flight (shared by concurrent fresh callers). */
let freshPromise: Promise<void> | null = null;
/** Changes applied while GET /api/chats is in flight — replayed onto its snapshot. */
let flightOps: ChatOp[] | null = null;

function peersOf(chats: ChatSummary[]): UserPublic[] {
  const out: UserPublic[] = [];
  for (const c of chats) if (c.peer) out.push(c.peer);
  return out;
}

const myId = () => useAuth.getState().user?.id ?? '';

/**
 * Watermarks only move forward: events can arrive out of order (REST response vs socket,
 * several devices), so keep the MAX of the cached and incoming values. The one legitimate
 * decrease is `readWatermark: 0` in a direct chat (read receipts turned off on either side).
 */
export function mergeWatermarks(
  current: Pick<ChatSummary, 'type' | 'readWatermark' | 'deliveredWatermark'>,
  incoming: { readWatermark: number; deliveredWatermark: number },
): { readWatermark: number; deliveredWatermark: number } {
  const readOff = current.type === 'direct' && incoming.readWatermark === 0;
  return {
    readWatermark: readOff ? 0 : Math.max(current.readWatermark, incoming.readWatermark),
    deliveredWatermark: Math.max(current.deliveredWatermark, incoming.deliveredWatermark),
  };
}

/**
 * Merge a full summary (`chat:upsert`, a REST response, a snapshot) into the cached one.
 * A summary is a snapshot of the moment it was built: when it is older than messages already
 * applied here (same membership, lower `lastSeq`), keep the cached preview and unread counts
 * instead of rolling them back. Membership changes (left, removed, rejoined) always take the
 * incoming summary. Pure (unit-tested).
 */
export function mergeChatUpsert(
  cached: ChatSummary | undefined,
  incoming: ChatSummary,
): ChatSummary {
  if (!cached) return incoming;
  if (cached.membership !== incoming.membership || incoming.lastSeq >= cached.lastSeq)
    return { ...cached, ...incoming };
  return {
    ...cached,
    ...incoming,
    lastMessage: cached.lastMessage,
    lastSeq: cached.lastSeq,
    lastActivityAt: cached.lastActivityAt,
    unreadCount: cached.unreadCount,
    unreadMentionCount: cached.unreadMentionCount,
    lastReadSeq: Math.max(cached.lastReadSeq, incoming.lastReadSeq),
    ...mergeWatermarks(incoming, cached),
  };
}

/** Apply a partial; a direct chat's permissions follow its peer (deleted/blocked). */
function patched(chat: ChatSummary, partial: Partial<ChatSummary>): ChatSummary {
  const next = { ...chat, ...partial };
  // `user:changed` and block syncs patch only `peer`, with no chat:upsert.
  if ('peer' in partial && !('permissions' in partial) && next.type === 'direct')
    next.permissions = computeChatPermissions(next, myId());
  return next;
}

function replay(byId: Record<ID, ChatSummary>, ops: ChatOp[]): Record<ID, ChatSummary> {
  for (const op of ops) {
    const next = op.apply(byId[op.id]);
    if (next) byId[op.id] = next;
    else delete byId[op.id];
  }
  return byId;
}

export const useChats = create<ChatsState>((set, get) => {
  /** Apply changes to the list (and record them while a list snapshot is in flight). */
  const commit = (ops: ChatOp[]) => {
    if (flightOps) flightOps.push(...ops);
    const cur = get().byId;
    let byId = cur;
    for (const op of ops) {
      const prev = byId[op.id];
      const next = op.apply(prev);
      if (next === prev) continue;
      if (byId === cur) byId = { ...cur };
      if (next) byId[op.id] = next;
      else delete byId[op.id];
    }
    if (byId !== cur) set({ byId });
  };

  const load = (): Promise<void> => {
    const epoch = sessionEpoch();
    const ops: ChatOp[] = [];
    flightOps = ops;
    set({ loading: true, error: null });
    const p: Promise<void> = api
      .get<ChatSummary[]>('/api/chats')
      .then((chats) => {
        if (epoch !== sessionEpoch()) return;
        if (flightOps === ops) flightOps = null;
        useUsers.getState().upsertUsers(peersOf(chats));
        const byId: Record<ID, ChatSummary> = {};
        for (const c of chats) byId[c.id] = c;
        set({ byId: replay(byId, ops), loaded: true, loading: false });
      })
      .catch((e: unknown) => {
        if (epoch !== sessionEpoch()) return;
        if (flightOps === ops) flightOps = null;
        set({ loading: false, error: e instanceof Error ? e.message : 'Failed to load chats' });
        throw e;
      })
      .finally(() => {
        if (loadingPromise === p) loadingPromise = null;
      });
    loadingPromise = p;
    return p;
  };

  return {
    ...initialState,

    loadChats(opts = {}) {
      if (!loadingPromise) return load();
      if (!opts.fresh) return loadingPromise;
      // The request in flight may predate the caller (e.g. issued before the socket joined
      // its rooms): queue one more after it instead of reusing its snapshot.
      if (!freshPromise) {
        const epoch = sessionEpoch();
        const again = (): Promise<void> => {
          if (freshPromise === queuedFresh) freshPromise = null;
          if (epoch !== sessionEpoch()) return Promise.resolve();
          return loadingPromise ?? load();
        };
        const queuedFresh: Promise<void> = loadingPromise.then(again, again);
        freshPromise = queuedFresh;
      }
      return freshPromise;
    },

    refreshChat(id) {
      const pending = refreshing.get(id);
      if (pending) return pending;
      const epoch = sessionEpoch();
      const p: Promise<ChatSummary | null> = api
        .get<ChatSummary>(`/api/chats/${id}`)
        .then((chat) => {
          if (epoch !== sessionEpoch()) return null;
          get().upsertChat(chat);
          return chat;
        })
        .catch((e: unknown) => {
          if (epoch !== sessionEpoch()) return null;
          if (e instanceof ApiError && (e.status === 404 || e.status === 403)) {
            get().removeChat(id);
            return null;
          }
          throw e;
        })
        .finally(() => {
          if (refreshing.get(id) === p) refreshing.delete(id);
        });
      refreshing.set(id, p);
      return p;
    },

    upsertChat(chat) {
      get().upsertChats([chat]);
    },

    upsertChats(chats) {
      if (!chats.length) return;
      useUsers.getState().upsertUsers(peersOf(chats));
      commit(chats.map((chat) => ({ id: chat.id, apply: (c) => mergeChatUpsert(c, chat) })));
    },

    patchChat(id, partial) {
      commit([{ id, apply: (c) => (c ? patched(c, partial) : c) }]);
    },

    mutateChat(id, fn) {
      commit([
        {
          id,
          apply: (c) => {
            if (!c) return c;
            const partial = fn(c);
            return partial ? patched(c, partial) : c;
          },
        },
      ]);
    },

    applyChatUpdate(id, changes) {
      commit([
        {
          id,
          apply: (c) => {
            if (!c) return c;
            const merged = { ...c, ...changes };
            const permissions = computeChatPermissions(merged, myId());
            const inviteCode = permissions.canInvite ? merged.inviteCode : null;
            return { ...merged, permissions, inviteCode };
          },
        },
      ]);
    },

    removeChat(id) {
      commit([{ id, apply: () => undefined }]);
      const { typing, pins } = get();
      if (typing[id] || pins[id]) {
        set((s) => {
          const nextTyping = { ...s.typing };
          delete nextTyping[id];
          const nextPins = { ...s.pins };
          delete nextPins[id];
          return { typing: nextTyping, pins: nextPins };
        });
      }
    },

    setTyping(chatId, userId, state) {
      const key = `${chatId}:${userId}`;
      const prevTimer = typingTimers.get(key);
      if (prevTimer) clearTimeout(prevTimer);
      typingTimers.delete(key);

      if (state === 'idle') {
        if (!get().typing[chatId]?.[userId]) return;
        set((s) => {
          const forChat = { ...s.typing[chatId] };
          delete forChat[userId];
          const typing = { ...s.typing };
          if (Object.keys(forChat).length) typing[chatId] = forChat;
          else delete typing[chatId];
          return { typing };
        });
        return;
      }

      const expiresAt = Date.now() + TYPING_TIMEOUT_MS;
      set((s) => ({
        typing: { ...s.typing, [chatId]: { ...s.typing[chatId], [userId]: { state, expiresAt } } },
      }));
      typingTimers.set(
        key,
        setTimeout(() => {
          typingTimers.delete(key);
          const entry = get().typing[chatId]?.[userId];
          if (entry && entry.expiresAt <= Date.now() + 50) get().setTyping(chatId, userId, 'idle');
        }, TYPING_TIMEOUT_MS),
      );
    },

    clearTyping() {
      for (const t of typingTimers.values()) clearTimeout(t);
      typingTimers.clear();
      if (Object.keys(get().typing).length) set({ typing: {} });
    },

    setPins(chatId, messageIds) {
      set((s) => ({ pins: { ...s.pins, [chatId]: messageIds } }));
    },

    forgetPins(chatId) {
      if (get().pins[chatId] === undefined) return;
      set((s) => {
        const pins = { ...s.pins };
        delete pins[chatId];
        return { pins };
      });
    },

    resetPins(keepChatId) {
      const kept = keepChatId ? get().pins[keepChatId] : undefined;
      set({ pins: keepChatId && kept ? { [keepChatId]: kept } : {} });
    },

    setOpenChat(id) {
      if (get().openChatId !== id) set({ openChatId: id });
    },
  };
});

registerSessionReset(() => {
  for (const t of typingTimers.values()) clearTimeout(t);
  typingTimers.clear();
  refreshing.clear();
  loadingPromise = null;
  freshPromise = null;
  flightOps = null;
  useChats.setState({ ...initialState });
});

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

/** `favorites` = pinned chats. */
export type ChatListFilter = 'all' | 'unread' | 'groups' | 'favorites';

export interface ChatListOptions {
  /** Show the archive (true) or the main list (false, default). */
  archived?: boolean;
  filter?: ChatListFilter;
  /** 'chats' (default) excludes channels; 'channels' only channels; 'all' everything. */
  kind?: 'chats' | 'channels' | 'all';
  /** Case-insensitive title match. */
  query?: string;
}

export function isChatUnread(chat: Pick<ChatSummary, 'unreadCount' | 'markedUnread'>): boolean {
  return chat.unreadCount > 0 || chat.markedUnread;
}

/**
 * Pinned first (unless `ignorePinned`: archive and channel lists), then most recent activity
 * first. Pure (unit-tested).
 */
export function compareChats(
  a: ChatSummary,
  b: ChatSummary,
  opts: { ignorePinned?: boolean } = {},
): number {
  if (!opts.ignorePinned && a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
  const ta = Date.parse(a.lastActivityAt) || 0;
  const tb = Date.parse(b.lastActivityAt) || 0;
  if (ta !== tb) return tb - ta;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function matches(chat: ChatSummary, filter: ChatListFilter, q: string | undefined): boolean {
  if (filter === 'unread' && !isChatUnread(chat)) return false;
  if (filter === 'groups' && chat.type !== 'group') return false;
  if (filter === 'favorites' && !chat.isPinned) return false;
  if (q && !chatTitle(chat).toLowerCase().includes(q)) return false;
  return true;
}

export function selectSortedChats(
  byId: Record<ID, ChatSummary>,
  opts: ChatListOptions = {},
): ChatSummary[] {
  const { archived = false, filter = 'all', kind = 'chats' } = opts;
  const q = opts.query?.trim().toLowerCase();
  // Decorate once (Date.parse per chat, not per comparison), sort, undecorate.
  const rows: { c: ChatSummary; t: number }[] = [];
  for (const chat of Object.values(byId)) {
    if (kind === 'chats' && chat.type === 'channel') continue;
    if (kind === 'channels' && chat.type !== 'channel') continue;
    if (kind !== 'channels' && chat.isArchived !== archived) continue;
    if (!matches(chat, filter, q)) continue;
    rows.push({ c: chat, t: Date.parse(chat.lastActivityAt) || 0 });
  }
  // The archive and channel lists don't honour pinning (WhatsApp behaviour).
  const ignorePinned = archived || kind === 'channels';
  rows.sort((x, y) => {
    const a = x.c;
    const b = y.c;
    if (!ignorePinned && a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
    if (x.t !== y.t) return y.t - x.t;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return rows.map((r) => r.c);
}

/** Filter an already sorted list (order kept) — cheaper than sorting again. */
export function filterChats(
  sorted: ChatSummary[],
  opts: { filter?: ChatListFilter; query?: string } = {},
): ChatSummary[] {
  const filter = opts.filter ?? 'all';
  const q = opts.query?.trim().toLowerCase();
  if (filter === 'all' && !q) return sorted;
  return sorted.filter((c) => matches(c, filter, q));
}

/** Memoized sorted/filtered chat list for list panes. */
export function useSortedChats(opts: ChatListOptions = {}): ChatSummary[] {
  const byId = useChats((s) => s.byId);
  const { archived, filter, kind, query } = opts;
  return useMemo(
    () => selectSortedChats(byId, { archived, filter, kind, query }),
    [byId, archived, filter, kind, query],
  );
}

export function useChat(id: ID | null | undefined): ChatSummary | undefined {
  return useChats((s) => (id ? s.byId[id] : undefined));
}

export function getChat(id: ID): ChatSummary | undefined {
  return useChats.getState().byId[id];
}

const NO_TYPING: Record<ID, TypingEntry> = {};

/** userId → typing entry for a chat (stable reference while unchanged). */
export function useTypingUsers(chatId: ID | null | undefined): Record<ID, TypingEntry> {
  return useChats((s) => (chatId ? (s.typing[chatId] ?? NO_TYPING) : NO_TYPING));
}

/** Number of unread, unmuted chats in the main list (Chats tab badge). */
export function useUnreadChatsCount(): number {
  return useChats((s) => {
    let n = 0;
    for (const c of Object.values(s.byId)) {
      if (c.type === 'channel' || c.isArchived || isMuted(c.mutedUntil)) continue;
      if (isChatUnread(c)) n++;
    }
    return n;
  });
}

/** Archived (non-channel) chats: how many, and how many of them are unread — no sorting. */
export function useArchivedCounts(): { count: number; unread: number } {
  const count = useChats((s) => {
    let n = 0;
    for (const c of Object.values(s.byId)) if (c.type !== 'channel' && c.isArchived) n++;
    return n;
  });
  const unread = useChats((s) => {
    let n = 0;
    for (const c of Object.values(s.byId))
      if (c.type !== 'channel' && c.isArchived && isChatUnread(c)) n++;
    return n;
  });
  return { count, unread };
}

/** Number of channels with unread posts (Updates tab dot). */
export function useUnreadChannelsCount(): number {
  return useChats((s) => {
    let n = 0;
    for (const c of Object.values(s.byId))
      if (c.type === 'channel' && isChatUnread(c) && !isMuted(c.mutedUntil)) n++;
    return n;
  });
}
