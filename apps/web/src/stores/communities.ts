/**
 * Communities store (agent 3) — the viewer's communities (`Community`, viewer-specific).
 *
 * State: `byId`, `loaded`, `loading`
 *
 * Loading / realtime (foundation contract, unchanged)
 * - `loadCommunities()`      GET /api/communities (replaces the map)
 * - `refreshCommunity(id)`   GET /api/communities/:id (404/403 → removed)
 * - `upsertCommunity(c)` / `removeCommunity(id)` — `community:upsert` / `community:removed`
 *
 * Mutations (REST; each applies its response right away, the socket echo merges idempotently)
 * - `createCommunity(body)`, `updateCommunity(id, body)`, `deactivateCommunity(id)`,
 *   `leaveCommunity(id)`
 * - groups: `createCommunityGroup(id, body)` → AddMembersResult, `linkGroups(id, chatIds)`,
 *   `unlinkGroup(id, chatId)`, `joinGroup(id, chatId)` → ChatSummary
 * - members (owner/admins): `fetchMembers(id)`, `addMembers(id, userIds)` →
 *   CommunityAddMembersResult, `removeMember(id, userId)`, `setRole(id, userId, role)`,
 *   `transferOwnership(id, userId)`
 * - invite (owner/admins): `getInvite(id)`, `resetInvite(id)`
 *
 * Hooks: `useSortedCommunities()` (by name), `useCommunity(id)`.
 */
import { useMemo } from 'react';
import { create } from 'zustand';
import type {
  AddMembersResult,
  ChatSummary,
  Community,
  CommunityAddMembersResult,
  CommunityMember,
  CreateCommunityGroupRequest,
  CreateCommunityRequest,
  ID,
  UpdateCommunityRequest,
} from '@enbox/shared';
import { ApiError, api } from '@/lib/api';
import { registerSessionReset } from '@/lib/session';
import { useChats } from './chats';
import { useUsers } from './users';

export interface CommunitiesState {
  byId: Record<ID, Community>;
  loaded: boolean;
  loading: boolean;

  loadCommunities(): Promise<void>;
  refreshCommunity(id: ID): Promise<Community | null>;
  upsertCommunity(community: Community): void;
  removeCommunity(id: ID): void;

  createCommunity(body: CreateCommunityRequest): Promise<Community>;
  updateCommunity(id: ID, body: UpdateCommunityRequest): Promise<Community>;
  deactivateCommunity(id: ID): Promise<void>;
  leaveCommunity(id: ID): Promise<void>;
  createCommunityGroup(id: ID, body: CreateCommunityGroupRequest): Promise<AddMembersResult>;
  linkGroups(id: ID, chatIds: ID[]): Promise<Community>;
  unlinkGroup(id: ID, chatId: ID): Promise<Community>;
  joinGroup(id: ID, chatId: ID): Promise<ChatSummary>;
  fetchMembers(id: ID, signal?: AbortSignal): Promise<CommunityMember[]>;
  addMembers(id: ID, userIds: ID[]): Promise<CommunityAddMembersResult>;
  removeMember(id: ID, userId: ID): Promise<void>;
  setRole(id: ID, userId: ID, role: 'admin' | 'member'): Promise<void>;
  transferOwnership(id: ID, userId: ID): Promise<void>;
  getInvite(id: ID): Promise<{ code: string }>;
  resetInvite(id: ID): Promise<{ code: string }>;
}

let loadingPromise: Promise<void> | null = null;

