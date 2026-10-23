/**
 * Bookmarks store: my saved messages and their reminders, all of them (≤ MAX_BOOKMARKS) loaded
 * page by page on every `ready` (GET /api/me/bookmarks) and kept current by
 * `bookmark:changed` / `bookmark:removed` / `reminder:due`, and by the saved messages' own
 * `message:updated` / `message:removed` (realtime/bookmarks.ts). The message menu, the Inbox's
 * Bookmarks and Reminders tabs and its badge read it.
 *
 * - `byId`: by message id. A reload replaces it in one go once every page arrived; changes
 *   that land meanwhile are applied over the result. `loaded`: a full list arrived once.
 * - `seen`: fired reminders I have looked at (`reminderKey`, this device, per account, newest
 *   SEEN_MAX). The other fired ones are due: they count on the Inbox button.
 */
import { create } from 'zustand';
import {
  MAX_BOOKMARKS,
  type Bookmark,
  type BookmarksPage,
  type ID,
  type Message,
} from '@enbox/shared';
import { api, errorMessage } from '@/lib/api';
import { registerSessionReset, sessionEpoch } from '@/lib/session';
import { storage } from '@/lib/storage';
import { useAuth } from '@/stores/auth';
import { useUsers } from '@/stores/users';

export const BOOKMARKS_PAGE_SIZE = 100;
const SEEN_MAX = 200;
const seenKey = (userId: ID) => `enbox.bookmarks.seenReminders.${userId}`;

export interface BookmarksState {
  byId: Record<ID, Bookmark>;
  loaded: boolean;
  /** When the last full list arrived (epoch ms; 0 = never). */
  loadedAt: number;
  loading: boolean;
  error: string | null;
  seen: string[];
  seenFor: ID | null;

  /** Every bookmark (reloaded on each `ready`; one load at a time). */
  load(): Promise<void>;
  upsert(bookmark: Bookmark): void;
  remove(messageId: ID): void;
  /**
   * A saved message changed (`message:updated`) or went away for me (`message:removed`: null);
   * deleted ones read null, as the list returns them.
   */
  setMessage(messageId: ID, message: Message | null): void;
  /** Fired reminders looked at (the Reminders tab, Open on the toast). */
  markSeen(keys: string[]): void;
}

/** A fired reminder's identity: a new time fires (and counts) again. */
export function reminderKey(b: Pick<Bookmark, 'messageId' | 'remindedAt'>): string {
  return `${b.messageId}@${b.remindedAt ?? ''}`;
}

/** Newest first (Discord's Bookmarks). */
export function bookmarkList(byId: Readonly<Record<ID, Bookmark>>): Bookmark[] {
  return Object.values(byId).sort(
    (a, b) =>
      Date.parse(b.createdAt) - Date.parse(a.createdAt) || (a.messageId < b.messageId ? 1 : -1),
  );
}

/** Bookmarks with a reminder: upcoming soonest first, then the done ones, last fired first. */
export function reminderList(byId: Readonly<Record<ID, Bookmark>>): Bookmark[] {
  const withTime = Object.values(byId).filter((b) => b.remindAt);
  const upcoming = withTime
    .filter((b) => !b.remindedAt)
    .sort(
      (a, b) =>
        Date.parse(a.remindAt!) - Date.parse(b.remindAt!) || (a.messageId < b.messageId ? -1 : 1),
    );
  const done = withTime
    .filter((b) => b.remindedAt)
    .sort(
      (a, b) =>
        Date.parse(b.remindedAt!) - Date.parse(a.remindedAt!) ||
        (a.messageId < b.messageId ? 1 : -1),
    );
  return [...upcoming, ...done];
}

/** Fired reminders not looked at yet. */
export function dueReminders(
  byId: Readonly<Record<ID, Bookmark>>,
  seen: readonly string[],
): Bookmark[] {
  const looked = new Set(seen);
  return Object.values(byId).filter((b) => b.remindedAt && !looked.has(reminderKey(b)));
}

