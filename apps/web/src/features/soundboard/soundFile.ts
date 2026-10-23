/**
 * Checking a clip before it is uploaded as a sound: MP3, OGG or WAV (the server sniffs the
 * bytes and decides; this catches the obvious), at most MAX_SOUND_BYTES and — measured here
 * from the audio metadata, the server does not decode audio — at most MAX_SOUND_DURATION_MS.
 */
import { MAX_SOUND_BYTES, MAX_SOUND_DURATION_MS, formatBytes } from '@enbox/shared';
import { readAudioDuration } from '@/lib/media';

/** The file picker's filter. */
export const SOUND_ACCEPT = '.mp3,.ogg,.oga,.wav,audio/mpeg,audio/ogg,audio/wav';

const SOUND_TYPES = new Set(['audio/mpeg', 'audio/mp3', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave']);
const SOUND_EXTENSIONS = /\.(mp3|ogg|oga|wav)$/i;

export type SoundFileCheck = { ok: true; durationMs: number } | { ok: false; error: string };

export async function checkSoundFile(file: File): Promise<SoundFileCheck> {
  if (!SOUND_TYPES.has(file.type) && !SOUND_EXTENSIONS.test(file.name))
    return { ok: false, error: 'Choose an MP3, OGG or WAV file.' };
  if (file.size > MAX_SOUND_BYTES)
    return { ok: false, error: `Sounds can be at most ${formatBytes(MAX_SOUND_BYTES)}.` };
  let durationMs: number;
  try {
    durationMs = await readAudioDuration(file);
  } catch {
    return { ok: false, error: 'This file can’t be played. Try another one.' };
  }
  if (!(durationMs > 0)) return { ok: false, error: 'This file can’t be played. Try another one.' };
  if (durationMs > MAX_SOUND_DURATION_MS)
    return { ok: false, error: `Sounds can be at most ${MAX_SOUND_DURATION_MS / 1000} seconds long.` };
  return { ok: true, durationMs };
}

/** A sound's default name from its file: the base name, tidied, 2-32 characters. */
export function soundNameFromFile(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  const name = base.slice(0, 32).trim();
  return name.length >= 2 ? name : 'New sound';
}
