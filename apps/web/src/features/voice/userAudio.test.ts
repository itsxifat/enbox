/**
 * Per-person audio on this device: volumes and local mutes persist in the device prefs (only
 * people I changed), and the gains reach the room's participants — volume × output volume,
 * nothing while muted for me or deafened, capped where audio cannot go past 100%; screen share
 * audio follows the output volume only.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PREFS, useUi } from '@/stores/ui';
import { StorageKeys } from '@/lib/storage';
import { applyVoiceGains, setUserMuted, setUserVolume, userAudioOf, voiceGain } from './userAudio';

const SOURCES = { voice: 'mic', stream: 'screen' } as const;

function participant(identity: string) {
  return { identity, setVolume: vi.fn<(volume: number, source?: 'mic' | 'screen') => void>() };
}

afterEach(() => useUi.setState({ prefs: DEFAULT_PREFS }));

describe('user audio', () => {
  it('keeps volumes and local mutes per person, persisted with the device prefs', () => {
    setUserVolume('bob', 1.5);
    setUserMuted('cat', true);
    expect(useUi.getState().prefs.userAudio).toEqual({
      bob: { volume: 1.5 },
      cat: { muted: true },
    });
    expect(userAudioOf(useUi.getState().prefs, 'bob')).toEqual({ volume: 1.5, muted: false });
    expect(userAudioOf(useUi.getState().prefs, 'dan')).toEqual({ volume: 1, muted: false });
    const saved = JSON.parse(localStorage.getItem(StorageKeys.ui) ?? '{}') as {
      state?: { prefs?: { userAudio?: unknown } };
    };
    expect(saved.state?.prefs?.userAudio).toEqual({ bob: { volume: 1.5 }, cat: { muted: true } });
  });

  it('clamps to 0-200% and forgets people back at the defaults', () => {
    setUserVolume('bob', 5);
    expect(userAudioOf(useUi.getState().prefs, 'bob').volume).toBe(2);
    setUserVolume('bob', -1);
    expect(userAudioOf(useUi.getState().prefs, 'bob').volume).toBe(0);
    setUserVolume('bob', 1);
    setUserMuted('cat', true);
    setUserMuted('cat', false);
    expect(useUi.getState().prefs.userAudio).toEqual({});
  });

  it('the gain: volume × output volume, nothing when muted for me or deafened, capped', () => {
    const prefs = {
      ...DEFAULT_PREFS,
      outputVolume: 1.5,
      userAudio: { bob: { volume: 2 }, cat: { muted: true } },
    };
    expect(voiceGain({ prefs, userId: 'bob', deafened: false, maxGain: 4 })).toBe(3);
    expect(voiceGain({ prefs, userId: 'bob', deafened: false, maxGain: 1 })).toBe(1);
    expect(voiceGain({ prefs, userId: 'dan', deafened: false, maxGain: 4 })).toBe(1.5);
    expect(voiceGain({ prefs, userId: 'cat', deafened: false, maxGain: 4 })).toBe(0);
    expect(voiceGain({ prefs, userId: 'bob', deafened: true, maxGain: 4 })).toBe(0);
  });

  it('applies to every participant: their voice at its gain, screen audio at the output volume', () => {
    const bob = participant('bob');
    const cat = participant('cat');
    const prefs = {
      ...DEFAULT_PREFS,
      outputVolume: 0.5,
      userAudio: { bob: { volume: 2 }, cat: { muted: true } },
    };
    applyVoiceGains([bob, cat], SOURCES, { prefs, deafened: false, maxGain: 4 });
    expect(bob.setVolume).toHaveBeenCalledWith(1, 'mic');
    expect(bob.setVolume).toHaveBeenCalledWith(0.5, 'screen');
    expect(cat.setVolume).toHaveBeenCalledWith(0, 'mic');
    expect(cat.setVolume).toHaveBeenCalledWith(0.5, 'screen');

    // Deafened: everything silent.
    applyVoiceGains([bob], SOURCES, { prefs, deafened: true, maxGain: 4 });
    expect(bob.setVolume).toHaveBeenLastCalledWith(0, 'screen');
    expect(bob.setVolume.mock.calls.slice(-2)).toEqual([
      [0, 'mic'],
      [0, 'screen'],
    ]);
  });
});
