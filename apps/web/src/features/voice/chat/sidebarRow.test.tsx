/**
 * Voice rows of the channel sidebar with text in voice: unread from their chat (bold, the mention
 * count) and the Open Chat icon, which opens the channel with its chat without joining the call.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { PERM, type ChatSummary } from '@enbox/shared';
import { ChannelSidebar } from '@/features/spaces/ChannelSidebar';
import { makeSpace } from '@/features/spaces/testUtils';
import { api } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useSpaces } from '@/stores/spaces';
import { makeChat, makeMe } from '@/test/factories';
import { useVoiceChat } from './store';

const voiceActions = vi.hoisted(() => ({ joinVoiceChannel: vi.fn() }));
vi.mock('@/features/voice/actions', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  joinVoiceChannel: voiceActions.joinVoiceChannel,
}));

const BITS = PERM.VIEW_CHANNEL | PERM.SEND_MESSAGES | PERM.CONNECT;

function channel(p: Partial<ChatSummary>): ChatSummary {
  return makeChat({
    type: 'space_text',
    spacePermissions: BITS,
    lastSeq: 1,
    lastReadSeq: 1,
    space: {
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
    },
    ...p,
  });
}

function Where() {
  const loc = useLocation();
  return <span data-testid="where">{loc.pathname}</span>;
}

const row = (name: string) =>
  screen.getAllByTestId('space-channel-row').find((r) => r.getAttribute('data-channel-name') === name)!;

beforeEach(() => {
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
  vi.spyOn(api, 'get').mockResolvedValue([] as never);
  useSpaces.setState({ byId: { s1: makeSpace({ id: 's1', name: 'Lab' }) }, order: ['s1'], loaded: true, channelsLoaded: { s1: true } });
  useChats.setState({
    byId: Object.fromEntries(
      [
        channel({ id: 'general', name: 'general' }),
        channel({ id: 'v1', name: 'Lounge', type: 'space_voice', lastSeq: 4, lastReadSeq: 2, unreadCount: 2, unreadMentionCount: 1 }),
        channel({ id: 'v2', name: 'Quiet', type: 'space_voice' }),
      ].map((c) => [c.id, c]),
    ),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  voiceActions.joinVoiceChannel.mockReset();
  useChats.setState({ byId: {} });
  useSpaces.setState({ byId: {}, order: [], channelsLoaded: {} });
  useVoiceChat.setState({ open: {}, pending: null, viewing: null });
});

describe('voice rows with text in voice', () => {
  it('are unread from their chat and open it from the Open Chat icon without joining', () => {
    render(
      <MemoryRouter initialEntries={['/spaces/s1/general']}>
        <Routes>
          <Route
            path="/spaces/:spaceId/:chatId"
            element={
              <>
                <ChannelSidebar spaceId="s1" />
                <Where />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    // Unread: bold like a text channel, with the mention count; a read one is not.
    expect(row('Lounge')).toHaveClass('font-semibold');
    expect(row('Lounge')).toHaveTextContent('1');
    expect(row('Quiet')).not.toHaveClass('font-semibold');

    fireEvent.click(within(row('Lounge')).getByRole('button', { name: 'Open chat in Lounge' }));
    expect(voiceActions.joinVoiceChannel).not.toHaveBeenCalled();
    expect(screen.getByTestId('where')).toHaveTextContent('/spaces/s1/v1');
    // The channel's view opens its chat once it shows (VoiceChatButton).
    expect(useVoiceChat.getState().pending).toBe('v1');

    // The row itself still joins the call.
    fireEvent.click(row('Quiet'));
    expect(voiceActions.joinVoiceChannel).toHaveBeenCalledTimes(1);
  });
});
