/**
 * Channel REST actions (agent 3). Responses are applied to the stores immediately; socket
 * echoes (`chat:upsert`, `chat:updated`, `message:updated`…) merge idempotently.
 */
import type {
  ChannelDirectoryEntry,
  ChannelPreview,
  ChatSummary,
  CreateChannelRequest,
  ID,
  Message,
  UpdateChannelRequest,
} from '@enbox/shared';
import { api } from '@/lib/api';
import { useChats } from '@/stores/chats';
import { useMessages } from '@/stores/messages';
import { useUsers } from '@/stores/users';

const chats = () => useChats.getState();

export function discoverChannels(
  q: string,
  opts: { limit?: number; signal?: AbortSignal } = {},
): Promise<ChannelDirectoryEntry[]> {
  return api.get<ChannelDirectoryEntry[]>('/api/channels/discover', {
    query: { q: q.trim() || undefined, limit: opts.limit ?? 30 },
    signal: opts.signal,
  });
}

/**
 * Non-follower preview. The users its posts reference (system actors, mentions, contact
 * cards) are side-loaded like `MessagePage.users`: put them in the users store so names render.
 */
export async function previewChannel(chatId: ID, signal?: AbortSignal): Promise<ChannelPreview> {
  const preview = await api.get<ChannelPreview>(`/api/channels/${chatId}`, { signal });
  if (preview.users?.length) useUsers.getState().upsertUsers(preview.users);
  return preview;
}

export async function createChannel(body: CreateChannelRequest): Promise<ChatSummary> {
  const chat = await api.post<ChatSummary>('/api/channels', body);
  chats().upsertChat(chat);
  return chat;
}

export async function updateChannel(chatId: ID, body: UpdateChannelRequest): Promise<ChatSummary> {
  const chat = await api.patch<ChatSummary>(`/api/channels/${chatId}`, body);
  chats().upsertChat(chat);
  return chat;
}

export async function deleteChannel(chatId: ID): Promise<void> {
  await api.delete(`/api/channels/${chatId}`);
  chats().removeChat(chatId);
  useMessages.getState().dropChat(chatId);
}

export async function followChannel(chatId: ID): Promise<ChatSummary> {
  const chat = await api.put<ChatSummary>(`/api/channels/${chatId}/follow`);
  chats().upsertChat(chat);
  return chat;
}

export async function unfollowChannel(chatId: ID): Promise<void> {
  await api.delete(`/api/channels/${chatId}/follow`);
  chats().removeChat(chatId);
  useMessages.getState().dropChat(chatId);
}

export async function setChannelAdmin(chatId: ID, userId: ID, admin: boolean): Promise<void> {
  if (admin) await api.put(`/api/channels/${chatId}/admins/${userId}`);
  else await api.delete(`/api/channels/${chatId}/admins/${userId}`);
}

export async function transferChannelOwnership(chatId: ID, userId: ID): Promise<void> {
  await api.post(`/api/channels/${chatId}/transfer-ownership`, { userId });
  await chats().refreshChat(chatId);
}

export async function getChannelInvite(chatId: ID): Promise<{ code: string }> {
  const r = await api.get<{ code: string }>(`/api/channels/${chatId}/invite`);
  chats().patchChat(chatId, { inviteCode: r.code });
  return r;
}

export async function resetChannelInvite(chatId: ID): Promise<{ code: string }> {
  const r = await api.post<{ code: string }>(`/api/channels/${chatId}/invite/reset`);
  chats().patchChat(chatId, { inviteCode: r.code });
  return r;
}

function applyMessage(m: Message): Message {
  useMessages.getState().upsertMessage(m, { onlyIfPresent: true });
  return m;
}

/** React (emoji) or remove my reaction (null). Optimistic on the loaded message. */
export async function reactToPost(message: Message, emoji: string | null): Promise<Message> {
  const store = useMessages.getState();
  const prev = { reactions: message.reactions, myReaction: message.myReaction ?? null };
  store.patchMessage(message.chatId, message.id, {
    reactions: applyReaction(message.reactions, prev.myReaction, emoji),
    myReaction: emoji,
  });
  try {
    const m = emoji
      ? await api.put<Message>(`/api/messages/${message.id}/reaction`, { emoji })
      : await api.delete<Message>(`/api/messages/${message.id}/reaction`);
    return applyMessage(m);
  } catch (e) {
    store.patchMessage(message.chatId, message.id, prev);
    throw e;
  }
}

/** Vote in a poll (empty array retracts). Optimistic on the loaded message. */
export async function voteInPoll(message: Message, optionIds: string[]): Promise<Message> {
  const store = useMessages.getState();
  const poll = message.poll;
  if (poll) store.patchMessage(message.chatId, message.id, { poll: applyVote(poll, optionIds) });
  try {
    return applyMessage(await api.put<Message>(`/api/messages/${message.id}/vote`, { optionIds }));
  } catch (e) {
    if (poll) store.patchMessage(message.chatId, message.id, { poll });
    throw e;
  }
}

export async function deletePost(message: Message): Promise<void> {
  await api.delete(`/api/messages/${message.id}`, undefined, { query: { for: 'everyone' } });
}

export async function editPost(message: Message, text: string): Promise<Message> {
  return applyMessage(await api.patch<Message>(`/api/messages/${message.id}`, { text }));
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

/** Reaction summary after replacing my reaction `prev` with `next` (either may be null). */
export function applyReaction(
  reactions: Message['reactions'],
  prev: string | null,
  next: string | null,
): Message['reactions'] {
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
export function applyVote(
  poll: NonNullable<Message['poll']>,
  optionIds: string[],
): NonNullable<Message['poll']> {
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
export function channelUrl(chatId: ID): string {
  return `${window.location.origin}/updates/channels/${chatId}`;
}
