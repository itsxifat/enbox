/**
 * Message requests (W7-C) on the web: the Requests page (list, accept, ignore, the Ignored
 * tab), the banner over an open request, the Privacy rows, the Space Privacy Settings dialog,
 * the store hand-off from the chats store and the realtime handlers.
 */
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import {
  DEFAULT_USER_SETTINGS,
  type ChatSummary,
  type Space,
  type UserProfile,
  type UserSettings,
} from '@enbox/shared';
import { useReport } from '@/features/safety/report';
import { makeSpace } from '@/features/spaces/testUtils';
import { api } from '@/lib/api';
import { resetSessionState } from '@/lib/session';
import type { AppSocket } from '@/lib/socket';
import { registerRequestsHandlers } from '@/realtime/requests';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useContacts } from '@/stores/contacts';
import { EMPTY_CHAT_MESSAGES, useMessages } from '@/stores/messages';
import { usePendingRequestCount, useRequests } from '@/stores/requests';
import { useSpaces } from '@/stores/spaces';
import { useUi } from '@/stores/ui';
import { makeChat, makeMe, makeMessage, makeUser } from '@/test/factories';
import { DmPrivacySettings } from './DmPrivacySettings';
import { MessageRequestsPage } from './MessageRequestsPage';
import { RequestBanner } from './RequestBanner';
import { SpacePrivacyDialog } from './SpacePrivacyDialog';

const ann = makeUser({ id: 'ann', displayName: 'Ann' });
const bo = makeUser({ id: 'bo', displayName: 'Bo' });
const cy = makeUser({ id: 'cy', displayName: 'Cy' });

function request(id: string, peer = ann, extra: Partial<ChatSummary> = {}): ChatSummary {
  return makeChat({
    id,
    type: 'direct',
    name: null,
    peer,
    request: 'pending',
    lastSeq: 1,
    unreadCount: 1,
    lastMessage: makeMessage({
      chatId: id,
      senderId: peer.id,
      text: `hi from ${peer.displayName}`,
    }),
    lastActivityAt: '2026-10-20T10:00:00.000Z',
    ...extra,
  });
}

function profile(user = ann, spaces = 2): UserProfile {
  return {
    user,
    mutualSpaces: Array.from({ length: spaces }, (_, i) => ({
      id: `s${i}`,
      name: `Space ${i}`,
      iconUrl: null,
      nickname: null,
    })),
    mutualFriends: [],
    note: null,
  } as unknown as UserProfile;
}

function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>;
}

