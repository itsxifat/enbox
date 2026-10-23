/** Test helpers for scheduled events (unit tests only). */
import type { ChatSummary, SpaceEvent } from '@enbox/shared';
import { makeChat } from '@/test/factories';

export function makeEvent(p: Partial<SpaceEvent> = {}): SpaceEvent {
  return {
    id: 'e1',
    spaceId: 's1',
    channelId: 'v1',
    creatorId: 'owner',
    name: 'Movie night',
    description: null,
    entityType: 'voice',
    location: null,
    startAt: '2026-10-25T19:00:00.000Z',
    endAt: null,
    status: 'scheduled',
    imageUrl: null,
    interestedCount: 1,
    interested: false,
    ...p,
  };
}

/** A voice channel of Space s1 that I can see. */
export function makeVoiceChannel(p: Partial<ChatSummary> = {}): ChatSummary {
  const c = makeChat({ id: 'v1', name: 'Lounge', type: 'space_voice', spacePermissions: 0x7fffffff, ...p });
  return {
    ...c,
    space: {
      spaceId: 's1',
      categoryId: null,
      position: 0,
      topic: null,
      slowmodeSeconds: 0,
      nsfw: false,
      userLimit: null,
      bitrate: null,
      permissionsSynced: true,
      overwrites: [],
    },
  };
}
