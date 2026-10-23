/**
 * Realtime: chat:request / chat:request-removed (message requests, stores/requests.ts).
 *
 * A request has no chat room (nothing joins it until it is accepted), so `chat:request` is
 * also how an open request shows a new message: its `lastMessage` goes into the loaded
 * window. Requests are reloaded on every `ready`, and when my blocks change (a blocked
 * person's requests leave the list).
 */
import { bus } from '@/lib/bus';
import type { AppSocket, ReadyInfo } from '@/lib/socket';
import { useChats } from '@/stores/chats';
import { useMessages } from '@/stores/messages';
import { useRequests } from '@/stores/requests';
import { useUsers } from '@/stores/users';

let offBlocks: (() => void) | null = null;

export function registerRequestsHandlers(socket: AppSocket): void {
  socket.on('chat:request', ({ chat }) => {
    // Accepted meanwhile (its chat:upsert came first): this one is stale.
    if (useChats.getState().byId[chat.id]) return;
    useRequests.getState().upsert(chat);
    if (chat.peer) useUsers.getState().upsertUsers([chat.peer]);
    if (chat.lastMessage) useMessages.getState().upsertMessage(chat.lastMessage);
  });

  socket.on('chat:request-removed', ({ chatId }) => {
    useRequests.getState().removed(chatId);
  });

  offBlocks?.();
  offBlocks = bus.on('blocks:changed', () => {
    if (Object.keys(useRequests.getState().byId).length) void useRequests.getState().load();
  });
}

export async function resyncRequests(_info: ReadyInfo): Promise<void> {
  await useRequests.getState().load();
}
