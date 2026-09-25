import type { ChatSummary } from '@enbox/shared';

/**
 * Whether a call log entry's chat can be called back: the chat is still in my list, I'm an
 * active member and `permissions.canCall` (no deleted or blocked peer, not a group I left).
 * Otherwise the call buttons are hidden instead of failing with "You can't call this chat".
 */
export function canCallBack(chat: ChatSummary | undefined): boolean {
  return (
    !!chat &&
    chat.type !== 'channel' &&
    chat.membership === 'active' &&
    chat.permissions.canCall &&
    !chat.peer?.isDeleted
  );
}
