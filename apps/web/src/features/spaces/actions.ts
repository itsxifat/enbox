/**
 * Space mutations (REST). Each applies its response right away; the socket echo of the same
 * change merges idempotently (`space:*`, `chat:*` handlers in realtime/spaces.ts / chats.ts).
 */
import type {
  BanRequest,
  ChatSummary,
  CreateCategoryRequest,
  CreateRoleRequest,
  CreateSpaceChannelRequest,
  CreateSpaceInviteRequest,
  ID,
  NotifyLevel,
  OverwriteRequest,
  Space,
  SpaceCategory,
  SpaceInvite,
  SpaceMember,
  SpaceRole,
  UpdateMemberRequest,
  UpdateMyMemberRequest,
  UpdateRoleRequest,
  UpdateSpaceChannelRequest,
  UpdateSpaceRequest,
} from '@enbox/shared';
import { patchPrefs } from '@/features/chats/chatActions';
import { api } from '@/lib/api';
import { storage } from '@/lib/storage';
import { useChats } from '@/stores/chats';
import { useSpaces } from '@/stores/spaces';

const base = (spaceId: ID) => `/api/spaces/${spaceId}`;

export async function updateSpace(spaceId: ID, body: UpdateSpaceRequest): Promise<Space> {
  const space = await api.patch<Space>(base(spaceId), body);
  useSpaces.getState().upsertSpace(space);
  return space;
}

export async function deleteSpace(spaceId: ID): Promise<void> {
  await api.delete(base(spaceId));
  useSpaces.getState().removeSpace(spaceId);
}

export async function leaveSpace(spaceId: ID): Promise<void> {
  await api.post(`${base(spaceId)}/leave`);
  useSpaces.getState().removeSpace(spaceId);
}

export async function transferOwnership(spaceId: ID, userId: ID): Promise<void> {
  const space = await api.post<Space>(`${base(spaceId)}/transfer-ownership`, { userId });
  useSpaces.getState().upsertSpace(space);
}

export async function createChannel(spaceId: ID, body: CreateSpaceChannelRequest): Promise<ChatSummary> {
  const chat = await api.post<ChatSummary>(`${base(spaceId)}/channels`, body);
  useChats.getState().upsertChat(chat);
  return chat;
}

export async function updateChannel(
  spaceId: ID,
  chatId: ID,
  body: UpdateSpaceChannelRequest,
): Promise<ChatSummary> {
  const chat = await api.patch<ChatSummary>(`${base(spaceId)}/channels/${chatId}`, body);
  useChats.getState().upsertChat(chat);
  return chat;
}

export async function deleteChannel(spaceId: ID, chatId: ID): Promise<void> {
  await api.delete(`${base(spaceId)}/channels/${chatId}`);
  useChats.getState().removeChat(chatId);
}

/** Same type, topic, settings, category and permissions (Discord's Clone Channel). */
export async function cloneChannel(spaceId: ID, chatId: ID, name?: string): Promise<ChatSummary> {
  const chat = await api.post<ChatSummary>(`${base(spaceId)}/channels/${chatId}/clone`, name ? { name } : {});
  useChats.getState().upsertChat(chat);
  return chat;
}

/**
 * Mark every channel of the Space read. Optimistic for the loaded channels; the server reads
 * the rest and echoes `chat:read` per channel plus a `space:upsert` (rail aggregate).
 */
export async function markSpaceRead(spaceId: ID): Promise<void> {
  const chats = useChats.getState();
  for (const c of Object.values(chats.byId))
    if (c.space?.spaceId === spaceId && (c.lastSeq > c.lastReadSeq || c.unreadCount || c.unreadMentionCount))
      chats.mutateChat(c.id, (cur) => ({
        lastReadSeq: Math.max(cur.lastReadSeq, cur.lastSeq),
        unreadCount: 0,
        unreadMentionCount: 0,
        markedUnread: false,
      }));
  const space = useSpaces.getState().byId[spaceId];
  if (space) useSpaces.getState().upsertSpace({ ...space, unread: false, unreadMentionCount: 0 });
  await api.post(`${base(spaceId)}/read`);
}

/**
 * Mute (or with `until: null` unmute) several channels through their per-channel prefs — a
 * category mute is the mute of each of its channels. Optimistic; failures toast and revert.
 */
export async function setChannelsMuted(chats: ChatSummary[], until: string | null): Promise<boolean> {
  const results = await Promise.all(chats.map((c) => patchPrefs(c, { mutedUntil: until })));
  return results.every(Boolean);
}