function inRouter(ui: ReactNode, entry = '/message-requests') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route
          path="/message-requests"
          element={
            <>
              {ui}
              <Where />
            </>
          }
        />
        <Route
          path="/chats/:chatId"
          element={
            <>
              {ui}
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

const closeDialog = (answer: 'confirm' | null) =>
  act(() => useUi.getState().closeDialog(useUi.getState().dialogs[0]!.id, answer));

beforeEach(() => {
  resetSessionState();
  vi.restoreAllMocks();
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
  useUi.setState({ toasts: [], dialogs: [] });
  useChats.setState({ loaded: true });
});

describe('Message Requests page', () => {
  it('lists pending requests (who, Spaces we share, last message); Accept and Ignore answer them', async () => {
    let pending = [
      request('c1', ann),
      request('c2', bo, { lastActivityAt: '2026-10-21T10:00:00.000Z' }),
    ];
    const get = vi
      .spyOn(api, 'get')
      .mockImplementation((path: string, opts?: { query?: Record<string, unknown> }) => {
        if (path === '/api/chats/requests')
          return Promise.resolve(
            structuredClone(opts?.query?.state === 'ignored' ? [] : pending) as never,
          );
        if (path === '/api/users/ann/profile') return Promise.resolve(profile(ann, 2) as never);
        if (path === '/api/users/bo/profile') return Promise.resolve(profile(bo, 0) as never);
        return Promise.reject(new Error(`unexpected GET ${path}`));
      });
    const post = vi.spyOn(api, 'post').mockImplementation((path: string) => {
      if (path === '/api/chats/c1/request/accept')
        return Promise.resolve({ ...request('c1', ann), request: undefined } as never);
      return Promise.resolve(undefined as never);
    });
    inRouter(<MessageRequestsPage />);
    expect(await screen.findByText('Pending — 2')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/api/chats/requests', { query: { state: 'ignored' } });
    const rows = screen.getAllByTestId('request-row');
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Bo'), // newest first
      expect.stringContaining('Ann'),
    ]);
    const annRow = rows[1]!;
    expect(within(annRow).getByText('hi from Ann')).toBeInTheDocument();
    expect(await within(annRow).findByText('You share 2 Spaces')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^Requests/ })).toHaveTextContent('Requests2');

    fireEvent.click(within(annRow).getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/chats/c1/request/accept'));
    await waitFor(() => expect(screen.getAllByTestId('request-row')).toHaveLength(1));
    expect(useChats.getState().byId.c1).toMatchObject({ id: 'c1' });
    expect(useChats.getState().byId.c1?.request).toBeUndefined();

    pending = [];
    fireEvent.click(
      within(screen.getByTestId('request-row')).getByRole('button', { name: 'Ignore' }),
    );
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/chats/c2/request/ignore'));
    expect(await screen.findByText('No message requests')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /^Ignored/ }));
    expect(screen.getByText('Ignored — 1')).toBeInTheDocument();
    const ignoredRow = screen.getByTestId('request-row');
    expect(within(ignoredRow).getByText('Bo')).toBeInTheDocument();
    expect(within(ignoredRow).queryByRole('button', { name: 'Ignore' })).toBeNull();
    expect(within(ignoredRow).getByRole('button', { name: 'Accept' })).toBeInTheDocument();
  });

  it('a row opens the chat; nothing pending says so', async () => {
    vi.spyOn(api, 'get').mockImplementation(
      (path: string, opts?: { query?: Record<string, unknown> }) =>
        path === '/api/chats/requests'
          ? Promise.resolve((opts?.query?.state === 'ignored' ? [] : [request('c9', cy)]) as never)
          : Promise.reject(new Error('no profile')),
    );
    inRouter(<MessageRequestsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open the request from Cy' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/chats/c9');
  });

  it('the pending count follows the store (Home sidebar badge)', () => {
    function Count() {
      return <span data-testid="count">{usePendingRequestCount()}</span>;
    }
    render(<Count />);
    expect(screen.getByTestId('count')).toHaveTextContent('0');
    act(() => useRequests.getState().upsert(request('c1')));
    act(() => useRequests.getState().upsert(request('c2', bo, { request: 'ignored' })));
    expect(screen.getByTestId('count')).toHaveTextContent('1');
  });
});

