/**
 * Voice channel status: the sidebar line under a voice channel (muted, truncated, with its
 * occupants or alone), and the header editor — only for someone connected with SPEAK (on a
 * Stage a speaker or moderator); Enter saves the trimmed text through the API (shown at once,
 * put back when refused), Escape cancels, the emoji button inserts at the caret.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PERM, type ChatSummary, type VoiceState } from '@enbox/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { useChat, useChats } from '@/stores/chats';
import { useUi } from '@/stores/ui';
import { useVoice } from '@/stores/voice';
import { makeChat, makeMe } from '@/test/factories';

vi.mock('@/features/conversation/lazy', () => ({
  LazyEmojiPicker: ({ onPick }: { onPick: (emoji: string) => void }) => (
    <button type="button" onClick={() => onPick('🎉')}>
      Party popper
    </button>
  ),
}));

const { VoiceChannelOccupants } = await import('./VoiceChannelOccupants');
const { VoiceStatusHeader } = await import('./VoiceStatus');

const SPEAKS = PERM.VIEW_CHANNEL | PERM.CONNECT | PERM.SPEAK;

function voiceChannel(
  p: { bits?: number; status?: string | null; type?: ChatSummary['type'] } = {},
): ChatSummary {
  const c = makeChat({
    id: 'v1',
    name: 'General',
    type: p.type ?? 'space_voice',
    spacePermissions: p.bits ?? SPEAKS,
  });
  return {
    ...c,
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
      voiceStatus: p.status ?? null,
    },
  };
}

const state = (userId: string, p: Partial<VoiceState> = {}): VoiceState => ({
  userId,
  spaceId: 's1',
  channelId: 'v1',
  selfMute: false,
  selfDeaf: false,
  selfVideo: false,
  selfStream: false,
  serverMute: false,
  serverDeaf: false,
  joinedAt: '2026-10-23T10:00:00.000Z',
  ...p,
});

/** The header as the voice view renders it: the chat from the store. */
function Header() {
  const chat = useChat('v1');
  return chat ? <VoiceStatusHeader chat={chat} /> : null;
}

function setup(o: { chat?: ChatSummary; connected?: boolean; mine?: Partial<VoiceState> } = {}) {
  const chat = o.chat ?? voiceChannel();
  useChats.setState({ byId: { v1: chat } });
  useVoice.setState({
    loadedSpaces: { s1: true },
    byUser:
      o.connected === false
        ? { bob: state('bob') }
        : { me: state('me', o.mine), bob: state('bob') },
    connection:
      o.connected === false ? null : { spaceId: 's1', channelId: 'v1', status: 'connected' },
  });
  return chat;
}

