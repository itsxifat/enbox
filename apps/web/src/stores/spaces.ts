/**
 * Spaces store (docs/design/spaces-at-scale.md "S2 — Web").
 *
 * - `byId` / `order`: my Spaces (`Space`, viewer-specific), from GET /api/spaces.
 * - Channel `ChatSummary`s live in the chats store (`useChats().byId`, `chat.space.spaceId`),
 *   so the conversation, message list and composer work unchanged; this store loads them
 *   (GET /api/spaces/:id) and keeps their permission bits current.
 * - Permissions are recomputed client-side (`recompute`) from the viewer-neutral roles and
 *   overwrites plus `space.me` after every structure change — the server sends one
 *   `space:updated`, never per-channel upserts. A channel I can no longer see disappears.
 * - `members`: a per-Space cache of `SpaceMember` (author nicknames/roles, member list).
 */
import { useEffect, useMemo } from 'react';
import { create } from 'zustand';
import {
  isVoiceChannelType,
  PERM,
  computeBasePermissions,
  computeChannelPermissions,
  hasPerm,
  isSpaceAdmin,
  isSpaceChatType,
  spaceChannelPermissions,
  type ChatSummary,
  type CreateSpaceRequest,
  type ID,
  type Message,
  type NotifyLevel,
  type Space,
  type SpaceDetail,
  type SpaceInfoChanges,
  type SpaceMember,
  type SpaceProfile,
  type SpaceRole,
} from '@enbox/shared';
import type { RoleNameStyle } from '@/components/cosmetics/StyledName';
import { ApiError, api } from '@/lib/api';
import { registerSessionReset, sessionEpoch } from '@/lib/session';
import { useAuth } from './auth';
import { useChats } from './chats';
import { useUsers } from './users';

export interface SpacesState {
  byId: Record<ID, Space>;
  order: ID[];
  loaded: boolean;
  loading: boolean;
  error: string | null;
  /** Spaces whose channel list was fetched this session. */
  channelsLoaded: Record<ID, boolean>;
  /** spaceId → userId → member (author nicknames, role colours, member list rows). */
  members: Record<ID, Record<ID, SpaceMember>>;

  loadSpaces(): Promise<void>;
  loadSpace(id: ID): Promise<SpaceDetail | null>;
  refetchChannels(id: ID, opts?: { jitterMs?: number }): void;
  upsertSpace(space: Space): void;
  removeSpace(id: ID): void;
  /** Shallow-merge viewer-neutral changes (also the Space options events.ts does not list yet). */
  applySpaceUpdate(
    id: ID,
    changes: SpaceInfoChanges & Partial<Pick<Space, 'systemFlags' | 'verificationLevel' | 'explicitFilter'>>,
  ): void;
  /** Recompute my base bits and every loaded channel's bits/permissions of the Space. */
  recompute(id: ID): void;
  upsertMembers(spaceId: ID, members: SpaceMember[]): void;
  removeMember(spaceId: ID, userId: ID): void;
  /** Batch-load members by id (authors of visible messages), deduped. */
  fetchMembers(spaceId: ID, userIds: ID[]): void;
  createSpace(body: CreateSpaceRequest): Promise<SpaceDetail>;
}

const initial = {
  byId: {} as Record<ID, Space>,
  order: [] as ID[],
  loaded: false,
  loading: false,
  error: null as string | null,
  channelsLoaded: {} as Record<ID, boolean>,
  members: {} as Record<ID, Record<ID, SpaceMember>>,
};

const myId = () => useAuth.getState().user?.id ?? '';
let loading: Promise<void> | null = null;
const refetchTimers = new Map<ID, ReturnType<typeof setTimeout>>();
const pendingMembers = new Map<ID, Set<ID>>();
let memberTimer: ReturnType<typeof setTimeout> | null = null;

/** The per-Space profile fields (`SpaceProfile`), as both `SpaceMember` and `space.me` carry them. */
export const SPACE_PROFILE_KEYS = [
  'avatarUrl',
  'avatarAnimatedUrl',
  'bannerUrl',
  'bannerAnimatedUrl',
  'bio',
  'pronouns',
  'profileColor',
  'accentColor',
  'avatarDecoration',
  'profileEffect',
  'nameplate',
] as const satisfies readonly (keyof SpaceProfile)[];

