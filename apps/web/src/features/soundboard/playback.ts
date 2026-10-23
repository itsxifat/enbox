/**
 * Soundboard playback. A played sound is not mixed into anyone's microphone: the server sends
 * `voice:sound` to the channel and every client connected there plays the clip itself, through
 * an `Audio` element at the sound's volume × my soundboard volume (Settings → Voice). Previews
 * (the picker's speaker button, Space Settings) play the same way, only here.
 */
import type { SpaceSound } from '@enbox/shared';
import { mediaUrl } from '@/lib/api';
import { useSoundboard } from '@/stores/soundboard';

/** The volume `sound` plays at on this device (0..1). */
export function soundVolume(
  sound: Pick<SpaceSound, 'volume'>,
  mine: number = useSoundboard.getState().volume,
): number {
  return Math.min(1, Math.max(0, sound.volume * mine));
}

/** Play a clip at `volume` (nothing at 0). Returns the element, e.g. to stop a preview. */
export function playClip(src: string, volume: number): HTMLAudioElement | null {
  if (!(volume > 0)) return null;
  const el = new Audio(src);
  el.volume = Math.min(1, volume);
  // Autoplay may be refused before the first click on the page: nothing to do then.
  void el.play()?.catch(() => undefined);
  return el;
}

/** Play a Space's sound here (an incoming `voice:sound`, or a preview). */
export function playSoundboardSound(sound: Pick<SpaceSound, 'url' | 'volume'>): HTMLAudioElement | null {
  const src = mediaUrl(sound.url);
  return src ? playClip(src, soundVolume(sound)) : null;
}
