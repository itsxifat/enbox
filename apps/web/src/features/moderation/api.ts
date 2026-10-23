/**
 * Moderation REST calls (contracts in @enbox/shared moderation.ts): the Members page search,
 * bulk actions, Mod View and security actions. Security changes go into the Space at once
 * (`space.security` for moderators, `invitesPaused` for everyone); the `space:security` echo
 * (realtime/moderation.ts) merges the same way.
 */
import {
  PERM,
  hasPerm,
  type BulkMembersRequest,
  type BulkMembersResult,
  type ID,
  type MemberSort,
  type ModMember,
  type ModMemberPage,
  type ModView,
  type Space,
  type SpaceMember,
  type SpaceSecurity,
  type UpdateSpaceSecurityRequest,
} from '@enbox/shared';
import { api } from '@/lib/api';
import { useSpaces } from '@/stores/spaces';

const base = (spaceId: ID) => `/api/spaces/${spaceId}`;

/** The server takes this many members per bulk request. */
export const BULK_CHUNK = 100;

export interface MemberSearch {
  q?: string;
  roleIds?: ID[];
  joinedAfter?: string;
  joinedBefore?: string;
  accountCreatedAfter?: string;
  timedOut?: boolean;
  sort?: MemberSort;
  after?: string | null;
  limit?: number;
}

export function searchMembers(spaceId: ID, s: MemberSearch): Promise<ModMemberPage> {
  return api.get<ModMemberPage>(`${base(spaceId)}/members/search`, {
    query: {
      q: s.q || undefined,
      roleIds: s.roleIds?.length ? s.roleIds.join(',') : undefined,
      joinedAfter: s.joinedAfter,
      joinedBefore: s.joinedBefore,
      accountCreatedAfter: s.accountCreatedAfter,
      timedOut: s.timedOut ? 'true' : undefined,
      sort: s.sort,
      after: s.after ?? undefined,
      limit: s.limit,
    },
  });
}

/**
 * A bulk action over any number of members, BULK_CHUNK per request (one after another); the
 * results add up. Kicked and banned members leave the member cache.
 */
export async function bulkMembers(
  spaceId: ID,
  body: BulkMembersRequest,
): Promise<BulkMembersResult> {
  const out: BulkMembersResult = { ok: [], failed: [] };
  for (let i = 0; i < body.userIds.length; i += BULK_CHUNK) {
    const r = await api.post<BulkMembersResult>(`${base(spaceId)}/members/bulk`, {
      ...body,
      userIds: body.userIds.slice(i, i + BULK_CHUNK),
    });
    out.ok.push(...r.ok);
    out.failed.push(...r.failed);
  }
  if (body.action === 'kick' || body.action === 'ban')
    for (const id of out.ok) useSpaces.getState().removeMember(spaceId, id);
  return out;
}

/** A `ModMember` as the plain `SpaceMember` the member cache holds. */
export function toSpaceMember(m: ModMember): SpaceMember {
  const { user: _user, accountCreatedAt: _created, ...member } = m;
  return member;
}

export function loadModView(spaceId: ID, userId: ID): Promise<ModView> {
  return api.get<ModView>(`${base(spaceId)}/members/${userId}/mod-view`);
}

/** MANAGE_SPACE or MODERATE_MEMBERS: the bits that see `Space.security`. */
export function canSeeSecurity(space: Pick<Space, 'myPermissions'>): boolean {
  return (
    hasPerm(space.myPermissions, PERM.MANAGE_SPACE) ||
    hasPerm(space.myPermissions, PERM.MODERATE_MEMBERS)
  );
}

/** A pause end that is still ahead (null when there is none or it has passed). */
export function liveUntil(until: string | null | undefined, now = Date.now()): string | null {
  return until && Date.parse(until) > now ? until : null;
}

/** Merge security actions into my Space (moderators keep the details). */
export function applySecurity(spaceId: ID, security: SpaceSecurity): void {
  const space = useSpaces.getState().byId[spaceId];
  if (!space) return;
  useSpaces.getState().upsertSpace({
    ...space,
    invitesPaused: !!liveUntil(security.invitesPausedUntil),
    security: canSeeSecurity(space) ? security : null,
  });
}

export async function fetchSecurity(spaceId: ID): Promise<SpaceSecurity> {
  const security = await api.get<SpaceSecurity>(`${base(spaceId)}/security`);
  applySecurity(spaceId, security);
  return security;
}

export async function updateSecurity(
  spaceId: ID,
  body: UpdateSpaceSecurityRequest,
): Promise<SpaceSecurity> {
  const security = await api.patch<SpaceSecurity>(`${base(spaceId)}/security`, body);
  applySecurity(spaceId, security);
  return security;
}
