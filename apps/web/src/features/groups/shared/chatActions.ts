/**
 * REST actions for groups/channels/chats used by agent-3 screens. Every action applies the
 * response to the stores right away (the matching socket events arrive later and merge
 * idempotently).
 */
import {
  MUTE_FOREVER_ISO,
  type AddMembersResult,
  type ChatMember,
  type ChatSummary,
  type CreateGroupRequest,
  type ID,
  type UpdateGroupRequest,
  type UpdateGroupSettingsRequest,
} from '@enbox/shared';
import { api } from '@/lib/api';
import { useChats } from '@/stores/chats';
import { useMessages } from '@/stores/messages';
import { useUsers } from '@/stores/users';

const chats = () => useChats.getState();

function upsert(chat: ChatSummary): ChatSummary {
  chats().upsertChat(chat);
  return chat;
}

// --- Groups -----------------------------------------------------------------

export async function createGroup(body: CreateGroupRequest): Promise<AddMembersResult> {
  const r = await api.post<AddMembersResult>('/api/groups', body);
  upsert(r.chat);
  return r;
}

export async function updateGroup(chatId: ID, body: UpdateGroupRequest): Promise<ChatSummary> {
  return upsert(await api.patch<ChatSummary>(`/api/groups/${chatId}`, body));
}

export async function updateGroupSettings(
  chatId: ID,
  body: UpdateGroupSettingsRequest,
): Promise<ChatSummary> {
  return upsert(await api.patch<ChatSummary>(`/api/groups/${chatId}/settings`, body));
}

export async function addGroupMembers(chatId: ID, userIds: ID[]): Promise<AddMembersResult> {
  const r = await api.post<AddMembersResult>(`/api/groups/${chatId}/members`, { userIds });
  upsert(r.chat);
  return r;
}

export async function removeGroupMember(chatId: ID, userId: ID): Promise<void> {
  await api.delete(`/api/groups/${chatId}/members/${userId}`);
}

export async function setGroupRole(
  chatId: ID,
  userId: ID,
  role: 'admin' | 'member',
): Promise<void> {
  await api.put(`/api/groups/${chatId}/members/${userId}/role`, { role });
}

export async function transferGroupOwnership(chatId: ID, userId: ID): Promise<void> {
  await api.post(`/api/groups/${chatId}/transfer-ownership`, { userId });
  await chats().refreshChat(chatId);
}

export async function leaveGroup(chatId: ID): Promise<void> {
  await api.post(`/api/groups/${chatId}/leave`);
  await chats()
    .refreshChat(chatId)
    .catch(() => undefined);
}

export async function getGroupInvite(chatId: ID): Promise<{ code: string }> {
  const r = await api.get<{ code: string }>(`/api/groups/${chatId}/invite`);
  chats().patchChat(chatId, { inviteCode: r.code });
  return r;
}

export async function resetGroupInvite(chatId: ID): Promise<{ code: string }> {
  const r = await api.post<{ code: string }>(`/api/groups/${chatId}/invite/reset`);
  chats().patchChat(chatId, { inviteCode: r.code });
  return r;
}

// --- Any chat ----------------------------------------------------------------

/** Active members (`permissions.canViewMembers`); users go into the users cache. */
export async function fetchMembers(chatId: ID, signal?: AbortSignal): Promise<ChatMember[]> {
  const list = await api.get<ChatMember[]>(`/api/chats/${chatId}/members`, { signal });
  useUsers.getState().upsertUsers(list.map((m) => m.user));
  return list;
}

export const MUTE_OPTIONS = [
  { value: '8h', label: '8 hours', ms: 8 * 60 * 60 * 1000 },
  { value: '1w', label: '1 week', ms: 7 * 24 * 60 * 60 * 1000 },
  { value: 'always', label: 'Always', ms: null },
] as const;

export type MuteChoice = (typeof MUTE_OPTIONS)[number]['value'];

/** ISO time to mute until for a choice (`always` = MUTE_FOREVER_ISO). */
export function muteUntil(choice: MuteChoice, now: number = Date.now()): string {
  const opt = MUTE_OPTIONS.find((o) => o.value === choice)!;
  return opt.ms === null ? MUTE_FOREVER_ISO : new Date(now + opt.ms).toISOString();
}

export async function setMuted(chatId: ID, mutedUntil: string | null): Promise<ChatSummary> {
  const prev = chats().byId[chatId]?.mutedUntil ?? null;
  chats().patchChat(chatId, { mutedUntil });
  try {
    return upsert(await api.patch<ChatSummary>(`/api/chats/${chatId}/prefs`, { mutedUntil }));
  } catch (e) {
    chats().patchChat(chatId, { mutedUntil: prev });
    throw e;
  }
}

export async function setDisappearing(chatId: ID, seconds: number | null): Promise<ChatSummary> {
  return upsert(await api.put<ChatSummary>(`/api/chats/${chatId}/disappearing`, { seconds }));
}

export async function clearChatHistory(chatId: ID): Promise<void> {
  await api.post(`/api/chats/${chatId}/clear`);
  const chat = chats().byId[chatId];
  if (chat) {
    useMessages.getState().clearChat(chatId, chat.lastSeq);
    chats().patchChat(chatId, { lastMessage: null, unreadCount: 0, unreadMentionCount: 0 });
  }
}

export async function deleteChatForMe(chatId: ID): Promise<void> {
  await api.delete(`/api/chats/${chatId}`);
  chats().removeChat(chatId);
  useMessages.getState().dropChat(chatId);
}

/** Open (or create) the direct chat with a user. */
export async function openDirectChat(userId: ID): Promise<ChatSummary> {
  return upsert(await api.post<ChatSummary>('/api/chats/direct', { userId }));
}
