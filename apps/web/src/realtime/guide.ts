/**
 * Realtime: space:guide and me:channel-prefs (Server Guide, Browse Channels) → my copy of the
 * Space. To-do progress and onboarding answers come with `space:upsert` (realtime/spaces.ts);
 * every `ready` reloads my Spaces, guides and channel choices included, so there is nothing
 * of its own to resync.
 */
import type { AppSocket, ReadyInfo } from '@/lib/socket';
import { receiveChannelPrefs, setSpaceGuide } from '@/features/guide/actions';

export function registerGuideHandlers(socket: AppSocket): void {
  socket.on('space:guide', ({ spaceId, guide }) => setSpaceGuide(spaceId, guide));
  // My choices from another device (or the echo of my own save): unsent ones stay on top.
  socket.on('me:channel-prefs', ({ spaceId, prefs }) => receiveChannelPrefs(spaceId, prefs));
}

export async function resyncGuide(_info: ReadyInfo): Promise<void> {}