describe('voice channel status', () => {
  beforeEach(() => {
    // The emoji picker opens in a popover, which watches its size.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );
    useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    useVoice.setState({ byUser: {}, loadedSpaces: {}, connection: null });
    useChats.setState({ byId: {} });
    useUi.setState({ toasts: [] });
  });

  it('the sidebar line: under the channel while it has a status, with or without occupants', () => {
    setup({ chat: voiceChannel({ status: 'Movie night 🍿' }) });
    const { rerender } = render(<VoiceChannelOccupants chat={useChats.getState().byId.v1!} />);
    const line = screen.getByTestId('voice-status-line');
    expect(line).toHaveTextContent('Movie night 🍿');
    expect(line).toHaveAttribute('title', 'Movie night 🍿');
    expect(line).toHaveClass('truncate', 'text-muted');
    expect(screen.getAllByTestId('voice-occupant')).toHaveLength(2);

    useVoice.setState({ byUser: {} });
    rerender(<VoiceChannelOccupants chat={voiceChannel({ status: 'Movie night 🍿' })} />);
    expect(screen.getByTestId('voice-status-line')).toBeInTheDocument();
    rerender(<VoiceChannelOccupants chat={voiceChannel()} />);
    expect(screen.queryByTestId('voice-status-line')).toBeNull();
  });

  it('connected with SPEAK: set it from the header (trimmed, Enter), shown at once', async () => {
    setup();
    const put = vi.spyOn(api, 'put').mockResolvedValue(undefined as never);
    render(<Header />);
    fireEvent.click(screen.getByRole('button', { name: 'Set a channel status' }));
    const input = screen.getByRole('textbox', { name: 'Channel status' });
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: '  Raid at 9  ' } });
    fireEvent.submit(input.closest('form')!);
    expect(put).toHaveBeenCalledWith('/api/chats/v1/voice-status', { status: 'Raid at 9' });
    expect(useChats.getState().byId.v1?.space?.voiceStatus).toBe('Raid at 9');
    expect(await screen.findByTestId('voice-status')).toHaveTextContent('Raid at 9');
    expect(screen.queryByTestId('voice-status-editor')).toBeNull();
  });

  it('blank text clears it; Escape cancels without a call', async () => {
    setup({ chat: voiceChannel({ status: 'Old news' }) });
    const put = vi.spyOn(api, 'put').mockResolvedValue(undefined as never);
    render(<Header />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit channel status' }));
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Channel status' }), { key: 'Escape' });
    expect(screen.queryByTestId('voice-status-editor')).toBeNull();
    expect(put).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Edit channel status' }));
    const input = screen.getByRole('textbox', { name: 'Channel status' });
    expect(input).toHaveValue('Old news');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.submit(input.closest('form')!);
    expect(put).toHaveBeenCalledWith('/api/chats/v1/voice-status', { status: null });
    await waitFor(() => expect(screen.queryByTestId('voice-status')).toBeNull());
  });

  it('the emoji button puts an emoji at the caret', async () => {
    setup();
    render(<Header />);
    fireEvent.click(screen.getByRole('button', { name: 'Set a channel status' }));
    const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Channel status' });
    fireEvent.change(input, { target: { value: 'Game night' } });
    input.setSelectionRange(4, 4);
    fireEvent.click(screen.getByRole('button', { name: 'Add an emoji' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Party popper' }));
    expect(input).toHaveValue('Game🎉 night');
  });

  it('a refused status is put back', async () => {
    setup({ chat: voiceChannel({ status: 'Before' }) });
    vi.spyOn(api, 'put').mockRejectedValue(new Error('Slow down'));
    render(<Header />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit channel status' }));
    const input = screen.getByRole('textbox', { name: 'Channel status' });
    fireEvent.change(input, { target: { value: 'After' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() =>
      expect(useUi.getState().toasts.some((t) => t.message === 'Slow down')).toBe(true),
    );
    expect(useChats.getState().byId.v1?.space?.voiceStatus).toBe('Before');
    // The editor stays open with the text for another try.
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Channel status' })).toBeEnabled(),
    );
    expect(screen.getByRole('textbox', { name: 'Channel status' })).toHaveValue('After');
  });

  it('only for someone connected to it with SPEAK; on a Stage a speaker or moderator', () => {
    setup({ connected: false, chat: voiceChannel({ status: 'Busy' }) });
    const { unmount } = render(<Header />);
    expect(screen.getByTestId('voice-status')).toHaveTextContent('Busy');
    expect(screen.queryByRole('button', { name: 'Edit channel status' })).toBeNull();
    unmount();

    setup({ chat: voiceChannel({ bits: PERM.VIEW_CHANNEL | PERM.CONNECT }) });
    const second = render(<Header />);
    expect(screen.queryByRole('button', { name: 'Set a channel status' })).toBeNull();
    second.unmount();

    // A Stage listener cannot; a speaker can.
    setup({ chat: voiceChannel({ type: 'space_stage' }), mine: { suppressed: true } });
    const third = render(<Header />);
    expect(screen.queryByRole('button', { name: 'Set a channel status' })).toBeNull();
    third.unmount();
    setup({ chat: voiceChannel({ type: 'space_stage' }), mine: { suppressed: false } });
    render(<Header />);
    expect(screen.getByRole('button', { name: 'Set a channel status' })).toBeInTheDocument();
  });
});
