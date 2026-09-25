/**
 * Messages store — per-chat message windows with optimistic sends.
 *
 * Per chat (`byChat[chatId]: ChatMessages`)
 * - `items`: confirmed messages ascending by `seq`, followed by optimistic ones
 *   (`id = 'local:<clientId>'`, `seq = 0`, `pending`/`failed`) in send order
 * - `hasMoreBefore` / `hasMoreAfter` (after `loadAround`, newer messages aren't loaded)
 * - `loaded`, `loadingLatest`, `loadingBefore`, `loadingAfter`, `error`
 *
 * Loading (every page's side-loaded `users` go into the users store)
 * - `loadLatest(chatId)`      newest page (replaces the window, keeps optimistic entries);
 *                             also the reconnect path: after a reconnect cached pages are
 *                             discarded and the open chat reloads its latest page (never
 *                             `after=` catch-up, which misses edits/deletes/reactions)
 * - `loadOlder(chatId)`       page before the first loaded seq
 * - `loadNewer(chatId)`       page after the last loaded seq (when `hasMoreAfter`)
 * - `loadAround(chatId, seq)` jump to a message (search, starred, reply quote)
 *
 * Mutations (realtime + optimistic)
 * - `upsertMessage(m, { onlyIfPresent })` dedupes by `id`, then by `clientId` (replacing the
 *   optimistic entry). Merges with `mergeMessage` so viewer-specific fields (`starred`,
 *   `myReaction`, `poll.myOptionIds`, `localUrl`) survive viewer-neutral `message:updated`
 *   payloads. New messages outside the loaded window are ignored (they load on scroll).
 * - `markQuotesDeleted(messageId)` blank loaded quotes of a message deleted for everyone
 * - `patchMessage(chatId, id, partial)`, `removeMessages(chatId, ids)`,
 *   `clearChat(chatId, clearedSeq)`, `dropChat(chatId)`
 * - `addOptimistic(chatId, input)` → ClientMessage (also bumps the chat-list preview)
 * - `patchOptimistic(chatId, clientId, partial)` (upload progress…), `markFailed`,
 *   `removeOptimistic`
 * - `sendMessage(chatId, req, { optimistic })` — optimistic entry + POST + replace/markFailed.
 *   Pass `req.clientId` of an entry you created with `addOptimistic` (e.g. while uploading
 *   media) to reuse it. `retryMessage(chatId, clientId)` re-sends a failed one.
 *
 * Hooks: `useChatMessages(chatId)`.
 */
import { create } from 'zustand';
import {
  MESSAGES_PAGE_SIZE,
  extractMentionIds,
  type ID,
  type Message,
  type MessagePage,
  type Poll,
  type SendMessageRequest,
} from '@enbox/shared';
import { api } from '@/lib/api';
import { isLocalId, localMessageId, newClientId } from '@/lib/ids';
import { registerSessionReset } from '@/lib/session';
import { useAuth } from './auth';
import { useChats } from './chats';
import { useUsers } from './users';

/** A message as held by the client: server `Message` + optimistic/upload state. */
export type ClientMessage = Message & {
  /** Optimistic: not yet confirmed by the server. */
  pending?: boolean;
  /** Optimistic send failed (show retry). */
  failed?: boolean;
  /** Local object URL for media being uploaded (kept after confirmation to avoid a flash). */
  localUrl?: string;
  /** Upload progress 0..1 while uploading. */
  uploadProgress?: number;
};

export interface ChatMessages {
  items: ClientMessage[];
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
  loaded: boolean;
  loadingLatest: boolean;
  loadingBefore: boolean;
  loadingAfter: boolean;
  error: string | null;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Body for `sendMessage`: a SendMessageRequest (discriminated by `type`) whose clientId is optional. */
export type SendInput = DistributiveOmit<SendMessageRequest, 'clientId'> & { clientId?: string };

/** Fields for `addOptimistic`: anything from Message, `type` required. */
export type OptimisticInput = Partial<ClientMessage> & Pick<Message, 'type'>;

export interface MessagesState {
  byChat: Record<ID, ChatMessages>;

  loadLatest(chatId: ID): Promise<void>;
  loadOlder(chatId: ID): Promise<void>;
  loadNewer(chatId: ID): Promise<void>;
  loadAround(chatId: ID, seq: number): Promise<void>;