export const useCommunities = create<CommunitiesState>((set, get) => ({
  byId: {},
  loaded: false,
  loading: false,

  async loadCommunities() {
    if (loadingPromise) return loadingPromise;
    set({ loading: true });
    const p: Promise<void> = api
      .get<Community[]>('/api/communities')
      .then((list) => {
        set({ byId: Object.fromEntries(list.map((c) => [c.id, c])), loaded: true, loading: false });
      })
      .catch((e: unknown) => {
        // Not after a logout meanwhile (the store was reset; api throws 'aborted').
        if (loadingPromise === p) set({ loading: false });
        throw e;
      })
      .finally(() => {
        if (loadingPromise === p) loadingPromise = null;
      });
    loadingPromise = p;
    return p;
  },

  async refreshCommunity(id) {
    try {
      const c = await api.get<Community>(`/api/communities/${id}`);
      get().upsertCommunity(c);
      return c;
    } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.status === 403))
        get().removeCommunity(id);
      throw e;
    }
  },

  upsertCommunity(community) {
    set((s) => ({
      byId: { ...s.byId, [community.id]: { ...s.byId[community.id], ...community } },
    }));
  },

  removeCommunity(id) {
    if (!get().byId[id]) return;
    set((s) => {
      const byId = { ...s.byId };
      delete byId[id];
      return { byId };
    });
  },

  async createCommunity(body) {
    const c = await api.post<Community>('/api/communities', body);
    get().upsertCommunity(c);
    // The announcement group (and linked groups' community ids) arrive via chat events;
    // fetch the announcement chat now so it is ready to open.
    void useChats
      .getState()
      .refreshChat(c.announcementChatId)
      .catch(() => undefined);
    return c;
  },

  async updateCommunity(id, body) {
    const c = await api.patch<Community>(`/api/communities/${id}`, body);
    get().upsertCommunity(c);
    return c;
  },

  async deactivateCommunity(id) {
    const c = get().byId[id];
    await api.delete(`/api/communities/${id}`);
    get().removeCommunity(id);
    if (c) useChats.getState().removeChat(c.announcementChatId);
  },

  async leaveCommunity(id) {
    const c = get().byId[id];
    await api.post(`/api/communities/${id}/leave`);
    get().removeCommunity(id);
    if (c) {
      useChats.getState().removeChat(c.announcementChatId);
      // Linked groups become "left" (read-only) — refresh the ones we have.
      for (const g of c.groups)
        if (!g.isAnnouncement && useChats.getState().byId[g.chatId])
          void useChats
            .getState()
            .refreshChat(g.chatId)
            .catch(() => undefined);
    }
  },

  async createCommunityGroup(id, body) {
    const r = await api.post<AddMembersResult>(`/api/communities/${id}/groups`, body);
    useChats.getState().upsertChat(r.chat);
    void get()
      .refreshCommunity(id)
      .catch(() => undefined);
    return r;
  },

  async linkGroups(id, chatIds) {
    const c = await api.post<Community>(`/api/communities/${id}/groups/link`, { chatIds });
    get().upsertCommunity(c);
    for (const chatId of chatIds) useChats.getState().applyChatUpdate(chatId, { communityId: id });
    return c;
  },

  async unlinkGroup(id, chatId) {
    const c = await api.delete<Community>(`/api/communities/${id}/groups/${chatId}`);
    get().upsertCommunity(c);
    useChats.getState().applyChatUpdate(chatId, { communityId: null });
    return c;
  },

  async joinGroup(id, chatId) {
    const chat = await api.post<ChatSummary>(`/api/communities/${id}/groups/${chatId}/join`);
    useChats.getState().upsertChat(chat);
    const c = get().byId[id];
    if (c)
      get().upsertCommunity({
        ...c,
        groups: c.groups.map((g) =>
          g.chatId === chatId ? { ...g, isMember: true, memberCount: chat.memberCount } : g,
        ),
      });
    return chat;
  },

  async fetchMembers(id, signal) {
    const list = await api.get<CommunityMember[]>(`/api/communities/${id}/members`, { signal });
    useUsers.getState().upsertUsers(list.map((m) => m.user));
    return list;
  },

  async addMembers(id, userIds) {
    const r = await api.post<CommunityAddMembersResult>(`/api/communities/${id}/members`, {
      userIds,
    });
    get().upsertCommunity(r.community);
    return r;
  },

  async removeMember(id, userId) {
    await api.delete(`/api/communities/${id}/members/${userId}`);
    void get()
      .refreshCommunity(id)
      .catch(() => undefined);
  },

  async setRole(id, userId, role) {
    await api.put(`/api/communities/${id}/members/${userId}/role`, { role });
  },

  async transferOwnership(id, userId) {
    await api.post(`/api/communities/${id}/transfer-ownership`, { userId });
    await get()
      .refreshCommunity(id)
      .catch(() => undefined);
  },

  async getInvite(id) {
    const r = await api.get<{ code: string }>(`/api/communities/${id}/invite`);
    const c = get().byId[id];
    if (c) get().upsertCommunity({ ...c, inviteCode: r.code });
    return r;
  },

  async resetInvite(id) {
    const r = await api.post<{ code: string }>(`/api/communities/${id}/invite/reset`);
    const c = get().byId[id];
    if (c) get().upsertCommunity({ ...c, inviteCode: r.code });
    return r;
  },
}));

registerSessionReset(() => {
  loadingPromise = null;
  useCommunities.setState({ byId: {}, loaded: false, loading: false });
});

export function useSortedCommunities(): Community[] {
  const byId = useCommunities((s) => s.byId);
  return useMemo(() => Object.values(byId).sort((a, b) => a.name.localeCompare(b.name)), [byId]);
}

export function useCommunity(id: ID | null | undefined): Community | undefined {
  return useCommunities((s) => (id ? s.byId[id] : undefined));
}

/** Owner or admin of the community (manage groups, members, invite link). */
export function isCommunityAdmin(c: Pick<Community, 'myRole'> | null | undefined): boolean {
  return c?.myRole === 'owner' || c?.myRole === 'admin';
}
