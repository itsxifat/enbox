/**
 * What the built-in commands that don't send a message do (commands.ts): `/nick` sets my
 * nickname in the chat's Space (`PATCH /api/spaces/:id/members/me`; CHANGE_NICKNAME, the
 * server answers 403 without it), `/thread` starts a thread in the text channel and opens it
 * beside the channel (`POST /api/chats/:chatId/threads`). Failures become toasts.
 */
import { NICKNAME_MAX_LENGTH, THREAD_NAME_MAX_LENGTH, type ChatSummary } from '@enbox/shared';
import { api } from '@/lib/api';
import { updateMyMember } from '@/features/spaces/actions';
import { openThread } from '@/features/threads/actions';
import { useThreads } from '@/stores/threads';
import { toast } from '@/stores/ui';

/** `/nick [name]`: my nickname in the chat's Space; empty resets it. */
export async function setNickname(chat: ChatSummary, name: string): Promise<void> {
  const spaceId = chat.space?.spaceId;
  if (!spaceId) return;
  if (name.length > NICKNAME_MAX_LENGTH) {
    toast.error(`Nicknames can be up to ${NICKNAME_MAX_LENGTH} characters`);
    return;
  }
  try {
    await updateMyMember(spaceId, { nickname: name || null });
    toast.success(name ? `Your nickname is now “${name}”` : 'Your nickname was reset', {
      id: 'slash-nick',
    });
  } catch (e) {
    toast.error(e);
  }
}

/** `/thread <name>`: a new thread of the channel, opened beside it. */
export async function startThread(chat: ChatSummary, name: string): Promise<void> {
  if (name.length > THREAD_NAME_MAX_LENGTH) {
    toast.error(`Thread names can be up to ${THREAD_NAME_MAX_LENGTH} characters`);
    return;
  }
  try {
    const thread = await api.post<ChatSummary>(`/api/chats/${chat.id}/threads`, { name });
    useThreads.getState().upsertThread(thread);
    openThread(thread.id, chat.id);
  } catch (e) {
    toast.error(e);
  }
}
