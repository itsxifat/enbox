/**
 * The voice grid with streams (the room faked): a camera tile per person and a stream tile per
 * sharer; Watch Stream subscribes (store) and focuses the stream, Stop Watching drops it; my
 * own stream is a preview with Stop Streaming and how many watch; clicking a tile focuses it
 * (the others go to the strip), clicking it again or Escape returns to the grid.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { Track, type Participant } from 'livekit-client';
import { makeSpace } from '@/features/spaces/testUtils';
import { useAuth } from '@/stores/auth';
import { useSpaces } from '@/stores/spaces';
import { useUsers } from '@/stores/users';
import { useVoice } from '@/stores/voice';
import { makeMe, makeUser } from '@/test/factories';

const fake = vi.hoisted(() => ({
  room: null as null | { localParticipant: unknown; remoteParticipants: Map<string, unknown> },
}));
const engine = vi.hoisted(() => ({
  getVoiceRoom: () => fake.room,
  toggleScreenShare: vi.fn(async () => undefined),
}));
vi.mock('@/features/voice/engine', () => engine);

const { VoiceGrid } = await import('./VoiceGrid');
const { useStreams } = await import('./store');

interface FakeScreen {
  track?: { attach: ReturnType<typeof vi.fn>; detach: ReturnType<typeof vi.fn> };
  isMuted: boolean;
}

/** Someone in the room; `screen` while they share (a track once subscribed). */
function person(identity: string, screen?: FakeScreen) {
  return {
    identity,
    isMicrophoneEnabled: true,
    get isScreenShareEnabled() {
      return !!screen;
    },
    getTrackPublication: (source: Track.Source) =>
      source === Track.Source.ScreenShare ? screen : undefined,
  } as unknown as Participant;
}
const track = () => ({ attach: vi.fn(), detach: vi.fn() });

const space = makeSpace({ id: 's1' });
let annScreen: FakeScreen;
let myScreen: FakeScreen | undefined;

function renderGrid() {
  return render(<VoiceGrid space={space} />);
}
const grid = () => screen.getByTestId('voice-grid');
const streamTile = (name: string) =>
  screen.getByRole('button', { name: `Focus ${name}'s stream` }).parentElement!;

beforeEach(() => {
  useAuth.setState({ user: makeMe({ id: 'me', displayName: 'Mia' }) });
  useUsers.setState({
    byId: {
      me: makeUser({ id: 'me', displayName: 'Mia' }),
      ann: makeUser({ id: 'ann', displayName: 'Ann' }),
      bob: makeUser({ id: 'bob', displayName: 'Bob' }),
    },
    fetchUsers: async () => undefined,
  });
  useSpaces.setState({ byId: { s1: space }, members: { s1: {} }, fetchMembers: () => undefined });
  annScreen = { isMuted: false };
  myScreen = undefined;
  fake.room = {
    localParticipant: {
      ...person('me'),
      getTrackPublication: (source: Track.Source) =>
        source === Track.Source.ScreenShare ? myScreen : undefined,
      get isScreenShareEnabled() {
        return !!myScreen;
      },
    },
    remoteParticipants: new Map([
      ['ann', person('ann', annScreen)],
      ['bob', person('bob')],
    ]),
  };
});
afterEach(() => {
  useStreams.getState().reset();
  fake.room = null;
});

