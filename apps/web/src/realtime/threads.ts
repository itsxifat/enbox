/**
 * Realtime: threads (Discord model) → threads + chats stores. Thread messages, reads and
 * typing arrive as the usual chat/message events (a thread's room is its channel's audience).
 *
 * - `thread:upsert` (viewer-neutral, to the channel's room): the thread's shared fields, its
 *   place in the Threads popout and the starter message's card; my read state stays and my
 *   permissions are recomputed (stores/threads.ts).
 * - `thread:deleted`: the thread, its messages and the card go; the panel on it closes.
 * - A channel's overwrites changed (`chat:updated { space }`): its threads take them (they
 *   are the parent's) and my bits in them are recomputed. Registered after the chats and
 *   Spaces handlers, so it runs once the channel itself is updated.
 * - A channel was deleted (`chat:removed`): its threads go with it.
 * Resync on every `ready`: the thread open in the panel and its latest page (other windows
 * were discarded by the chats resync); the popout lists reload when opened.
 */
import type { ID } from '@enbox/shared';
import type { AppSocket, ReadyInfo } from '@/lib/socket';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useMessages } from '@/stores/messages';
import { useSidePanel } from '@/stores/sidePanel';
import { useSpaces } from '@/stores/spaces';
import { NEW_THREAD_ID, threadView, useThreads } from '@/stores/threads';

/** A channel's overwrites changed: its loaded threads follow (permissions recomputed). */
export function syncThreadsOfChannel(parentId: ID): void {
  const chats = useChats.getState();
  const parent = chats.byId[parentId];
  if (!parent?.space) return;
  const space = useSpaces.getState().byId[parent.space.spaceId];
  const me = useAuth.getState().user?.id ?? '';
  for (const c of Object.values(chats.byId)) {
    if (c.thread?.parentId !== parentId || !c.space) continue;
    const next = { ...c, space: { ...c.space, overwrites: parent.space.overwrites } };
    const view = threadView(next, space, parent, me);
    chats.patchChat(c.id, { space: next.space, spacePermissions: view.bits, permissions: view.permissions });
  }
}

/** A channel is gone: drop its threads (and the panel on one of them). */
export function dropThreadsOf(parentId: ID): void {
  for (const c of Object.values(useChats.getState().byId))
    if (c.thread?.parentId === parentId) useThreads.getState().removeThread(c.id, parentId);
  const panel = useSidePanel.getState().panel;
  if (panel?.kind === 'thread' && panel.parentId === parentId) useSidePanel.getState().close();
}

export function registerThreadHandlers(socket: AppSocket): void {
  socket.on('thread:upsert', ({ thread }) => useThreads.getState().upsertThread(thread, { neutral: true }));
  socket.on('thread:deleted', ({ threadId, parentId }) => useThreads.getState().removeThread(threadId, parentId));
  socket.on('chat:updated', ({ chatId, changes }) => {
    if (changes.space) syncThreadsOfChannel(chatId);
  });
  socket.on('chat:removed', ({ chatId }) => dropThreadsOf(chatId));
}

export async function resyncThreads(_info: ReadyInfo): Promise<void> {
  useThreads.setState({ lists: {} });
  const panel = useSidePanel.getState().panel;
  if (panel?.kind !== 'thread' || panel.threadId === NEW_THREAD_ID) return;
  const id = panel.threadId;
  await Promise.allSettled([
    useChats.getState().refreshChat(id),
    useMessages.getState().loadLatest(id, { fresh: true }),
  ]);
}
