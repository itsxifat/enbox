/**
 * Realtime soundboard: `voice:sound` plays through an Audio element at the sound's volume × my
 * soundboard volume, only in the channel I am connected to and never while deafened (the
 * player's emoji shows either way); `space:sounds` replaces a Space's list; leaving drops it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpaceSound, VoiceSoundEvent } from '@enbox/shared';
import type { AppSocket } from '@/lib/socket';
import { mediaUrl } from '@/lib/api';
import { FLASH_MS, useSoundboard } from '@/stores/soundboard';
import { useVoice } from '@/stores/voice';
import { useVoiceSelf } from '@/stores/voiceSelf';
import { handleVoiceSound, registerSoundboardHandlers, resyncSoundboard } from './soundboard';

class FakeAudio {
  static made: FakeAudio[] = [];
  volume = 1;
  play = vi.fn(() => Promise.resolve());
  constructor(public src: string) {
    FakeAudio.made.push(this);
  }
}

const horn: SpaceSound = {
  id: 'snd1',
  spaceId: 's2',
  name: 'Air horn',
  emoji: '📯',
  volume: 0.5,
  url: '/uploads/2026/10/horn.mp3',
  createdBy: 'owner',
};
const event = (p: Partial<VoiceSoundEvent> = {}): VoiceSoundEvent => ({
  spaceId: 's1',
  channelId: 'v1',
  userId: 'bob',
  sound: horn,
  ...p,
});

describe('realtime soundboard', () => {
  beforeEach(() => {
    FakeAudio.made = [];
    vi.stubGlobal('Audio', FakeAudio);
    useVoice.setState({ connection: { spaceId: 's1', channelId: 'v1', status: 'connected' } });
    useVoiceSelf.setState({ muted: false, deafened: false });
    useSoundboard.setState({ volume: 0.8, flashes: {}, bySpace: {}, fresh: {} });
  });
  afterEach(() => {
    vi.useRealTimers();
    useVoice.setState({ connection: null });
  });

  it('plays a sound of my channel at its volume × my soundboard volume, and shows its emoji', () => {
    vi.useFakeTimers();
    handleVoiceSound(event());
    expect(FakeAudio.made).toHaveLength(1);
    expect(FakeAudio.made[0]!.src).toBe(mediaUrl(horn.url));
    expect(FakeAudio.made[0]!.volume).toBeCloseTo(0.4);
    expect(FakeAudio.made[0]!.play).toHaveBeenCalled();
    expect(useSoundboard.getState().flashes.bob).toMatchObject({ emoji: '📯', name: 'Air horn' });
    vi.advanceTimersByTime(FLASH_MS);
    expect(useSoundboard.getState().flashes.bob).toBeUndefined();
  });

  it('never plays while I am deafened, nor for another channel, nor at 0%', () => {
    useVoiceSelf.setState({ deafened: true });
    handleVoiceSound(event());
    expect(FakeAudio.made).toHaveLength(0);
    // The emoji still shows over their tile.
    expect(useSoundboard.getState().flashes.bob).toBeDefined();

    useVoiceSelf.setState({ deafened: false });
    handleVoiceSound(event({ channelId: 'elsewhere', userId: 'cat' }));
    expect(FakeAudio.made).toHaveLength(0);
    expect(useSoundboard.getState().flashes.cat).toBeUndefined();

    useSoundboard.getState().setVolume(0);
    handleVoiceSound(event());
    expect(FakeAudio.made).toHaveLength(0);
    useVoice.setState({ connection: null });
    useSoundboard.getState().setVolume(1);
    handleVoiceSound(event());
    expect(FakeAudio.made).toHaveLength(0);
  });

  it('space:sounds replaces a Space’s list, leaving drops it, a reconnect marks lists stale', async () => {
    const handlers = new Map<string, (p: unknown) => void>();
    const socket = { on: (ev: string, fn: (p: unknown) => void) => handlers.set(ev, fn) } as unknown as AppSocket;
    registerSoundboardHandlers(socket);
    handlers.get('space:sounds')!({ spaceId: 's2', sounds: [horn] });
    expect(useSoundboard.getState().bySpace.s2).toEqual([horn]);
    expect(useSoundboard.getState().fresh.s2).toBe(true);
    await resyncSoundboard({} as never);
    expect(useSoundboard.getState().fresh.s2).toBeUndefined();
    expect(useSoundboard.getState().bySpace.s2).toEqual([horn]);
    handlers.get('space:removed')!({ spaceId: 's2' });
    expect(useSoundboard.getState().bySpace.s2).toBeUndefined();
    // voice:sound goes through the same handler.
    handlers.get('voice:sound')!(event());
    expect(FakeAudio.made).toHaveLength(1);
  });
});
