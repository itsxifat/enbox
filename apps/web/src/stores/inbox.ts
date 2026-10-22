/**
 * Inbox store (features/inbox): the popout's open state and tab, the Mentions feed
 * (GET /api/me/mentions, keyset pages, newest first) with its filters, local dismissals, and
 * the Unreads tab's message previews.
 *
 * - `open` / `owner`: which mounted Inbox button shows the popout (headers each render one;
 *   Ctrl+I opens the newest).
 * - `filters` (this device, localStorage): @everyone/@here, role mentions, This Space only.
 * - `feed`: the mentions of one query (`key` = filters + Space); a new key starts empty, the
 *   same key refreshes in place (stale items stay while the first page reloads). Responses of
 *   an older request or a previous session are dropped. A page can be short or empty and still
 *   have a `nextCursor` (the server skips what I cannot see): callers keep paging.
 * - `dismissed`: message ids removed with ✕ (this device, per account, newest DISMISSED_MAX).
 * - `previews`: the latest PREVIEW_COUNT messages per unread chat, refetched when `lastSeq` moves.
 */
import { create } from 'zustand';
import type { ID, InboxMention, InboxMentionsPage, Message, MessagePage } from '@enbox/shared';
import { api, errorMessage } from '@/lib/api';
import { registerSessionReset, sessionEpoch } from '@/lib/session';
import { storage } from '@/lib/storage';
import { useAuth } from './auth';
import { useUsers } from './users';

export type InboxTab = 'mentions' | 'unreads';

export interface InboxFilters {
  /** Include @everyone / @here. */
  everyone: boolean;
  /** Include mentions of my roles. */
  roles: boolean;
  /** Only the Space I am in (when I am in one). */
  thisSpace: boolean;
}

export const MENTIONS_PAGE_SIZE = 25;
/** Messages shown per channel in the Unreads tab. */
export const PREVIEW_COUNT = 3;
const DISMISSED_MAX = 500;
const FILTERS_KEY = 'enbox.inbox.filters';
const dismissedKey = (userId: ID) => `enbox.inbox.dismissed.${userId}`;

export const DEFAULT_INBOX_FILTERS: Readonly<InboxFilters> = Object.freeze({
  everyone: true,
  roles: true,
  thisSpace: false,
});

export interface MentionsFeed {
  /** The query the items belong to (`mentionsQueryKey`). */
  key: string | null;
  items: InboxMention[];
  nextCursor: string | null;
  loading: boolean;
  /** The first page of `key` arrived. */
  loaded: boolean;
  error: string | null;
}

export interface UnreadPreview {
  /** The chat's `lastSeq` when fetched. */
  lastSeq: number;
  messages: Message[];
  failed?: boolean;
}

export interface InboxState {
  open: boolean;
  tab: InboxTab;
  owner: string | null;
  filters: InboxFilters;
  feed: MentionsFeed;
  /** Dismissed message ids (newest last) and the account they belong to. */
  dismissed: ID[];
  dismissedFor: ID | null;
  previews: Record<ID, UnreadPreview>;

  setOpen(open: boolean, owner?: string): void;
  toggle(owner?: string): void;
  setTab(tab: InboxTab): void;
  setFilters(patch: Partial<InboxFilters>): void;
  /** First page (`more`: the next one) of the mentions for the filters, in `spaceId` when it applies. */
  loadMentions(spaceId: ID | null, opts?: { more?: boolean }): Promise<void>;
  dismiss(messageId: ID): void;
  isDismissed(messageId: ID): boolean;
  /** The latest messages of an unread chat (no-op while fresh for `lastSeq`). */
  loadPreview(chatId: ID, lastSeq: number): Promise<void>;
}

const EMPTY_FEED: MentionsFeed = {
  key: null,
  items: [],
  nextCursor: null,
  loading: false,
  loaded: false,
  error: null,
};

function storedFilters(): InboxFilters {
  const v = storage.getJSON<Partial<InboxFilters>>(FILTERS_KEY);
  return {
    everyone: typeof v?.everyone === 'boolean' ? v.everyone : DEFAULT_INBOX_FILTERS.everyone,
    roles: typeof v?.roles === 'boolean' ? v.roles : DEFAULT_INBOX_FILTERS.roles,
    thisSpace: typeof v?.thisSpace === 'boolean' ? v.thisSpace : DEFAULT_INBOX_FILTERS.thisSpace,
  };
}

/** The query of `GET /api/me/mentions` for these filters (`spaceId`: the Space I am in). */
export function mentionsQuery(
  filters: InboxFilters,
  spaceId: ID | null,
): { limit: number; everyone: boolean; roles: boolean; spaceId?: ID } {
  return {
    limit: MENTIONS_PAGE_SIZE,
    everyone: filters.everyone,
    roles: filters.roles,
    ...(filters.thisSpace && spaceId ? { spaceId } : {}),
  };
}

