/**
 * Realtime: communities — OWNED BY FEATURE AGENT 3 (groups / communities / channels).
 *
 * `community:upsert` replaces my copy of a community (viewer-specific); `community:removed`
 * drops it (left, removed, deactivated). On every `ready` the list is reloaded when it was
 * loaded before (the socket never replays missed events).
 */
import type { AppSocket, ReadyInfo } from '@/lib/socket';
import { useCommunities } from '@/stores/communities';

export function registerCommunityHandlers(socket: AppSocket): void {
  socket.on('community:upsert', ({ community }) => {
    useCommunities.getState().upsertCommunity(community);
  });
  socket.on('community:removed', ({ communityId }) => {
    useCommunities.getState().removeCommunity(communityId);
  });
}

export async function resyncCommunities(_info: ReadyInfo): Promise<void> {
  if (useCommunities.getState().loaded) {
    await useCommunities
      .getState()
      .loadCommunities()
      .catch(() => undefined);
  }
}
