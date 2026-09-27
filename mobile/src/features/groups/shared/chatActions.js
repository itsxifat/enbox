/**
 * REST actions for groups/channels/chats used by agent-3 screens. Every action applies the
 * response to the stores right away (the matching socket events arrive later and merge
 * idempotently).
 */
import { MUTE_FOREVER_ISO } from '@enbox/shared';
import { api } from '@/lib/api';
import { useChats } from '@/stores/chats';
import { useMessages } from '@/stores/messages';
import { useUsers } from '@/stores/users';

const chats = () => useChats.getState();

function upsert(chat) {
  chats().upsertChat(chat);
  return chat;
}

// --- Groups -----------------------------------------------------------------

export async function createGroup(body) {
  const r = await api.post('/api/groups', body);
  upsert(r.chat);
  return r;
}

export async function updateGroup(chatId, body) {
  return upsert(await api.patch(`/api/groups/${chatId}`, body));
}

export async function updateGroupSettings(chatId, body) {
  return upsert(await api.patch(`/api/groups/${chatId}/settings`, body));
}

export async function addGroupMembers(chatId, userIds) {
  const r = await api.post(`/api/groups/${chatId}/members`, { userIds });
  upsert(r.chat);
  return r;
}

export async function removeGroupMember(chatId, userId) {
  await api.delete(`/api/groups/${chatId}/members/${userId}`);
}

export async function setGroupRole(chatId, userId, role) {
  await api.put(`/api/groups/${chatId}/members/${userId}/role`, { role });
}

export async function transferGroupOwnership(chatId, userId) {
  await api.post(`/api/groups/${chatId}/transfer-ownership`, { userId });
  await chats().refreshChat(chatId);
}

export async function leaveGroup(chatId) {
  await api.post(`/api/groups/${chatId}/leave`);
  await chats()
    .refreshChat(chatId)
    .catch(() => undefined);
}

export async function getGroupInvite(chatId) {
  const r = await api.get(`/api/groups/${chatId}/invite`);
  chats().patchChat(chatId, { inviteCode: r.code });
  return r;
}

export async function resetGroupInvite(chatId) {
  const r = await api.post(`/api/groups/${chatId}/invite/reset`);
  chats().patchChat(chatId, { inviteCode: r.code });
  return r;
}

// --- Any chat ----------------------------------------------------------------

/** Active members (`permissions.canViewMembers`); users go into the users cache. */
export async function fetchMembers(chatId, signal) {
  const list = await api.get(`/api/chats/${chatId}/members`, { signal });
  useUsers.getState().upsertUsers(list.map((m) => m.user));
  return list;
}

export const MUTE_OPTIONS = [
  { value: '8h', label: '8 hours', ms: 8 * 60 * 60 * 1000 },
  { value: '1w', label: '1 week', ms: 7 * 24 * 60 * 60 * 1000 },
  { value: 'always', label: 'Always', ms: null },
];

/** ISO time to mute until for a choice (`always` = MUTE_FOREVER_ISO). */
export function muteUntil(choice, now = Date.now()) {
  const opt = MUTE_OPTIONS.find((o) => o.value === choice);
  return opt.ms === null ? MUTE_FOREVER_ISO : new Date(now + opt.ms).toISOString();
}

export async function setMuted(chatId, mutedUntil) {
  const prev = chats().byId[chatId]?.mutedUntil ?? null;
  chats().patchChat(chatId, { mutedUntil });
  try {
    return upsert(await api.patch(`/api/chats/${chatId}/prefs`, { mutedUntil }));
  } catch (e) {
    chats().patchChat(chatId, { mutedUntil: prev });
    throw e;
  }
}

export async function setDisappearing(chatId, seconds) {
  return upsert(await api.put(`/api/chats/${chatId}/disappearing`, { seconds }));
}

export async function clearChatHistory(chatId) {
  await api.post(`/api/chats/${chatId}/clear`);
  const chat = chats().byId[chatId];
  if (chat) {
    useMessages.getState().clearChat(chatId, chat.lastSeq);
    chats().patchChat(chatId, { lastMessage: null, unreadCount: 0, unreadMentionCount: 0 });
  }
}

export async function deleteChatForMe(chatId) {
  await api.delete(`/api/chats/${chatId}`);
  chats().removeChat(chatId);
  useMessages.getState().dropChat(chatId);
}

/** Open (or create) the direct chat with a user. */
export async function openDirectChat(userId) {
  return upsert(await api.post('/api/chats/direct', { userId }));
}