/** The per-Space profile of a member / `space.me` (absent fields = null = the main profile). */
export function spaceProfileOf(m: SpaceProfile): Required<SpaceProfile> {
  const out = {} as Record<keyof SpaceProfile, string | null>;
  for (const k of SPACE_PROFILE_KEYS) out[k] = m[k] ?? null;
  return out as Required<SpaceProfile>;
}

function sameProfile(a: SpaceProfile, b: SpaceProfile): boolean {
  return SPACE_PROFILE_KEYS.every((k) => (a[k] ?? null) === (b[k] ?? null));
}

/**
 * My cached `SpaceMember` follows `space.me` (my nickname / roles / profile changed through a
 * `space:upsert` or my own PATCH): messages and the member list show the change at once.
 */
function syncMyMember(
  members: Record<ID, Record<ID, SpaceMember>>,
  space: Space,
): Record<ID, Record<ID, SpaceMember>> {
  const me = myId();
  const cur = me ? members[space.id]?.[me] : undefined;
  if (!cur) return members;
  const mine = space.me;
  if (
    cur.nickname === mine.nickname &&
    cur.roleIds.join() === mine.roleIds.join() &&
    cur.timedOutUntil === mine.timedOutUntil &&
    sameProfile(cur, mine)
  )
    return members;
  const next: SpaceMember = {
    ...cur,
    nickname: mine.nickname,
    roleIds: mine.roleIds,
    timedOutUntil: mine.timedOutUntil,
    ...spaceProfileOf(mine),
  };
  return { ...members, [space.id]: { ...members[space.id], [me]: next } };
}

function orderOf(byId: Record<ID, Space>): ID[] {
  return Object.values(byId)
    .sort((a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1))
    .map((s) => s.id);
}

/** My bits in a channel of `space` (0 = I cannot see it). Pure. */
export function channelBitsFor(space: Space, chat: Pick<ChatSummary, 'type' | 'space'>, me: ID): number {
  if (!chat.space || !isSpaceChatType(chat.type)) return 0;
  const everyone = space.roles.find((r) => r.isDefault);
  if (!everyone) return 0;
  const base = computeBasePermissions({
    ownerId: space.ownerId,
    viewerId: me,
    everyoneRoleId: everyone.id,
    roles: space.roles,
    memberRoleIds: space.me.roleIds,
  });
  const timedOut =
    !!space.me.timedOutUntil && Date.parse(space.me.timedOutUntil) > Date.now() && !isSpaceAdmin(base);
  return computeChannelPermissions(base, {
    channelType: chat.type,
    overwrites: chat.space.overwrites,
    everyoneRoleId: everyone.id,
    memberRoleIds: space.me.roleIds,
    viewerId: me,
    timedOut,
  });
}

