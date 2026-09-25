/**
 * Chat members cache for the conversation (header subtitle "Maya, Leo, You", @mention
 * suggestions). Loaded only when `permissions.canViewMembers`; refetched on
 * `chat:members-changed`.
 */
import { useEffect } from 'react';
import { create } from 'zustand';
import type { ChatMember, ChatSummary, ID } from '@enbox/shared';
import { api } from '@/lib/api';
import { bus } from '@/lib/bus';
import { registerSessionReset } from '@/lib/session';
import { useUsers } from '@/stores/users';

interface MembersState {
  byChat: Record<ID, ChatMember[] | undefined>;
  load(chatId: ID, opts?: { force?: boolean }): Promise<void>;
}

const inflight = new Map<ID, Promise<void>>();

export const useChatMembersStore = create<MembersState>((set, get) => ({
  byChat: {},
  load(chatId, { force = false } = {}) {
    if (!force && get().byChat[chatId]) return Promise.resolve();
    const pending = inflight.get(chatId);
    if (pending) return pending;
    const p = api
      .get<ChatMember[]>(`/api/chats/${chatId}/members`)
      .then((members) => {
        useUsers.getState().upsertUsers(members.map((m) => m.user));
        set((s) => ({ byChat: { ...s.byChat, [chatId]: members } }));
      })
      .catch(() => undefined)
      .finally(() => inflight.delete(chatId));
    inflight.set(chatId, p);
    return p;
  },
}));

bus.on('chat:members-changed', ({ chatId }) => {
  if (useChatMembersStore.getState().byChat[chatId])
    void useChatMembersStore.getState().load(chatId, { force: true });
});
bus.on('realtime:ready', () => {
  // Memberships may have changed while offline: drop the cache (reloaded on demand).
  useChatMembersStore.setState({ byChat: {} });
});

registerSessionReset(() => {
  inflight.clear();
  useChatMembersStore.setState({ byChat: {} });
});

/** Active members of a group/direct chat (undefined until loaded or when not allowed). */
export function useChatMembers(
  chat: Pick<ChatSummary, 'id' | 'type' | 'permissions' | 'membership' | 'memberCount'> | undefined,
): ChatMember[] | undefined {
  const id = chat?.id;
  const allowed =
    !!chat &&
    chat.type !== 'channel' &&
    chat.permissions.canViewMembers &&
    chat.membership === 'active';
  const members = useChatMembersStore((s) => (id ? s.byChat[id] : undefined));
  const memberCount = chat?.memberCount;
  useEffect(() => {
    if (id && allowed && !members) void useChatMembersStore.getState().load(id);
  }, [id, allowed, members]);
  // Member count changed (someone joined/left) → refresh the cached list.
  useEffect(() => {
    if (!id || !allowed) return;
    const cached = useChatMembersStore.getState().byChat[id];
    if (cached && memberCount !== undefined && cached.length !== memberCount)
      void useChatMembersStore.getState().load(id, { force: true });
  }, [id, allowed, memberCount]);
  return allowed ? members : undefined;
}
