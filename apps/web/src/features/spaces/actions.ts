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
  await api.patch(`${base(spaceId)}/categories/${categoryId}`, { name });
}

export async function deleteCategory(spaceId: ID, categoryId: ID): Promise<void> {
  await api.delete(`${base(spaceId)}/categories/${categoryId}`);
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

export async function updateMyMember(spaceId: ID, body: UpdateMyMemberRequest): Promise<void> {
  const space = await api.patch<Space>(`${base(spaceId)}/members/me`, body);
  useSpaces.getState().upsertSpace(space);
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
  collapsed: (): Record<ID, boolean> => storage.getJSON<Record<ID, boolean>>(COLLAPSED) ?? {},
  setCollapsed: (categoryId: ID, collapsed: boolean) => {
    const cur = spaceMemory.collapsed();
    if (collapsed) cur[categoryId] = true;
    else delete cur[categoryId];
    storage.setJSON(COLLAPSED, cur);
  },
};
