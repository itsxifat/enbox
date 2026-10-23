import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bookmark } from '@enbox/shared';
import type { MenuEntry, MenuItem } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useUi } from '@/stores/ui';
import { makeChat, makeMe, makeMessage } from '@/test/factories';
import { bookmarkMenuItems } from './bookmarkMenu';
import { useBookmarks } from './store';

const put = vi.fn();
const del = vi.fn();
vi.mock('@/lib/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  api: {
    put: (...a: unknown[]) => put(...a),
    delete: (...a: unknown[]) => del(...a),
  },
}));

const chat = makeChat({ id: 'c1', type: 'group', name: 'Hikers' });
const m = makeMessage({ id: 'm1', chatId: 'c1', senderId: 'alice', text: 'trail at 9' });
const real = (entries: MenuEntry[] | undefined) =>
  (entries ?? []).filter((e): e is MenuItem => !!e && e !== 'separator');
const items = () => real(bookmarkMenuItems(chat, m));
const labels = (entries: MenuEntry[] | undefined) => real(entries).map((i) => i.label);
const pick = (entries: MenuEntry[] | undefined, label: string) =>
  real(entries).find((i) => i.label === label)!.onSelect!();
const saved = (p: Partial<Bookmark> = {}): Bookmark => ({
  messageId: 'm1',
  chatId: 'c1',
  createdAt: '2026-10-23T10:00:00.000Z',
  remindAt: null,
  remindedAt: null,
  message: m,
  ...p,
});
const lastToast = () => useUi.getState().toasts.at(-1);

describe('message menu: Bookmark and Remind Me', () => {
  beforeEach(() => {
    useAuth.setState({ user: makeMe({ id: 'me' }) });
    useUi.setState({ toasts: [] });
  });
  afterEach(() => {
    resetSessionState();
    put.mockReset();
    del.mockReset();
    vi.useRealTimers();
  });

  it('only for messages I can see: not unsent, system or deleted ones', () => {
    expect(items().map((i) => i.label)).toEqual(['Bookmark', 'Remind Me']);
    expect(bookmarkMenuItems(chat, { ...m, pending: true })).toEqual([]);
    expect(bookmarkMenuItems(chat, { ...m, failed: true })).toEqual([]);
    expect(bookmarkMenuItems(chat, makeMessage({ type: 'system' }))).toEqual([]);
    expect(bookmarkMenuItems(chat, { ...m, deletedAt: '2026-10-23T10:00:00.000Z' })).toEqual([]);
  });

  it('Bookmark saves right away; Remove Bookmark removes', async () => {
    put.mockResolvedValue(saved());
    pick(items(), 'Bookmark');
    expect(useBookmarks.getState().byId.m1?.message?.text).toBe('trail at 9');
    expect(put).toHaveBeenCalledWith('/api/messages/m1/bookmark', {});
    await vi.waitFor(() => expect(lastToast()?.message).toBe('Bookmarked'));
    expect(items()[0]!.label).toBe('Remove Bookmark');

    del.mockResolvedValue(undefined);
    pick(items(), 'Remove Bookmark');
    expect(useBookmarks.getState().byId.m1).toBeUndefined();
    expect(del).toHaveBeenCalledWith('/api/messages/m1/bookmark');
  });

  it('puts it back when saving fails, and explains the limit', async () => {
    put.mockRejectedValue(new ApiError('limit_reached', 'Too many', 409));
    pick(items(), 'Bookmark');
    await vi.waitFor(() => expect(lastToast()?.kind).toBe('error'));
    expect(lastToast()?.message).toMatch(/up to 500/);
    expect(useBookmarks.getState().byId.m1).toBeUndefined();
  });

  it('Remind Me ▸ presets and Custom…, then the reminder it has and Remove Reminder', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 23, 14, 10));
    put.mockImplementation(async (_path: string, body: { remindAt?: string | null }) =>
      saved({ remindAt: body.remindAt ?? null }),
    );
    const remind = items()[1]!;
    expect(labels(remind.submenu)).toEqual([
      'In 20 minutes',
      'In 1 hour',
      'In 3 hours',
      'Tomorrow',
      'Next week',
      'Custom…',
    ]);
    pick(remind.submenu, 'In 1 hour');
    const at = new Date(2026, 9, 23, 15, 10).toISOString();
    expect(put).toHaveBeenCalledWith('/api/messages/m1/bookmark', { remindAt: at });
    await vi.waitFor(() => expect(lastToast()?.message).toMatch(/^Reminder set for today at /));

    const again = items()[1]!;
    expect(again.description).toMatch(/^Today at /);
    expect(labels(again.submenu).at(-1)).toBe('Remove Reminder');
    pick(again.submenu, 'Remove Reminder');
    expect(put).toHaveBeenLastCalledWith('/api/messages/m1/bookmark', { remindAt: null });
    await vi.waitFor(() => expect(lastToast()?.message).toBe('Reminder removed'));
    expect(useBookmarks.getState().byId.m1?.remindAt).toBeNull();
  });
});