/** Notification level of several channels (null = follow the Space setting). */
export async function setChannelsNotifyLevel(chats: ChatSummary[], level: NotifyLevel | null): Promise<boolean> {
  const results = await Promise.all(chats.map((c) => patchPrefs(c, { notifyLevel: level })));
  return results.every(Boolean);
}

/** Live invites; with `channelId` only that channel's (MANAGE_CHANNELS there: everyone's). */
export async function listInvites(spaceId: ID, channelId?: ID): Promise<SpaceInvite[]> {
  return api.get<SpaceInvite[]>(`${base(spaceId)}/invites`, { query: { channelId } });
}

export async function moveChannels(
  spaceId: ID,
  items: { id: ID; categoryId: ID | null; position: number; syncPermissions?: boolean }[],
): Promise<void> {
  // Optimistic: the sidebar reorders at once; the refetch after the echo confirms it.
  const chats = useChats.getState();
  for (const it of items)
    chats.mutateChat(it.id, (c) =>
      c.space ? { space: { ...c.space, categoryId: it.categoryId, position: it.position } } : null,
    );
  await api.patch(`${base(spaceId)}/channels/positions`, { items });
}

export async function setChannelOverwrite(
  spaceId: ID,
  chatId: ID,
  target: { type: 'role' | 'member'; id: ID },
  body: OverwriteRequest | null,
): Promise<void> {
  const path = `${base(spaceId)}/channels/${chatId}/overwrites/${target.type}/${target.id}`;
  const chat = body
    ? await api.put<ChatSummary | null>(path, body)
    : await api.delete<ChatSummary | null>(path);
  if (chat) useChats.getState().upsertChat(chat);
  else useSpaces.getState().refetchChannels(spaceId);
}

export async function syncChannel(spaceId: ID, chatId: ID): Promise<void> {
  const chat = await api.post<ChatSummary | null>(`${base(spaceId)}/channels/${chatId}/sync`);
  if (chat) useChats.getState().upsertChat(chat);
}

export async function createCategory(spaceId: ID, body: CreateCategoryRequest): Promise<SpaceCategory> {
  const cat = await api.post<SpaceCategory>(`${base(spaceId)}/categories`, body);
  const space = useSpaces.getState().byId[spaceId];
  if (space && !space.categories.some((c) => c.id === cat.id))
    useSpaces.getState().applySpaceUpdate(spaceId, { categories: [...space.categories, cat] });
  return cat;
}

export async function renameCategory(spaceId: ID, categoryId: ID, name: string): Promise<void> {
  const cat = await api.patch<SpaceCategory>(`${base(spaceId)}/categories/${categoryId}`, { name });
  const space = useSpaces.getState().byId[spaceId];
  if (space)
    useSpaces.getState().applySpaceUpdate(spaceId, {
      categories: space.categories.map((c) => (c.id === cat.id ? cat : c)),
    });
}

export async function deleteCategory(spaceId: ID, categoryId: ID): Promise<void> {
  await api.delete(`${base(spaceId)}/categories/${categoryId}`);
  const space = useSpaces.getState().byId[spaceId];
  if (space)
    useSpaces.getState().applySpaceUpdate(spaceId, {
      categories: space.categories.filter((c) => c.id !== categoryId),
    });
  // Its channels become uncategorised (the channel list refetch after the echo confirms it).
  const chats = useChats.getState();
  for (const c of Object.values(chats.byId))
    if (c.space?.spaceId === spaceId && c.space.categoryId === categoryId)
      chats.mutateChat(c.id, (cur) => (cur.space ? { space: { ...cur.space, categoryId: null } } : null));
}

export async function createRole(spaceId: ID, body: CreateRoleRequest): Promise<SpaceRole> {
  return api.post<SpaceRole>(`${base(spaceId)}/roles`, body);
}

export async function updateRole(spaceId: ID, roleId: ID, body: UpdateRoleRequest): Promise<SpaceRole> {
  return api.patch<SpaceRole>(`${base(spaceId)}/roles/${roleId}`, body);
}

export async function deleteRole(spaceId: ID, roleId: ID): Promise<void> {
  await api.delete(`${base(spaceId)}/roles/${roleId}`);
}

export async function reorderRoles(spaceId: ID, roleIds: ID[]): Promise<SpaceRole[]> {
  const roles = await api.patch<SpaceRole[]>(`${base(spaceId)}/roles/positions`, { roleIds });
  useSpaces.getState().applySpaceUpdate(spaceId, { roles });
  return roles;
}

/**
 * My settings in a Space (nickname, notifications, mute, suppressions, hide muted channels).
 * The notification fields apply optimistically (menu checkboxes flip at once) and revert on
 * failure; the response (and its `space:upsert` echo on my other devices) is the truth.
 */
