/**
 * Realtime: Space events → spaces store (docs/design/spaces-at-scale.md "Realtime fan-out").
 * Channel messages, reads, typing and pins arrive as the usual chat/message events (the
 * server resolves a space channel's room to the members who can see it).
 */
import { LARGE_SPACE_THRESHOLD, type ID } from '@enbox/shared';
import { sendEvent, type AppSocket, type ReadyInfo } from '@/lib/socket';
import { useChats } from '@/stores/chats';
import { useMessages } from '@/stores/messages';
import { useSpaces } from '@/stores/spaces';

/** The space channel this device has open (re-sent after every `ready`). */
let focusedChannel: ID | null = null;
/** The Space whose member list is open (large Spaces send member events only to subscribers). */
let membersSpace: ID | null = null;

/** Tell the server which space channel is open (typing reaches open channels only). */
export function focusSpaceChannel(chatId: ID | null): void {
  if (focusedChannel === chatId) return;
  focusedChannel = chatId;
  sendEvent('space:focus', { chatId });
}

export function subscribeSpaceMembers(spaceId: ID | null): void {
  if (membersSpace === spaceId) return;
  membersSpace = spaceId;
  sendEvent('space:members-subscribe', { spaceId });
}

function jitterFor(spaceId: ID): number {
  const s = useSpaces.getState().byId[spaceId];
  // Spread refetch storms in large Spaces (thousands of clients at once).
  return s && s.memberCount > LARGE_SPACE_THRESHOLD ? 15_000 : 1_500;
}

export function registerSpaceHandlers(socket: AppSocket): void {
  const spaces = () => useSpaces.getState();

  socket.on('space:upsert', ({ space }) => {
    const prev = spaces().byId[space.id];
    spaces().upsertSpace(space);
    // Suppressing @everyone / role mentions changes the loaded channels' mention badges
    // (counted at read time): refetch them (this device already did when it made the change).
    if (
      prev &&
      spaces().channelsLoaded[space.id] &&
      (prev.me.suppressEveryone !== space.me.suppressEveryone || prev.me.suppressRoles !== space.me.suppressRoles)
    )
      spaces().refetchChannels(space.id, { jitterMs: 500 });
  });

  socket.on('space:removed', ({ spaceId }) => {
    const chatIds = Object.values(useChats.getState().byId)
      .filter((c) => c.space?.spaceId === spaceId)
      .map((c) => c.id);
    spaces().removeSpace(spaceId);
    for (const id of chatIds) useMessages.getState().dropChat(id);
  });

  socket.on('space:updated', ({ spaceId, changes }) => spaces().applySpaceUpdate(spaceId, changes));

  socket.on('space:channels-changed', ({ spaceId }) =>
    spaces().refetchChannels(spaceId, { jitterMs: jitterFor(spaceId) }),
  );

  socket.on('space:member-joined', ({ spaceId, member }) => spaces().upsertMembers(spaceId, [member]));
  socket.on('space:member-updated', ({ spaceId, member }) => spaces().upsertMembers(spaceId, [member]));
  socket.on('space:member-left', ({ spaceId, userId }) => spaces().removeMember(spaceId, userId));
}

/** On every `ready`: my Spaces, the channels of the Spaces already loaded, focus + subscriptions. */
export async function resyncSpaces(_info: ReadyInfo): Promise<void> {
  try {
    await useSpaces.getState().loadSpaces();
  } catch {
    return;
  }
  const { channelsLoaded, byId } = useSpaces.getState();
  await Promise.allSettled(
    Object.keys(channelsLoaded)
      .filter((id) => byId[id])
      .map((id) => useSpaces.getState().loadSpace(id)),
  );
  const focus = focusedChannel;
  const members = membersSpace;
  focusedChannel = null;
  membersSpace = null;
  if (focus) focusSpaceChannel(focus);
  if (members) subscribeSpaceMembers(members);
}