describe('the banner over an open request', () => {
  beforeEach(() => {
    vi.spyOn(api, 'get').mockResolvedValue(profile(ann, 1) as never);
  });

  it('says who wants to talk and how many Spaces we share; Accept moves it to my chats', async () => {
    const chat = request('c1');
    act(() => useRequests.getState().upsert(chat));
    const post = vi.spyOn(api, 'post').mockResolvedValue({ ...chat, request: undefined } as never);
    inRouter(<RequestBanner chat={chat} />, '/chats/c1');
    const banner = screen.getByRole('region', { name: 'Message request' });
    expect(banner).toHaveTextContent('Ann wants to message you');
    expect(await within(banner).findByText(/You share 1 Space ·/)).toBeInTheDocument();
    fireEvent.click(within(banner).getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/chats/c1/request/accept'));
    await waitFor(() => expect(useChats.getState().byId.c1).toBeDefined());
    expect(useRequests.getState().byId.c1).toBeUndefined();
    expect(screen.getByTestId('where')).toHaveTextContent('/chats/c1'); // stays in the chat
  });

  it('Ignore leaves for the Requests list; Block asks, blocks, and ignores the request', async () => {
    const chat = request('c1');
    act(() => useRequests.getState().upsert(chat));
    const post = vi.spyOn(api, 'post').mockResolvedValue(undefined as never);
    const block = vi.spyOn(useContacts.getState(), 'block').mockResolvedValue(undefined);
    const view = inRouter(<RequestBanner chat={chat} />, '/chats/c1');
    fireEvent.click(screen.getByRole('button', { name: 'Block' }));
    expect(useUi.getState().dialogs[0]).toMatchObject({
      title: 'Block Ann?',
      confirmLabel: 'Block',
    });
    closeDialog('confirm');
    await waitFor(() => expect(block).toHaveBeenCalledWith('ann'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/chats/c1/request/ignore'));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/message-requests'));
    expect(useRequests.getState().byId.c1?.request).toBe('ignored');
    view.unmount();

    const other = request('c2', bo);
    act(() => useRequests.getState().upsert(other));
    inRouter(<RequestBanner chat={other} />, '/chats/c2');
    fireEvent.click(screen.getByRole('button', { name: 'Ignore' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/chats/c2/request/ignore'));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/message-requests'));
  });

  it('Report opens the report flow about them', () => {
    inRouter(<RequestBanner chat={request('c1')} />, '/chats/c1');
    fireEvent.click(screen.getByRole('button', { name: 'Report' }));
    expect(useReport.getState().target).toEqual({
      targetType: 'user',
      targetId: 'ann',
      userId: 'ann',
      label: 'Ann',
    });
  });

  it('an ignored request can still be accepted (no Ignore button)', () => {
    inRouter(<RequestBanner chat={request('c1', ann, { request: 'ignored' })} />, '/chats/c1');
    expect(screen.getByRole('region', { name: 'Message request' })).toHaveTextContent(
      'You ignored Ann’s message request',
    );
    expect(screen.queryByRole('button', { name: 'Ignore' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Accept' })).toBeInTheDocument();
  });
});

describe('Settings ▸ Privacy ▸ Direct messages', () => {
  function settingsWith(patch: Partial<UserSettings>) {
    useAuth.setState({
      user: makeMe({ id: 'me', settings: { ...DEFAULT_USER_SETTINGS, ...patch } }),
    });
  }

  it('who can DM me, the requests filter and new Spaces are saved as they change', async () => {
    settingsWith({});
    const patch = vi
      .spyOn(api, 'patch')
      .mockImplementation((_path: string, body?: unknown) =>
        Promise.resolve({ ...useAuth.getState().user!.settings, ...(body as object) } as never),
      );
    render(<DmPrivacySettings />);
    const who = screen.getByRole('combobox', { name: 'Who can send you direct messages' });
    expect(who).toHaveValue('everyone');
    expect(
      within(who)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Everyone', 'Members of Spaces you share', 'Friends only']);
    fireEvent.change(who, { target: { value: 'friends' } });
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/api/me/settings', { whoCanDm: 'friends' }),
    );
    expect(useAuth.getState().user!.settings.whoCanDm).toBe('friends');

    const filter = screen.getByRole('switch', { name: 'Message requests' });
    expect(filter).toHaveAttribute('aria-checked', 'true');
    expect(
      screen.getByText('Filter messages from people you may not know into Message Requests'),
    ).toBeInTheDocument();
    fireEvent.click(filter);
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/api/me/settings', { messageRequests: false }),
    );
    expect(screen.getByRole('switch', { name: 'Message requests' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('turning off DMs from new Spaces offers to apply it to the Spaces I am in', async () => {
    settingsWith({});
    const s1 = makeSpace({ id: 's1' });
    const s2 = makeSpace({ id: 's2', me: { allowDms: false } });
    const s3 = makeSpace({ id: 's3', me: { allowDms: true } });
    useSpaces.setState({ byId: { s1, s2, s3 } });
    const patch = vi.spyOn(api, 'patch').mockImplementation((path: string, body?: unknown) => {
      if (path === '/api/me/settings')
        return Promise.resolve({
          ...useAuth.getState().user!.settings,
          ...(body as object),
        } as never);
      const id = path.split('/')[3]!;
      const space = useSpaces.getState().byId[id]!;
      return Promise.resolve({
        ...space,
        me: { ...space.me, ...(body as object) },
      } as Space as never);
    });
    render(<DmPrivacySettings />);
    fireEvent.click(screen.getByRole('switch', { name: 'Allow DMs from new Spaces’ members' }));
    await waitFor(() => expect(useUi.getState().dialogs).toHaveLength(1));
    expect(patch).toHaveBeenCalledWith('/api/me/settings', { allowSpaceDms: false });
    expect(useUi.getState().dialogs[0]).toMatchObject({
      title: 'Apply to the Spaces you’re in?',
      confirmLabel: 'Apply to existing Spaces',
      cancelLabel: 'Only new Spaces',
    });
    closeDialog('confirm');
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/api/spaces/s3/members/me', { allowDms: false }),
    );
    expect(patch).toHaveBeenCalledWith('/api/spaces/s1/members/me', { allowDms: false });
    expect(patch).not.toHaveBeenCalledWith('/api/spaces/s2/members/me', expect.anything());
    await waitFor(() => expect(useSpaces.getState().byId.s1!.me.allowDms).toBe(false));
  });
});

describe('Space menu ▸ Privacy Settings', () => {
  it('the Direct Messages switch saves through PATCH members/me', async () => {
    useAuth.setState({
      user: makeMe({ id: 'me', settings: { ...DEFAULT_USER_SETTINGS, whoCanDm: 'spaces' } }),
    });
    const space = makeSpace({ id: 's1', name: 'Gamers' });
    useSpaces.setState({ byId: { s1: space } });
    const patch = vi
      .spyOn(api, 'patch')
      .mockImplementation((_path: string, body?: unknown) =>
        Promise.resolve({ ...space, me: { ...space.me, ...(body as object) } } as never),
      );
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <SpacePrivacyDialog space={space} onClose={onClose} />
      </MemoryRouter>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Privacy Settings' });
    expect(dialog).toHaveTextContent('Gamers');
    const toggle = within(dialog).getByRole('switch', { name: 'Direct Messages' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(
      within(dialog).getByText('Allow direct messages from members of this Space.'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('space-privacy-note')).toBeNull();
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/api/spaces/s1/members/me', { allowDms: false }),
    );
    await waitFor(() => expect(useSpaces.getState().byId.s1!.me.allowDms).toBe(false));
    expect(within(dialog).getByRole('switch', { name: 'Direct Messages' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('says when my DM setting makes the switch moot', () => {
    useAuth.setState({ user: makeMe({ id: 'me' }) }); // everyone
    render(
      <MemoryRouter>
        <SpacePrivacyDialog space={makeSpace({ id: 's1' })} onClose={() => undefined} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('space-privacy-note')).toHaveTextContent(
      'Right now anyone can send you direct messages',
    );
    expect(screen.getByRole('link', { name: 'Change who can message you' })).toHaveAttribute(
      'href',
      '/settings/privacy',
    );
  });
});

describe('stores and realtime', () => {
  it('requests never enter the chat list; an ordinary summary of one means it was accepted', () => {
    const req = request('c1');
    const normal = makeChat({ id: 'g1' });
    act(() => useChats.getState().upsertChats([req, normal]));
    expect(Object.keys(useChats.getState().byId)).toEqual(['g1']);
    expect(useRequests.getState().byId.c1).toMatchObject({ request: 'pending' });

    act(() => useChats.getState().upsertChat({ ...req, request: undefined }));
    expect(useChats.getState().byId.c1).toBeDefined();
    expect(useRequests.getState().byId.c1).toBeUndefined();
  });

  it('chat:request adds it (and its message to an open window); stale ones and chat:request-removed', () => {
    const handlers: Record<string, (p: unknown) => void> = {};
    const socket = {
      on: (e: string, h: (p: unknown) => void) => void (handlers[e] = h),
    } as unknown as AppSocket;
    registerRequestsHandlers(socket);
    const first = makeMessage({ id: 'm1', chatId: 'c1', seq: 1 });
    useMessages.setState({
      byChat: {
        c1: { ...EMPTY_CHAT_MESSAGES, loaded: true, hasMoreBefore: false, items: [first] },
      },
    });
    const next = makeMessage({ id: 'm2', chatId: 'c1', seq: 2, text: 'and again' });
    handlers['chat:request']!({ chat: request('c1', ann, { lastMessage: next, lastSeq: 2 }) });
    expect(useRequests.getState().byId.c1?.lastMessage?.id).toBe('m2');
    expect(useMessages.getState().byChat.c1!.items.map((m) => m.id)).toEqual(['m1', 'm2']);

    // Accepted meanwhile (its chat:upsert came first): a late chat:request is ignored.
    act(() => useChats.getState().upsertChat(makeChat({ id: 'c3', type: 'direct', peer: bo })));
    handlers['chat:request']!({ chat: request('c3', bo) });
    expect(useRequests.getState().byId.c3).toBeUndefined();

    vi.useFakeTimers();
    try {
      vi.spyOn(api, 'get').mockResolvedValue([] as never);
      handlers['chat:request-removed']!({ chatId: 'c1' });
      expect(useRequests.getState().byId.c1).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
    // One I ignored here myself stays (in Ignored).
    act(() => useRequests.getState().upsert(request('c4', cy, { request: 'ignored' })));
    handlers['chat:request-removed']!({ chatId: 'c4' });
    expect(useRequests.getState().byId.c4?.request).toBe('ignored');
  });
});
