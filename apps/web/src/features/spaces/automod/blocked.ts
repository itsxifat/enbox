/**
 * Sends AutoMod refused (`403 automod_blocked`): the message is never created, so its
 * optimistic copy goes and the composer shows Discord's "Only you can see this" notice with
 * the Space's message (AutoModBlockedNotice) instead of a failed bubble and a toast. One
 * notice per chat (the latest), until dismissed; cleared on logout.
 */
import { create } from 'zustand';
import { AUTOMOD_BLOCKED_CODE, type ID } from '@enbox/shared';
import { ApiError } from '@/lib/api';
import { registerSessionReset } from '@/lib/session';
import { useMessages } from '@/stores/messages';

export interface AutoModNotice {
  /** The Space's explanation (its custom message or the default one). */
  message: string;
  /** What I tried to send (to copy it back). */
  text: string | null;
  at: number;
}

interface AutoModNoticeState {
  byChat: Record<ID, AutoModNotice>;
  show(chatId: ID, notice: Omit<AutoModNotice, 'at'>): void;
  dismiss(chatId: ID): void;
}

export const useAutoModNotices = create<AutoModNoticeState>((set) => ({
  byChat: {},
  show: (chatId, notice) => set((s) => ({ byChat: { ...s.byChat, [chatId]: { ...notice, at: Date.now() } } })),
  dismiss: (chatId) =>
    set((s) => {
      if (!s.byChat[chatId]) return s;
      const byChat = { ...s.byChat };
      delete byChat[chatId];
      return { byChat };
    }),
}));

registerSessionReset(() => useAutoModNotices.setState({ byChat: {} }));

export function isAutoModBlocked(e: unknown): e is ApiError {
  return e instanceof ApiError && (e.code as string) === AUTOMOD_BLOCKED_CODE;
}

/**
 * A failed send: when AutoMod blocked it, drop the optimistic message and show the notice
 * (true); anything else is the caller's (false).
 */
export function handleAutoModBlock(chatId: ID, clientId: string, e: unknown): boolean {
  if (!isAutoModBlocked(e)) return false;
  const sent = useMessages.getState().byChat[chatId]?.items.find((m) => m.clientId === clientId);
  useMessages.getState().removeOptimistic(chatId, clientId);
  useAutoModNotices.getState().show(chatId, { message: e.message, text: sent?.text ?? null });
  return true;
}
