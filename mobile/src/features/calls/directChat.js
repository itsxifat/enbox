import { api } from '@/lib/api';
import { useChats } from '@/stores/chats';

/** The active direct chat with `userId`, created (idempotently) with `POST /api/chats/direct` if needed. */
export async function ensureDirectChat(userId) {
  const existing = Object.values(useChats.getState().byId).find(
    (c) => c.type === 'direct' && c.peer?.id === userId && c.membership === 'active',
  );
  if (existing) return existing;
  const chat = await api.post('/api/chats/direct', {
    userId,
  });
  useChats.getState().upsertChat(chat);
  return chat;
}
