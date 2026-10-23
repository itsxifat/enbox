/**
 * Discord's keys on a focused message (features/a11y/rowKeys.ts reads them): E edits mine, R
 * replies, Backspace / Delete deletes (asking first; mine, or with the rights), P pins or
 * unpins (with the rights), + or = opens Add Reaction and Ctrl/Cmd+C copies the text. The
 * message menu's actions and rules (actions.ts, moreActions.ts); nothing in select mode.
 * Returns whether the key did something.
 */
import type { ChatSummary } from '@enbox/shared';
import type { RowAction } from '@/features/a11y/rowKeys';
import { useChats } from '@/stores/chats';
import type { ClientMessage } from '@/stores/messages';
import {
  canEdit,
  canPinMessage,
  canReact,
  canReply,
  copyMessages,
  copyText,
  pinMessage,
  startEdit,
  startReply,
  unpinMessage,
} from '../actions';
import { canDeleteMessage, deleteMessage } from '../moreActions';
import { useConversationUi } from '../state';
import { openAddReaction } from './addReaction';

export function runMessageKey(chat: ChatSummary, m: ClientMessage, action: RowAction): boolean {
  if (useConversationUi.getState().selecting[chat.id] !== undefined) return false;
  switch (action) {
    case 'edit':
      if (!canEdit(chat, m)) return false;
      startEdit(chat, m);
      return true;
    case 'reply':
      if (!canReply(chat, m)) return false;
      startReply(chat, m);
      return true;
    case 'delete':
      if (!canDeleteMessage(chat, m)) return false;
      void deleteMessage(chat, m);
      return true;
    case 'pin': {
      if (!canPinMessage(chat, m)) return false;
      const pinned = !!useChats.getState().pins[chat.id]?.includes(m.id);
      void (pinned ? unpinMessage(chat, m.id) : pinMessage(chat, m));
      return true;
    }
    case 'react':
      return canReact(chat, m) && openAddReaction(m.id);
    case 'copy':
      if (!copyText(m)) return false;
      void copyMessages([m]);
      return true;
  }
}
