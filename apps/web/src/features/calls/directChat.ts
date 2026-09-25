import type { ChatSummary, ID } from '@enbox/shared';
import { api, type ApiResponse } from '@/lib/api';
import { useChats } from '@/stores/chats';

/** The active direct chat with `userId`, created (idempotently) with `POST /api/chats/direct` if needed. */
export async function ensureDirectChat(userId: ID): Promise<ChatSummary> {
  const existing = Object.values(useChats.getState().byId).find(
    (c) => c.type === 'direct' && c.peer?.id === userId && c.membership === 'active',
  );
  if (existing) return existing;
  const chat = await api.post<ApiResponse<'POST /api/chats/direct'>>('/api/chats/direct', {
    userId,
  });
  useChats.getState().upsertChat(chat);
  return chat;
}
