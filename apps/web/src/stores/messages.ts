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
 * - `loadLatest(chatId, { fresh })` newest page (replaces the window, keeps optimistic
 *                             entries); also the reconnect path: after a reconnect cached pages
 *                             are discarded and the open chat reloads its latest page (never
 *                             `after=` catch-up, which misses edits/deletes/reactions).
 *                             `fresh: true` never reuses a request already in flight (it may
 *                             predate the reconnect): a new one is issued after it.
 * - `loadOlder(chatId)`       page before the first loaded seq
 * - `loadNewer(chatId)`       page after the last loaded seq (when `hasMoreAfter`)
 * - `loadAround(chatId, seq)` jump to a message (search, starred, reply quote)
 * Messages that arrive (socket, REST) while a latest/around page is in flight are kept when
 * the page lands (and removals/clears received meanwhile are applied to it).
 *
 * Mutations (realtime + optimistic)
 * - `upsertMessage(m, { onlyIfPresent })` dedupes by `id`, then by `clientId` (replacing the
 *   optimistic entry). Merges with `mergeMessage` so viewer-specific fields (`starred`,
 *   `myReaction`, `poll.myOptionIds`, `localUrl`) survive viewer-neutral `message:updated`
 *   payloads. New messages outside the loaded window are ignored (they load on scroll).
 * - `markQuotesDeleted(messageId)` blank loaded quotes of a message deleted for everyone
 * - `patchMessage(chatId, id, partial)`, `removeMessages(chatId, ids)`,
 *   `clearChat(chatId, clearedSeq)` (also forgets the chat's cached pin ids), `dropChat(chatId)`,
 *   `discardConfirmed(chatId)` (reconnect: drop the cached pages but keep unsent messages)
 * - `addOptimistic(chatId, input)` → ClientMessage (also bumps the chat-list preview)
 * - `patchOptimistic(chatId, clientId, partial)` (upload progress…), `markFailed`,
 *   `removeOptimistic` — the chat-list preview follows (failed icon; previous message after a
 *   removal)
 * - `sendMessage(chatId, req, { optimistic })` — optimistic entry + POST + replace/markFailed.
 *   Pass `req.clientId` of an entry you created with `addOptimistic` (e.g. while uploading
 *   media) to reuse it. `retryMessage(chatId, clientId)` re-sends a failed one. A send whose
 *   clientId is already confirmed (a retry after a timed-out POST that did commit) resolves
 *   with the confirmed message instead of posting again.
 *
 * Memory: object URLs (`blob:`) of removed messages are revoked; windows of chats that are no
 * longer open are trimmed to their newest messages and at most MAX_CACHED_WINDOWS are kept
 * (least recently used first; never the open chat or windows with unsent messages).
 * Responses of a previous session (logout while a request was in flight) are dropped.
 *
 * Hooks: `useChatMessages(chatId)`.
 */
import { create } from 'zustand';
import {
  MESSAGES_PAGE_SIZE,
  extractMentionIds,
  type ChatSummary,
  type ID,
  type Message,
  type MessagePage,
  type Poll,
  type SendMessageRequest,
} from '@enbox/shared';
import { api } from '@/lib/api';
import { isLocalId, localMessageId, newClientId } from '@/lib/ids';
import { revokeObjectUrl } from '@/lib/media';
import { registerSessionReset, sessionEpoch } from '@/lib/session';
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

  loadLatest(chatId: ID, opts?: { fresh?: boolean }): Promise<void>;
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
  discardConfirmed(chatId: ID): void;

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

/** Message windows kept in memory (the open chat and windows with unsent messages always stay). */
export const MAX_CACHED_WINDOWS = 10;
/** Confirmed messages kept when the window of a chat that is no longer open is trimmed. */
export const TRIM_WINDOW_TO = MESSAGES_PAGE_SIZE * 2;

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
    // An optimistic copy never replaces the confirmed message (a retry of a send that did
    // commit): the delivered message stays where it is.
    if (isOptimistic(incoming) && !isOptimistic(old)) return items;
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

/**
 * What happened to a chat's window while a page request was in flight: the page was built
 * before (some of) these, so they are re-applied when it lands.
 */
export interface PageFlight {
  /** Confirmed messages received (latest copy per id); `insert` = a new message (not only an update). */
  arrived: Map<ID, { message: ClientMessage; insert: boolean }>;
  removed: Set<ID>;
  clearedSeq: number;
}

export function newPageFlight(): PageFlight {
  return { arrived: new Map(), removed: new Set(), clearedSeq: 0 };
}

/**
 * Replace the confirmed window with `page`, keeping unconfirmed optimistic entries.
 * With a `flight`: messages removed/cleared meanwhile are left out of the page, messages
 * updated meanwhile keep their newer copy, and — when the page reaches the newest message
 * (`toEnd`) — messages that arrived meanwhile after the page's last seq are appended.
 */
export function replaceWindow(
  items: ClientMessage[],
  page: Message[],
  flight?: PageFlight,
  toEnd = false,
): ClientMessage[] {
  const oldById = new Map(items.map((m) => [m.id, m] as const));
  const oldByClientId = new Map(
    items.filter((m) => m.clientId).map((m) => [m.clientId!, m] as const),
  );
  const kept = flight
    ? page.filter((m) => !flight.removed.has(m.id) && m.seq > flight.clearedSeq)
    : page;
  const confirmed = [...kept]
    .sort((a, b) => a.seq - b.seq)
    .map((m) => {
      const old = oldById.get(m.id) ?? (m.clientId ? oldByClientId.get(m.clientId) : undefined);
      let merged: ClientMessage = old ? mergeMessage(old, m) : m;
      const newer = flight?.arrived.get(m.id);
      if (newer) merged = mergeMessage(merged, newer.message);
      return finalize(merged);
    });
  if (flight && toEnd && flight.arrived.size) {
    const lastSeq = confirmed.length ? confirmed[confirmed.length - 1]!.seq : 0;
    const have = new Set(confirmed.map((m) => m.id));
    const extra: ClientMessage[] = [];
    for (const { message, insert } of flight.arrived.values()) {
      if (have.has(message.id) || message.seq <= lastSeq) continue;
      if (flight.removed.has(message.id) || message.seq <= flight.clearedSeq) continue;
      const current = oldById.get(message.id);
      if (!insert && !current) continue;
      extra.push(finalize(current ?? message));
    }
    extra.sort((a, b) => a.seq - b.seq);
    for (const m of extra) {
      const prev = confirmed[confirmed.length - 1];
      if (!prev || prev.seq < m.seq) confirmed.push(m);
    }
  }
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

function blobUrlsOf(m: ClientMessage): string[] {
  const out: string[] = [];
  if (m.localUrl?.startsWith('blob:')) out.push(m.localUrl);
  if (m.media?.url.startsWith('blob:')) out.push(m.media.url);
  if (m.media?.thumbnailUrl?.startsWith('blob:')) out.push(m.media.thumbnailUrl);
  return out;
}

/** Revoke the object URLs of messages that left the store (unless still referenced by `kept`). */
export function releaseDropped(dropped: ClientMessage[], kept: ClientMessage[] = []): void {
  let urls: Set<string> | null = null;
  for (const m of dropped) for (const u of blobUrlsOf(m)) (urls ??= new Set()).add(u);
  if (!urls) return;
  const stillUsed = new Set<string>();
  for (const m of kept) for (const u of blobUrlsOf(m)) stillUsed.add(u);
  for (const u of urls) if (!stillUsed.has(u)) revokeObjectUrl(u);
}

/** The confirmed copy of a send (window or chat preview), if the server already has it. */
function confirmedByClientId(chatId: ID, clientId: string): ClientMessage | undefined {
  const inWindow = useMessages
    .getState()
    .byChat[chatId]?.items.find((m) => m.clientId === clientId && !isOptimistic(m));
  if (inWindow) return inWindow;
  const last = useChats.getState().byId[chatId]?.lastMessage;
  return last && last.clientId === clientId && !isLocalId(last.id) ? last : undefined;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const inflight = new Map<string, Promise<void>>();
/** clientId → original request, for retries. */
const sendRequests = new Map<string, { chatId: ID; req: SendMessageRequest }>();
/** chatId → page requests in flight that replace the window (latest / around). */
const flights = new Map<ID, Set<PageFlight>>();
/**
 * chatId → generation of the last window replacement request (latest / around). A page
 * that lands after a newer replacement was requested is stale: the newer intent wins (e.g. a
 * reconnect reload must not undo the user's jump to an older message).
 */
const windowGen = new Map<ID, number>();
/** Global, monotonic counter the generations are drawn from. */
let windowSeq = 0;

function nextWindowGen(chatId: ID): number {
  const gen = ++windowSeq;
  windowGen.set(chatId, gen);
  return gen;
}

const currentWindowGen = (chatId: ID) => windowGen.get(chatId) ?? 0;

/**
 * Generation of a chat's last window request (`loadLatest` / `loadAround`); it is greater
 * than a `windowRequestMark()` taken earlier iff the window was requested after that point.
 * The reconnect resync uses it: a window requested after `ready` is already fresh.
 */
export function windowGeneration(chatId: ID): number {
  return currentWindowGen(chatId);
}

export function windowRequestMark(): number {
  return windowSeq;
}
/** Windows by recency of use (first = least recently used). */
const recent = new Set<ID>();
let compactTimer: ReturnType<typeof setTimeout> | null = null;

function once(key: string, fn: () => Promise<void>): Promise<void> {
  const pending = inflight.get(key);
  if (pending) return pending;
  const p: Promise<void> = fn().finally(() => {
    if (inflight.get(key) === p) inflight.delete(key);
  });
  inflight.set(key, p);
  return p;
}

/** Like `once`, but never joins a request that is already in flight: queue one after it. */
function onceFresh(key: string, fn: () => Promise<void>): Promise<void> {
  const pending = inflight.get(key);
  if (!pending) return once(key, fn);
  const freshKey = `${key}:fresh`;
  const queued = inflight.get(freshKey);
  if (queued) return queued;
  const epoch = sessionEpoch();
  const again = () => (epoch === sessionEpoch() ? once(key, fn) : Promise.resolve());
  const p: Promise<void> = pending.then(again, again).finally(() => {
    if (inflight.get(freshKey) === p) inflight.delete(freshKey);
  });
  inflight.set(freshKey, p);
  return p;
}

function beginFlight(chatId: ID): PageFlight {
  const f = newPageFlight();
  let set = flights.get(chatId);
  if (!set) flights.set(chatId, (set = new Set()));
  set.add(f);
  return f;
}

function endFlight(chatId: ID, f: PageFlight): void {
  const set = flights.get(chatId);
  if (!set) return;
  set.delete(f);
  if (!set.size) flights.delete(chatId);
}

function noteArrived(message: ClientMessage, insert: boolean): void {
  if (isOptimistic(message)) return;
  const set = flights.get(message.chatId);
  if (!set) return;
  for (const f of set) {
    const prev = f.arrived.get(message.id);
    f.arrived.set(message.id, {
      message: prev ? mergeMessage(prev.message, message) : message,
      insert: insert || !!prev?.insert,
    });
  }
}

function noteRemoved(chatId: ID, ids: Iterable<ID>): void {
  const set = flights.get(chatId);
  if (!set) return;
  for (const f of set) for (const id of ids) f.removed.add(id);
}

function noteCleared(chatId: ID, clearedSeq: number): void {
  const set = flights.get(chatId);
  if (!set) return;
  for (const f of set) f.clearedSeq = Math.max(f.clearedSeq, clearedSeq);
}

function touch(chatId: ID): void {
  recent.delete(chatId);
  recent.add(chatId);
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

  /** Replace a window with a latest/around page (see `replaceWindow`). */
  const applyPage = (
    chatId: ID,
    messages: Message[],
    flight: PageFlight,
    bounds: { hasMoreBefore: boolean; hasMoreAfter: boolean },
  ) => {
    let dropped: ClientMessage[] = [];
    let items: ClientMessage[] = [];
    update(chatId, (s) => {
      items = replaceWindow(s.items, messages, flight, !bounds.hasMoreAfter);
      dropped = s.items;
      return { items, ...bounds, loaded: true, loadingLatest: false };
    });
    releaseDropped(dropped, items);
  };

  const removeWindow = (chatId: ID, keep?: ClientMessage[]) => {
    const w = get().byChat[chatId];
    if (!w) return;
    set((st) => {
      const byChat = { ...st.byChat };
      if (keep?.length) byChat[chatId] = { ...EMPTY_CHAT_MESSAGES, items: keep };
      else delete byChat[chatId];
      return { byChat };
    });
    if (!keep?.length) recent.delete(chatId);
    releaseDropped(w.items, keep);
  };

  return {
    byChat: {},

    loadLatest(chatId, opts = {}) {
      touch(chatId);
      scheduleCompact();
      const run = async () => {
        const epoch = sessionEpoch();
        const gen = nextWindowGen(chatId);
        update(chatId, () => ({ loadingLatest: true, error: null }));
        const flight = beginFlight(chatId);
        try {
          const page = await api.get<MessagePage>(pageUrl(chatId), {
            query: { limit: MESSAGES_PAGE_SIZE },
          });
          if (epoch !== sessionEpoch() || gen !== currentWindowGen(chatId)) return;
          const messages = ingestPage(page);
          applyPage(chatId, messages, flight, {
            hasMoreBefore: page.hasMoreBefore,
            hasMoreAfter: false,
          });
        } catch (e) {
          if (epoch !== sessionEpoch() || gen !== currentWindowGen(chatId)) return;
          fail(chatId, 'loadingLatest', e);
          throw e;
        } finally {
          endFlight(chatId, flight);
        }
      };
      const key = `${chatId}:latest`;
      return opts.fresh ? onceFresh(key, run) : once(key, run);
    },

    loadOlder(chatId) {
      const s = chatState(chatId);
      if (!s.loaded) return get().loadLatest(chatId);
      if (!s.hasMoreBefore || s.loadingBefore) return Promise.resolve();
      const before = firstConfirmedSeq(s.items);
      if (!before) return get().loadLatest(chatId);
      touch(chatId);
      return once(`${chatId}:before`, async () => {
        const epoch = sessionEpoch();
        const gen = currentWindowGen(chatId);
        update(chatId, () => ({ loadingBefore: true, error: null }));
        try {
          const page = await api.get<MessagePage>(pageUrl(chatId), {
            query: { before, limit: MESSAGES_PAGE_SIZE },
          });
          if (epoch !== sessionEpoch()) return;
          // The window was replaced meanwhile: this page may not connect to it.
          if (gen !== currentWindowGen(chatId)) {
            update(chatId, () => ({ loadingBefore: false }));
            return;
          }
          const messages = ingestPage(page);
          update(chatId, (cur) => ({
            items: mergePage(cur.items, messages),
            hasMoreBefore: page.hasMoreBefore && messages.length > 0,
            loadingBefore: false,
          }));
        } catch (e) {
          if (epoch !== sessionEpoch()) return;
          fail(chatId, 'loadingBefore', e);
          throw e;
        }
      });
    },

    loadNewer(chatId) {
      const s = chatState(chatId);
      if (!s.loaded || !s.hasMoreAfter || s.loadingAfter) return Promise.resolve();
      const after = lastConfirmedSeq(s.items);
      touch(chatId);
      return once(`${chatId}:after`, async () => {
        const epoch = sessionEpoch();
        const gen = currentWindowGen(chatId);
        update(chatId, () => ({ loadingAfter: true, error: null }));
        try {
          const page = await api.get<MessagePage>(pageUrl(chatId), {
            query: { after, limit: MESSAGES_PAGE_SIZE },
          });
          if (epoch !== sessionEpoch()) return;
          if (gen !== currentWindowGen(chatId)) {
            update(chatId, () => ({ loadingAfter: false }));
            return;
          }
          const messages = ingestPage(page);
          update(chatId, (cur) => ({
            items: mergePage(cur.items, messages),
            hasMoreAfter: page.hasMoreAfter && messages.length > 0,
            loadingAfter: false,
          }));
        } catch (e) {
          if (epoch !== sessionEpoch()) return;
          fail(chatId, 'loadingAfter', e);
          throw e;
        }
      });
    },

    loadAround(chatId, seq) {
      touch(chatId);
      scheduleCompact();
      return once(`${chatId}:around:${seq}`, async () => {
        const epoch = sessionEpoch();
        const gen = nextWindowGen(chatId);
        update(chatId, () => ({ loadingLatest: true, error: null }));
        const flight = beginFlight(chatId);
        try {
          const page = await api.get<MessagePage>(pageUrl(chatId), {
            query: { around: seq, limit: MESSAGES_PAGE_SIZE },
          });
          if (epoch !== sessionEpoch() || gen !== currentWindowGen(chatId)) return;
          const messages = ingestPage(page);
          applyPage(chatId, messages, flight, {
            hasMoreBefore: page.hasMoreBefore,
            hasMoreAfter: page.hasMoreAfter,
          });
        } catch (e) {
          if (epoch !== sessionEpoch() || gen !== currentWindowGen(chatId)) return;
          fail(chatId, 'loadingLatest', e);
          throw e;
        } finally {
          endFlight(chatId, flight);
        }
      });
    },

    upsertMessage(message, opts = {}) {
      noteArrived(message, !opts.onlyIfPresent);
      const s = get().byChat[message.chatId];
      if (!s) return;
      const items = upsertInto(s.items, message, s, opts.onlyIfPresent);
      if (items !== s.items) update(message.chatId, () => ({ items }));
    },

    upsertMessages(chatId, messages) {
      for (const m of messages) noteArrived(m, true);
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
      noteRemoved(chatId, drop);
      let removed: ClientMessage[] = [];
      update(chatId, (s) => {
        const items = s.items.filter((m) => !drop.has(m.id));
        if (items.length === s.items.length) return null;
        removed = s.items.filter((m) => drop.has(m.id));
        return { items };
      });
      releaseDropped(removed);
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
      noteCleared(chatId, clearedSeq);
      // Pins on cleared messages are no longer visible to me: re-seed them from the server.
      useChats.getState().forgetPins(chatId);
      let removed: ClientMessage[] = [];
      update(chatId, (s) => {
        removed = s.items.filter((m) => !isOptimistic(m) && m.seq <= clearedSeq);
        return {
          items: s.items.filter((m) => isOptimistic(m) || m.seq > clearedSeq),
          hasMoreBefore: false,
        };
      });
      releaseDropped(removed);
    },

    dropChat(chatId) {
      removeWindow(chatId);
    },

    discardConfirmed(chatId) {
      const w = get().byChat[chatId];
      if (!w) return;
      // Unsent messages (pending, failed, uploading) stay: they can still be retried. The
      // window is "not loaded", so the history reloads when the chat is opened.
      removeWindow(chatId, w.items.filter(isOptimistic));
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
      touch(chatId);
      update(chatId, (s) => ({ items: upsertInto(s.items, message) }));
      // Chat list shows the outgoing message immediately (with a clock icon) — unless the
      // server already confirmed this send.
      useChats
        .getState()
        .mutateChat(chatId, (c) =>
          c.lastMessage?.clientId === clientId && !isLocalId(c.lastMessage.id)
            ? null
            : { lastMessage: message, lastActivityAt: now },
        );
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
      // The chat-list preview shows the send state (clock / failed); progress ticks don't matter.
      if ('pending' in partial || 'failed' in partial) {
        const localId = localMessageId(clientId);
        const state: Partial<ClientMessage> = {};
        if ('pending' in partial) state.pending = partial.pending;
        if ('failed' in partial) state.failed = partial.failed;
        useChats
          .getState()
          .mutateChat(chatId, (c) =>
            c.lastMessage?.id === localId
              ? { lastMessage: { ...c.lastMessage, ...state } as ChatSummary['lastMessage'] }
              : null,
          );
      }
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
      let removed: ClientMessage[] = [];
      update(chatId, (s) => {
        const items = s.items.filter((m) => !(m.clientId === clientId && isOptimistic(m)));
        if (items.length === s.items.length) return null;
        removed = s.items.filter((m) => m.clientId === clientId && isOptimistic(m));
        return { items };
      });
      releaseDropped(removed);
      // The chat-list preview was this message: fall back to the previous one.
      const localId = localMessageId(clientId);
      const chats = useChats.getState();
      if (chats.byId[chatId]?.lastMessage?.id !== localId) return;
      const w = get().byChat[chatId];
      const prev = w && !w.hasMoreAfter ? w.items[w.items.length - 1] : undefined;
      if (prev) {
        chats.mutateChat(chatId, (c) =>
          c.lastMessage?.id === localId
            ? { lastMessage: prev, lastActivityAt: prev.createdAt }
            : null,
        );
      } else {
        void chats.refreshChat(chatId).catch(() => undefined);
      }
    },

    async sendMessage(chatId, input, opts = {}) {
      const clientId = input.clientId ?? newClientId();
      const req: SendMessageRequest = { ...input, clientId };
      // Already delivered (e.g. a retry after a timed-out POST that did commit): done.
      const delivered = confirmedByClientId(chatId, clientId);
      if (delivered) {
        sendRequests.delete(clientId);
        return delivered;
      }
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

      const epoch = sessionEpoch();
      try {
        const message = await api.post<Message>(pageUrl(chatId), req);
        if (epoch !== sessionEpoch()) return message;
        sendRequests.delete(clientId);
        get().upsertMessage(message);
        // Sending advances my read watermark (and clears marked-unread) server-side.
        useChats.getState().mutateChat(chatId, (c) =>
          message.seq >= c.lastSeq
            ? {
                lastMessage: message,
                lastSeq: message.seq,
                lastReadSeq: Math.max(c.lastReadSeq, message.seq),
                lastActivityAt: message.createdAt,
                unreadCount: 0,
                unreadMentionCount: 0,
                markedUnread: false,
              }
            : { lastReadSeq: Math.max(c.lastReadSeq, message.seq) },
        );
        return message;
      } catch (e) {
        if (epoch === sessionEpoch()) get().markFailed(chatId, clientId);
        throw e;
      }
    },

    async retryMessage(chatId, clientId) {
      const pending = sendRequests.get(clientId);
      if (!pending) return null;
      const delivered = confirmedByClientId(chatId, clientId);
      if (delivered) {
        sendRequests.delete(clientId);
        return delivered;
      }
      return get().sendMessage(chatId, pending.req);
    },
  };
});

// ---------------------------------------------------------------------------
// Window cache bounds (see "Memory" above)
// ---------------------------------------------------------------------------

function busy(w: ChatMessages): boolean {
  return w.loadingLatest || w.loadingBefore || w.loadingAfter || w.items.some(isOptimistic);
}

/**
 * Keep the cache bounded: windows of chats that are not open are trimmed to their newest
 * TRIM_WINDOW_TO messages (an older "around" window is dropped: reopening loads the latest
 * page anyway), and beyond MAX_CACHED_WINDOWS the least recently used ones are dropped.
 */
export function compactWindows(): void {
  const { byChat } = useMessages.getState();
  const open = useChats.getState().openChatId;
  const ids = Object.keys(byChat);
  const order = [...ids.filter((id) => !recent.has(id)), ...[...recent].filter((id) => byChat[id])];
  let excess = ids.length - MAX_CACHED_WINDOWS;
  const drop: ID[] = [];
  const trim: ID[] = [];
  for (const id of order) {
    if (id === open) continue;
    const w = byChat[id]!;
    if (busy(w)) continue;
    if (excess > 0 || w.hasMoreAfter) {
      drop.push(id);
      excess--;
    } else if (w.items.length > TRIM_WINDOW_TO) trim.push(id);
  }
  if (!drop.length && !trim.length) return;
  const released: ClientMessage[] = [];
  useMessages.setState((st) => {
    const next = { ...st.byChat };
    for (const id of drop) {
      released.push(...next[id]!.items);
      delete next[id];
      recent.delete(id);
    }
    for (const id of trim) {
      const w = next[id]!;
      const cut = w.items.length - TRIM_WINDOW_TO;
      released.push(...w.items.slice(0, cut));
      next[id] = { ...w, items: w.items.slice(cut), hasMoreBefore: true };
    }
    return { byChat: next };
  });
  releaseDropped(released);
}

/** Compact a little later (quick back-and-forth between chats keeps their windows). */
function scheduleCompact(delayMs = 2_000): void {
  if (compactTimer) clearTimeout(compactTimer);
  compactTimer = setTimeout(() => {
    compactTimer = null;
    compactWindows();
  }, delayMs);
}

useChats.subscribe((s, prev) => {
  if (s.openChatId === prev.openChatId) return;
  if (s.openChatId) touch(s.openChatId);
  scheduleCompact();
});

registerSessionReset(() => {
  inflight.clear();
  sendRequests.clear();
  flights.clear();
  windowGen.clear();
  recent.clear();
  if (compactTimer) clearTimeout(compactTimer);
  compactTimer = null;
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
