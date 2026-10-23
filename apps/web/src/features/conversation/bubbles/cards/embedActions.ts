/**
 * "Remove all embeds" (Discord's X on an embed): `PATCH /api/messages/:id/suppress-embeds`
 * sets MESSAGE_FLAGS.SUPPRESS_EMBEDS for everyone (`message:updated`). Allowed for the author
 * — a broadcast channel's admins for its posts — and for MANAGE_MESSAGES in a Space channel.
 * One confirmation, none with Shift held; applied at once and undone if the server refuses.
 */
import {
  MESSAGE_FLAGS,
  PERM,
  hasMessageFlag,
  hasPerm,
  isSpaceChatType,
  type ChatSummary,
  type ID,
  type Message,
} from '@enbox/shared';
import { api } from '@/lib/api';
import { useMessages, type ClientMessage } from '@/stores/messages';
import { confirm, toast } from '@/stores/ui';
import { isActionable } from '../../actions';

/** Whether `me` may remove the embeds of `m` (and it still has them). */
export function canRemoveEmbeds(
  chat: ChatSummary,
  m: ClientMessage,
  me: ID | null | undefined,
): boolean {
  if (!isActionable(m) || m.deletedAt || m.type === 'system' || m.type === 'call') return false;
  if (chat.membership !== 'active' || hasMessageFlag(m.flags, MESSAGE_FLAGS.SUPPRESS_EMBEDS))
    return false;
  if (chat.type === 'channel') return chat.permissions.canSend;
  if (me && m.senderId === me) return true;
  return isSpaceChatType(chat.type) && hasPerm(chat.spacePermissions, PERM.MANAGE_MESSAGES);
}

export async function removeEmbeds(
  chat: ChatSummary,
  m: ClientMessage,
  opts: { shift?: boolean } = {},
): Promise<void> {
  if (
    !opts.shift &&
    !(await confirm({
      title: 'Remove all embeds?',
      message:
        'This removes all embeds on this message for everyone. Tip: hold Shift when you click the X to skip this.',
      confirmLabel: 'Remove all embeds',
      danger: true,
    }))
  )
    return;
  const store = useMessages.getState();
  const before = m.flags;
  store.patchMessage(chat.id, m.id, { flags: (before ?? 0) | MESSAGE_FLAGS.SUPPRESS_EMBEDS });
  try {
    const updated = await api.patch<Message>(`/api/messages/${m.id}/suppress-embeds`, {
      suppress: true,
    });
    useMessages.getState().upsertMessage(updated, { onlyIfPresent: true });
  } catch (e) {
    useMessages.getState().patchMessage(chat.id, m.id, { flags: before });
    toast.error(e);
  }
}
