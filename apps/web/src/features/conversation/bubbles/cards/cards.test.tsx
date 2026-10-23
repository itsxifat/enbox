/**
 * Links to this app: `internalLinkOf`, in-app navigation from message text (RichText) with a
 * jump when the message is in the open chat, the message link card (`GET /api/messages/:id`,
 * 404 → "Message not found or you can't see it") and the invite card (`GET /api/invites/:code`,
 * Join / Joined, invalid codes).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { InviteJoinResult, InvitePreview, Message } from '@enbox/shared';
import { ApiError, api } from '@/lib/api';
import { bus } from '@/lib/bus';
import { resetSessionState } from '@/lib/session';
import { getServerConfig } from '@/lib/serverConfig';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useMessages, type ChatMessages } from '@/stores/messages';
import { DEFAULT_PREFS, useUi } from '@/stores/ui';
import { useUsers } from '@/stores/users';
import { makeChat, makeMe, makeMessage, makeUser } from '@/test/factories';
import { useConversationUi } from '../../state';
import { resetLinkPreviewCache } from '../../lib/linkPreview';
import { LinkPreviewCard } from '../LinkPreviewCard';
import { RichText } from '../RichText';
import { resetInviteCards } from './InviteCard';
import { internalLinkOf } from './internalLinks';
import { resetLinkedMessages } from './MessageLinkCard';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SPACE = uuid(901);
const CHANNEL = uuid(902);
const MSG = uuid(903);
const CODE = 'ABCDEFGHJKLMNPQRSTUVWX';
const origin = window.location.origin;
const messageLink = `${origin}/spaces/${SPACE}/${CHANNEL}?m=7&mid=${MSG}`;

let navigations: string[];
let offNavigate: () => void;
/** Whether the last click was kept in the app (default prevented); also stops jsdom navigating. */
let prevented: boolean | null;
const onClick = (e: Event) => {
  prevented = e.defaultPrevented;
  e.preventDefault();
};
/**
 * Watch clicks on the React root itself: links stop propagation (rows must not see their
 * clicks), but a listener added after React's on the same node still runs, after it.
 */
const watchClicks = (container: HTMLElement) => container.addEventListener('click', onClick);

const channel = makeChat({
  id: CHANNEL,
  type: 'space_text',
  name: 'general',
  space: { spaceId: SPACE, categoryId: null, position: 0, overwrites: [] } as never,
});

beforeEach(() => {
  resetLinkPreviewCache();
  resetLinkedMessages();
  resetInviteCards();
  useAuth.setState({
    user: makeMe({ id: 'me', displayName: 'Me' }),
    token: 't',
    status: 'authenticated',
  });
  useUi.setState({ prefs: { ...DEFAULT_PREFS }, dialogs: [] });
  useUsers.setState({ byId: { olive: makeUser({ id: 'olive', displayName: 'Olive' }) } });
  navigations = [];
  offNavigate = bus.on('navigate', ({ to }) => navigations.push(to));
  prevented = null;
  // Space member lookups of card authors: none known.
  vi.spyOn(api, 'post').mockResolvedValue([] as never);
});

afterEach(() => {
  offNavigate();
  resetSessionState();
  useMessages.setState({ byChat: {} });
  useChats.setState({ byId: {}, openChatId: null });
  useConversationUi.setState({ jump: null });
});

