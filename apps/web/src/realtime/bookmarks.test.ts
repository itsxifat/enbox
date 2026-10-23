/**
 * Realtime bookmarks: bookmark:changed / bookmark:removed into the store, reminder:due with its
 * toast, message:new offered to the in-app banners, and the reload on `ready`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bookmark, BookmarksPage, ServerToClientEvents } from '@enbox/shared';
import { useBookmarks } from '@/features/bookmarks/store';
import { useBanners } from '@/features/notifications/banners';
import { resetSessionState } from '@/lib/session';
import type { AppSocket, ReadyInfo } from '@/lib/socket';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useUi } from '@/stores/ui';
import { makeChat, makeMe, makeMessage } from '@/test/factories';
import { registerBookmarkHandlers, resyncBookmarks } from './bookmarks';

const get = vi.fn();
vi.mock('@/lib/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  api: { get: (...a: unknown[]) => get(...a) },
}));

type Handler = (payload: unknown) => void;

function fakeSocket() {
  const handlers = new Map<string, Handler[]>();
  const socket = {
    on(event: string, fn: Handler) {
      handlers.set(event, [...(handlers.get(event) ?? []), fn]);
      return socket;
    },
  } as unknown as AppSocket;
  registerBookmarkHandlers(socket);
  return <E extends keyof ServerToClientEvents>(
    event: E,
    payload: Parameters<ServerToClientEvents[E]>[0],
  ) => {
    for (const fn of handlers.get(event) ?? []) fn(payload);
  };
}

const message = makeMessage({ id: 'm1', chatId: 'g1', senderId: 'alice', text: 'pay rent' });
const bookmark = (p: Partial<Bookmark> = {}): Bookmark => ({
  messageId: 'm1',
  chatId: 'g1',
  createdAt: '2026-10-23T08:00:00.000Z',
  remindAt: null,
  remindedAt: null,
  message,
  ...p,
});

describe('realtime: bookmarks and reminders', () => {
  beforeEach(() => {
    useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
    useUi.setState({ toasts: [] });
  });
  afterEach(() => {
    resetSessionState();
    useChats.setState({ byId: {}, openChatId: null });
    get.mockReset();
  });

  it('keeps the store current; a due reminder also shows its toast', () => {
    const fire = fakeSocket();
    fire('bookmark:changed', { bookmark: bookmark() });
    expect(useBookmarks.getState().byId.m1).toEqual(bookmark());
    const due = bookmark({
      remindAt: '2026-10-23T09:00:00.000Z',
      remindedAt: '2026-10-23T09:00:01.000Z',
    });
    fire('reminder:due', { bookmark: due });
    expect(useBookmarks.getState().byId.m1).toEqual(due);
    expect(useUi.getState().toasts.at(-1)).toMatchObject({
      message: 'Reminder',
      action: { label: 'Open' },
    });
    fire('bookmark:removed', { messageId: 'm1' });
    expect(useBookmarks.getState().byId.m1).toBeUndefined();
  });

  it('keeps a saved message current: edited, deleted, gone for me', () => {
    const fire = fakeSocket();
    fire('bookmark:changed', { bookmark: bookmark() });
    fire('message:updated', { message: { ...message, text: 'pay rent today' } });
    expect(useBookmarks.getState().byId.m1?.message?.text).toBe('pay rent today');
    fire('message:updated', { message: { ...message, deletedAt: '2026-10-23T10:00:00.000Z' } });
    expect(useBookmarks.getState().byId.m1?.message).toBeNull();
    fire('bookmark:changed', { bookmark: bookmark() });
    fire('message:removed', { chatId: 'g1', messageIds: ['m1', 'other'] });
    expect(useBookmarks.getState().byId.m1?.message).toBeNull();
    expect(useBookmarks.getState().byId.other).toBeUndefined();
  });

  it('offers new messages to the in-app banners', () => {
    useUi.getState().setPref('inAppBanners', true);
    useUi.getState().setPref('desktopNotifications', false);
    useChats.setState({ byId: { g1: makeChat({ id: 'g1', type: 'group', name: 'Hikers' }) } });
    fakeSocket()('message:new', { message });
    expect(useBanners.getState().banners.map((b) => b.chatId)).toEqual(['g1']);
  });

  it('reloads my bookmarks on every ready', async () => {
    const page: BookmarksPage = { bookmarks: [bookmark()], nextCursor: null, users: [] };
    get.mockResolvedValue(page);
    await resyncBookmarks({
      userId: 'me',
      sessionId: 's',
      serverTime: '',
      reconnect: false,
    } as ReadyInfo);
    expect(get).toHaveBeenCalledWith('/api/me/bookmarks', {
      query: { limit: 100, before: undefined },
    });
    expect(useBookmarks.getState()).toMatchObject({ loaded: true, byId: { m1: bookmark() } });
  });
});