export const useSpaces = create<SpacesState>((set, get) => ({
  ...initial,

  loadSpaces() {
    if (loading) return loading;
    const epoch = sessionEpoch();
    set({ loading: true, error: null });
    const p = api
      .get<Space[]>('/api/spaces')
      .then((list) => {
        if (epoch !== sessionEpoch()) return;
        const byId: Record<ID, Space> = {};
        for (const s of list) byId[s.id] = s;
        // Channels of Spaces I left meanwhile go too.
        const chats = useChats.getState();
        for (const c of Object.values(chats.byId))
          if (c.space && !byId[c.space.spaceId]) chats.removeChat(c.id);
        set({ byId, order: orderOf(byId), loaded: true, loading: false });
      })
      .catch((e: unknown) => {
        if (epoch !== sessionEpoch()) return;
        set({ loading: false, error: e instanceof Error ? e.message : 'Failed to load Spaces' });
        throw e;
      })
      .finally(() => {
        if (loading === p) loading = null;
      });
    loading = p;
    return p;
  },

  async loadSpace(id) {
    const epoch = sessionEpoch();
    try {
      const detail = await api.get<SpaceDetail>(`/api/spaces/${id}`);
      if (epoch !== sessionEpoch()) return null;
      get().upsertSpace(detail.space);
      const chats = useChats.getState();
      const keep = new Set(detail.channels.map((c) => c.id));
      for (const c of Object.values(chats.byId))
        if (c.space?.spaceId === id && !keep.has(c.id)) chats.removeChat(c.id);
      chats.upsertChats(detail.channels);
      set((s) => ({ channelsLoaded: { ...s.channelsLoaded, [id]: true } }));
      return detail;
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        get().removeSpace(id);
        return null;
      }
      throw e;
    }
  },

  refetchChannels(id, opts = {}) {
    if (!get().byId[id]) return;
    const prev = refetchTimers.get(id);
    if (prev) clearTimeout(prev);
    const delay = Math.random() * (opts.jitterMs ?? 0);
    refetchTimers.set(
      id,
      setTimeout(() => {
        refetchTimers.delete(id);
        void get()
          .loadSpace(id)
          .catch(() => undefined);
      }, delay),
    );
  },

  upsertSpace(space) {
    set((s) => {
      const byId = { ...s.byId, [space.id]: space };
      return {
        byId,
        order: s.byId[space.id] ? s.order : orderOf(byId),
        members: syncMyMember(s.members, space),
      };
    });
    get().recompute(space.id);
  },

  removeSpace(id) {
    const chats = useChats.getState();
    for (const c of Object.values(chats.byId)) if (c.space?.spaceId === id) chats.removeChat(c.id);
    set((s) => {
      if (!s.byId[id]) return s;
      const byId = { ...s.byId };
      delete byId[id];
      const members = { ...s.members };
      delete members[id];
      const channelsLoaded = { ...s.channelsLoaded };
      delete channelsLoaded[id];
      return { byId, order: s.order.filter((x) => x !== id), members, channelsLoaded };
    });
  },

  applySpaceUpdate(id, changes) {
    const cur = get().byId[id];
    if (!cur) return;
    const next = { ...cur, ...changes };
    set((s) => ({
      byId: { ...s.byId, [id]: next },
      order: changes.name !== undefined ? orderOf({ ...s.byId, [id]: next }) : s.order,
    }));
    if (changes.roles || changes.ownerId) get().recompute(id);
  },

  recompute(id) {
    const space = get().byId[id];
    const me = myId();
    if (!space || !me) return;
    const everyone = space.roles.find((r) => r.isDefault);
    const base = everyone
      ? computeBasePermissions({
          ownerId: space.ownerId,
          viewerId: me,
          everyoneRoleId: everyone.id,
          roles: space.roles,
          memberRoleIds: space.me.roleIds,
        })
      : 0;
    if (base !== space.myPermissions)
      set((s) => ({ byId: { ...s.byId, [id]: { ...space, myPermissions: base } } }));
    const chats = useChats.getState();
    let lost = false;
    for (const c of Object.values(chats.byId)) {
      if (c.space?.spaceId !== id) continue;
      const bits = channelBitsFor(space, c, me);
      if (!hasPerm(bits, PERM.VIEW_CHANNEL)) {
        chats.removeChat(c.id);
        lost = true;
        continue;
      }
      if (bits === c.spacePermissions) continue;
      chats.patchChat(c.id, {
        spacePermissions: bits,
        permissions: spaceChannelPermissions(bits, c.type as 'space_text'),
      });
    }
    void lost;
  },

  upsertMembers(spaceId, members) {
    if (!members.length) return;
    set((s) => {
      const cur = { ...(s.members[spaceId] ?? {}) };
      for (const m of members) cur[m.userId] = m;
      return { members: { ...s.members, [spaceId]: cur } };
    });
    const me = myId();
    const mine = members.find((m) => m.userId === me);
    const space = get().byId[spaceId];
    if (mine && space) {
      const permsChanged =
        mine.roleIds.join() !== space.me.roleIds.join() || mine.timedOutUntil !== space.me.timedOutUntil;
      const changed = permsChanged || mine.nickname !== space.me.nickname || !sameProfile(mine, space.me);
      if (changed) {
        set((s) => ({
          byId: {
            ...s.byId,
            [spaceId]: {
              ...space,
              me: {
                ...space.me,
                roleIds: mine.roleIds,
                timedOutUntil: mine.timedOutUntil,
                nickname: mine.nickname,
                ...spaceProfileOf(mine),
              },
            },
          },
        }));
        if (permsChanged) get().recompute(spaceId);
      }
    }
  },

  removeMember(spaceId, userId) {
    set((s) => {
      const cur = s.members[spaceId];
      if (!cur?.[userId]) return s;
      const next = { ...cur };
      delete next[userId];
      return { members: { ...s.members, [spaceId]: next } };
    });
  },

  fetchMembers(spaceId, userIds) {
    const known = get().members[spaceId] ?? {};
    const want = userIds.filter((id) => !known[id]);
    if (!want.length) return;
    let set_ = pendingMembers.get(spaceId);
    if (!set_) pendingMembers.set(spaceId, (set_ = new Set()));
    for (const id of want) set_.add(id);
    if (memberTimer) return;
    memberTimer = setTimeout(() => {
      memberTimer = null;
      const batches = [...pendingMembers];
      pendingMembers.clear();
      for (const [sid, ids] of batches) {
        void api
          .post<SpaceMember[]>(`/api/spaces/${sid}/members/batch`, { userIds: [...ids].slice(0, 500) })
          .then((list) => {
            get().upsertMembers(sid, list);
            void useUsers
              .getState()
              .fetchUsers(list.map((m) => m.userId))
              .catch(() => undefined);
          })
          .catch(() => undefined);
      }
    }, 50);
  },

  async createSpace(body) {
    const detail = await api.post<SpaceDetail>('/api/spaces', body);
    get().upsertSpace(detail.space);
    useChats.getState().upsertChats(detail.channels);
    set((s) => ({ channelsLoaded: { ...s.channelsLoaded, [detail.space.id]: true } }));
    return detail;
  },
}));

