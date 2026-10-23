/**
 * The Voice Connected panel's Camera and Screen (the voice engine faked): Screen needs STREAM
 * and Camera VIDEO in the channel — disabled with the reason as the tooltip otherwise, and so
 * in a Stage audience; while I share my screen the button says "Live" and stops it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { PERM, type VoiceState } from '@enbox/shared';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useVoice } from '@/stores/voice';
import { makeChat, makeMe } from '@/test/factories';

const local = vi.hoisted(() => ({ isCameraEnabled: false, isScreenShareEnabled: false }));
const engine = vi.hoisted(() => ({
  getVoiceRoom: () => ({ localParticipant: local, remoteParticipants: new Map() }),
  disconnectVoice: vi.fn(async () => undefined),
  resumeVoiceAudio: vi.fn(async () => undefined),
  toggleCamera: vi.fn(async () => undefined),
  toggleScreenShare: vi.fn(async () => undefined),
}));
vi.mock('./engine', () => engine);

const { VoicePanel } = await import('./VoicePanel');

const BASE = PERM.VIEW_CHANNEL | PERM.CONNECT | PERM.SPEAK;

function connect(
  bits: number,
  type: 'space_voice' | 'space_stage' = 'space_voice',
  suppressed = false,
) {
  useChats.setState({
    byId: { v1: makeChat({ id: 'v1', type, name: 'General', spacePermissions: bits }) },
  });
  const mine: VoiceState = {
    userId: 'me',
    spaceId: 's1',
    channelId: 'v1',
    selfMute: false,
    selfDeaf: false,
    selfVideo: false,
    selfStream: false,
    serverMute: false,
    serverDeaf: false,
    suppressed,
    joinedAt: '2026-10-23T10:00:00.000Z',
  };
  useVoice.setState({
    connection: { spaceId: 's1', channelId: 'v1', status: 'connected' },
    byUser: { me: mine },
  });
  return render(
    <MemoryRouter>
      <VoicePanel />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useAuth.setState({ user: makeMe({ id: 'me' }) });
  local.isCameraEnabled = false;
  local.isScreenShareEnabled = false;
  engine.toggleScreenShare.mockClear();
});
afterEach(() => useVoice.setState({ connection: null, byUser: {} }));

describe('VoicePanel', () => {
  it('without STREAM or VIDEO: Screen and Camera are disabled and say why', () => {
    connect(BASE);
    const screenButton = screen.getByTestId('panel-screen');
    expect(screenButton).toBeDisabled();
    expect(screenButton).toHaveAccessibleName('Screen: You don’t have permission to stream here');
    expect(
      screen.getByRole('tooltip', { name: 'You don’t have permission to stream here' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('panel-camera')).toBeDisabled();
  });

  it('with STREAM: Screen shares; while live it says so and stops', () => {
    connect(BASE | PERM.STREAM | PERM.VIDEO);
    const screenButton = screen.getByTestId('panel-screen');
    expect(screenButton).toBeEnabled();
    expect(screenButton).toHaveTextContent('Screen');
    fireEvent.click(screenButton);
    expect(engine.toggleScreenShare).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('panel-camera')).toBeEnabled();
  });

  it('while sharing: "Live", pressed', () => {
    local.isScreenShareEnabled = true;
    connect(BASE | PERM.STREAM);
    const screenButton = screen.getByTestId('panel-screen');
    expect(screenButton).toHaveTextContent('Live');
    expect(screenButton).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screenButton);
    expect(engine.toggleScreenShare).toHaveBeenCalledTimes(1);
  });

  it('a Stage audience has neither, whatever the bits', () => {
    connect(BASE | PERM.STREAM | PERM.VIDEO, 'space_stage', true);
    expect(screen.getByTestId('panel-screen')).toHaveAccessibleName(
      'Screen: Become a speaker to share your screen',
    );
    expect(screen.getByTestId('panel-camera')).toBeDisabled();
  });
});
