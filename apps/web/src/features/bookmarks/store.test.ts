import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bookmark, BookmarksPage } from '@enbox/shared';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { makeMe, makeMessage, makeUser } from '@/test/factories';
import { bookmarkList, dueReminders, reminderKey, reminderList, useBookmarks } from './store';

const get = vi.fn();
vi.mock('@/lib/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  api: { get: (...a: unknown[]) => get(...a) },
}));

const at = (h: number) => new Date(Date.UTC(2026, 9, 23, h)).toISOString();
const bm = (id: string, p: Partial<Bookmark> = {}): Bookmark => ({
  messageId: id,
  chatId: 'c1',
  createdAt: at(1),
  remindAt: null,
  remindedAt: null,
  message: makeMessage({ id, chatId: 'c1' }),
  ...p,
});
const page = (bookmarks: Bookmark[], nextCursor: string | null = null): BookmarksPage => ({
  bookmarks,
  nextCursor,
  users: [makeUser({ id: 'alice' })],
});

describe('bookmarks store', () => {
  beforeEach(() => {
    useAuth.setState({ user: makeMe({ id: 'me' }) });
  });
  afterEach(() => {
    resetSessionState();
    get.mockReset();
  });

  it('orders bookmarks newest first and reminders upcoming first, then done', () => {
    const byId = {
      a: bm('a', { createdAt: at(1), remindAt: at(9) }),
      b: bm('b', { createdAt: at(3) }),
      c: bm('c', { createdAt: at(2), remindAt: at(5), remindedAt: at(5) }),
      d: bm('d', { createdAt: at(4), remindAt: at(7) }),
      e: bm('e', { createdAt: at(0), remindAt: at(4), remindedAt: at(6) }),
    };
    expect(bookmarkList(byId).map((b) => b.messageId)).toEqual(['d', 'b', 'c', 'a', 'e']);
    expect(reminderList(byId).map((b) => b.messageId)).toEqual(['d', 'a', 'e', 'c']);
    expect(dueReminders(byId, [reminderKey(byId.c)]).map((b) => b.messageId)).toEqual(['e']);
  });

  it('loads every page, keeping what changed meanwhile', async () => {
    let releaseSecond!: (p: BookmarksPage) => void;
    get.mockImplementation(async (_path: string, opts: { query: { before?: string } }) =>
      opts.query.before === 'p2'
        ? new Promise((r) => (releaseSecond = r))
        : page([bm('a'), bm('b')], 'p2'),
    );
    useBookmarks.getState().upsert(bm('stale'));
    const loading = useBookmarks.getState().load();
    // A second `ready` while loading: the same load.
    expect(useBookmarks.getState().load()).toBe(loading);
    await vi.waitFor(() => expect(releaseSecond).toBeTypeOf('function'));
    // Live events during the load win over its snapshot.
    useBookmarks.getState().upsert(bm('new'));
    useBookmarks.getState().remove('b');
    releaseSecond(page([bm('c')]));
    await loading;
    const s = useBookmarks.getState();
    expect(Object.keys(s.byId).sort()).toEqual(['a', 'c', 'new']);
    expect(s.loaded).toBe(true);
    expect(get).toHaveBeenCalledWith('/api/me/bookmarks', {
      query: { limit: 100, before: undefined },
    });
    expect(get).toHaveBeenCalledWith('/api/me/bookmarks', { query: { limit: 100, before: 'p2' } });
  });

  it('keeps an error and the old list when a load fails', async () => {
    useBookmarks.getState().upsert(bm('kept'));
    get.mockRejectedValue(new Error('offline'));
    await useBookmarks.getState().load();
    const s = useBookmarks.getState();
    expect(s.error).toBeTruthy();
    expect(Object.keys(s.byId)).toEqual(['kept']);
  });

  it('remembers seen reminders per account on this device', () => {
    const fired = bm('a', { remindAt: at(5), remindedAt: at(5) });
    useBookmarks.getState().upsert(fired);
    useBookmarks.getState().markSeen([reminderKey(fired)]);
    expect(JSON.parse(localStorage.getItem('enbox.bookmarks.seenReminders.me') ?? '[]')).toEqual([
      'a@' + at(5),
    ]);
    // Fired again (a new time): due again.
    const again = { ...fired, remindAt: at(8), remindedAt: at(8) };
    useBookmarks.getState().upsert(again);
    expect(dueReminders(useBookmarks.getState().byId, useBookmarks.getState().seen)).toEqual([
      again,
    ]);
  });
});
