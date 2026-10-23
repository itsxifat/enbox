/** Test helpers of the Server Guide, Browse Channels and Channels & Roles (unit tests only). */
import type { ChatSummary, ID, SpaceChannelInfo } from '@enbox/shared';
import { makeChat } from '@/test/factories';
import { useChats } from '@/stores/chats';
import { useSpaces } from '@/stores/spaces';
import { makeSpace } from '@/features/spaces/testUtils';

/** A channel of Space `s1` (a text channel unless `type` says otherwise). */
export function spaceChannel(
  id: ID,
  name: string,
  p: Partial<ChatSummary> = {},
  info: Partial<SpaceChannelInfo> = {},
): ChatSummary {
  return makeChat({
    id,
    name,
    type: 'space_text',
    spacePermissions: 1,
    ...p,
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
      ...info,
    },
  });
}

/** Space `s1` (me: `me`) with these channels loaded. */
export function seedSpace(
  p: Parameters<typeof makeSpace>[0] = {},
  channels: readonly ChatSummary[] = [],
): ReturnType<typeof makeSpace> {
  const space = makeSpace({ id: 's1', name: 'Rocket Club', ...p });
  useSpaces.setState({
    byId: { s1: space },
    order: ['s1'],
    loaded: true,
    channelsLoaded: { s1: true },
    members: {},
  });
  useChats.setState({ byId: Object.fromEntries(channels.map((c) => [c.id, c])) });
  return space;
}