  upsertMessage(message: ClientMessage, opts?: { onlyIfPresent?: boolean }): void;
  upsertMessages(chatId: ID, messages: ClientMessage[]): void;
  patchMessage(chatId: ID, id: ID, partial: Partial<ClientMessage>): void;
  removeMessages(chatId: ID, ids: ID[]): void;
  markQuotesDeleted(messageId: ID): void;
  clearChat(chatId: ID, clearedSeq: number): void;
  dropChat(chatId: ID): void;

  addOptimistic(chatId: ID, input: OptimisticInput): ClientMessage;
  patchOptimistic(chatId: ID, clientId: string, partial: Partial<ClientMessage>): void;
  markFailed(chatId: ID, clientId: string): void;
  removeOptimistic(chatId: ID, clientId: string): void;
  sendMessage(
    chatId: ID,
    req: SendInput,
    opts?: { optimistic?: Partial<ClientMessage> },
  ): Promise<Message>;
  retryMessage(chatId: ID, clientId: string): Promise<Message | null>;
}

export const EMPTY_CHAT_MESSAGES: ChatMessages = Object.freeze({
  items: [],
  hasMoreBefore: true,
  hasMoreAfter: false,
  loaded: false,
  loadingLatest: false,
  loadingBefore: false,
  loadingAfter: false,
  error: null,
}) as ChatMessages;

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

export function isOptimistic(m: Pick<Message, 'id'>): boolean {
  return isLocalId(m.id);
}

/** Index of the first optimistic entry (= number of confirmed messages). */
function confirmedCount(items: ClientMessage[]): number {
  let i = items.length;
  while (i > 0 && isOptimistic(items[i - 1]!)) i--;
  return i;
}

/** First index in the confirmed prefix whose seq is >= `seq`. */
function lowerBound(items: ClientMessage[], end: number, seq: number): number {
  let lo = 0;
  let hi = end;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (items[mid]!.seq < seq) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Merge an incoming (possibly viewer-neutral) message into the cached one: incoming fields
 * win, except the viewer-specific ones it lacks (`starred`, `myReaction` stay via the spread;
 * `poll.myOptionIds` is nested, so it is carried over explicitly).
 */
export function mergeMessage(old: ClientMessage, incoming: ClientMessage): ClientMessage {
  const merged: ClientMessage = { ...old, ...incoming };
  if (incoming.poll && incoming.poll.myOptionIds === undefined && old.poll?.myOptionIds) {
    merged.poll = { ...incoming.poll, myOptionIds: old.poll.myOptionIds };
  }
  return merged;
}

function finalize(merged: ClientMessage): ClientMessage {
  if (isOptimistic(merged)) return merged;
  const m = { ...merged };
  delete m.pending;
  delete m.failed;
  delete m.uploadProgress;
  return m;
}

export interface WindowBounds {
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
}

/**
 * Insert or merge `incoming` into an ordered items array (immutable). Returns the same
 * array when nothing changed/was inserted.
 */
export function upsertInto(
  items: ClientMessage[],
  incoming: ClientMessage,
  bounds: WindowBounds = { hasMoreBefore: false, hasMoreAfter: false },
  onlyIfPresent = false,
): ClientMessage[] {
  let idx = items.findIndex((m) => m.id === incoming.id);
  if (idx === -1 && incoming.clientId)
    idx = items.findIndex((m) => m.clientId === incoming.clientId);

  let merged: ClientMessage;
  let base = items;
  if (idx >= 0) {
    const old = items[idx]!;
    merged = finalize(mergeMessage(old, incoming));
    const samePlace = isOptimistic(old) === isOptimistic(merged) && old.seq === merged.seq;
    if (samePlace) {
      const next = items.slice();
      next[idx] = merged;
      return next;
    }
    base = items.slice(0, idx).concat(items.slice(idx + 1));
  } else {
    if (onlyIfPresent) return items;
    merged = finalize(incoming);
  }

  if (isOptimistic(merged)) return base.concat(merged);

  const end = confirmedCount(base);
  const first = end > 0 ? base[0]!.seq : null;
  const last = end > 0 ? base[end - 1]!.seq : null;
  // Outside the loaded window: it will be fetched when the user scrolls there.
  if (idx === -1) {
    if (bounds.hasMoreAfter && last !== null && merged.seq > last) return items;
    if (bounds.hasMoreBefore && first !== null && merged.seq < first) return items;
  }
  const at = lowerBound(base, end, merged.seq);
  if (at < end && base[at]!.seq === merged.seq) {
    // Same seq, different id (shouldn't happen) — replace.
    const next = base.slice();
    next[at] = merged;
    return next;
  }
  return base.slice(0, at).concat(merged, base.slice(at));
}

/** Merge a page of confirmed messages into items (any order in `page`). */
export function mergePage(items: ClientMessage[], page: Message[]): ClientMessage[] {
  let next = items;
  for (const m of [...page].sort((a, b) => a.seq - b.seq)) next = upsertInto(next, m);
  return next;
}

/** Replace the confirmed window with `page`, keeping unconfirmed optimistic entries. */
function replaceWindow(items: ClientMessage[], page: Message[]): ClientMessage[] {
  const oldById = new Map(items.map((m) => [m.id, m] as const));
  const oldByClientId = new Map(
    items.filter((m) => m.clientId).map((m) => [m.clientId!, m] as const),
  );
  const confirmed = [...page]
    .sort((a, b) => a.seq - b.seq)
    .map((m) => {
      const old = oldById.get(m.id) ?? (m.clientId ? oldByClientId.get(m.clientId) : undefined);
      return finalize(old ? mergeMessage(old, m) : m);
    });
  const confirmedClientIds = new Set(confirmed.map((m) => m.clientId).filter(Boolean));
  const optimistic = items.filter((m) => isOptimistic(m) && !confirmedClientIds.has(m.clientId));
  return confirmed.concat(optimistic);
}

function lastConfirmedSeq(items: ClientMessage[]): number {
  const end = confirmedCount(items);
  return end > 0 ? items[end - 1]!.seq : 0;
}

function firstConfirmedSeq(items: ClientMessage[]): number {
  return confirmedCount(items) > 0 ? items[0]!.seq : 0;
}

function optimisticFromRequest(req: SendInput): Partial<ClientMessage> {
  const text = 'text' in req ? (req.text ?? null) : null;
  const poll: Poll | null =
    req.type === 'poll'
      ? {
          question: req.poll.question,
          options: req.poll.options.map((option, i) => ({
            id: `local-${i}`,
            text: option,
            voteCount: 0,
            voterIds: [],
          })),
          allowMultiple: req.poll.allowMultiple ?? false,
          totalVoters: 0,
          myOptionIds: [],
        }
      : null;
  return {
    type: req.type,
    text,
    // The server derives mentions from the text's `@{uuid}` tokens (active members only).
    mentions: extractMentionIds(text),
    location:
      req.type === 'location'
        ? {
            latitude: req.location.latitude,
            longitude: req.location.longitude,
            name: req.location.name ?? null,
            address: req.location.address ?? null,
          }
        : null,
    contact:
      req.type === 'contact'
        ? {
            userId: req.contact.userId ?? null,
            name: req.contact.name ?? '',
            username: req.contact.username ?? null,
            phone: req.contact.phone ?? null,
          }
        : null,
    poll,
  };
}

/** Put a page's side-loaded users into the users store and return its messages. */
function ingestPage(page: MessagePage): Message[] {
  if (page.users?.length) useUsers.getState().upsertUsers(page.users);
  return page.messages;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const inflight = new Map<string, Promise<void>>();
/** clientId → original request, for retries. */
const sendRequests = new Map<string, { chatId: ID; req: SendMessageRequest }>();

function once(key: string, fn: () => Promise<void>): Promise<void> {
  const pending = inflight.get(key);
  if (pending) return pending;
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

function pageUrl(chatId: ID): string {
  return `/api/chats/${chatId}/messages`;
}

export const useMessages = create<MessagesState>((set, get) => {
  const chatState = (chatId: ID): ChatMessages => get().byChat[chatId] ?? EMPTY_CHAT_MESSAGES;
  const update = (chatId: ID, fn: (s: ChatMessages) => Partial<ChatMessages> | null) =>
    set((st) => {
      const current = st.byChat[chatId] ?? EMPTY_CHAT_MESSAGES;
      const patch = fn(current);
      if (!patch) return st;
      return { byChat: { ...st.byChat, [chatId]: { ...current, ...patch } } };
    });

  const fail = (
    chatId: ID,
    flag: 'loadingLatest' | 'loadingBefore' | 'loadingAfter',
    e: unknown,
  ) => {
    const patch: Partial<ChatMessages> = {
      error: e instanceof Error ? e.message : 'Failed to load messages',
    };
    patch[flag] = false;
    update(chatId, () => patch);
  };

  return {
    byChat: {},

    loadLatest(chatId) {
      return once(`${chatId}:latest`, async () => {
        update(chatId, () => ({ loadingLatest: true, error: null }));
        try {
          const page = await api.get<MessagePage>(pageUrl(chatId), {
            query: { limit: MESSAGES_PAGE_SIZE },
          });
          const messages = ingestPage(page);
          update(chatId, (s) => ({
            items: replaceWindow(s.items, messages),
            hasMoreBefore: page.hasMoreBefore,
            hasMoreAfter: false,
            loaded: true,
            loadingLatest: false,
          }));
        } catch (e) {
          fail(chatId, 'loadingLatest', e);
          throw e;
        }
      });
    },

    loadOlder(chatId) {
      const s = chatState(chatId);
      if (!s.loaded) return get().loadLatest(chatId);
      if (!s.hasMoreBefore || s.loadingBefore) return Promise.resolve();
      const before = firstConfirmedSeq(s.items);
      if (!before) return get().loadLatest(chatId);
      return once(`${chatId}:before`, async () => {
        update(chatId, () => ({ loadingBefore: true, error: null }));
        try {
          const page = await api.get<MessagePage>(pageUrl(chatId), {
            query: { before, limit: MESSAGES_PAGE_SIZE },
          });
          const messages = ingestPage(page);
          update(chatId, (cur) => ({
            items: mergePage(cur.items, messages),
            hasMoreBefore: page.hasMoreBefore && messages.length > 0,
            loadingBefore: false,
          }));
        } catch (e) {
          fail(chatId, 'loadingBefore', e);
          throw e;
        }
      });
    },

    loadNewer(chatId) {
      const s = chatState(chatId);
      if (!s.loaded || !s.hasMoreAfter || s.loadingAfter) return Promise.resolve();
      const after = lastConfirmedSeq(s.items);
      return once(`${chatId}:after`, async () => {
        update(chatId, () => ({ loadingAfter: true, error: null }));
        try {
          const page = await api.get<MessagePage>(pageUrl(chatId), {
            query: { after, limit: MESSAGES_PAGE_SIZE },
          });
          const messages = ingestPage(page);
          update(chatId, (cur) => ({
            items: mergePage(cur.items, messages),
            hasMoreAfter: page.hasMoreAfter && messages.length > 0,
            loadingAfter: false,
          }));
        } catch (e) {
          fail(chatId, 'loadingAfter', e);
          throw e;
        }
      });
    },

    loadAround(chatId, seq) {
      return once(`${chatId}:around:${seq}`, async () => {
        update(chatId, () => ({ loadingLatest: true, error: null }));
        try {
          const page = await api.get<MessagePage>(pageUrl(chatId), {
            query: { around: seq, limit: MESSAGES_PAGE_SIZE },
          });
          const messages = ingestPage(page);
          update(chatId, (cur) => ({
            items: replaceWindow(cur.items, messages),
            hasMoreBefore: page.hasMoreBefore,
            hasMoreAfter: page.hasMoreAfter,
            loaded: true,
            loadingLatest: false,
          }));
        } catch (e) {
          fail(chatId, 'loadingLatest', e);
          throw e;
        }
      });
    },

    upsertMessage(message, opts = {}) {
      const s = get().byChat[message.chatId];
      if (!s) return;
      const items = upsertInto(s.items, message, s, opts.onlyIfPresent);
      if (items !== s.items) update(message.chatId, () => ({ items }));
    },

    upsertMessages(chatId, messages) {
      const s = get().byChat[chatId];
      if (!s || !messages.length) return;
      let items = s.items;
      for (const m of messages) items = upsertInto(items, m, s);
      if (items !== s.items) update(chatId, () => ({ items }));
    },

    patchMessage(chatId, id, partial) {
      update(chatId, (s) => {
        const idx = s.items.findIndex((m) => m.id === id);
        if (idx === -1) return null;
        const items = s.items.slice();
        items[idx] = { ...items[idx]!, ...partial };
        return { items };
      });
    },

    removeMessages(chatId, ids) {
      const drop = new Set(ids);
      update(chatId, (s) => {
        const items = s.items.filter((m) => !drop.has(m.id));
        return items.length === s.items.length ? null : { items };
      });
    },

    markQuotesDeleted(messageId) {
      set((st) => {
        let byChat = st.byChat;
        for (const [chatId, cm] of Object.entries(st.byChat)) {
          if (!cm.items.some((m) => m.replyTo?.id === messageId)) continue;
          const items = cm.items.map((m) =>
            m.replyTo?.id === messageId
              ? { ...m, replyTo: { ...m.replyTo, text: null, media: null, deleted: true } }
              : m,
          );
          if (byChat === st.byChat) byChat = { ...st.byChat };
          byChat[chatId] = { ...cm, items };
        }
        return byChat === st.byChat ? st : { byChat };
      });
    },

    clearChat(chatId, clearedSeq) {
      update(chatId, (s) => ({
        items: s.items.filter((m) => isOptimistic(m) || m.seq > clearedSeq),
        hasMoreBefore: false,
      }));
    },

    dropChat(chatId) {
      if (!get().byChat[chatId]) return;
      set((st) => {
        const byChat = { ...st.byChat };
        delete byChat[chatId];
        return { byChat };
      });
    },

    addOptimistic(chatId, input) {
      const clientId = input.clientId ?? newClientId();
      const now = new Date().toISOString();
      const message: ClientMessage = {
        chatId,
        senderId: useAuth.getState().user?.id ?? null,
        text: null,
        media: null,
        location: null,
        contact: null,
        poll: null,
        system: null,
        call: null,
        statusReply: null,
        replyTo: null,
        forwardCount: 0,
        mentions: [],
        reactions: [],
        editedAt: null,
        deletedAt: null,
        expiresAt: null,
        createdAt: now,
        ...input,
        id: localMessageId(clientId),
        seq: 0,
        clientId,
        pending: true,
        failed: false,
      };
      update(chatId, (s) => ({ items: upsertInto(s.items, message) }));
      // Chat list shows the outgoing message immediately (with a clock icon).
      const chat = useChats.getState().byId[chatId];
      if (chat)
        useChats.getState().patchChat(chatId, { lastMessage: message, lastActivityAt: now });
      return message;
    },

    patchOptimistic(chatId, clientId, partial) {
      update(chatId, (s) => {
        const idx = s.items.findIndex((m) => m.clientId === clientId && isOptimistic(m));
        if (idx === -1) return null;
        const items = s.items.slice();
        items[idx] = { ...items[idx]!, ...partial };
        return { items };
      });
    },

    markFailed(chatId, clientId) {
      get().patchOptimistic(chatId, clientId, {
        pending: false,
        failed: true,
        uploadProgress: undefined,
      });
    },

    removeOptimistic(chatId, clientId) {
      sendRequests.delete(clientId);
      update(chatId, (s) => {
        const items = s.items.filter((m) => !(m.clientId === clientId && isOptimistic(m)));
        return items.length === s.items.length ? null : { items };
      });
    },

    async sendMessage(chatId, input, opts = {}) {
      const clientId = input.clientId ?? newClientId();
      const req: SendMessageRequest = { ...input, clientId };
      const existing = get().byChat[chatId]?.items.find(
        (m) => m.clientId === clientId && isOptimistic(m),
      );
      if (existing) get().patchOptimistic(chatId, clientId, { pending: true, failed: false });
      else
        get().addOptimistic(chatId, {
          ...optimisticFromRequest(req),
          ...opts.optimistic,
          type: req.type,
          clientId,
        });
      sendRequests.set(clientId, { chatId, req });

      try {
        const message = await api.post<Message>(pageUrl(chatId), req);
        sendRequests.delete(clientId);
        get().upsertMessage(message);
        const chat = useChats.getState().byId[chatId];
        if (chat && message.seq >= chat.lastSeq) {
          useChats.getState().patchChat(chatId, {
            lastMessage: message,
            lastSeq: message.seq,
            lastReadSeq: Math.max(chat.lastReadSeq, message.seq),
            lastActivityAt: message.createdAt,
          });
        }
        return message;
      } catch (e) {
        get().markFailed(chatId, clientId);
        throw e;
      }
    },

    async retryMessage(chatId, clientId) {
      const pending = sendRequests.get(clientId);
      if (!pending) return null;
      return get().sendMessage(chatId, pending.req);
    },
  };
});

registerSessionReset(() => {
  inflight.clear();
  sendRequests.clear();
  useMessages.setState({ byChat: {} });
});

/** Message window for a chat (stable EMPTY_CHAT_MESSAGES when nothing is loaded). */
export function useChatMessages(chatId: ID | null | undefined): ChatMessages {
  return useMessages((s) =>
    chatId ? (s.byChat[chatId] ?? EMPTY_CHAT_MESSAGES) : EMPTY_CHAT_MESSAGES,
  );
}

export function getChatMessages(chatId: ID): ChatMessages {
  return useMessages.getState().byChat[chatId] ?? EMPTY_CHAT_MESSAGES;
}