registerSessionReset(() => {
  for (const t of refetchTimers.values()) clearTimeout(t);
  refetchTimers.clear();
  pendingMembers.clear();
  if (memberTimer) clearTimeout(memberTimer);
  memberTimer = null;
  loading = null;
  useSpaces.setState({ ...initial });
});

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export function useSpace(id: ID | null | undefined): Space | undefined {
  return useSpaces((s) => (id ? s.byId[id] : undefined));
}

/** My Spaces in rail order. */
export function useSpaceList(): Space[] {
  const byId = useSpaces((s) => s.byId);
  const order = useSpaces((s) => s.order);
  return useMemo(() => order.map((id) => byId[id]).filter((x): x is Space => !!x), [byId, order]);
}

/** The loaded channels of a Space, threads excluded (sidebar order: category, text before voice, position). */
export function useSpaceChannels(spaceId: ID | null | undefined): ChatSummary[] {
  const byId = useChats((s) => s.byId);
  const space = useSpace(spaceId);
  return useMemo(() => {
    if (!spaceId) return [];
    const cats = new Map((space?.categories ?? []).map((c) => [c.id, c.position]));
    return Object.values(byId)
      .filter((c) => c.space?.spaceId === spaceId && c.type !== 'space_thread')
      .sort((a, b) => {
        const ka = [a.space!.categoryId ? (cats.get(a.space!.categoryId) ?? 0) : -1, isVoiceChannelType(a.type) ? 1 : 0, a.space!.position];
        const kb = [b.space!.categoryId ? (cats.get(b.space!.categoryId) ?? 0) : -1, isVoiceChannelType(b.type) ? 1 : 0, b.space!.position];
        for (let i = 0; i < 3; i++) if (ka[i] !== kb[i]) return ka[i]! - kb[i]!;
        return a.createdAt < b.createdAt ? -1 : 1;
      });
  }, [byId, space?.categories, spaceId]);
}

