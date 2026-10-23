/**
 * Text chat in voice and Stage channels: the view's Chat button (unread dot, mention count,
 * toggles the chat, full screen on phones), the panel (header, marks the chat read while shown,
 * the open conversation), the sidebar's Open Chat icon, `?m=` links, the chat remembered per
 * channel on desktop, and the badges, Inbox and permission editor rules that now count voice
 * and Stage chats. The message list and the composer are stubbed (they have their own tests).
 */
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate, useParams } from 'react-router';
import { PERM, type ChatSummary } from '@enbox/shared';
import { useConversationUi } from '@/features/conversation/state';
import { openUnreadChat, unreadGroups } from '@/features/inbox/lib';
import { PERMISSION_GROUPS } from '@/features/spaces/permissionLabels';
import { isChannelUnread } from '@/features/spaces/sidebar';
import { makeSpace } from '@/features/spaces/testUtils';
import { api } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useMessages, type ChatMessages } from '@/stores/messages';
import { useSidePanel } from '@/stores/sidePanel';
import { computeSpaceBadges, useSpaces } from '@/stores/spaces';
import { makeChat, makeMe } from '@/test/factories';
import { hideVoiceChat } from './actions';
import { OpenVoiceChatButton } from './OpenVoiceChatButton';
import { useVoiceChat } from './store';
import { VoiceChatButton } from './VoiceChatButton';
import { VoiceChatPanel } from './VoiceChatPanel';

vi.mock('@/features/conversation/MessageList', () => ({
  MessageList: ({ chat, initialTarget }: { chat: ChatSummary; initialTarget: { seq: number } | null }) => (
    <div data-testid="message-list" data-chat-id={chat.id} data-target={initialTarget?.seq ?? ''} />
  ),
}));
vi.mock('@/features/conversation/composer/Composer', () => ({
  Composer: ({ chat }: { chat: ChatSummary }) => <div data-testid="composer" data-chat-id={chat.id} />,
}));
const layout = vi.hoisted(() => ({ desktop: false }));
vi.mock('@/hooks/useMediaQuery', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useIsDesktop: () => layout.desktop,
}));

const MEMBER = PERM.VIEW_CHANNEL | PERM.SEND_MESSAGES | PERM.ADD_REACTIONS | PERM.CONNECT | PERM.SPEAK;