export function mentionsQueryKey(q: ReturnType<typeof mentionsQuery>): string {
  return `${q.everyone ? 1 : 0}${q.roles ? 1 : 0}:${q.spaceId ?? ''}`;
}

const myId = () => useAuth.getState().user?.id ?? null;

/** The newest request of the feed (older ones' responses are dropped). */
let feedRequest = 0;
const previewsInFlight = new Set<ID>();

export const useInbox = create<InboxState>((set, get) => {
  /** Dismissals of the signed-in account (read from storage when the account changed). */
  const hydrateDismissed = () => {
    const me = myId();
    if (get().dismissedFor === me) return;
    const ids = me ? storage.getJSON<ID[]>(dismissedKey(me)) : null;
    set({ dismissed: Array.isArray(ids) ? ids.filter((x) => typeof x === 'string') : [], dismissedFor: me });
  };

  return {
    open: false,
    tab: 'mentions',
    owner: null,
    filters: storedFilters(),
    feed: EMPTY_FEED,
    dismissed: [],
    dismissedFor: null,
    previews: {},

    setOpen(open, owner) {
      if (open) hydrateDismissed();
      set((s) => ({ open, owner: open ? (owner ?? s.owner) : s.owner }));
    },

    toggle(owner) {
      get().setOpen(!get().open, owner);
    },

    setTab(tab) {
      if (get().tab !== tab) set({ tab });
    },

    setFilters(patch) {
      const filters = { ...get().filters, ...patch };
      storage.setJSON(FILTERS_KEY, filters);
      set({ filters });
    },

    async loadMentions(spaceId, opts = {}) {
      hydrateDismissed();
      const query = mentionsQuery(get().filters, spaceId);
      const key = mentionsQueryKey(query);
      const feed = get().feed;
      let before: string | undefined;
      if (opts.more) {
        if (feed.key !== key || !feed.nextCursor || feed.loading) return;
        before = feed.nextCursor;
      }
      const epoch = sessionEpoch();
      const request = ++feedRequest;
      set({
        feed:
          feed.key === key
            ? { ...feed, loading: true, error: null }
            : { ...EMPTY_FEED, key, loading: true },
      });
      try {
        const page = await api.get<InboxMentionsPage>('/api/me/mentions', {
          query: { ...query, before },
        });
        if (epoch !== sessionEpoch() || request !== feedRequest) return;
        useUsers.getState().upsertUsers(page.users);
        set((s) => {
          const items = before ? [...s.feed.items] : [];
          const seen = new Set(items.map((i) => i.message.id));
          for (const item of page.items)
            if (!seen.has(item.message.id)) {
              seen.add(item.message.id);
              items.push(item);
            }
          return {
            feed: { key, items, nextCursor: page.nextCursor, loading: false, loaded: true, error: null },
          };
        });
      } catch (e) {
        if (epoch !== sessionEpoch() || request !== feedRequest) return;
        set((s) => ({ feed: { ...s.feed, loading: false, error: errorMessage(e) } }));
      }
    },

    dismiss(messageId) {
      hydrateDismissed();
      const { dismissed, dismissedFor } = get();
      if (dismissed.includes(messageId)) return;
      const next = [...dismissed, messageId].slice(-DISMISSED_MAX);
      if (dismissedFor) storage.setJSON(dismissedKey(dismissedFor), next);
      set({ dismissed: next });
    },

    isDismissed(messageId) {
      return get().dismissed.includes(messageId);
    },

    async loadPreview(chatId, lastSeq) {
      const cur = get().previews[chatId];
      if ((cur && cur.lastSeq >= lastSeq) || previewsInFlight.has(chatId)) return;
      previewsInFlight.add(chatId);
      const epoch = sessionEpoch();
      try {
        const page = await api.get<MessagePage>(`/api/chats/${chatId}/messages`, {
          query: { limit: PREVIEW_COUNT },
        });
        if (epoch !== sessionEpoch()) return;
        useUsers.getState().upsertUsers(page.users);
        set((s) => ({ previews: { ...s.previews, [chatId]: { lastSeq, messages: page.messages } } }));
      } catch {
        // The card shows without messages (no retry until the chat moves on).
        if (epoch === sessionEpoch())
          set((s) => ({ previews: { ...s.previews, [chatId]: { lastSeq, messages: [], failed: true } } }));
      } finally {
        previewsInFlight.delete(chatId);
      }
    },
  };
});

registerSessionReset(() => {
  feedRequest++;
  previewsInFlight.clear();
  useInbox.setState({
    open: false,
    tab: 'mentions',
    owner: null,
    feed: EMPTY_FEED,
    dismissed: [],
    dismissedFor: null,
    previews: {},
  });
});
