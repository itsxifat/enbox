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
 * - `loadChats()`            GET /api/chats (replaces the list)
 * - `refreshChat(id)`        GET /api/chats/:id (deduped), upserts; removes on 404
 * - `upsertChat(chat)` / `upsertChats(chats)` / `patchChat(id, partial)` / `removeChat(id)`
 * - `applyChatUpdate(id, changes)` apply a viewer-neutral `chat:updated` (merges the changes,
 *                            recomputes `permissions` with `computeChatPermissions`, and drops
 *                            `inviteCode` when no longer allowed)
 * - `setTyping(chatId, userId, state)` auto-expires after TYPING_TIMEOUT_MS; 'idle' clears
 * - `clearTyping()` drop every typing indicator (on reconnect)
 * - `setPins(chatId, ids)`, `setOpenChat(id | null)`
 *
 * Selectors / hooks
 * - `selectSortedChats(byId, opts)` pure; `useSortedChats(opts)` memoized hook:
 *   pinned first, then `lastActivityAt` desc. opts: { archived?: boolean (default false),
 *   filter?: 'all'|'unread'|'groups'|'favorites' (= pinned), kind?: 'chats'|'channels'|'all' (default 'chats' =
 *   excludes channels, which live in the Updates tab), query?: string }
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
import { registerSessionReset } from '@/lib/session';
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

  loadChats(): Promise<void>;
  refreshChat(id: ID): Promise<ChatSummary | null>;
  upsertChat(chat: ChatSummary): void;
  upsertChats(chats: ChatSummary[]): void;
  patchChat(id: ID, partial: Partial<ChatSummary>): void;
  applyChatUpdate(id: ID, changes: ChatInfoChanges): void;
  removeChat(id: ID): void;
  setTyping(chatId: ID, userId: ID, state: TypingState): void;
  clearTyping(): void;
  setPins(chatId: ID, messageIds: ID[]): void;
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

const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();
const refreshing = new Map<ID, Promise<ChatSummary | null>>();
let loadingPromise: Promise<void> | null = null;

function peersOf(chats: ChatSummary[]): UserPublic[] {
  const out: UserPublic[] = [];
  for (const c of chats) if (c.peer) out.push(c.peer);
  return out;
}

export const useChats = create<ChatsState>((set, get) => ({
  ...initialState,

  loadChats() {
    if (loadingPromise) return loadingPromise;
    set({ loading: true, error: null });
    const p: Promise<void> = api
      .get<ChatSummary[]>('/api/chats')
      .then((chats) => {
        useUsers.getState().upsertUsers(peersOf(chats));
        const byId: Record<ID, ChatSummary> = {};
        for (const c of chats) byId[c.id] = c;
        set({ byId, loaded: true, loading: false });
      })
      .catch((e: unknown) => {
        // A response of the previous session (logout meanwhile): the store was reset.
        if (loadingPromise === p)
          set({ loading: false, error: e instanceof Error ? e.message : 'Failed to load chats' });
        throw e;
      })
      .finally(() => {
        if (loadingPromise === p) loadingPromise = null;
      });
    loadingPromise = p;
    return p;
  },

  refreshChat(id) {
    const pending = refreshing.get(id);
    if (pending) return pending;
    const p = api
      .get<ChatSummary>(`/api/chats/${id}`)
      .then((chat) => {
        get().upsertChat(chat);
        return chat;
      })
      .catch((e: unknown) => {
        if (e instanceof ApiError && (e.status === 404 || e.status === 403)) {
          get().removeChat(id);
          return null;
        }
        throw e;
      })
      .finally(() => refreshing.delete(id));
    refreshing.set(id, p);
    return p;
  },

  upsertChat(chat) {
    if (chat.peer) useUsers.getState().upsertUsers([chat.peer]);
    set((s) => ({ byId: { ...s.byId, [chat.id]: { ...s.byId[chat.id], ...chat } } }));
  },

  upsertChats(chats) {
    if (!chats.length) return;
    useUsers.getState().upsertUsers(peersOf(chats));
    set((s) => {
      const byId = { ...s.byId };
      for (const c of chats) byId[c.id] = { ...byId[c.id], ...c };
      return { byId };
    });
  },

  patchChat(id, partial) {
    const current = get().byId[id];
    if (!current) return;
    const merged = { ...current, ...partial };
    // A direct chat's permissions derive from its peer (deleted / blocked): `user:changed`
    // and block syncs patch only `peer`, with no chat:upsert, so recompute them here.
    if ('peer' in partial && !('permissions' in partial) && merged.type === 'direct') {
      merged.permissions = computeChatPermissions(merged, useAuth.getState().user?.id ?? '');
    }
    set((s) => ({ byId: { ...s.byId, [id]: merged } }));
  },

  applyChatUpdate(id, changes) {
    const current = get().byId[id];
    if (!current) return;
    const merged = { ...current, ...changes };
    const permissions = computeChatPermissions(merged, useAuth.getState().user?.id ?? '');
    const inviteCode = permissions.canInvite ? merged.inviteCode : null;
    set((s) => ({ byId: { ...s.byId, [id]: { ...merged, permissions, inviteCode } } }));
  },

  removeChat(id) {
    if (!get().byId[id]) return;
    set((s) => {
      const byId = { ...s.byId };
      delete byId[id];
      const typing = { ...s.typing };
      delete typing[id];
      const pins = { ...s.pins };
      delete pins[id];
      return { byId, typing, pins };
    });
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

  setOpenChat(id) {
    if (get().openChatId !== id) set({ openChatId: id });
  },
}));

registerSessionReset(() => {
  for (const t of typingTimers.values()) clearTimeout(t);
  typingTimers.clear();
  refreshing.clear();
  loadingPromise = null;
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

/** Pinned first, then most recent activity first. Pure (unit-tested). */
export function compareChats(a: ChatSummary, b: ChatSummary): number {
  if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
  const ta = Date.parse(a.lastActivityAt) || 0;
  const tb = Date.parse(b.lastActivityAt) || 0;
  if (ta !== tb) return tb - ta;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function selectSortedChats(
  byId: Record<ID, ChatSummary>,
  opts: ChatListOptions = {},
): ChatSummary[] {
  const { archived = false, filter = 'all', kind = 'chats' } = opts;
  const q = opts.query?.trim().toLowerCase();
  const out: ChatSummary[] = [];
  for (const chat of Object.values(byId)) {
    if (kind === 'chats' && chat.type === 'channel') continue;
    if (kind === 'channels' && chat.type !== 'channel') continue;
    if (kind !== 'channels' && chat.isArchived !== archived) continue;
    if (filter === 'unread' && !isChatUnread(chat)) continue;
    if (filter === 'groups' && chat.type !== 'group') continue;
    if (filter === 'favorites' && !chat.isPinned) continue;
    if (q && !chatTitle(chat).toLowerCase().includes(q)) continue;
    out.push(chat);
  }
  // The archive and channel lists don't honour pinning (WhatsApp behaviour).
  return out.sort(
    archived || kind === 'channels'
      ? (a, b) => compareChats({ ...a, isPinned: false }, { ...b, isPinned: false })
      : compareChats,
  );
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

/** Number of channels with unread posts (Updates tab dot). */
export function useUnreadChannelsCount(): number {
  return useChats((s) => {
    let n = 0;
    for (const c of Object.values(s.byId))
      if (c.type === 'channel' && isChatUnread(c) && !isMuted(c.mutedUntil)) n++;
    return n;
  });
}
