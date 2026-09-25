/**
 * Chat-level actions (chat list context menu, conversation menu): pin, archive, mute,
 * mark read/unread, clear, delete, exit group. Optimistic with rollback; the server's
 * `chat:upsert` / `chat:cleared` / `chat:removed` events confirm them.
 */
import {
  Archive,
  ArchiveRestore,
  Bell,
  BellOff,
  Eraser,
  LogOut,
  MailCheck,
  MailWarning,
  Pin,
  PinOff,
  Trash2,
} from 'lucide-react';
import {
  MAX_PINNED_CHATS,
  MUTE_FOREVER_ISO,
  isMuted,
  type ChatSummary,
  type UpdateChatPrefsRequest,
} from '@enbox/shared';
import type { MenuEntry } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { markChatRead } from '@/realtime/chats';
import { useChats } from '@/stores/chats';
import { useMessages } from '@/stores/messages';
import { choose, confirm, toast } from '@/stores/ui';
import { useDrafts } from './drafts';

async function patchPrefs(chat: ChatSummary, prefs: UpdateChatPrefsRequest): Promise<boolean> {
  const store = useChats.getState();
  const before = store.byId[chat.id];
  if (!before) return false;
  store.patchChat(chat.id, prefs as Partial<ChatSummary>);
  try {
    const updated = await api.patch<ChatSummary>(`/api/chats/${chat.id}/prefs`, prefs);
    if (updated) useChats.getState().upsertChat(updated);
    return true;
  } catch (e) {
    const cur = useChats.getState().byId[chat.id];
    if (cur) {
      const revert: Partial<ChatSummary> = {};
      for (const k of Object.keys(prefs) as (keyof UpdateChatPrefsRequest)[])
        (revert as Record<string, unknown>)[k] = before[k];
      useChats.getState().patchChat(chat.id, revert);
    }
    if (e instanceof ApiError && e.code === 'limit_reached')
      toast.error(`You can only pin up to ${MAX_PINNED_CHATS} chats`);
    else toast.error(e);
    return false;
  }
}

export function setPinned(chat: ChatSummary, isPinned: boolean): Promise<boolean> {
  if (isPinned) {
    const pinned = Object.values(useChats.getState().byId).filter(
      (c) => c.isPinned && c.type !== 'channel' && !c.isArchived,
    ).length;
    if (pinned >= MAX_PINNED_CHATS) {
      toast.error(`You can only pin up to ${MAX_PINNED_CHATS} chats`);
      return Promise.resolve(false);
    }
  }
  return patchPrefs(chat, { isPinned });
}

export async function setArchived(chat: ChatSummary, isArchived: boolean): Promise<void> {
  const ok = await patchPrefs(chat, isArchived ? { isArchived, isPinned: false } : { isArchived });
  if (ok)
    toast.info(isArchived ? 'Chat archived' : 'Chat unarchived', {
      id: `archive:${chat.id}`,
      action: {
        label: 'Undo',
        onClick: () => void patchPrefs(chat, { isArchived: !isArchived }),
      },
    });
}

export const MUTE_CHOICES = [
  { value: '8h', label: '8 hours', ms: 8 * 3600_000 },
  { value: '1w', label: '1 week', ms: 7 * 24 * 3600_000 },
  { value: 'always', label: 'Always', ms: 0 },
] as const;

export async function muteChat(chat: ChatSummary): Promise<void> {
  const choice = await choose({
    title: 'Mute notifications',
    message: 'Other members won’t see that you muted this chat.',
    options: MUTE_CHOICES.map((c) => ({ value: c.value, label: c.label })),
  });
  if (!choice) return;
  const opt = MUTE_CHOICES.find((c) => c.value === choice)!;
  const mutedUntil = opt.ms ? new Date(Date.now() + opt.ms).toISOString() : MUTE_FOREVER_ISO;
  await patchPrefs(chat, { mutedUntil });
}

export function unmuteChat(chat: ChatSummary): Promise<boolean> {
  return patchPrefs(chat, { mutedUntil: null });
}

export function markUnread(chat: ChatSummary): Promise<boolean> {
  return patchPrefs(chat, { markedUnread: true });
}

