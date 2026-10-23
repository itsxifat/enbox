/**
 * Poll actions: vote with my answers (`[]` = Remove vote) and End Poll Now. The server's poll
 * goes to the store; a vote shows at once and is undone when refused (a poll that ended
 * meanwhile reads as closed until its update arrives).
 */
import type { ChatSummary, Message } from '@enbox/shared';
import { api, isApiError } from '@/lib/api';
import { getMyId } from '@/stores/auth';
import { useMessages, type ClientMessage } from '@/stores/messages';
import { confirm, toast } from '@/stores/ui';
import { isActionable } from '../../actions';
import { applyVote } from '../../lib/optimistic';
import { listsVoters, pollEnded } from './model';

/** `PUT /api/messages/:id/vote` with my answers; false when refused (or not possible). */
export async function castVote(
  chat: ChatSummary,
  m: ClientMessage,
  optionIds: string[],
): Promise<boolean> {
  const me = getMyId();
  if (!me || !m.poll || !isActionable(m) || chat.membership !== 'active') return false;
  if (pollEnded(m.poll)) return false;
  const before = m.poll;
  useMessages.getState().patchMessage(m.chatId, m.id, {
    poll: applyVote(before, optionIds, me, !listsVoters(chat)),
  });
  try {
    const updated = await api.put<Message>(`/api/messages/${m.id}/vote`, { optionIds });
    useMessages.getState().upsertMessage(updated, { onlyIfPresent: true });
    return true;
  } catch (e) {
    const ended = isApiError(e) && e.code === 'expired';
    useMessages.getState().patchMessage(m.chatId, m.id, {
      poll: ended ? { ...before, closedAt: before.closedAt ?? new Date().toISOString() } : before,
    });
    toast.error(e);
    return false;
  }
}

/** End Poll Now: asks first, then closes it for everyone (the result message follows). */
export async function endPoll(m: ClientMessage): Promise<void> {
  const ok = await confirm({
    title: 'End poll now?',
    message: 'No one will be able to vote after this, and the results will be posted in the chat.',
    confirmLabel: 'End Poll Now',
    danger: true,
  });
  if (!ok) return;
  try {
    const updated = await api.post<Message>(`/api/messages/${m.id}/poll/end`);
    useMessages.getState().upsertMessage(updated, { onlyIfPresent: true });
  } catch (e) {
    toast.error(e);
  }
}
