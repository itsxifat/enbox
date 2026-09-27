/**
 * Channel REST actions (agent 3). Responses are applied to the stores immediately; socket
 * echoes (`chat:upsert`, `chat:updated`, `message:updated`…) merge idempotently.
 */

import { api } from '@/lib/api';
import { publicOrigin } from '@/lib/serverConfig';
import { useChats } from '@/stores/chats';
import { useMessages } from '@/stores/messages';
import { useUsers } from '@/stores/users';

const chats = () => useChats.getState();

export function discoverChannels(q, opts = {}) {
  return api.get('/api/channels/discover', {
    query: { q: q.trim() || undefined, limit: opts.limit ?? 30 },
    signal: opts.signal,
  });
}

/**
 * Non-follower preview. The users its posts reference (system actors, mentions, contact
 * cards) are side-loaded like `MessagePage.users`: put them in the users store so names render.
 */
export async function previewChannel(chatId, signal) {
  const preview = await api.get(`/api/channels/${chatId}`, { signal });
  if (preview.users?.length) useUsers.getState().upsertUsers(preview.users);
  return preview;
}

export async function createChannel(body) {
  const chat = await api.post('/api/channels', body);
  chats().upsertChat(chat);
  return chat;
}

export async function updateChannel(chatId, body) {
  const chat = await api.patch(`/api/channels/${chatId}`, body);
  chats().upsertChat(chat);
  return chat;
}

export async function deleteChannel(chatId) {
  await api.delete(`/api/channels/${chatId}`);
  chats().removeChat(chatId);
  useMessages.getState().dropChat(chatId);
}

export async function followChannel(chatId) {
  const chat = await api.put(`/api/channels/${chatId}/follow`);
  chats().upsertChat(chat);
  return chat;
}

export async function unfollowChannel(chatId) {
  await api.delete(`/api/channels/${chatId}/follow`);
  chats().removeChat(chatId);
  useMessages.getState().dropChat(chatId);
}

export async function setChannelAdmin(chatId, userId, admin) {
  if (admin) await api.put(`/api/channels/${chatId}/admins/${userId}`);
  else await api.delete(`/api/channels/${chatId}/admins/${userId}`);
}

export async function transferChannelOwnership(chatId, userId) {
  await api.post(`/api/channels/${chatId}/transfer-ownership`, { userId });
  await chats().refreshChat(chatId);
}

export async function getChannelInvite(chatId) {
  const r = await api.get(`/api/channels/${chatId}/invite`);
  chats().patchChat(chatId, { inviteCode: r.code });
  return r;
}

export async function resetChannelInvite(chatId) {
  const r = await api.post(`/api/channels/${chatId}/invite/reset`);
  chats().patchChat(chatId, { inviteCode: r.code });
  return r;
}

function applyMessage(m) {
  useMessages.getState().upsertMessage(m, { onlyIfPresent: true });
  return m;
}

/** React (emoji) or remove my reaction (null). Optimistic on the loaded message. */
export async function reactToPost(message, emoji) {
  const store = useMessages.getState();
  const prev = { reactions: message.reactions, myReaction: message.myReaction ?? null };
  store.patchMessage(message.chatId, message.id, {
    reactions: applyReaction(message.reactions, prev.myReaction, emoji),
    myReaction: emoji,
  });
  try {
    const m = emoji
      ? await api.put(`/api/messages/${message.id}/reaction`, { emoji })
      : await api.delete(`/api/messages/${message.id}/reaction`);
    return applyMessage(m);
  } catch (e) {
    store.patchMessage(message.chatId, message.id, prev);
    throw e;
  }
}

/** Vote in a poll (empty array retracts). Optimistic on the loaded message. */
export async function voteInPoll(message, optionIds) {
  const store = useMessages.getState();
  const poll = message.poll;
  if (poll) store.patchMessage(message.chatId, message.id, { poll: applyVote(poll, optionIds) });
  try {
    return applyMessage(await api.put(`/api/messages/${message.id}/vote`, { optionIds }));
  } catch (e) {
    if (poll) store.patchMessage(message.chatId, message.id, { poll });
    throw e;
  }
}

export async function deletePost(message) {
  await api.delete(`/api/messages/${message.id}`, undefined, { query: { for: 'everyone' } });
}

export async function editPost(message, text) {
  return applyMessage(await api.patch(`/api/messages/${message.id}`, { text }));
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

/** Reaction summary after replacing my reaction `prev` with `next` (either may be null). */
export function applyReaction(reactions, prev, next) {
  if (prev === next) return reactions;
  let out = reactions.map((r) => ({ ...r }));
  if (prev) {
    out = out
      .map((r) => (r.emoji === prev ? { ...r, count: r.count - 1 } : r))
      .filter((r) => r.count > 0);
  }
  if (next) {
    const hit = out.find((r) => r.emoji === next);
    if (hit) hit.count += 1;
    else out.push({ emoji: next, count: 1, userIds: [] });
  }
  return out.sort((a, b) => b.count - a.count);
}

/** Poll counts after replacing my vote with `optionIds`. */
export function applyVote(poll, optionIds) {
  const before = new Set(poll.myOptionIds ?? []);
  const after = new Set(optionIds);
  const hadVote = before.size > 0;
  const hasVote = after.size > 0;
  return {
    ...poll,
    options: poll.options.map((o) => ({
      ...o,
      voteCount: Math.max(0, o.voteCount - (before.has(o.id) ? 1 : 0) + (after.has(o.id) ? 1 : 0)),
    })),
    totalVoters: Math.max(0, poll.totalVoters - (hadVote ? 1 : 0) + (hasVote ? 1 : 0)),
    myOptionIds: optionIds,
  };
}

/** Share URL of a public channel (opens its page / preview). */
export function channelUrl(chatId) {
  return `${publicOrigin()}/updates/channels/${chatId}`;
}
