/**
 * Community helpers (docs/design/discord-parity.md W12): the discovery listing, the community
 * settings on the wire and their validation, onboarding answers and the join-time hook.
 * Kept free of the invite routes so `modules/spaces/invites.ts` can import the hook.
 */
import { and, asc, count, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import {
  DISCOVERY_PAGE_SIZE,
  PERM,
  computeBasePermissions,
  computeChannelPermissions,
  hasPerm,
  type DiscoverableSpace,
  type DiscoveryCategory,
  type DiscoveryPage,
  type OnboardingOption,
  type SpaceCommunity,
  type SpaceOnboarding,
  type WelcomeScreen,
} from '@enbox/shared';
import { z } from 'zod';
import type { DbOrTx } from '../../db/index.js';
import {
  chats,
  communities,
  spaceInvites,
  spaceMembers,
  spaces,
  type MediaRow,
  type SpaceRow,
} from '../../db/schema.js';
import { badRequest, conflict, forbidden } from '../../lib/errors.js';
import { loadChannelOverwrites, type SpaceAccess } from '../../services/spaceAccess.js';
import { loadMediaMap, staticMediaUrl } from '../../services/media.js';
import { myTop } from '../spaces/service.js';

// ---------------------------------------------------------------------------
// Invite lookups (the vanity fallback)
// ---------------------------------------------------------------------------

/**
 * `/invites/:code` params: an invite code or a Space's vanity code. Vanity codes are stored
 * lowercase (3-32 letters, digits, dashes) and looked up case-insensitively; every invite code
 * (INVITE_CODE_ALPHABET, 22 characters) also fits this shape.
 */
export const inviteOrVanityParamsSchema = z.object({
  code: z.string().regex(/^[A-Za-z0-9-]{3,32}$/, 'Invalid invite code'),
});

/** The message of a vanity code some invite, chat, community or other Space already uses. */
export const VANITY_TAKEN = 'That vanity URL is already taken';

/**
 * 409 unless `code` is free across every invite code table (this Space's own vanity aside).
 * The unique index on `spaces.vanity_code` settles a race between two Spaces (the route maps
 * its violation to the same 409).
 */
export async function assertVanityFree(dbx: DbOrTx, code: string, spaceId: string): Promise<void> {
  const taken =
    (await dbx.select({ id: chats.id }).from(chats).where(eq(chats.inviteCode, code)).limit(1))
      .length > 0 ||
    (
      await dbx
        .select({ id: communities.id })
        .from(communities)
        .where(eq(communities.inviteCode, code))
        .limit(1)
    ).length > 0 ||
    (
      await dbx
        .select({ code: spaceInvites.code })
        .from(spaceInvites)
        .where(eq(spaceInvites.code, code))
        .limit(1)
    ).length > 0 ||
    (
      await dbx
        .select({ id: spaces.id })
        .from(spaces)
        .where(and(eq(spaces.vanityCode, code), ne(spaces.id, spaceId)))
        .limit(1)
    ).length > 0;
  if (taken) throw conflict(VANITY_TAKEN);
}

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------

/** Onboarding runs for new members: switched on, with at least one question. */
export function onboardingActive(o: SpaceOnboarding | null | undefined): o is SpaceOnboarding {
  return !!o?.enabled && o.prompts.length > 0;
}

/**
 * Join-time hook (every join path through `joinSpaceViaInvite`): without active onboarding a
 * new member counts as onboarded at once; with it, `onboarded_at` stays null until they answer.
 */
export async function markOnboardedOnJoin(
  dbx: DbOrTx,
  space: Pick<SpaceRow, 'id' | 'onboarding'>,
  userId: string,
): Promise<void> {
  if (onboardingActive(space.onboarding)) return;
  await dbx
    .update(spaceMembers)
    .set({ onboardedAt: new Date() })
    .where(and(eq(spaceMembers.spaceId, space.id), eq(spaceMembers.userId, userId)));
}

/**
 * Onboarding was switched on: the members already here count as onboarded (Discord does not
 * send existing members through it). One statement over the Space's members.
 */
export async function backfillOnboarded(dbx: DbOrTx, spaceId: string): Promise<void> {
  await dbx
    .update(spaceMembers)
    .set({ onboardedAt: sql`${spaceMembers.joinedAt}` })
    .where(and(eq(spaceMembers.spaceId, spaceId), isNull(spaceMembers.onboardedAt)));
}

/**
 * The roles my picks hand out (validated against the current prompts): every id must be an
 * option, a required prompt needs a pick, a single-select prompt takes at most one.
 */
export function rolesForAnswers(onboarding: SpaceOnboarding, optionIds: readonly string[]): string[] {
  const picked = new Set(optionIds);
  const known = new Set(onboarding.prompts.flatMap((p) => p.options.map((o) => o.id)));
  for (const id of picked)
    if (!known.has(id)) throw badRequest('optionIds: These questions changed. Reload and try again.');
  const roles = new Set<string>();
  for (const p of onboarding.prompts) {
    const mine = p.options.filter((o) => picked.has(o.id));
    if (p.required && mine.length === 0) throw badRequest(`optionIds: Answer “${p.title}” to finish`);
    if (p.singleSelect && mine.length > 1) throw badRequest(`optionIds: Pick one answer for “${p.title}”`);
    for (const o of mine) for (const r of o.roleIds) roles.add(r);
  }
  return [...roles];
}

const blankToNull = (s: string | null | undefined): string | null => (s?.trim() ? s.trim() : null);

/**
 * Validate and normalise an onboarding body: unique prompt and option ids (answers name
 * options across all prompts), a question before it can be switched on, and roles that exist,
 * are not @everyone and sit below my highest role (handing out roles needs MANAGE_ROLES).
 */
export function normalizeOnboarding(
  access: SpaceAccess,
  me: string,
  input: SpaceOnboarding,
): SpaceOnboarding {
  if (input.enabled && input.prompts.length === 0)
    throw badRequest('onboarding: Add at least one question before turning onboarding on');
  const promptIds = new Set<string>();
  const optionIds = new Set<string>();
  for (const p of input.prompts) {
    if (promptIds.has(p.id)) throw badRequest('onboarding: Each question needs its own id');
    promptIds.add(p.id);
    for (const o of p.options) {
      if (optionIds.has(o.id)) throw badRequest('onboarding: Each option needs its own id');
      optionIds.add(o.id);
    }
  }
  const roleIds = new Set(input.prompts.flatMap((p) => p.options.flatMap((o) => o.roleIds)));
  if (roleIds.size && !hasPerm(access.base, PERM.MANAGE_ROLES))
    throw forbidden('You need Manage Roles to hand out roles in onboarding');
  const byId = new Map(access.ctx.roles.map((r) => [r.id, r]));
  const top = myTop(access, me);
  for (const id of roleIds) {
    const role = byId.get(id);
    if (!role || role.isDefault) throw badRequest('onboarding: Pick roles of this Space');
    if (role.position >= top)
      throw badRequest(`onboarding: You can only hand out roles below your highest role (${role.name})`);
  }
  return {
    enabled: input.enabled,
    prompts: input.prompts.map((p) => ({
      id: p.id,
      title: p.title,
      singleSelect: p.singleSelect,
      required: p.required,
      options: p.options.map(
        (o): OnboardingOption => ({
          id: o.id,
          title: o.title,
          description: blankToNull(o.description),
          emoji: blankToNull(o.emoji),
          roleIds: [...new Set(o.roleIds)],
        }),
      ),
    })),
  };
}

// ---------------------------------------------------------------------------
// Welcome screen
// ---------------------------------------------------------------------------

/** Channel types a welcome screen can recommend. */
const WELCOME_CHANNEL_TYPES = new Set(['space_text', 'space_forum']);

/**
 * Validate and normalise a welcome screen: each recommended channel once, a text (or forum)
 * channel of this Space that new members (@everyone, no roles) can see — any member reads the
 * welcome screen, so it must never point at a private channel.
 */
export async function normalizeWelcomeScreen(
  dbx: DbOrTx,
  access: SpaceAccess,
  spaceId: string,
  input: WelcomeScreen,
): Promise<WelcomeScreen> {
  const ids = input.channels.map((c) => c.channelId);
  if (new Set(ids).size !== ids.length)
    throw badRequest('welcomeScreen: Recommend each channel only once');
  if (ids.length) {
    const rows = await dbx
      .select({ id: chats.id, type: chats.type, name: chats.name })
      .from(chats)
      .where(and(eq(chats.spaceId, spaceId), inArray(chats.id, ids)));
    const byId = new Map(rows.map((r) => [r.id, r]));
    const overwrites = await loadChannelOverwrites(dbx, ids);
    const { ctx } = access;
    const everyone = { everyoneRoleId: ctx.everyoneRoleId, memberRoleIds: [] as string[], viewerId: '' };
    const base = computeBasePermissions({ ...everyone, ownerId: ctx.ownerId, roles: ctx.roles });
    for (const id of ids) {
      const ch = byId.get(id);
      if (!ch || !WELCOME_CHANNEL_TYPES.has(ch.type))
        throw badRequest('welcomeScreen: Recommend text channels of this Space');
      const bits = computeChannelPermissions(base, {
        ...everyone,
        channelType: ch.type as 'space_text' | 'space_forum',
        overwrites: overwrites.get(id) ?? [],
        timedOut: false,
      });
      if (!hasPerm(bits, PERM.VIEW_CHANNEL))
        throw badRequest(`welcomeScreen: #${ch.name ?? 'channel'} is not visible to new members`);
    }
  }
  return {
    enabled: input.enabled,
    description: blankToNull(input.description),
    channels: input.channels.map((c) => ({
      channelId: c.channelId,
      description: c.description,
      emoji: blankToNull(c.emoji),
    })),
  };
}

// ---------------------------------------------------------------------------
// Serialisers
// ---------------------------------------------------------------------------

type CommunityColumns = Pick<
  SpaceRow,
  'isDiscoverable' | 'discoveryCategory' | 'discoveryTags' | 'vanityCode' | 'welcomeScreen' | 'onboarding'
>;

/** The community settings; the vanity code only for MANAGE_SPACE (like `Space.vanityCode`). */
export function toSpaceCommunity(s: CommunityColumns, canManage: boolean): SpaceCommunity {
  return {
    isDiscoverable: s.isDiscoverable,
    discoveryCategory: (s.discoveryCategory as DiscoveryCategory | null) ?? null,
    discoveryTags: s.discoveryTags ?? [],
    vanityCode: canManage ? s.vanityCode : null,
    welcomeScreen: s.welcomeScreen ?? null,
    onboarding: s.onboarding ?? null,
  };
}

/** Listed in discovery: discoverable, with the description and category it needs. */
export function isListed(
  s: Pick<SpaceRow, 'isDiscoverable' | 'discoveryCategory' | 'description'>,
): boolean {
  return s.isDiscoverable && !!s.discoveryCategory && !!s.description?.trim();
}

const LISTED = sql`${spaces.isDiscoverable} and ${spaces.discoveryCategory} is not null and coalesce(trim(${spaces.description}), '') <> ''`;

/** `%term%` for ILIKE with the wildcards of the term escaped. */
function containsPattern(term: string): string {
  return `%${term.replace(/[%_\\]/g, '\\$&')}%`;
}

/**
 * One page of discoverable Spaces, the biggest first (`spaces_discovery_idx`), filtered by
 * category and by a search over name, description and tags; `joined` is the viewer's.
 */
export async function discoverSpaces(
  dbx: DbOrTx,
  viewerId: string,
  q: { q?: string; category?: DiscoveryCategory; offset: number },
): Promise<DiscoveryPage> {
  const term = q.q?.trim();
  const pattern = term ? containsPattern(term) : null;
  const where = and(
    LISTED,
    q.category ? eq(spaces.discoveryCategory, q.category) : undefined,
    pattern
      ? or(
          sql`${spaces.name} ilike ${pattern}`,
          sql`${spaces.description} ilike ${pattern}`,
          sql`exists (select 1 from unnest(${spaces.discoveryTags}) as t(tag) where t.tag ilike ${pattern})`,
        )
      : undefined,
  );
  const rows = await dbx
    .select({
      id: spaces.id,
      name: spaces.name,
      description: spaces.description,
      iconMediaId: spaces.iconMediaId,
      bannerMediaId: spaces.bannerMediaId,
      memberCount: spaces.memberCount,
      category: spaces.discoveryCategory,
      tags: spaces.discoveryTags,
      joined: sql<boolean>`${spaceMembers.userId} is not null`,
    })
    .from(spaces)
    .leftJoin(spaceMembers, and(eq(spaceMembers.spaceId, spaces.id), eq(spaceMembers.userId, viewerId)))
    .where(where)
    .orderBy(desc(spaces.memberCount), asc(spaces.id))
    .limit(DISCOVERY_PAGE_SIZE)
    .offset(q.offset);
  const [total] = await dbx.select({ n: count() }).from(spaces).where(where);
  const mediaById = await loadMediaMap(
    dbx,
    rows.flatMap((r) => [r.iconMediaId, r.bannerMediaId]),
  );
  const url = (id: string | null, m: ReadonlyMap<string, MediaRow>) => {
    const row = id ? m.get(id) : undefined;
    return row ? staticMediaUrl(row) : null;
  };
  return {
    spaces: rows.map(
      (r): DiscoverableSpace => ({
        id: r.id,
        name: r.name,
        description: r.description,
        iconUrl: url(r.iconMediaId, mediaById),
        bannerUrl: url(r.bannerMediaId, mediaById),
        memberCount: r.memberCount,
        category: (r.category as DiscoveryCategory | null) ?? null,
        tags: r.tags ?? [],
        joined: !!r.joined,
      }),
    ),
    total: Number(total?.n ?? 0),
  };
}