export function markRead(chat: ChatSummary): void {
  markChatRead(chat.id, { force: true });
}

export async function clearChat(chat: ChatSummary): Promise<boolean> {
  const ok = await confirm({
    title: 'Clear this chat?',
    message:
      'Messages will be removed from this chat on all your devices. Starred messages in it will be unstarred.',
    confirmLabel: 'Clear chat',
    danger: true,
  });
  if (!ok) return false;
  try {
    await api.post(`/api/chats/${chat.id}/clear`);
    useMessages.getState().clearChat(chat.id, chat.lastSeq);
    useChats
      .getState()
      .patchChat(chat.id, { lastMessage: null, unreadCount: 0, unreadMentionCount: 0 });
    return true;
  } catch (e) {
    toast.error(e);
    return false;
  }
}

/** Delete a chat for me (groups only after leaving). Resolves true when deleted. */
export async function deleteChat(chat: ChatSummary): Promise<boolean> {
  if (chat.type === 'group' && chat.membership === 'active') {
    toast.info('Exit the group before deleting it');
    return false;
  }
  const ok = await confirm({
    title: chat.type === 'group' ? 'Delete this group?' : 'Delete this chat?',
    message: 'Its messages will be removed from all your devices.',
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!ok) return false;
  try {
    await api.delete(`/api/chats/${chat.id}`);
    useChats.getState().removeChat(chat.id);
    useMessages.getState().dropChat(chat.id);
    useDrafts.getState().clearDraft(chat.id);
    return true;
  } catch (e) {
    toast.error(e);
    return false;
  }
}

export async function exitGroup(chat: ChatSummary): Promise<boolean> {
  const ok = await confirm({
    title: `Exit "${chat.name ?? 'group'}"?`,
    message: 'You will no longer receive messages from this group. Members will see that you left.',
    confirmLabel: 'Exit group',
    danger: true,
  });
  if (!ok) return false;
  try {
    await api.post(`/api/groups/${chat.id}/leave`);
    void useChats
      .getState()
      .refreshChat(chat.id)
      .catch(() => undefined);
    return true;
  } catch (e) {
    toast.error(e);
    return false;
  }
}

/** Context-menu entries for a chat row. `onDeleted` runs after a delete (e.g. navigate away). */
export function chatMenuItems(
  chat: ChatSummary,
  opts: { onDeleted?: () => void } = {},
): MenuEntry[] {
  const muted = isMuted(chat.mutedUntil);
  const unread = chat.unreadCount > 0 || chat.markedUnread;
  const group = chat.type === 'group';
  return [
    chat.isArchived
      ? {
          label: 'Unarchive chat',
          icon: ArchiveRestore,
          onSelect: () => void setArchived(chat, false),
        }
      : { label: 'Archive chat', icon: Archive, onSelect: () => void setArchived(chat, true) },
    muted
      ? { label: 'Unmute notifications', icon: Bell, onSelect: () => void unmuteChat(chat) }
      : { label: 'Mute notifications', icon: BellOff, onSelect: () => void muteChat(chat) },
    !chat.isArchived &&
      (chat.isPinned
        ? { label: 'Unpin chat', icon: PinOff, onSelect: () => void setPinned(chat, false) }
        : { label: 'Pin chat', icon: Pin, onSelect: () => void setPinned(chat, true) }),
    unread
      ? { label: 'Mark as read', icon: MailCheck, onSelect: () => markRead(chat) }
      : { label: 'Mark as unread', icon: MailWarning, onSelect: () => void markUnread(chat) },
    'separator',
    chat.lastMessage && { label: 'Clear chat', icon: Eraser, onSelect: () => void clearChat(chat) },
    group && chat.membership === 'active' && chat.permissions.canLeave
      ? { label: 'Exit group', icon: LogOut, danger: true, onSelect: () => void exitGroup(chat) }
      : !(group && chat.membership === 'active') && chat.type !== 'channel'
        ? {
            label: group ? 'Delete group' : 'Delete chat',
            icon: Trash2,
            danger: true,
            onSelect: () =>
              void deleteChat(chat).then((ok) => {
                if (ok) opts.onDeleted?.();
              }),
          }
        : null,
  ];
}
