/**
 * Thread entry points shared by the message menu, the starter card, the sidebar and the
 * Threads popout: open a thread in the panel, start one from a message, copy its link.
 */
import { MessagesSquare } from 'lucide-react';
import { PERM, hasPerm, type ChatSummary, type ID, type Message } from '@enbox/shared';
import type { MenuEntry } from '@/components/ui';
import { toast } from '@/stores/ui';
import { copyText } from '@/features/groups/shared/share';
import type { ClientMessage } from '@/stores/messages';
import { useThreads } from '@/stores/threads';

/** Whether a thread can be started from this message (a confirmed one of a text channel I can write in). */
export function canStartThread(chat: ChatSummary, m: ClientMessage): boolean {
  return (
    chat.type === 'space_text' &&
    !chat.thread &&
    chat.membership === 'active' &&
    hasPerm(chat.spacePermissions, PERM.SEND_MESSAGES) &&
    m.seq > 0 &&
    !m.pending &&
    !m.failed &&
    !m.deletedAt &&
    m.type !== 'system' &&
    m.type !== 'call' &&
    !m.thread
  );
}

/** Open a thread beside its channel. */
export function openThread(threadId: ID, parentId: ID, starter?: Message | null): void {
  useThreads.getState().openThread({ id: threadId, parentId }, starter ?? null);
}

/** "New Thread" from a message (the panel asks for the name; the first message creates it). */
export function startThreadFromMessage(chat: Pick<ChatSummary, 'id'>, m: Message): void {
  useThreads.getState().startDraft(chat.id, m);
}

/** The message menu's thread item: Open Thread when the message has one, else Create Thread. */
export function threadMessageAction(chat: ChatSummary, m: ClientMessage): MenuEntry {
  if (m.thread && chat.type === 'space_text')
    return { label: 'Open Thread', icon: MessagesSquare, onSelect: () => openThread(m.thread!.id, chat.id, m) };
  if (!canStartThread(chat, m)) return null;
  return { label: 'Create Thread', icon: MessagesSquare, onSelect: () => startThreadFromMessage(chat, m) };
}

/** `/spaces/:spaceId/:channelId?thread=:threadId` (opens the thread beside its channel). */
export function threadLink(spaceId: ID, parentId: ID, threadId: ID): string {
  return `${location.origin}/spaces/${spaceId}/${parentId}?thread=${threadId}`;
}

export function copyThreadLink(spaceId: ID, parentId: ID, threadId: ID): void {
  void copyText(threadLink(spaceId, parentId, threadId)).then((ok) =>
    ok ? toast.success('Link copied') : toast.error('Could not copy'),
  );
}
