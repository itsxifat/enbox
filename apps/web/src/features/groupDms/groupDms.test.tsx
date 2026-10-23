import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router';
import type { ChatMember, ChatSummary, UserPublic } from '@enbox/shared';
import type * as MediaQuery from '@/hooks/useMediaQuery';
import { DialogHost } from '@/components/ui';
import { ConversationHeader } from '@/features/conversation/ConversationHeader';
import { useChatMembersStore } from '@/features/conversation/members';
import { DmRow, HomeSidebar } from '@/features/home/HomeSidebar';
import { api } from '@/lib/api';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useChat, useChats } from '@/stores/chats';
import { useContacts } from '@/stores/contacts';
import { useUi } from '@/stores/ui';
import { useUsers } from '@/stores/users';
import { makeChat, makeMe, makeUser } from '@/test/factories';

const media = vi.hoisted(() => ({ desktop: true }));
vi.mock('@/hooks/useMediaQuery', async (importOriginal) => ({
  ...(await importOriginal<typeof MediaQuery>()),
  useIsDesktop: () => media.desktop,
}));
// The header's neighbours from other features.
vi.mock('@/features/conversation/pins/PinsPopout', () => ({ PinsButton: () => null }));
vi.mock('@/features/search/HeaderSearch', () => ({ HeaderSearch: () => null }));
vi.mock('@/features/inbox/InboxButton', () => ({ InboxButton: () => null }));

const friend = (name: string) =>
  makeUser({
    id: name.toLowerCase(),
    username: name.toLowerCase(),
    displayName: name,
    isContact: true,
  });
const ann = friend('Ann');
const bob = friend('Bob');
const cy = friend('Cy');
const stranger = makeUser({ id: 'zed', username: 'zed', displayName: 'Zed' });
const meUser = makeUser({ id: 'me', username: 'me', displayName: 'Me' });
const member = (user: UserPublic, role: ChatMember['role'] = 'member'): ChatMember => ({
  user,
  role,
  joinedAt: '2026-10-01T00:00:00.000Z',
});

const groupDm = (p: Partial<ChatSummary> = {}) =>
  makeChat({ type: 'group', isGroupDm: true, memberCount: 3, ...p });

let members: Record<string, ChatMember[]>;
function setMembers(chatId: string, list: ChatMember[]) {
  members[chatId] = list;
  useChatMembersStore.setState((s) => ({ byChat: { ...s.byChat, [chatId]: list } }));
}

function Where() {
  const loc = useLocation();
  return <span data-testid="where">{loc.pathname}</span>;
}

function Live() {
  const { chatId } = useParams();
  const chat = useChat(chatId);
  return chat ? <ConversationHeader chat={chat} onOpenInfo={() => undefined} /> : null;
}

function renderHeader(chat: ChatSummary) {
  useChats.getState().upsertChat(chat);
  return render(
    <>
      <DialogHost />
      <MemoryRouter initialEntries={[`/chats/${chat.id}`]}>
        <Routes>
          <Route path="/chats/:chatId" element={<Live />} />
          <Route path="*" element={null} />
        </Routes>
        <Where />
      </MemoryRouter>
    </>,
  );
}

function renderRow(chat: ChatSummary) {
  useChats.getState().upsertChat(chat);
  return render(
    <>
      <DialogHost />
      <MemoryRouter initialEntries={['/chats']}>
        <DmRow chat={chat} active={false} />
      </MemoryRouter>
    </>,
  );
}