describe('internalLinkOf', () => {
  it('message links, invites and other pages of this app; other sites are not', () => {
    expect(internalLinkOf(messageLink)).toEqual({
      kind: 'message',
      path: `/spaces/${SPACE}/${CHANNEL}?m=7&mid=${MSG}`,
      messageId: MSG,
      chatId: CHANNEL,
      seq: 7,
      spaceId: SPACE,
    });
    expect(internalLinkOf(`${origin}/chats/${CHANNEL}?m=3&mid=${MSG}`)).toMatchObject({
      kind: 'message',
      chatId: CHANNEL,
      seq: 3,
      spaceId: null,
    });
    expect(internalLinkOf(`${origin}/updates/channels/${CHANNEL}?m=3&mid=${MSG}`)).toMatchObject({
      kind: 'message',
      chatId: CHANNEL,
    });
    expect(internalLinkOf(`${origin}/join/${CODE}`)).toEqual({
      kind: 'invite',
      code: CODE,
      path: `/join/${CODE}`,
    });
    expect(internalLinkOf(`${origin}/invite/star-club`)).toEqual({
      kind: 'invite',
      code: 'star-club',
      path: '/join/star-club',
    });
    expect(internalLinkOf(`${origin}/spaces/${SPACE}/${CHANNEL}`)).toEqual({
      kind: 'page',
      path: `/spaces/${SPACE}/${CHANNEL}`,
    });
    // Without the message id it is just the chat.
    expect(internalLinkOf(`${origin}/chats/${CHANNEL}?m=3`)?.kind).toBe('page');
    expect(internalLinkOf(`${origin}/join/no`)?.kind).toBe('page');
    expect(internalLinkOf('https://example.com/join/abc')).toBeNull();
    expect(internalLinkOf('mailto:a@b.co')).toBeNull();
  });

  it('the canonical public origin counts as this app too', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ publicUrl: 'https://enbox.example' } as never);
    await getServerConfig();
    expect(internalLinkOf(`https://enbox.example/join/${CODE}`)).toMatchObject({ kind: 'invite' });
    expect(internalLinkOf(`${origin}/join/${CODE}`)).toMatchObject({ kind: 'invite' });
  });
});

describe('links in message text', () => {
  it("this app's links open in-app (a modified click is the browser's); others in a new tab", () => {
    const { container } = render(
      <RichText text={`go ${origin}/spaces/${SPACE}/${CHANNEL} or https://example.com`} />,
    );
    watchClicks(container);
    const inApp = screen.getByRole('link', { name: `${origin}/spaces/${SPACE}/${CHANNEL}` });
    expect(inApp).not.toHaveAttribute('target');
    fireEvent.click(inApp);
    expect(prevented).toBe(true);
    expect(navigations).toEqual([`/spaces/${SPACE}/${CHANNEL}`]);
    fireEvent.click(inApp, { ctrlKey: true });
    expect(prevented).toBe(false);
    expect(navigations).toHaveLength(1);
    const external = screen.getByRole('link', { name: 'https://example.com' });
    expect(external).toHaveAttribute('target', '_blank');
    expect(external).toHaveAttribute('rel', 'noopener noreferrer');
    // Another site: the "Leaving Enbox" warning first (features/links), unless trusted.
    fireEvent.click(external);
    expect(prevented).toBe(true);
    useUi.getState().setPref('trustedLinkDomains', ['example.com']);
    fireEvent.click(external);
    expect(prevented).toBe(false);
  });

  it('a link to a message of the open chat scrolls there instead', () => {
    useChats.setState({ openChatId: CHANNEL });
    render(<RichText text={messageLink} />);
    fireEvent.click(screen.getByRole('link'));
    expect(navigations).toEqual([]);
    expect(useConversationUi.getState().jump).toMatchObject({
      chatId: CHANNEL,
      seq: 7,
      messageId: MSG,
    });
  });
});