describe('VoiceGrid', () => {
  it('a tile per person and one per stream; Watch Stream subscribes and focuses, Stop Watching drops it', () => {
    renderGrid();
    expect(grid()).toHaveAttribute('data-mode', 'grid');
    expect(screen.getAllByTestId('voice-tile')).toHaveLength(3);
    expect(screen.getAllByTestId('stream-tile')).toHaveLength(1);
    // Not watched: nothing plays, Watch Stream and LIVE.
    const tile = streamTile('Ann');
    expect(within(tile).queryByRole('button', { name: 'Stop Watching' })).toBeNull();
    expect(tile.querySelector('video')).toBeNull();
    expect(within(tile).getByText('LIVE')).toBeInTheDocument();

    fireEvent.click(within(tile).getByRole('button', { name: 'Watch Stream' }));
    expect(useStreams.getState().watching).toEqual({ ann: true });
    expect(grid()).toHaveAttribute('data-mode', 'focus');
    expect(
      within(screen.getByTestId('voice-focus')).getByTestId('stream-tile'),
    ).toBeInTheDocument();
    expect(within(screen.getByTestId('voice-strip')).getAllByTestId('voice-tile')).toHaveLength(3);

    // The subscription lands: the video plays.
    annScreen.track = track();
    act(() => useVoice.getState().bumpRoom());
    const focused = within(screen.getByTestId('voice-focus'));
    expect(screen.getByTestId('voice-focus').querySelector('video')).not.toBeNull();
    expect(annScreen.track.attach).toHaveBeenCalled();

    fireEvent.click(focused.getByRole('button', { name: 'Stop Watching' }));
    expect(useStreams.getState().watching).toEqual({});
    expect(focused.getByRole('button', { name: 'Watch Stream' })).toBeInTheDocument();
  });

  it('clicking a tile focuses it, clicking it again or Escape returns to the grid', async () => {
    vi.useFakeTimers();
    try {
      renderGrid();
      fireEvent.click(screen.getByRole('button', { name: 'Focus Bob' }));
      expect(grid()).toHaveAttribute('data-mode', 'focus');
      const area = within(screen.getByTestId('voice-focus'));
      expect(area.getByRole('button', { name: 'Focus Bob' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      expect(
        within(screen.getByTestId('voice-strip')).getAllByTestId(/voice-tile|stream-tile/),
      ).toHaveLength(3);

      fireEvent.click(area.getByRole('button', { name: 'Focus Bob' }));
      expect(grid()).toHaveAttribute('data-mode', 'grid');

      // Another tile from the strip takes the focus; Escape leaves it.
      fireEvent.click(screen.getByRole('button', { name: 'Focus Ann' }));
      fireEvent.click(
        within(screen.getByTestId('voice-strip')).getByRole('button', { name: 'Focus Mia' }),
      );
      expect(
        within(screen.getByTestId('voice-focus')).getByRole('button', { name: 'Focus Mia' }),
      ).toBeInTheDocument();
      fireEvent.keyDown(window, { key: 'Escape' });
      await act(() => vi.runOnlyPendingTimersAsync());
      expect(grid()).toHaveAttribute('data-mode', 'grid');
    } finally {
      vi.useRealTimers();
    }
  });

  it('Escape that a menu or dialog took keeps the focus', async () => {
    vi.useFakeTimers();
    try {
      renderGrid();
      fireEvent.click(screen.getByRole('button', { name: 'Focus Bob' }));
      const taken = (e: KeyboardEvent) => e.preventDefault();
      window.addEventListener('keydown', taken);
      fireEvent.keyDown(window, { key: 'Escape' });
      window.removeEventListener('keydown', taken);
      await act(() => vi.runOnlyPendingTimersAsync());
      expect(grid()).toHaveAttribute('data-mode', 'focus');
    } finally {
      vi.useRealTimers();
    }
  });

  it('my stream: a local preview with how many watch and Stop Streaming', () => {
    myScreen = { isMuted: false, track: track() };
    useStreams.getState().setViewing('ann', ['me']);
    useStreams.getState().setViewing('bob', ['me']);
    renderGrid();
    const mine = streamTile('Mia');
    expect(mine.querySelector('video')).not.toBeNull();
    expect(within(mine).queryByRole('button', { name: 'Watch Stream' })).toBeNull();
    expect(within(mine).getByLabelText('2 watching')).toBeInTheDocument();
    fireEvent.click(within(mine).getByRole('button', { name: 'Stop Streaming' }));
    expect(engine.toggleScreenShare).toHaveBeenCalled();
  });

  it('a focused stream that ends goes back to the grid', () => {
    renderGrid();
    fireEvent.click(within(streamTile('Ann')).getByRole('button', { name: 'Watch Stream' }));
    expect(grid()).toHaveAttribute('data-mode', 'focus');
    act(() => useStreams.getState().streamEnded('ann'));
    expect(grid()).toHaveAttribute('data-mode', 'grid');
  });
});
