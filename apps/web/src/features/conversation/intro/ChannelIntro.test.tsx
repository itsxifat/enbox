/**
 * The beginning of a conversation: Space channels welcome you to #channel (topic, Edit Channel
 * with Manage Channels); DMs show the person, the Spaces we share and the friend and block
 * actions; group DMs and groups their own line; threads and posts their title. The message
 * list shows it once no older messages are left.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { VirtuosoMockContext } from 'react-virtuoso';
import { PERM, type ChatSummary, type UserProfile } from '@enbox/shared';
import { useProfiles } from '@/features/profile/profileStore';
import { api } from '@/lib/api';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useFriends } from '@/stores/friends';
import { useMessages, type ChatMessages } from '@/stores/messages';
import { useUi } from '@/stores/ui';
import { useUsers } from '@/stores/users';
import { makeChat, makeMe, makeMessage, makeUser } from '@/test/factories';
import { RowAppearanceContext } from '../bubbles/appearance';
import { MessageList } from '../MessageList';
import { ChannelIntro, mutualSpacesLabel } from './ChannelIntro';

vi.mock('@/features/spaces/dialogs/ChannelDialog', () => ({
  ChannelDialog: ({ chat }: { chat: ChatSummary }) => (
    <div role="dialog" aria-label={`Settings of ${chat.name}`} />
  ),
}));

const space: NonNullable<ChatSummary['space']> = {
  spaceId: 's1',
  categoryId: null,
  position: 0,
  topic: null,
  slowmodeSeconds: 0,
  nsfw: false,
  userLimit: null,
  bitrate: null,
  permissionsSynced: true,
  overwrites: [],
};
const MEMBER = PERM.VIEW_CHANNEL | PERM.SEND_MESSAGES;
const channel = (p: Partial<ChatSummary> = {}, topic: string | null = null) =>
  makeChat({
    id: 'general',
    type: 'space_text',
    name: 'general',
    space: { ...space, topic },
    spacePermissions: MEMBER,
    ...p,
  });

const ann = makeUser({ id: 'ann', displayName: 'Ann', username: 'ann.b' });
const dm = (peer = ann) => makeChat({ id: 'd1', type: 'direct', name: null, peer });
const profile = (n: number): UserProfile => ({
  user: ann,
  mutualSpaces: Array.from({ length: n }, (_, i) => ({
    id: `s${i}`,
    name: `Space ${i}`,
    iconUrl: null,
    nickname: null,
  })),
  mutualFriends: [],
  mutualGroupCount: 0,
  note: null,
});

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  useAuth.setState({
    user: makeMe({ id: 'me', displayName: 'Mia', username: 'mia' }),
    token: 't',
    status: 'authenticated',
  });
  useUsers.getState().upsertUsers([ann]);
  useProfiles.setState({ byId: { ann: profile(2) } });
  useFriends.setState({ loaded: true, incoming: [], outgoing: [] });
  vi.spyOn(api, 'get').mockResolvedValue({ incoming: [], outgoing: [], users: [] } as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetSessionState();
  useProfiles.setState({ byId: {} });
  useMessages.setState({ byChat: {} });
  useUi.setState({ dialogs: [] });
});

describe('Space channels', () => {
  it('welcome you to #channel, with its topic', () => {
    render(<ChannelIntro chat={channel({}, 'Say hi **here**')} />);
    expect(screen.getByRole('heading', { name: 'Welcome to #general!' })).toBeInTheDocument();
    expect(screen.getByText('This is the start of the #general channel.')).toBeInTheDocument();
    expect(screen.getByTestId('intro-topic')).toHaveTextContent('Say hi here');
    expect(screen.queryByRole('button', { name: 'Edit Channel' })).toBeNull();
  });

  it('Edit Channel opens the channel settings with Manage Channels', async () => {
    render(<ChannelIntro chat={channel({ spacePermissions: MEMBER | PERM.MANAGE_CHANNELS })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Channel' }));
    expect(await screen.findByRole('dialog', { name: 'Settings of general' })).toBeInTheDocument();
  });

  it('a voice channel’s chat is named without the #', () => {
    render(<ChannelIntro chat={channel({ type: 'space_voice', name: 'Lounge' })} />);
    expect(screen.getByRole('heading', { name: 'Welcome to Lounge!' })).toBeInTheDocument();
  });

  it('threads and forum posts show their title and who started them', () => {
    useChats.setState({
      byId: { forum: makeChat({ id: 'forum', type: 'space_forum', name: 'ideas', space }) },
    });
    const thread = (parentId: string) =>
      makeChat({
        id: 't1',
        type: 'space_thread',
        name: 'Plans',
        space,
        thread: {
          parentId,
          starterMessageId: null,
          ownerId: 'ann',
          archived: false,
          locked: false,
          autoArchiveMinutes: 1440,
          messageCount: 0,
        },
      });
    const { unmount } = render(<ChannelIntro chat={thread('general')} />);
    expect(screen.getByRole('heading', { name: 'Plans' })).toBeInTheDocument();
    expect(screen.getByText(/Started by/)).toHaveTextContent('Started by Ann');
    unmount();
    render(<ChannelIntro chat={thread('forum')} />);
    expect(screen.getByText(/Posted by/)).toHaveTextContent('Posted by Ann');
  });
});

describe('DMs', () => {
  it('show the person, the Spaces we share, Add Friend and Block', () => {
    render(<ChannelIntro chat={dm()} />);
    expect(screen.getByRole('heading', { name: 'Ann' })).toBeInTheDocument();
    expect(screen.getByText('ann.b')).toBeInTheDocument();
    expect(
      screen.getByText(/This is the beginning of your direct message history with/),
    ).toHaveTextContent('This is the beginning of your direct message history with @Ann.');
    expect(screen.getByTestId('intro-mutuals')).toHaveTextContent('2 Mutual Spaces');
    expect(screen.getByRole('button', { name: 'Add Friend' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Block' })).toBeEnabled();
  });

  it('Add Friend sends a request; Block asks first', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ status: 'sent' } as never);
    render(<ChannelIntro chat={dm()} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add Friend' }));
    });
    expect(post).toHaveBeenCalledWith('/api/friends/requests', { userId: 'ann' });
    fireEvent.click(screen.getByRole('button', { name: 'Block' }));
    expect(useUi.getState().dialogs[0]?.title).toBe('Block Ann?');
  });

  it('friends get Remove Friend, a sent request shows, blocked people get Unblock', () => {
    useUsers.getState().upsertUsers([{ ...ann, isContact: true }]);
    const { unmount } = render(<ChannelIntro chat={dm()} />);
    expect(screen.getByRole('button', { name: 'Remove Friend' })).toBeInTheDocument();
    unmount();

    useUsers.getState().upsertUsers([{ ...ann, isContact: false }]);
    useFriends.setState({ outgoing: [{ userId: 'ann', createdAt: '2026-10-01T00:00:00.000Z' }] });
    const second = render(<ChannelIntro chat={dm()} />);
    expect(screen.getByRole('button', { name: 'Friend Request Sent' })).toBeDisabled();
    second.unmount();

    useFriends.setState({ outgoing: [] });
    useUsers.getState().upsertUsers([{ ...ann, isBlocked: true }]);
    render(<ChannelIntro chat={dm()} />);
    expect(screen.getByRole('button', { name: 'Unblock' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add Friend' })).toBeNull();
  });

  it('my own notes chat says what it is for, without friend actions', () => {
    const me = makeUser({ id: 'me', displayName: 'Mia', username: 'mia' });
    render(<ChannelIntro chat={dm(me)} />);
    expect(screen.getByText(/This is your space for notes/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('mutual Spaces wording', () => {
    expect(mutualSpacesLabel(0)).toBe('No Spaces in common');
    expect(mutualSpacesLabel(1)).toBe('1 Mutual Space');
    expect(mutualSpacesLabel(4)).toBe('4 Mutual Spaces');
  });
});

describe('groups', () => {
  it('group DMs and groups welcome you to the group', () => {
    const { unmount } = render(
      <ChannelIntro chat={makeChat({ id: 'g1', type: 'group', name: 'Weekend', isGroupDm: true, avatarUrl: '/x.png' })} />,
    );
    expect(screen.getByRole('heading', { name: 'Weekend' })).toBeInTheDocument();
    expect(screen.getByText(/Welcome to the beginning of the/)).toHaveTextContent(
      'Welcome to the beginning of the Weekend group.',
    );
    unmount();
    render(<ChannelIntro chat={makeChat({ id: 'g2', type: 'group', name: 'Book club' })} />);
    expect(screen.getByText(/Welcome to the beginning of the/)).toHaveTextContent(
      'Welcome to the beginning of the Book club group.',
    );
  });
});

describe('in the message list', () => {
  function renderList(hasMoreBefore: boolean) {
    const chat = channel();
    useMessages.setState({
      byChat: {
        general: {
          items: [makeMessage({ id: 'm1', chatId: 'general', seq: 5, senderId: 'ann' })],
          loaded: true,
          hasMoreBefore,
          hasMoreAfter: false,
        } as unknown as ChatMessages,
      },
    });
    return render(
      <VirtuosoMockContext.Provider value={{ viewportHeight: 2000, itemHeight: 60 }}>
        <RowAppearanceContext.Provider value={{ bubbleStyle: 'cozy', messageAnimation: 'none' }}>
          <MessageList chat={chat} unread={null} initialTarget={null} />
        </RowAppearanceContext.Provider>
      </VirtuosoMockContext.Provider>,
    );
  }

  it('opens the history once no older messages are left', () => {
    const { unmount } = renderList(false);
    expect(screen.getByRole('heading', { name: 'Welcome to #general!' })).toBeInTheDocument();
    unmount();
    renderList(true);
    expect(screen.queryByTestId('channel-intro')).toBeNull();
  });
});