export function useSpaceMember(spaceId: ID | null | undefined, userId: ID | null | undefined) {
  return useSpaces((s) => (spaceId && userId ? s.members[spaceId]?.[userId] : undefined));
}

/**
 * The highest coloured role of a member (name colour in messages and the member list). A
 * holographic role counts even without colours (the client draws its own palette).
 */
export function topColoredRole(space: Space | undefined, roleIds: readonly ID[] | undefined): SpaceRole | null {
  if (!space || !roleIds?.length) return null;
  let best: SpaceRole | null = null;
  for (const r of space.roles)
    if (
      roleIds.includes(r.id) &&
      (r.color || r.colorStyle === 'holographic') &&
      (!best || r.position > best.position)
    )
      best = r;
  return best;
}

/**
 * Whether a message mentions me in a space channel (user, my roles, @everyone/@here), minus
 * what I suppress in that Space (@everyone/@here, role mentions) — like the server's counts.
 */
export function mentionsMe(message: Message, chat: Pick<ChatSummary, 'space'>, me: ID): boolean {
  if (message.mentions.includes(me)) return true;
  const space = chat.space ? useSpaces.getState().byId[chat.space.spaceId] : undefined;
  if (!space) return false;
  if (message.mentionEveryone && !space.me.suppressEveryone) return true;
  if (space.me.suppressRoles) return false;
  return message.mentionRoleIds.some((r) => space.me.roleIds.includes(r));
}

/** The whole Space is muted for me (no unread pill, dimmed in the rail). */
export function isSpaceMuted(space: Pick<Space, 'me'>, now = Date.now()): boolean {
  return !!space.me.mutedUntil && Date.parse(space.me.mutedUntil) > now;
}

/** The effective notification level of a space channel for me. */
export function notifyLevelOf(chat: Pick<ChatSummary, 'space' | 'notifyLevel'>): NotifyLevel {
  const space = chat.space ? useSpaces.getState().byId[chat.space.spaceId] : undefined;
  return chat.notifyLevel ?? space?.me.notifyLevel ?? space?.defaultNotifyLevel ?? 'mentions';
}

/**
 * Rail badges: unread dot / mention count per Space from its loaded channels (else the server
 * aggregate). A muted Space shows no unread dot (Discord); mentions of me still count.
 */
export interface SpaceBadge {
  unread: boolean;
  mentions: number;
  muted: boolean;
}

/** Channels whose messages count for the rail and tab badges: text, voice and Stage chats. */
function countsForBadges(c: ChatSummary): boolean {
  return c.type === 'space_text' || isVoiceChannelType(c.type);
}

/**
 * Badges of Spaces in one pass over the chats: from the loaded text channels and voice / Stage
 * chats when a Space's channel list is loaded (muted channels never count as unread), else the
 * server's aggregate. A muted Space is never unread; its mentions still count.
 */
export function computeSpaceBadges(
  spaces: readonly Space[],
  chats: Record<ID, ChatSummary>,
  channelsLoaded: Record<ID, boolean>,
  now = Date.now(),
): Map<ID, SpaceBadge> {
  const live = new Map<ID, { unread: boolean; mentions: number }>();
  for (const s of spaces) if (channelsLoaded[s.id]) live.set(s.id, { unread: false, mentions: 0 });
  if (live.size)
    for (const c of Object.values(chats)) {
      const acc = c.space ? live.get(c.space.spaceId) : undefined;
      if (!acc || !countsForBadges(c)) continue;
      if (c.lastSeq > c.lastReadSeq && !(c.mutedUntil && Date.parse(c.mutedUntil) > now)) acc.unread = true;
      acc.mentions += c.unreadMentionCount;
    }
  const out = new Map<ID, SpaceBadge>();
  for (const s of spaces) {
    const muted = isSpaceMuted(s, now);
    const l = live.get(s.id);
    out.set(s.id, {
      unread: (l ? l.unread : s.unread) && !muted,
      mentions: l ? l.mentions : s.unreadMentionCount,
      muted,
    });
  }
  return out;
}