beforeEach(() => {
  media.desktop = true;
  members = {};
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
  useUsers.getState().upsertUsers([ann, bob, cy, stranger, meUser]);
  useContacts.setState({
    contacts: [ann, bob, cy].map((u) => ({ userId: u.id, name: null, createdAt: '' })),
    loaded: true,
  });
  vi.spyOn(useUsers.getState(), 'subscribePresence').mockResolvedValue();
  vi.spyOn(useUsers.getState(), 'unsubscribePresence').mockReturnValue();
  vi.spyOn(api, 'get').mockImplementation((path: string) => {
    const m = /^\/api\/chats\/([^/]+)\/members$/.exec(path);
    return Promise.resolve((m ? (members[m[1]!] ?? []) : []) as never);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetSessionState();
  useUi.setState({ dialogs: [] });
  useUi.getState().setPref('developerMode', false);
});

describe('group DMs in the DM list', () => {
  it("an unnamed one shows the other members' names, its member count and two stacked avatars", () => {
    const chat = groupDm({ id: 'g1', name: null });
    setMembers('g1', [member(ann, 'owner'), member(meUser), member(bob)]);
    renderRow(chat);
    const row = screen.getByTestId('dm-row');
    expect(row).toHaveTextContent('Ann, Bob');
    expect(row).toHaveTextContent('3 Members');
    expect(within(row).getByTestId('group-dm-avatar')).toBeInTheDocument();
  });

  it('a named one shows its name, and its icon when it has one', () => {
    setMembers('g2', [member(ann, 'owner'), member(meUser), member(bob)]);
    renderRow(groupDm({ id: 'g2', name: 'Crew', avatarUrl: '/uploads/crew.png' }));
    const row = screen.getByTestId('dm-row');
    expect(row).toHaveTextContent('Crew');
    expect(within(row).queryByTestId('group-dm-avatar')).toBeNull();
  });

  it('right-click: Mark as Read, Leave Group, and Copy Channel ID in Developer Mode', () => {
    useUi.getState().setPref('developerMode', true);
    setMembers('g3', [member(ann, 'owner'), member(meUser), member(bob)]);
    renderRow(groupDm({ id: 'g3', name: 'Crew', unreadCount: 2 }));
    fireEvent.contextMenu(screen.getByTestId('dm-row'));
    const menu = screen.getByRole('menu', { name: 'Crew menu' });
    expect(within(menu).getByRole('menuitem', { name: 'Mark as Read' })).toBeEnabled();
    expect(within(menu).getByRole('menuitem', { name: 'Leave Group' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Copy Channel ID' })).toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: /Archive|Pin/ })).toBeNull();
  });

  it('Leave Group asks first, leaves with a notice, then drops it from my list', async () => {
    setMembers('g4', [member(ann, 'owner'), member(meUser), member(bob)]);
    const post = vi.spyOn(api, 'post').mockResolvedValue(undefined as never);
    const del = vi.spyOn(api, 'delete').mockResolvedValue(undefined as never);
    renderRow(groupDm({ id: 'g4', name: 'Crew' }));
    fireEvent.contextMenu(screen.getByTestId('dm-row'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Leave Group' }));
    const dialog = await screen.findByRole('dialog', { name: 'Leave ‘Crew’?' });
    expect(dialog).toHaveTextContent('Are you sure you want to leave Crew?');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Leave Group' }));
    await waitFor(() => expect(del).toHaveBeenCalledWith('/api/chats/g4'));
    expect(post).toHaveBeenCalledWith('/api/groups/g4/leave');
    expect(useChats.getState().byId.g4).toBeUndefined();
  });

  it('the hover X leaves too; "Leave without notifying other members" leaves silently', async () => {
    setMembers('g5', [member(ann, 'owner'), member(meUser), member(bob)]);
    const post = vi.spyOn(api, 'post').mockResolvedValue(undefined as never);
    const del = vi.spyOn(api, 'delete').mockResolvedValue(undefined as never);
    renderRow(groupDm({ id: 'g5', name: null }));
    fireEvent.click(screen.getByRole('button', { name: 'Leave Ann, Bob' }));
    const dialog = await screen.findByRole('dialog', { name: 'Leave ‘Ann, Bob’?' });
    fireEvent.click(
      within(dialog).getByRole('checkbox', { name: 'Leave without notifying other members' }),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Leave Group' }));
    await waitFor(() => expect(del).toHaveBeenCalledWith('/api/chats/g5'));
    expect(del).toHaveBeenCalledWith('/api/chats/g5/group-dm/members/me');
    expect(post).not.toHaveBeenCalled();
  });

  it('"+" opens Select Friends', async () => {
    render(
      <MemoryRouter initialEntries={['/chats']}>
        <HomeSidebar />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Create DM' }));
    const picker = await screen.findByRole('dialog', { name: 'Select Friends' });
    expect(within(picker).getAllByRole('checkbox')).toHaveLength(3);
  });
});

describe('group DM header', () => {
  it('shows the icon and the name; any member renames it inline (Escape cancels)', async () => {
    const chat = groupDm({ id: 'h1', name: 'Crew' });
    setMembers('h1', [member(ann, 'owner'), member(meUser), member(bob)]);
    const patch = vi
      .spyOn(api, 'patch')
      .mockImplementation((_path: string, body?: unknown) =>
        Promise.resolve({ ...chat, ...(body as object) } as never),
      );
    renderHeader(chat);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Crew');
    expect(screen.getByRole('button', { name: 'Members: Crew' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Crew, rename the group' }));
    let input = screen.getByRole('textbox', { name: 'Group name' });
    fireEvent.change(input, { target: { value: 'Nope' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Crew');

    fireEvent.click(screen.getByRole('button', { name: 'Crew, rename the group' }));
    input = screen.getByRole('textbox', { name: 'Group name' });
    fireEvent.change(input, { target: { value: '  Weekend ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Weekend');
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch).toHaveBeenCalledWith('/api/groups/h1', { name: 'Weekend' });

    // An empty name clears it: the members' names stand in again.
    fireEvent.click(screen.getByRole('button', { name: 'Weekend, rename the group' }));
    input = screen.getByRole('textbox', { name: 'Group name' });
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    await waitFor(() => expect(patch).toHaveBeenLastCalledWith('/api/groups/h1', { name: null }));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Ann, Bob');
  });

  it('Add Friends to DM: my friends who are not in it; Add posts the picks', async () => {
    const chat = groupDm({ id: 'h2', name: 'Crew' });
    setMembers('h2', [member(ann, 'owner'), member(meUser), member(bob)]);
    const post = vi.spyOn(api, 'post').mockResolvedValue({ ...chat, memberCount: 4 } as never);
    renderHeader(chat);
    fireEvent.click(screen.getByRole('button', { name: 'Add Friends to DM' }));
    const picker = await screen.findByRole('dialog', { name: 'Select Friends' });
    expect(within(picker).getByTestId('select-friends-slots')).toHaveTextContent(
      'You can add 7 more friends.',
    );
    const options = within(picker).getAllByRole('checkbox');
    expect(options).toHaveLength(1);
    fireEvent.click(options[0]!);
    fireEvent.click(within(picker).getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/api/chats/h2/group-dm/members', { userIds: ['cy'] }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Select Friends' })).toBeNull(),
    );
  });

  it('the member list: a crown on the owner; the owner removes members; everyone may leave', async () => {
    const chat = groupDm({ id: 'h3', name: 'Crew', myRole: 'owner' });
    setMembers('h3', [member(meUser, 'owner'), member(ann), member(bob)]);
    const del = vi.spyOn(api, 'delete').mockResolvedValue(undefined as never);
    renderHeader(chat);
    fireEvent.click(screen.getByRole('button', { name: 'Show Member List' }));
    const panel = await screen.findByRole('dialog', { name: /^Members/ });
    const rows = within(panel).getAllByTestId('group-dm-member');
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Me'),
      expect.stringContaining('Ann'),
      expect.stringContaining('Bob'),
    ]);
    expect(within(rows[0]!).getByRole('img', { name: 'Group Owner' })).toBeInTheDocument();
    expect(within(rows[1]!).queryByRole('img', { name: 'Group Owner' })).toBeNull();

    fireEvent.click(within(rows[2]!).getByRole('button', { name: 'More for Bob' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove from Group' }));
    await waitFor(() => expect(del).toHaveBeenCalledWith('/api/chats/h3/group-dm/members/bob'));
    expect(within(panel).getByRole('button', { name: 'Leave Group' })).toBeInTheDocument();
  });

  it('members see no Remove from Group; Leave Group leaves and goes back to Home', async () => {
    const chat = groupDm({ id: 'h4', name: 'Crew' });
    setMembers('h4', [member(ann, 'owner'), member(meUser), member(bob)]);
    const post = vi.spyOn(api, 'post').mockResolvedValue(undefined as never);
    vi.spyOn(api, 'delete').mockResolvedValue(undefined as never);
    renderHeader(chat);
    fireEvent.click(screen.getByRole('button', { name: 'Show Member List' }));
    const panel = await screen.findByRole('dialog', { name: /^Members/ });
    fireEvent.click(within(panel).getByRole('button', { name: 'More for Bob' }));
    expect(screen.queryByRole('menuitem', { name: 'Remove from Group' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Message' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });

    fireEvent.click(within(panel).getByRole('button', { name: 'Leave Group' }));
    const dialog = await screen.findByRole('dialog', { name: 'Leave ‘Crew’?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Leave Group' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/chats$/));
    expect(post).toHaveBeenCalledWith('/api/groups/h4/leave');
  });

  it('on phones the header menu holds Members, Add Friends to DM and Leave Group', async () => {
    media.desktop = false;
    setMembers('h5', [member(ann, 'owner'), member(meUser), member(bob)]);
    renderHeader(groupDm({ id: 'h5', name: 'Crew' }));
    expect(screen.queryByRole('button', { name: 'Add Friends to DM' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Chat menu' }));
    expect(screen.getByRole('menuitem', { name: 'Members' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Leave Group' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Exit group' })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add Friends to DM' }));
    expect(await screen.findByRole('dialog', { name: 'Select Friends' })).toBeInTheDocument();
  });
});

describe('DM header', () => {
  it('Add Friends to DM starts a NEW group DM with the two of us and the friends picked', async () => {
    const dm = makeChat({ id: 'd1', type: 'direct', name: null, peer: ann, memberCount: 2 });
    const post = vi
      .spyOn(api, 'post')
      .mockResolvedValue(groupDm({ id: 'g9', name: null }) as never);
    renderHeader(dm);
    fireEvent.click(screen.getByRole('button', { name: 'Add Friends to DM' }));
    const picker = await screen.findByRole('dialog', { name: 'Select Friends' });
    expect(within(picker).getAllByRole('checkbox')).toHaveLength(2);
    fireEvent.click(within(picker).getAllByRole('checkbox')[0]!);
    fireEvent.click(within(picker).getByRole('button', { name: 'Create Group DM' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/chats/g9'));
    expect(post).toHaveBeenCalledWith('/api/chats/group-dm', { userIds: ['ann', 'bob'] });
  });

  it('not with someone who is not my friend', () => {
    renderHeader(
      makeChat({ id: 'd2', type: 'direct', name: null, peer: stranger, memberCount: 2 }),
    );
    expect(screen.queryByRole('button', { name: 'Add Friends to DM' })).toBeNull();
  });
});
