/**
 * NotificationsHost: the in-app banners (who, where, the first line; a click opens the chat at
 * the message; ✕; hidden after a while unless held), the "enable desktop notifications" bar
 * (Enable asks, ✕ is remembered) and a due reminder's toast with Open.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import type { Bookmark } from '@enbox/shared';
import { Toaster } from '@/components/ui';
import { useBookmarks } from '@/features/bookmarks/store';
import { bus } from '@/lib/bus';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useUi } from '@/stores/ui';
import { useUsers } from '@/stores/users';
import { makeChat, makeMe, makeMessage, makeUser } from '@/test/factories';
import { BANNER_MS, offerMessageBanner } from './banners';
import { NotificationsHost } from './NotificationsHost';
import { PERMISSION_BAR_DISMISSED_KEY } from './PermissionBanner';
import { showReminderToast } from './reminderToast';

const push = vi.hoisted(() => ({
  enablePush: vi.fn(async () => 'subscribed' as const),
  pushSupported: () => true,
}));
vi.mock('@/lib/push', () => push);

const ALICE = '00000000-0000-4000-8000-0000000000a1';
const group = makeChat({ id: 'g1', type: 'group', name: 'Hikers' });
const message = makeMessage({
  id: 'm1',
  chatId: 'g1',
  seq: 5,
  senderId: ALICE,
  text: 'trail at 9',
});

function Where() {
  const loc = useLocation();
  return <output data-testid="location">{`${loc.pathname}${loc.search}`}</output>;
}

function renderHost() {
  return render(
    <MemoryRouter initialEntries={['/chats']}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <NotificationsHost />
              <Where />
              <Toaster />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

const banners = () => screen.queryAllByTestId('message-banner');

describe('NotificationsHost', () => {
  beforeEach(() => {
    vi.stubGlobal('Notification', { permission: 'granted' });
    useAuth.setState({ user: makeMe({ displayName: 'Me' }), token: 't', status: 'authenticated' });
    useChats.setState({ byId: { g1: group }, openChatId: null });
    useUsers.getState().upsertUsers([makeUser({ id: ALICE, displayName: 'Alice' })]);
    useUi.setState({ toasts: [] });
    useUi.getState().setPref('inAppBanners', true);
    // No system notifications to defer to: banners whether or not the window has focus.
    useUi.getState().setPref('desktopNotifications', false);
  });
  afterEach(() => {
    resetSessionState();
    useChats.setState({ byId: {}, openChatId: null });
    vi.useRealTimers();
  });

  it('shows a banner for a new message elsewhere; a click opens it at the message', async () => {
    renderHost();
    act(() => offerMessageBanner(message));
    const [card] = banners();
    expect(within(card!).getByText('Alice')).toBeInTheDocument();
    expect(within(card!).getByText('Hikers')).toBeInTheDocument();
    expect(within(card!).getByText('trail at 9')).toBeInTheDocument();
    fireEvent.click(within(card!).getByRole('button', { name: 'Alice in Hikers: trail at 9' }));
    expect(banners()).toHaveLength(0);
    await vi.waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/chats/g1?m=5&mid=m1'),
    );
  });

  it('✕ hides it; otherwise it goes after a while, unless held', () => {
    vi.useFakeTimers();
    renderHost();
    act(() => offerMessageBanner(message));
    fireEvent.click(within(banners()[0]!).getByRole('button', { name: 'Dismiss' }));
    expect(banners()).toHaveLength(0);

    act(() => offerMessageBanner({ ...message, id: 'm2' }));
    fireEvent.mouseEnter(banners()[0]!);
    act(() => vi.advanceTimersByTime(BANNER_MS + 100));
    expect(banners()).toHaveLength(1);
    fireEvent.mouseLeave(banners()[0]!);
    act(() => vi.advanceTimersByTime(BANNER_MS + 100));
    expect(banners()).toHaveLength(0);
  });

  it('asks for the browser permission from a bar; ✕ hides it on this device for good', async () => {
    const notification = { permission: 'default' as NotificationPermission };
    vi.stubGlobal('Notification', notification);
    useUi.getState().setPref('desktopNotifications', true);
    push.enablePush.mockImplementation(async () => {
      notification.permission = 'granted';
      return 'subscribed';
    });
    const { unmount } = renderHost();
    const bar = screen.getByTestId('notification-permission-bar');
    expect(bar).toHaveTextContent('Enbox needs your permission to enable desktop notifications.');
    fireEvent.click(within(bar).getByRole('button', { name: 'Enable' }));
    await vi.waitFor(() => expect(screen.queryByTestId('notification-permission-bar')).toBeNull());
    expect(push.enablePush).toHaveBeenCalledTimes(1);
    unmount();

    notification.permission = 'default';
    const again = renderHost();
    fireEvent.click(
      within(screen.getByTestId('notification-permission-bar')).getByRole('button', {
        name: 'Dismiss',
      }),
    );
    expect(screen.queryByTestId('notification-permission-bar')).toBeNull();
    expect(localStorage.getItem(PERMISSION_BAR_DISMISSED_KEY)).toBe('1');
    again.unmount();
    renderHost();
    expect(screen.queryByTestId('notification-permission-bar')).toBeNull();
  });

  it('a due reminder is a toast with Open; one for a message that is gone has no Open', async () => {
    const navigations: string[] = [];
    const off = bus.on('navigate', ({ to }) => void navigations.push(to));
    renderHost();
    const due: Bookmark = {
      messageId: 'm1',
      chatId: 'g1',
      createdAt: '2026-10-23T08:00:00.000Z',
      remindAt: '2026-10-23T09:00:00.000Z',
      remindedAt: '2026-10-23T09:00:01.000Z',
      message,
    };
    useBookmarks.getState().upsert(due);
    act(() => showReminderToast(due));
    expect(screen.getByText('Reminder')).toBeInTheDocument();
    expect(screen.getByText('Alice: trail at 9')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(useBookmarks.getState().seen).toEqual(['m1@2026-10-23T09:00:01.000Z']);
    await vi.waitFor(() => expect(navigations).toEqual(['/chats/g1?m=5&mid=m1']));

    act(() => showReminderToast({ ...due, messageId: 'gone', message: null }));
    expect(screen.getByText('This message is no longer available')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open' })).toBeNull();
    off();
  });
});