const myId = () => useAuth.getState().user?.id ?? null;

/** Changes made while a reload is in flight (null = removed), applied over its result. */
let pending: Map<ID, Bookmark | null> | null = null;
let inFlight: Promise<void> | null = null;

export const useBookmarks = create<BookmarksState>((set, get) => {
  const hydrateSeen = () => {
    const me = myId();
    if (get().seenFor === me) return;
    const keys = me ? storage.getJSON<string[]>(seenKey(me)) : null;
    set({
      seen: Array.isArray(keys) ? keys.filter((k) => typeof k === 'string') : [],
      seenFor: me,
    });
  };

  const fetchAll = async (epoch: number): Promise<void> => {
    const byId: Record<ID, Bookmark> = {};
    let before: string | undefined;
    // ≤ MAX_BOOKMARKS: a bounded number of pages.
    for (let i = 0; i * BOOKMARKS_PAGE_SIZE < MAX_BOOKMARKS; i++) {
      const page = await api.get<BookmarksPage>('/api/me/bookmarks', {
        query: { limit: BOOKMARKS_PAGE_SIZE, before },
      });
      if (epoch !== sessionEpoch()) return;
      useUsers.getState().upsertUsers(page.users);
      for (const b of page.bookmarks) byId[b.messageId] = b;
      if (!page.nextCursor) break;
      before = page.nextCursor;
    }
    for (const [id, b] of pending ?? []) {
      if (b) byId[id] = b;
      else delete byId[id];
    }
    set({ byId, loaded: true, loadedAt: Date.now(), loading: false, error: null });
  };

  return {
    byId: {},
    loaded: false,
    loadedAt: 0,
    loading: false,
    error: null,
    seen: [],
    seenFor: null,

    load() {
      hydrateSeen();
      if (inFlight) return inFlight;
      const epoch = sessionEpoch();
      pending = new Map();
      set({ loading: true, error: null });
      inFlight = fetchAll(epoch)
        .catch((e: unknown) => {
          if (epoch === sessionEpoch()) set({ loading: false, error: errorMessage(e) });
        })
        .finally(() => {
          if (epoch !== sessionEpoch()) return;
          pending = null;
          inFlight = null;
        });
      return inFlight;
    },

    upsert(bookmark) {
      pending?.set(bookmark.messageId, bookmark);
      set((s) => ({ byId: { ...s.byId, [bookmark.messageId]: bookmark } }));
    },

    remove(messageId) {
      pending?.set(messageId, null);
      if (!get().byId[messageId]) return;
      set((s) => {
        const byId = { ...s.byId };
        delete byId[messageId];
        return { byId };
      });
    },

    setMessage(messageId, message) {
      const b = get().byId[messageId];
      if (b) get().upsert({ ...b, message: message && !message.deletedAt ? message : null });
    },

    markSeen(keys) {
      hydrateSeen();
      const { seen, seenFor } = get();
      const fresh = keys.filter((k) => !seen.includes(k));
      if (fresh.length === 0) return;
      const next = [...seen, ...fresh].slice(-SEEN_MAX);
      if (seenFor) storage.setJSON(seenKey(seenFor), next);
      set({ seen: next });
    },
  };
});

/** Whether a message is bookmarked (rows can show a mark with it). */
export function useIsBookmarked(messageId: ID): boolean {
  return useBookmarks((s) => !!s.byId[messageId]);
}

/** Due reminders (the Inbox button and the Reminders tab's count). */
export function useDueReminderCount(): number {
  return useBookmarks((s) => dueReminders(s.byId, s.seen).length);
}

registerSessionReset(() => {
  pending = null;
  inFlight = null;
  useBookmarks.setState({
    byId: {},
    loaded: false,
    loadedAt: 0,
    loading: false,
    error: null,
    seen: [],
    seenFor: null,
  });
});