function spaceInfo(): NonNullable<ChatSummary['space']> {
  return {
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
}

function voiceChat(p: Partial<ChatSummary> = {}): ChatSummary {
  return makeChat({
    id: 'v1',
    type: 'space_voice',
    name: 'General',
    space: spaceInfo(),
    spacePermissions: MEMBER,
    lastSeq: 5,
    lastReadSeq: 3,
    unreadCount: 2,
    ...p,
  });
}

const general = () =>
  makeChat({ id: 'general', type: 'space_text', name: 'general', space: spaceInfo(), spacePermissions: MEMBER });

function seed(chats: ChatSummary[] = [voiceChat(), general()]) {
  useSpaces.setState({ byId: { s1: makeSpace({ id: 's1' }) }, order: ['s1'], loaded: true, channelsLoaded: { s1: true } });
  useChats.setState({ byId: Object.fromEntries(chats.map((c) => [c.id, c])), loaded: true });
  // The voice chat's window is loaded (the list is stubbed).
  useMessages.setState({
    byChat: { v1: { items: [], loaded: true, hasMoreBefore: false, hasMoreAfter: false } as unknown as ChatMessages },
  });
}

function Where() {
  const loc = useLocation();
  return <span data-testid="where">{`${loc.pathname}${loc.search}`}</span>;
}

/** The voice view's header as far as the chat goes: its Chat button. */
function VoiceView() {
  const { chatId } = useParams<{ chatId: string }>();
  const chat = useChats((s) => (chatId ? s.byId[chatId] : undefined));
  return chat && (chat.type === 'space_voice' || chat.type === 'space_stage') ? <VoiceChatButton chat={chat} /> : null;
}

function at(path: string, node: ReactNode = <VoiceView />) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/spaces/:spaceId/:chatId"
          element={
            <>
              {node}
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

const chatButton = () => screen.getByTestId('voice-chat-button');

beforeEach(() => {
  layout.desktop = false;
  useAuth.setState({ user: makeMe({ id: 'me', displayName: 'Me' }), token: 't', status: 'authenticated' });
  // Visible and focused: reads are reported.
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.spyOn(api, 'post').mockResolvedValue(undefined as never);
  vi.spyOn(api, 'get').mockResolvedValue({ messages: [], hasMoreBefore: false, hasMoreAfter: false, users: [] } as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  useChats.setState({ byId: {}, loaded: false, openChatId: null });
  useMessages.setState({ byChat: {} });
  useSpaces.setState({ byId: {}, order: [], channelsLoaded: {}, members: {} });
  useSidePanel.setState({ panel: null });
  useVoiceChat.setState({ open: {}, pending: null, viewing: null });
  useConversationUi.setState({ jump: null });
});

describe('the Chat button and the voice chat panel', () => {
  it('shows an unread dot, opens the chat full screen on phones and marks it read while shown', async () => {
    seed();
    at('/spaces/s1/v1');
    expect(chatButton()).toHaveAccessibleName('Chat, unread messages');
    expect(chatButton()).toHaveAttribute('title', 'Show Chat');
    expect(chatButton()).toHaveAttribute('aria-pressed', 'false');
    expect(chatButton()).toHaveAttribute('data-unread', 'true');

    fireEvent.click(chatButton());
    const panel = await screen.findByTestId('voice-chat-panel');
    expect(useSidePanel.getState().panel).toEqual({ kind: 'voiceChat', channelId: 'v1' });
    expect(useVoiceChat.getState().open).toEqual({ v1: true });
    expect(screen.getByTestId('voice-chat-header')).toHaveTextContent('General');
    expect(screen.getByTestId('message-list')).toHaveAttribute('data-chat-id', 'v1');
    // Members write without connecting.
    expect(screen.getByTestId('composer')).toHaveAttribute('data-chat-id', 'v1');
    // Shown: the open conversation, read up to its last message.
    expect(useChats.getState().openChatId).toBe('v1');
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/api/chats/v1/read', { seq: 5 }));
    expect(useChats.getState().byId.v1).toMatchObject({ unreadCount: 0, lastReadSeq: 5 });
    expect(chatButton()).toHaveAccessibleName('Chat');
    expect(chatButton()).toHaveAttribute('aria-pressed', 'true');
    expect(chatButton()).toHaveAttribute('title', 'Hide Chat');
    expect(panel).toHaveAccessibleName('Chat in General');

    // ✕ closes it and forgets it.
    fireEvent.click(screen.getByRole('button', { name: 'Close chat' }));
    expect(screen.queryByTestId('voice-chat-panel')).toBeNull();
    expect(useSidePanel.getState().panel).toBeNull();
    expect(useVoiceChat.getState().open).toEqual({});
    expect(useChats.getState().openChatId).toBeNull();
  });

  it('while closed the chat is not the open conversation, so its new messages stay unread', async () => {
    seed();
    at('/spaces/s1/v1');
    // What the channel route does on open.
    act(() => useChats.getState().setOpenChat('v1'));
    expect(useChats.getState().openChatId).toBeNull();
    // Shown, it is.
    fireEvent.click(chatButton());
    await screen.findByTestId('voice-chat-panel');
    expect(useChats.getState().openChatId).toBe('v1');
  });

  it('shows the mention count while closed; members without SEND_MESSAGES read only', async () => {
    seed([voiceChat({ unreadMentionCount: 3, spacePermissions: PERM.VIEW_CHANNEL | PERM.CONNECT })]);
    at('/spaces/s1/v1');
    expect(chatButton()).toHaveAccessibleName('Chat, 3 unread mentions');
    expect(chatButton()).toHaveTextContent('3');
    fireEvent.click(chatButton());
    await screen.findByTestId('voice-chat-panel');
    expect(screen.queryByTestId('composer')).toBeNull();
    expect(screen.getByTestId('read-only-footer')).toHaveTextContent('You do not have permission to send messages');
  });

  it('works for Stage channels too (their audience chats)', async () => {
    seed([voiceChat({ id: 'st1', type: 'space_stage', name: 'Town Hall' })]);
    at('/spaces/s1/st1');
    fireEvent.click(chatButton());
    await screen.findByTestId('voice-chat-panel');
    expect(screen.getByTestId('voice-chat-header')).toHaveTextContent('Town Hall');
    expect(screen.getByTestId('composer')).toHaveAttribute('data-chat-id', 'st1');
  });

  it('a `?m=` link opens the chat at that message and leaves the URL', async () => {
    seed();
    at('/spaces/s1/v1?m=4&mid=m4');
    const list = await screen.findByTestId('message-list');
    expect(list).toHaveAttribute('data-target', '4');
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/spaces\/s1\/v1$/);
  });

  it('the sidebar icon opens the channel with its chat, without following the row link', async () => {
    seed();
    const rowClick = vi.fn();
    function Page() {
      const { chatId } = useParams<{ chatId: string }>();
      const voice = useChats((s) => s.byId.v1);
      if (!voice) return null;
      return (
        <>
          <div onClick={rowClick}>
            <OpenVoiceChatButton chat={voice} active={false} />
          </div>
          {chatId === 'v1' ? <VoiceChatButton chat={voice} /> : null}
        </>
      );
    }
    at('/spaces/s1/general', <Page />);
    fireEvent.click(screen.getByRole('button', { name: 'Open chat in General' }));
    expect(rowClick).not.toHaveBeenCalled();
    expect(screen.getByTestId('where')).toHaveTextContent('/spaces/s1/v1');
    expect(await screen.findByTestId('voice-chat-panel')).toBeInTheDocument();
    expect(useVoiceChat.getState().pending).toBeNull();
    // On the channel already: no navigation, the chat just opens.
    act(() => hideVoiceChat('v1'));
    fireEvent.click(screen.getByRole('button', { name: 'Open chat in General' }));
    expect(useSidePanel.getState().panel).toEqual({ kind: 'voiceChat', channelId: 'v1' });
  });

  it('leaving the channel on a phone closes its full-screen chat', async () => {
    seed();
    function Leave() {
      const navigate = useNavigate();
      return <button onClick={() => navigate('/spaces/s1/general')}>leave</button>;
    }
    at(
      '/spaces/s1/v1',
      <>
        <VoiceView />
        <Leave />
      </>,
    );
    fireEvent.click(chatButton());
    await screen.findByTestId('voice-chat-panel');
    fireEvent.click(screen.getByRole('button', { name: 'leave' }));
    expect(screen.queryByTestId('voice-chat-panel')).toBeNull();
    expect(useSidePanel.getState().panel).toBeNull();
  });
});

describe('desktop: the chat is remembered per channel', () => {
  it('re-opens beside the channel it was left open in, and stays closed once closed', () => {
    layout.desktop = true;
    seed();
    useVoiceChat.setState({ open: { v1: true } });
    const view = at('/spaces/s1/v1');
    expect(useSidePanel.getState().panel).toEqual({ kind: 'voiceChat', channelId: 'v1' });
    // No overlay on desktop: SpacesView shows the panel in its side slot.
    expect(screen.queryByTestId('voice-chat-panel')).toBeNull();
    // Another side panel takes the slot; once it closes, the chat comes back.
    act(() => useSidePanel.getState().open({ kind: 'search', scope: { kind: 'space', spaceId: 's1' }, query: 'x' }));
    act(() => useSidePanel.getState().close());
    expect(useSidePanel.getState().panel).toEqual({ kind: 'voiceChat', channelId: 'v1' });
    // Leaving the channel closes it, still remembered.
    view.unmount();
    expect(useSidePanel.getState().panel).toBeNull();
    expect(useVoiceChat.getState().open).toEqual({ v1: true });
    // Closed with its ✕: forgotten.
    at('/spaces/s1/v1');
    expect(useSidePanel.getState().panel).toEqual({ kind: 'voiceChat', channelId: 'v1' });
    act(() => hideVoiceChat('v1'));
    expect(useSidePanel.getState().panel).toBeNull();
    expect(useVoiceChat.getState().open).toEqual({});
  });

  it('the side panel closes itself on another channel', () => {
    layout.desktop = true;
    seed();
    useSidePanel.setState({ panel: { kind: 'voiceChat', channelId: 'v1' } });
    at('/spaces/s1/general', <VoiceChatPanel channelId="v1" />);
    expect(useSidePanel.getState().panel).toBeNull();
  });
});

describe('voice and Stage chats count as unread', () => {
  it('sidebar rows: voice and Stage chats with new messages are unread, not when muted; forums never', () => {
    expect(isChannelUnread(voiceChat())).toBe(true);
    expect(isChannelUnread(voiceChat({ type: 'space_stage' }))).toBe(true);
    expect(isChannelUnread(voiceChat({ lastReadSeq: 5 }))).toBe(false);
    expect(isChannelUnread(voiceChat({ mutedUntil: '2999-01-01T00:00:00.000Z' }))).toBe(false);
    expect(isChannelUnread(voiceChat({ type: 'space_forum' }))).toBe(false);
  });

  it('rail badges: a loaded Space is unread from its voice chat and counts its mentions', () => {
    const space = makeSpace({ id: 's1' });
    const chats = {
      general: general(),
      v1: voiceChat({ unreadMentionCount: 2 }),
      st1: voiceChat({ id: 'st1', type: 'space_stage', unreadMentionCount: 1 }),
    };
    expect(computeSpaceBadges([space], chats, { s1: true }).get('s1')).toEqual({ unread: true, mentions: 3, muted: false });
    const read = { general: general(), v1: voiceChat({ lastReadSeq: 5, unreadCount: 0 }) };
    expect(computeSpaceBadges([space], read, { s1: true }).get('s1')).toMatchObject({ unread: false, mentions: 0 });
  });

  it('Inbox Unreads lists voice chats and opens them beside their channel', () => {
    seed();
    const groups = unreadGroups(useChats.getState().byId, useSpaces.getState().byId);
    expect(groups.map((g) => g.chats.map((c) => c.id))).toEqual([['v1']]);
    const navigate = vi.fn();
    openUnreadChat(useChats.getState().byId.v1!, navigate);
    expect(navigate).toHaveBeenCalledWith('/spaces/s1/v1', expect.anything());
    expect(useVoiceChat.getState().pending).toBe('v1');
  });

  it('the permission editor shows the text permissions for voice channels (and so Stages)', () => {
    const titles = (type: 'space_text' | 'space_voice') =>
      PERMISSION_GROUPS.filter((g) => g.channel.includes(type)).map((g) => g.title);
    expect(titles('space_voice')).toEqual(['General', 'Text channels', 'Voice channels']);
    expect(titles('space_text')).toEqual(['General', 'Text channels']);
    const text = PERMISSION_GROUPS.find((g) => g.title === 'Text channels')!;
    expect(text.items.map((i) => i.bit)).toContain(PERM.SEND_MESSAGES);
  });
});
