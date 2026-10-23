/**
 * Desktop notifications for messages (Discord's wording): the title names the sender and the
 * place, the body is the text with mentions resolved (or what was sent), the icon is the
 * sender's avatar, a click opens the chat at the message; nothing for the chat on screen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMember, ChatSummary, MediaAttachment, Message } from '@enbox/shared';
import { useChatMembersStore } from '@/features/conversation/members';
import { makeSpace } from '@/features/spaces/testUtils';
import { api } from '@/lib/api';
import type * as NotifyModule from '@/lib/notify';
import { isAppFocused, playSound, showNotification } from '@/lib/notify';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useSidePanel } from '@/stores/sidePanel';
import { useSpaces } from '@/stores/spaces';
import { useUi } from '@/stores/ui';
import { useUsers } from '@/stores/users';
import { makeChat, makeMe, makeMessage, makeUser } from '@/test/factories';
import {
  handleNewMessage,
  messageNotification,
  notificationBody,
  type NotificationContext,
} from './messages';

vi.mock('@/lib/notify', async (importOriginal) => {
  const actual = await importOriginal<typeof NotifyModule>();
  return {
    ...actual,
    isAppFocused: vi.fn(() => false),
    playSound: vi.fn(),
    showNotification: vi.fn(async () => true),
  };
});

const ALICE = '00000000-0000-4000-8000-0000000000a1';
const BOB = '00000000-0000-4000-8000-0000000000b0';
const ROLE = '00000000-0000-4000-8000-0000000000c0';

const spaceInfo = (spaceId = 's1'): NonNullable<ChatSummary['space']> => ({
  spaceId,
  categoryId: null,
  position: 0,
  topic: null,
  slowmodeSeconds: 0,
  nsfw: false,
  userLimit: null,
  bitrate: null,
  permissionsSynced: true,
  overwrites: [],
});

const general = (p: Partial<ChatSummary> = {}) =>
  makeChat({
    id: 'general',
    type: 'space_text',
    name: 'general',
    space: spaceInfo(),
    notifyLevel: 'all',
    ...p,
  });

function ctx(p: Partial<NotificationContext> = {}): NotificationContext {
  return {
    viewerId: 'me',
    previews: true,
    senderName: 'Alice',
    senderAvatar: '/media/alice.png',
    spaceName: 'Gaming',
    nameOf: (id) => (id === BOB ? 'Bob' : 'Someone'),
    roleName: (id) => (id === ROLE ? 'Mods' : 'role'),
    ...p,
  };
}

const file = (
  kind: MediaAttachment['kind'],
  p: Partial<MediaAttachment> = {},
): MediaAttachment => ({
  id: `f-${kind}`,
  kind,
  url: `/media/${kind}`,
  thumbnailUrl: null,
  mimeType: kind === 'image' ? 'image/png' : 'application/octet-stream',
  fileName: null,
  size: 1,
  width: null,
  height: null,
  animated: false,
  frameCount: null,
  durationMs: null,
  waveform: null,
  ...p,
});

describe('messageNotification', () => {
  it('titles: "Alice (#general, Gaming)", "Alice" in a DM, "Alice (Book club)" in a group', () => {
    const m = makeMessage({ id: 'm5', seq: 5, senderId: ALICE, text: 'hi' });
    expect(messageNotification(m, general(), ctx()).title).toBe('Alice (#general, Gaming)');
    expect(messageNotification(m, makeChat({ type: 'direct', name: null }), ctx()).title).toBe(
      'Alice',
    );
    expect(
      messageNotification(m, makeChat({ type: 'group', name: 'Book club' }), ctx()).title,
    ).toBe('Alice (Book club)');
    // An unnamed group DM: its members' names, never "Untitled".
    const gdm = makeChat({ type: 'group', isGroupDm: true, name: null });
    expect(messageNotification(m, gdm, ctx({ chatName: 'Alice, Bob' })).title).toBe(
      'Alice (Alice, Bob)',
    );
  });

  it('the sender’s avatar as the icon, a link to the message, one per chat', () => {
    const m = makeMessage({ id: 'm5', seq: 5, senderId: ALICE });
    const n = messageNotification(m, general(), ctx());
    expect(n.icon).toMatch(/\/media\/alice\.png$/);
    expect(n.url).toBe('/spaces/s1/general?m=5&mid=m5');
    expect(n.tag).toBe('chat:general');
    expect(
      messageNotification(m, makeChat({ id: 'd1', type: 'direct' }), ctx({ senderAvatar: null }))
        .icon,
    ).toBeUndefined();
    expect(messageNotification(m, makeChat({ id: 'd1', type: 'direct' }), ctx()).url).toBe(
      '/chats/d1?m=5&mid=m5',
    );
  });

  it('previews off: "New message"', () => {
    const m = makeMessage({ text: 'secret plans' });
    expect(messageNotification(m, general(), ctx({ previews: false })).body).toBe('New message');
  });
});

describe('notificationBody', () => {
  const names = { nameOf: ctx().nameOf, roleName: ctx().roleName };

  it('resolves user and role mentions, @everyone and custom emoji', () => {
    const text = `@{${BOB}} and @{role:${ROLE}} @{everyone} look <:party:${ALICE}>`;
    expect(notificationBody(makeMessage({ text }), names)).toBe(
      '@Bob and @Mods @everyone look :party:',
    );
  });

  it('says what was sent when there is no text', () => {
    const body = (p: Partial<Message>) =>
      notificationBody(makeMessage({ text: null, ...p }), names);
    expect(body({ type: 'image', media: file('image') })).toBe('Sent an image');
    expect(
      body({ type: 'image', media: file('image', { animated: true, mimeType: 'image/gif' }) }),
    ).toBe('Sent a GIF');
    expect(
      body({
        type: 'image',
        media: file('image'),
        sticker: { id: 'st', name: 'wave', spaceId: 's1' },
      }),
    ).toBe('Sent a sticker');
    expect(
      body({
        type: 'image',
        media: file('image'),
        attachments: [
          { ...file('image'), description: null },
          { ...file('image'), id: 'x', description: null },
        ],
      }),
    ).toBe('Sent 2 images');
    expect(
      body({
        type: 'file',
        media: file('file'),
        attachments: [
          { ...file('file'), description: null },
          { ...file('image'), description: null },
          { ...file('video'), description: null },
        ],
      }),
    ).toBe('Sent 3 files');
    expect(body({ type: 'video', media: file('video') })).toBe('Sent a video');
    expect(body({ type: 'voice', media: file('voice') })).toBe('Sent a voice message');
    expect(body({ type: 'file', media: file('file') })).toBe('Sent a file');
    expect(
      body({
        type: 'poll',
        poll: { question: 'Pizza?', options: [], allowMultiple: false, totalVoters: 0 },
      }),
    ).toBe('Poll: Pizza?');
  });

  it('a caption wins over the media phrase', () => {
    expect(
      notificationBody(makeMessage({ type: 'image', media: file('image'), text: 'look!' }), names),
    ).toBe('look!');
  });
});

describe('notifying a new message', () => {
  beforeEach(() => {
    vi.mocked(isAppFocused).mockReturnValue(false);
    useAuth.setState({
      user: makeMe({ id: 'me', displayName: 'Me' }),
      token: 't',
      status: 'authenticated',
    });
    useUi.getState().setPref('desktopNotifications', true);
    useUi.getState().setPref('sounds', true);
    useUsers.setState({
      byId: {
        [ALICE]: makeUser({ id: ALICE, displayName: 'Alice', avatarUrl: '/media/alice.png' }),
      },
    });
    useSpaces.setState({
      byId: { s1: makeSpace({ id: 's1', name: 'Gaming' }) },
      order: ['s1'],
      channelsLoaded: { s1: true },
      members: { s1: {} },
    });
  });

  afterEach(() => {
    useChats.setState({ byId: {}, openChatId: null });
    useSpaces.setState({ byId: {}, order: [], channelsLoaded: {}, members: {} });
    useSidePanel.setState({ panel: null });
    useUsers.setState({ byId: {} });
    useChatMembersStore.setState({ byChat: {} });
  });

  const member = (id: string, displayName: string): ChatMember => ({
    user: makeUser({ id, displayName }),
    role: 'member',
    joinedAt: '2026-01-01T00:00:00.000Z',
  });
  const groupDmMembers = () => [member('me', 'Me'), member(ALICE, 'Alice'), member(BOB, 'Bob')];
  const groupDm = (id: string) =>
    makeChat({ id, type: 'group', isGroupDm: true, name: null, memberCount: 3 });

  it('an unnamed group DM is titled with its members’ names', async () => {
    useChatMembersStore.setState({ byChat: { gdm: groupDmMembers() } });
    useChats.getState().upsertChat(groupDm('gdm'));
    vi.mocked(showNotification).mockClear();
    handleNewMessage(makeMessage({ id: 'm1', chatId: 'gdm', seq: 1, senderId: ALICE, text: 'yo' }));
    await vi.waitFor(() => expect(showNotification).toHaveBeenCalled());
    expect(vi.mocked(showNotification).mock.calls.at(-1)![0]).toMatchObject({
      title: 'Alice (Alice, Bob)',
      body: 'yo',
      url: '/chats/gdm?m=1&mid=m1',
    });
  });

  it('…loading its members first when they are not cached yet', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue(groupDmMembers() as never);
    vi.spyOn(api, 'post').mockResolvedValue([] as never); // the sender's profile fetch
    useChats.getState().upsertChat(groupDm('gdm2'));
    vi.mocked(showNotification).mockClear();
    handleNewMessage(makeMessage({ id: 'm2', chatId: 'gdm2', seq: 1, senderId: BOB, text: 'hi' }));
    await vi.waitFor(() => expect(showNotification).toHaveBeenCalled());
    expect(get).toHaveBeenCalledWith('/api/chats/gdm2/members');
    expect(vi.mocked(showNotification).mock.calls.at(-1)![0]).toMatchObject({
      title: 'Bob (Alice, Bob)',
    });
  });

  it('a Space message: titled with the sender and the place, opening at the message', async () => {
    useChats.getState().upsertChat(general());
    handleNewMessage(
      makeMessage({ id: 'm5', chatId: 'general', seq: 5, senderId: ALICE, text: 'gg' }),
    );
    await vi.waitFor(() => expect(showNotification).toHaveBeenCalled());
    expect(vi.mocked(showNotification).mock.calls.at(-1)![0]).toMatchObject({
      title: 'Alice (#general, Gaming)',
      body: 'gg',
      url: '/spaces/s1/general?m=5&mid=m5',
      icon: expect.stringMatching(/\/media\/alice\.png$/),
    });
  });

  it('nothing for the thread open beside its channel while the window is focused', () => {
    vi.mocked(isAppFocused).mockReturnValue(true);
    const thread = general({ id: 't1', type: 'space_thread', name: 'Plans' });
    useChats.getState().upsertChat(general());
    useChats.getState().upsertChat(thread);
    useChats.getState().setOpenChat('general');
    useSidePanel.getState().open({ kind: 'thread', threadId: 't1', parentId: 'general' });
    vi.mocked(showNotification).mockClear();
    vi.mocked(playSound).mockClear();
    handleNewMessage(makeMessage({ id: 'm9', chatId: 't1', seq: 9, senderId: ALICE }));
    expect(showNotification).not.toHaveBeenCalled();
    expect(playSound).not.toHaveBeenCalled();
    // Another chat while focused: the sound only.
    useChats.getState().upsertChat(makeChat({ id: 'g', type: 'group', name: 'Book club' }));
    handleNewMessage(makeMessage({ id: 'm1', chatId: 'g', seq: 1, senderId: ALICE }));
    expect(showNotification).not.toHaveBeenCalled();
    expect(playSound).toHaveBeenCalledWith('message');
  });
});