describe('message link cards', () => {
  it('show the author, the channel, the time and the text; a click opens the message', async () => {
    useChats.setState({ byId: { [CHANNEL]: channel } });
    const get = vi.spyOn(api, 'get').mockResolvedValue(
      makeMessage({
        id: MSG,
        chatId: CHANNEL,
        seq: 7,
        senderId: 'olive',
        text: '**Big** news, ||the secret||!',
        createdAt: new Date().toISOString(),
      }) as never,
    );
    const { container } = render(<LinkPreviewCard text={`look ${messageLink}`} />);
    watchClicks(container);
    const card = await screen.findByTestId('message-link-embed');
    expect(get).toHaveBeenCalledWith(`/api/messages/${MSG}`);
    expect(card).toHaveTextContent('Olive');
    expect(card).toHaveTextContent('#general');
    expect(card).toHaveTextContent('Big news, spoiler!');
    expect(card.querySelector('time')).not.toBeNull();
    fireEvent.click(card);
    expect(prevented).toBe(true);
    expect(navigations).toEqual([`/spaces/${SPACE}/${CHANNEL}?m=7&mid=${MSG}`]);
  });

  it("a message I can't see says so", async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new ApiError('not_found', 'Message not found', 404));
    render(<LinkPreviewCard text={messageLink} />);
    expect(await screen.findByText("Message not found or you can't see it")).toBeInTheDocument();
  });

  it('a message already loaded is shown without asking the server', () => {
    useChats.setState({ byId: { [CHANNEL]: channel } });
    const loaded: Message = makeMessage({
      id: MSG,
      chatId: CHANNEL,
      seq: 7,
      senderId: 'me',
      text: 'mine',
    });
    useMessages.setState({
      byChat: {
        [CHANNEL]: {
          items: [loaded],
          loaded: true,
          hasMoreBefore: false,
          hasMoreAfter: false,
        } as unknown as ChatMessages,
      },
    });
    const get = vi.spyOn(api, 'get');
    render(<LinkPreviewCard text={messageLink} />);
    const card = screen.getByTestId('message-link-embed');
    expect(card).toHaveTextContent('Me');
    expect(card).toHaveTextContent('mine');
    expect(get).not.toHaveBeenCalled();
  });
});

describe('invite cards', () => {
  const invite = (p: Partial<InvitePreview> = {}): InvitePreview => ({
    code: CODE,
    kind: 'space',
    id: SPACE,
    name: 'Star Club',
    description: null,
    avatarUrl: null,
    memberCount: 1234,
    communityId: null,
    communityName: null,
    isMember: false,
    canJoin: true,
    reason: null,
    onlineCount: 56,
    ...p,
  });

  it('show the Space, who is online and how many joined; Join joins and opens it', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue(invite() as never);
    const joined: InviteJoinResult = {
      kind: 'space',
      id: SPACE,
      chat: null,
      community: null,
      space: null,
      channelId: CHANNEL,
    };
    const post = vi.spyOn(api, 'post').mockResolvedValue(joined as never);
    render(<LinkPreviewCard text={`come ${origin}/join/${CODE}`} />);
    const card = await screen.findByTestId('invite-embed');
    expect(get).toHaveBeenCalledWith(`/api/invites/${CODE}`);
    expect(card).toHaveTextContent("You've been invited to join a Space");
    expect(card).toHaveTextContent('Star Club');
    expect(card).toHaveTextContent('56 Online');
    expect(card).toHaveTextContent(/1[,.\s]?234 Members/);
    fireEvent.click(within(card).getByRole('button', { name: 'Join' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith(`/api/invites/${CODE}/join`));
    await waitFor(() => expect(navigations).toEqual([`/spaces/${SPACE}/${CHANNEL}`]));
    expect(await within(card).findByRole('button', { name: 'Joined' })).toBeInTheDocument();
  });

  it('Joined when I am in already (it opens the Space)', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(invite({ isMember: true, canJoin: false }) as never);
    render(<LinkPreviewCard text={`${origin}/invite/${CODE}`} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Joined' }));
    expect(navigations).toEqual([`/spaces/${SPACE}`]);
  });

  it('an unknown or reset code is an invalid invite', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new ApiError('not_found', 'Invite not found', 404));
    render(<LinkPreviewCard text={`${origin}/join/${CODE}`} />);
    const card = await screen.findByTestId('invite-embed');
    expect(card).toHaveTextContent('Invalid invite');
    expect(within(card).queryByRole('button', { name: 'Join' })).toBeNull();
  });
});
