/**
 * Realtime: space:sounds (a Space's soundboard) and voice:sound (play it) → soundboard store.
 *
 * - `space:sounds` (to the Space room) replaces that Space's list; leaving a Space drops it.
 * - `voice:sound` (to a voice channel's room: everyone who can see it) plays only when I am
 *   connected to that channel, never while I am deafened; the player's tile shows the emoji.
 * - Every `ready` marks the lists stale: the next look refetches them (the open Space Settings
 *   page and the open picker at once).
 */
import type { VoiceSoundEvent } from '@enbox/shared';
import type { AppSocket, ReadyInfo } from '@/lib/socket';
import { playSoundboardSound } from '@/features/soundboard/playback';
import { useSoundboard } from '@/stores/soundboard';
import { useVoice } from '@/stores/voice';
import { useVoiceSelf } from '@/stores/voiceSelf';

export function registerSoundboardHandlers(socket: AppSocket): void {
  const sb = () => useSoundboard.getState();
  socket.on('space:sounds', ({ spaceId, sounds }) => sb().applySpaceSounds(spaceId, sounds));
  socket.on('space:removed', ({ spaceId }) => sb().dropSpace(spaceId));
  socket.on('voice:sound', (p) => handleVoiceSound(p));
}

/** Someone played a sound in a voice channel (exported for tests). */
export function handleVoiceSound(p: VoiceSoundEvent): void {
  const c = useVoice.getState().connection;
  if (!c || c.channelId !== p.channelId) return;
  useSoundboard.getState().flash(p.userId, p.sound);
  if (useVoiceSelf.getState().deafened) return;
  playSoundboardSound(p.sound);
}

export async function resyncSoundboard(_info: ReadyInfo): Promise<void> {
  useSoundboard.getState().invalidate();
}