export function useSpaceBadge(space: Space): SpaceBadge {
  const byId = useChats((s) => s.byId);
  const loaded = useSpaces((s) => !!s.channelsLoaded[space.id]);
  return useMemo(
    () => computeSpaceBadges([space], byId, { [space.id]: loaded }).get(space.id)!,
    [byId, loaded, space],
  );
}

/** Spaces tab badge: total mentions (or a dot for unread messages) across my unmuted Spaces. */
export function useSpacesTabBadge(): { count?: number; dot?: boolean } | undefined {
  const byId = useSpaces((s) => s.byId);
  const loadedIds = useSpaces((s) => s.channelsLoaded);
  const chats = useChats((s) => s.byId);
  return useMemo(() => {
    let mentions = 0;
    let unread = false;
    const loadedMentions = new Map<ID, number>();
    const loadedUnread = new Set<ID>();
    for (const c of Object.values(chats)) {
      const sid = c.space?.spaceId;
      if (!sid || !loadedIds[sid] || !countsForBadges(c)) continue;
      loadedMentions.set(sid, (loadedMentions.get(sid) ?? 0) + c.unreadMentionCount);
      if (c.lastSeq > c.lastReadSeq && !(c.mutedUntil && Date.parse(c.mutedUntil) > Date.now())) loadedUnread.add(sid);
    }
    for (const s of Object.values(byId)) {
      const muted = !!s.me.mutedUntil && Date.parse(s.me.mutedUntil) > Date.now();
      mentions += loadedIds[s.id] ? (loadedMentions.get(s.id) ?? 0) : s.unreadMentionCount;
      if (!muted && (loadedIds[s.id] ? loadedUnread.has(s.id) : s.unread)) unread = true;
    }
    if (mentions) return { count: mentions };
    return unread ? { dot: true } : undefined;
  }, [byId, loadedIds, chats]);
}

/** The highest role of the member with an icon (shown next to their name). */
export function topIconRole(space: Space | undefined, roleIds: readonly ID[] | undefined): SpaceRole | null {
  if (!space || !roleIds?.length) return null;
  let best: SpaceRole | null = null;
  for (const r of space.roles)
    if (roleIds.includes(r.id) && (r.iconUrl || r.iconEmoji) && (!best || r.position > best.position)) best = r;
  return best;
}

/** How an author shows in a Space: nickname, top role colour/style and icon, per-Space profile. */
export interface SpaceAuthor {
  nickname: string | null;
  /** The top coloured role's colour (kept for older callers; `role` has the full style). */
  color: string | null;
  role: RoleNameStyle | null;
  iconRole: SpaceRole | null;
  /** Per-Space profile overrides (null fields = the main profile). */
  profile: SpaceProfile | null;
}

/** How an author shows in a space channel (members are batch-loaded on first sight). */
export function useSpaceAuthor(
  spaceId: ID | null | undefined,
  userId: ID | null | undefined,
): SpaceAuthor | null {
  const member = useSpaceMember(spaceId, userId);
  const space = useSpace(spaceId);
  useEffect(() => {
    if (spaceId && userId && !member) useSpaces.getState().fetchMembers(spaceId, [userId]);
  }, [spaceId, userId, member]);
  return useMemo(() => {
    if (!spaceId || !userId) return null;
    // Me before my member row loads: `space.me` has the same fields.
    const m = member ?? (space && userId === myId() ? space.me : undefined);
    const top = topColoredRole(space, m?.roleIds);
    return {
      nickname: m?.nickname ?? null,
      color: top?.color ?? null,
      role: top ? roleNameStyle(top) : null,
      iconRole: topIconRole(space, m?.roleIds),
      profile: m ? spaceProfileOf(m) : null,
    };
  }, [spaceId, userId, space, member]);
}

/** A role's name colouring for `StyledName` (`role` prop). */
export function roleNameStyle(role: Pick<SpaceRole, 'color' | 'colorSecondary' | 'colorStyle'>): RoleNameStyle {
  return { color: role.color, colorSecondary: role.colorSecondary ?? null, colorStyle: role.colorStyle ?? 'solid' };
}