export async function updateMyMember(spaceId: ID, body: UpdateMyMemberRequest): Promise<void> {
  const before = useSpaces.getState().byId[spaceId];
  if (before) {
    const me = { ...before.me };
    if (body.notifyLevel !== undefined) me.notifyLevel = body.notifyLevel;
    if (body.mutedUntil !== undefined) me.mutedUntil = body.mutedUntil;
    if (body.suppressEveryone !== undefined) me.suppressEveryone = body.suppressEveryone;
    if (body.suppressRoles !== undefined) me.suppressRoles = body.suppressRoles;
    if (body.hideMutedChannels !== undefined) me.hideMutedChannels = body.hideMutedChannels;
    useSpaces.getState().upsertSpace({ ...before, me });
  }
  try {
    const space = await api.patch<Space>(`${base(spaceId)}/members/me`, body);
    useSpaces.getState().upsertSpace(space);
    // Mention counts are computed at read time: the loaded channels' badges change too.
    if (
      (body.suppressEveryone !== undefined || body.suppressRoles !== undefined) &&
      useSpaces.getState().channelsLoaded[spaceId]
    )
      useSpaces.getState().refetchChannels(spaceId);
  } catch (e) {
    const cur = useSpaces.getState().byId[spaceId];
    if (before && cur) useSpaces.getState().upsertSpace({ ...cur, me: before.me });
    throw e;
  }
}

export async function updateMember(spaceId: ID, userId: ID, body: UpdateMemberRequest): Promise<SpaceMember> {
  const m = await api.patch<SpaceMember>(`${base(spaceId)}/members/${userId}`, body);
  useSpaces.getState().upsertMembers(spaceId, [m]);
  return m;
}

export async function setMemberRole(spaceId: ID, userId: ID, roleId: ID, on: boolean): Promise<void> {
  const path = `${base(spaceId)}/members/${userId}/roles/${roleId}`;
  const m = on ? await api.put<SpaceMember>(path) : await api.delete<SpaceMember>(path);
  useSpaces.getState().upsertMembers(spaceId, [m]);
}

export async function kickMember(spaceId: ID, userId: ID, reason?: string): Promise<void> {
  const q = reason ? `?reason=${encodeURIComponent(reason)}` : '';
  await api.delete(`${base(spaceId)}/members/${userId}${q}`);
  useSpaces.getState().removeMember(spaceId, userId);
}

export async function banMember(spaceId: ID, userId: ID, body: BanRequest): Promise<void> {
  await api.put(`${base(spaceId)}/bans/${userId}`, body);
  useSpaces.getState().removeMember(spaceId, userId);
}

export async function unbanMember(spaceId: ID, userId: ID): Promise<void> {
  await api.delete(`${base(spaceId)}/bans/${userId}`);
}

export async function createInvite(spaceId: ID, body: CreateSpaceInviteRequest): Promise<SpaceInvite> {
  return api.post<SpaceInvite>(`${base(spaceId)}/invites`, body);
}

export async function revokeInvite(spaceId: ID, code: string): Promise<void> {
  await api.delete(`${base(spaceId)}/invites/${code}`);
}

// ---------------------------------------------------------------------------
// Device-local memory (last channel per Space, collapsed categories)
// ---------------------------------------------------------------------------

const lastKey = (spaceId: ID) => `enbox.spaces.lastChannel.${spaceId}`;
const LAST_SPACE = 'enbox.spaces.lastSpace';
const COLLAPSED = 'enbox.spaces.collapsed';

export const spaceMemory = {
  lastChannel: (spaceId: ID) => storage.get(lastKey(spaceId)),
  setLastChannel: (spaceId: ID, chatId: ID) => {
    storage.set(lastKey(spaceId), chatId);
    storage.set(LAST_SPACE, spaceId);
  },
  lastSpace: () => storage.get(LAST_SPACE),
  /** Collapsed categories on this device (category id → true). */
  collapsed: (): Record<ID, boolean> => storage.getJSON<Record<ID, boolean>>(COLLAPSED) ?? {},
  setCollapsed: (categoryId: ID, collapsed: boolean) => spaceMemory.setCollapsedMany([categoryId], collapsed),
  /** Collapse All Categories (or expand them): one write. Returns the new map. */
  setCollapsedMany: (categoryIds: readonly ID[], collapsed: boolean): Record<ID, boolean> => {
    const cur = spaceMemory.collapsed();
    for (const id of categoryIds) {
      if (collapsed) cur[id] = true;
      else delete cur[id];
    }
    storage.setJSON(COLLAPSED, cur);
    return cur;
  },
};
