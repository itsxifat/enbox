import type { AppSocket, ReadyInfo } from '@/lib/socket';
import { playSound } from '@/lib/notify';
import { reannounceVoice, voiceEndedByServer, voiceMovedByServer } from '@/features/voice/engine';
import { useAuth } from '@/stores/auth';
import { useVoice } from '@/stores/voice';

/**
 * `voice:state` keeps everyone's voice states current; `voice:disconnected` ends mine;
 * `voice:moved` (a moderator dragged me) swaps my media room for the new channel's.
 */
export function registerVoiceHandlers(socket: AppSocket): void {
  socket.on('voice:state', (p) => {
    const before = useVoice.getState().byUser[p.userId]?.channelId;
    useVoice.getState().applyState(p);
    // Discord's join/leave chime for my own channel.
    const mine = useVoice.getState().connection;
    if (!mine || mine.status !== 'connected' || p.userId === useAuth.getState().user?.id) return;
    if (p.state && p.state.channelId === mine.channelId && before !== mine.channelId) playSound('sent');
    else if (!p.state && p.channelId === mine.channelId && before === mine.channelId) playSound('end');
  });
  socket.on('voice:disconnected', ({ channelId, reason }) => void voiceEndedByServer(channelId, reason));
  socket.on('voice:moved', ({ from, result }) => void voiceMovedByServer(from, result));
}

/** After every `ready`: re-announce my connection, then reload the states I show. */
export async function resyncVoice(_info: ReadyInfo): Promise<void> {
  await reannounceVoice();
  const spaces = Object.keys(useVoice.getState().loadedSpaces);
  await Promise.allSettled(spaces.map((id) => useVoice.getState().loadSpace(id, { force: true })));
}
