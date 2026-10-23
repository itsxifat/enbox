/**
 * Thread entry points shared by the message menu, the starter card, the sidebar and the
 * Threads popout: open a thread in the panel, start one from a message, copy its link; and
 * the "…" menu items a thread's panel and a forum's post cards share.
 */
import {
  Archive,
  ArchiveRestore,
  BellOff,
  BellPlus,
  Lock,
  LockOpen,
  MessagesSquare,
  Pencil,
  Pin,
  PinOff,
  Trash2,
} from 'lucide-react';
import {
  PERM,
  hasPerm,
  type ChatSummary,
  type ID,
  type Message,
  type UpdateThreadRequest,
} from '@enbox/shared';
import type { MenuEntry, MenuItem } from '@/components/ui';
import { confirm, toast } from '@/stores/ui';
import { copyText } from '@/features/groups/shared/share';
import type { ClientMessage } from '@/stores/messages';
import { threadRights, useThreads } from '@/stores/threads';

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

function updateThread(threadId: ID, patch: UpdateThreadRequest): void {
  void useThreads
    .getState()
    .updateThread(threadId, patch)
    .catch((e: unknown) => toast.error(e));
}

/**
 * The "…" menu items a thread and a forum post share, as my rights allow (`threadRights`):
 * Follow / Unfollow, Archive / Unarchive (a post: Close / Reopen), Lock / Unlock, Pin / Unpin
 * (posts) and the rename (`onRename`: Edit Thread Name, a post's Edit Title). Failures toast.
 */
export function threadMenuItems(
  thread: ChatSummary,
  me: ID | undefined,
  opts: { post: boolean; onRename: () => void },
): MenuEntry[] {
  const { post } = opts;
  const noun = post ? 'Post' : 'Thread';
  const rights = threadRights(thread, me, { post });
  const info = thread.thread;
  const following = !!info?.following;
  return [
    thread.membership === 'active' && {
      label: `${following ? 'Unfollow' : 'Follow'} ${noun}`,
      icon: following ? BellOff : BellPlus,
      onSelect: () =>
        void useThreads
          .getState()
          .setFollowing(thread.id, !following)
          .catch((e: unknown) => toast.error(e)),
    },
    rights.canEdit &&
      (info?.archived
        ? {
            label: post ? 'Reopen Post' : 'Unarchive Thread',
            icon: ArchiveRestore,
            onSelect: () => updateThread(thread.id, { archived: false }),
          }
        : {
            label: post ? 'Close Post' : 'Archive Thread',
            icon: Archive,
            onSelect: () => updateThread(thread.id, { archived: true }),
          }),
    rights.canLock &&
      (info?.locked
        ? { label: `Unlock ${noun}`, icon: LockOpen, onSelect: () => updateThread(thread.id, { locked: false }) }
        : { label: `Lock ${noun}`, icon: Lock, onSelect: () => updateThread(thread.id, { locked: true }) }),
    rights.canPin &&
      (info?.pinned
        ? { label: 'Unpin Post', icon: PinOff, onSelect: () => updateThread(thread.id, { pinned: false }) }
        : { label: 'Pin Post', icon: Pin, onSelect: () => updateThread(thread.id, { pinned: true }) }),
    rights.canEdit && { label: post ? 'Edit Title' : 'Edit Thread Name', icon: Pencil, onSelect: opts.onRename },
  ];
}

/** Delete Thread / Delete Post, after a confirmation (its messages go with it). */
export function deleteThreadItem(thread: ChatSummary, noun: 'Post' | 'Thread'): MenuItem {
  return {
    label: `Delete ${noun}`,
    icon: Trash2,
    danger: true,
    onSelect: () =>
      void confirm({
        title: `Delete ${noun}`,
        message: `Are you sure you want to delete ${thread.name ?? `this ${noun.toLowerCase()}`}? Its messages go with it. This can’t be undone.`,
        confirmLabel: `Delete ${noun}`,
        danger: true,
      }).then(
        (ok) =>
          ok &&
          void useThreads
            .getState()
            .deleteThread(thread.id)
            .catch((e: unknown) => toast.error(e)),
      ),
  };
}
