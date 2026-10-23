/**
 * How I hear people in voice channels, on this device (`DevicePrefs.userAudio`, by user id):
 * their volume (0-200%, Discord's "User Volume") and a mute only I hear. With my output
 * volume and deafen it makes the gain each voice plays at (`voiceGain`); the voice engine
 * applies it to the media room's participants (`applyVoiceGains`).
 */
import { useUi, type DevicePrefs, type UserAudioPref } from '@/stores/ui';

/** User and output volumes go up to 200%. */
export const VOLUME_MAX = 2;

export interface UserAudio {
  volume: number;
  muted: boolean;
}

const clamp = (v: number, max: number) => Math.min(max, Math.max(0, Number.isFinite(v) ? v : 1));

export function userAudioOf(prefs: Pick<DevicePrefs, 'userAudio'>, userId: string): UserAudio {
  const p = prefs.userAudio[userId];
  return { volume: clamp(p?.volume ?? 1, VOLUME_MAX), muted: !!p?.muted };
}

/** Someone's audio prefs (a component re-renders when they change). */
export function useUserAudio(userId: string): UserAudio {
  const pref = useUi((s) => s.prefs.userAudio[userId]);
  return { volume: clamp(pref?.volume ?? 1, VOLUME_MAX), muted: !!pref?.muted };
}

function update(userId: string, patch: UserAudioPref): void {
  const { prefs, setPref } = useUi.getState();
  const next: UserAudioPref = { ...prefs.userAudio[userId], ...patch };
  const map = { ...prefs.userAudio };
  // Back to the defaults: forget them (the map holds only people I changed).
  if ((next.volume ?? 1) === 1 && !next.muted) delete map[userId];
  else map[userId] = next;
  setPref('userAudio', map);
}

/** Someone's volume for me, 0-2 (1 = as they send it). */
export function setUserVolume(userId: string, volume: number): void {
  update(userId, { volume: Math.round(clamp(volume, VOLUME_MAX) * 100) / 100 });
}

/** Mute someone for me only (Discord's local "Mute"). */
export function setUserMuted(userId: string, muted: boolean): void {
  update(userId, { muted });
}

/**
 * The gain someone's voice plays at: nothing while I am deafened or muted them, else their
 * volume × my output volume, up to `maxGain` (1 where audio plays through media elements,
 * which cannot go louder than as sent).
 */
export function voiceGain(o: {
  prefs: Pick<DevicePrefs, 'userAudio' | 'outputVolume'>;
  userId: string;
  deafened: boolean;
  maxGain: number;
}): number {
  if (o.deafened) return 0;
  const user = userAudioOf(o.prefs, o.userId);
  if (user.muted) return 0;
  return clamp(user.volume * clamp(o.prefs.outputVolume, VOLUME_MAX), o.maxGain);
}

/**
 * Set every participant's voice (`sources.voice`) to its gain; their screen share audio
 * (`sources.stream`) follows my output volume and deafen only — someone's volume and mute are
 * about their voice. Participants are LiveKit's `RemoteParticipant`s.
 */
export function applyVoiceGains<S>(
  participants: Iterable<{ identity: string; setVolume(volume: number, source?: S): void }>,
  sources: { voice: S; stream: S },
  o: { prefs: Pick<DevicePrefs, 'userAudio' | 'outputVolume'>; deafened: boolean; maxGain: number },
): void {
  const stream = o.deafened ? 0 : clamp(clamp(o.prefs.outputVolume, VOLUME_MAX), o.maxGain);
  for (const p of participants) {
    p.setVolume(voiceGain({ ...o, userId: p.identity }), sources.voice);
    p.setVolume(stream, sources.stream);
  }
}
