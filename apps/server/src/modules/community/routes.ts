/**
 * Community module — owns /discover/* (Space discovery), /spaces/:spaceId/community (the
 * discovery listing, vanity URL, welcome screen and onboarding settings) and
 * /spaces/:spaceId/onboarding/answers (docs/design/discord-parity.md W12).
 *
 * - Discovery lists Spaces that are discoverable with a description and a category, biggest
 *   first; joining one goes through the invite join (bans, member cap, Space limit).
 * - Settings: members read them, MANAGE_SPACE edits (handing out roles also needs
 *   MANAGE_ROLES); edits lock the Space, are audited and end in `space:updated` → room.
 * - Onboarding answers add the roles of my picks (never remove any) in one transaction, then
 *   mark me onboarded. Joins without active onboarding are marked at join (invites.ts hook).
 */
import { Router } from 'express';
import { and, eq, sql } from 'drizzle-orm';
import {
  PERM,
  discoveryQuerySchema,
  hasPerm,
  idParamSchema,
  onboardingAnswersSchema,
  updateSpaceCommunitySchema,
  type SpaceCommunity,
  type SpaceDetail,
  type SpaceOnboarding,
  type WelcomeScreen,
} from '@enbox/shared';
import { db } from '../../db/index.js';
import { spaceMemberRoles, spaceMembers, spaces } from '../../db/schema.js';
import { authUserId } from '../../http/auth.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { assertUserLimit } from '../../lib/userLimit.js';
import { parse } from '../../lib/validate.js';
import { transact } from '../../services/effects.js';
import {
  bumpPermVersion,
  lockSpace,
  requireSpaceMember,
  requireSpacePermission,
} from '../../services/spaceAccess.js';
import {
  audit,
  fxChannelsChanged,
  fxMemberChanged,
  fxMemberEvent,
  fxSpaceUpdated,
  fxSpaceUpsert,
  toSpace,
  toSpaceMembers,
} from '../../services/spaces.js';
import { spaceChannelSummaries } from '../../services/spaceSummaries.js';
import { isUniqueViolation } from '../auth/service.js';
import { joinSpaceViaInvite } from '../spaces/invites.js';
import {
  VANITY_TAKEN,
  assertVanityFree,
  backfillOnboarded,
  discoverSpaces,
  isListed,
  normalizeOnboarding,
  normalizeWelcomeScreen,
  onboardingActive,
  rolesForAnswers,
  toSpaceCommunity,
} from './service.js';
import './hooks.js';

export const router = Router();

const P = { space: idParamSchema('spaceId') };

/** Discovery searches per user (a light limit: each page is one indexed query). */
const DISCOVERY_LIMIT = { limit: 120, windowMs: 60_000 } as const;
/** Onboarding submissions per user. */
const ONBOARDING_LIMIT = { limit: 20, windowMs: 60_000 } as const;

/** Query strings: blank values (`?q=&category=`) count as absent. */
function withoutBlanks(query: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(query).filter(([, v]) => v !== '' && v !== undefined));
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

// GET /discover/spaces?q=&category=&offset= → DiscoveryPage (any signed-in user)
router.get('/discover/spaces', async (req, res) => {
  const me = authUserId(req);
  const q = parse(discoveryQuerySchema, withoutBlanks(req.query));
  assertUserLimit(me, 'discoverSpaces', DISCOVERY_LIMIT);
  res.json(await discoverSpaces(db, me, q));
});

// POST /discover/spaces/:spaceId/join → SpaceDetail. A listed Space only (else 404); joins
// like an invite: banned 403, already a member 409, full / too many Spaces 409.
router.post('/discover/spaces/:spaceId/join', async (req, res) => {
  const me = authUserId(req);
  const { spaceId } = parse(P.space, req.params);
  await transact(async (tx, fx) => {
    const space = await lockSpace(tx, spaceId);
    if (!isListed(space)) throw notFound('Space');
    await joinSpaceViaInvite(tx, fx, me, '', { invite: null, space });
  });
  const space = await toSpace(db, me, spaceId);
  if (!space) throw notFound('Space');
  const detail: SpaceDetail = { space, channels: await spaceChannelSummaries(db, me, spaceId) };
  res.json(detail);
});

// ---------------------------------------------------------------------------
// Community settings
// ---------------------------------------------------------------------------

// GET /spaces/:spaceId/community → SpaceCommunity (members; the vanity code for MANAGE_SPACE)
router.get('/spaces/:spaceId/community', async (req, res) => {
  const me = authUserId(req);
  const { spaceId } = parse(P.space, req.params);
  const access = await requireSpaceMember(db, spaceId, me);
  const [row] = await db
    .select({
      isDiscoverable: spaces.isDiscoverable,
      discoveryCategory: spaces.discoveryCategory,
      discoveryTags: spaces.discoveryTags,
      vanityCode: spaces.vanityCode,
      welcomeScreen: spaces.welcomeScreen,
      onboarding: spaces.onboarding,
    })
    .from(spaces)
    .where(eq(spaces.id, spaceId))
    .limit(1);
  if (!row) throw notFound('Space');
  res.json(toSpaceCommunity(row, hasPerm(access.base, PERM.MANAGE_SPACE)));
});

// PATCH /spaces/:spaceId/community (MANAGE_SPACE) → SpaceCommunity. Listing needs a description
// and a category (400); a vanity code taken anywhere → 409; welcome channels must be text
// channels new members can see; onboarding roles below my highest role (400). Audited per
// area; space:updated { isDiscoverable } → room; the vanity code → space:upsert → U(me).
router.patch('/spaces/:spaceId/community', async (req, res) => {
  const me = authUserId(req);
  const { spaceId } = parse(P.space, req.params);
  const body = parse(updateSpaceCommunitySchema, req.body ?? {});
  const out = await transact(async (tx, fx): Promise<SpaceCommunity> => {
    const space = await lockSpace(tx, spaceId);
    const access = await requireSpacePermission(tx, spaceId, me, PERM.MANAGE_SPACE);
    const patch: Partial<typeof spaces.$inferInsert> = {};
    const discovery: Record<string, unknown> = {};

    if (body.isDiscoverable !== undefined && body.isDiscoverable !== space.isDiscoverable) {
      patch.isDiscoverable = body.isDiscoverable;
      discovery.isDiscoverable = [space.isDiscoverable, body.isDiscoverable];
    }
    if (body.discoveryCategory !== undefined && body.discoveryCategory !== space.discoveryCategory) {
      patch.discoveryCategory = body.discoveryCategory;
      discovery.discoveryCategory = [space.discoveryCategory, body.discoveryCategory];
    }
    if (body.discoveryTags !== undefined) {
      const tags = [...new Set(body.discoveryTags)];
      if (tags.join('\u0000') !== space.discoveryTags.join('\u0000')) {
        patch.discoveryTags = tags;
        discovery.discoveryTags = [space.discoveryTags, tags];
      }
    }
    // Discord: a listing needs a description (Overview) and a category.
    const listed = patch.isDiscoverable ?? space.isDiscoverable;
    if (listed && (body.isDiscoverable !== undefined || body.discoveryCategory !== undefined)) {
      if (!space.description?.trim())
        throw badRequest(
          'isDiscoverable: Add a description in Overview before listing your Space in discovery',
        );
      const category =
        patch.discoveryCategory !== undefined ? patch.discoveryCategory : space.discoveryCategory;
      if (!category)
        throw badRequest('discoveryCategory: Pick a category before listing your Space in discovery');
    }
    if (body.vanityCode !== undefined && body.vanityCode !== space.vanityCode) {
      if (body.vanityCode) await assertVanityFree(tx, body.vanityCode, spaceId);
      patch.vanityCode = body.vanityCode;
      discovery.vanityCode = [space.vanityCode, body.vanityCode];
    }
    let welcome: WelcomeScreen | null | undefined;
    if (body.welcomeScreen !== undefined) {
      welcome = body.welcomeScreen
        ? await normalizeWelcomeScreen(tx, access, spaceId, body.welcomeScreen)
        : null;
      patch.welcomeScreen = welcome;
    }
    let onboarding: SpaceOnboarding | null | undefined;
    if (body.onboarding !== undefined) {
      onboarding = body.onboarding ? normalizeOnboarding(access, me, body.onboarding) : null;
      patch.onboarding = onboarding;
    }
    if (Object.keys(patch).length === 0) return toSpaceCommunity(space, true);

    const [row] = await tx
      .update(spaces)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(spaces.id, spaceId))
      .returning();
    if (onboarding !== undefined && onboardingActive(onboarding) && !onboardingActive(space.onboarding))
      await backfillOnboarded(tx, spaceId);
    const entry = { spaceId, actorId: me, targetType: 'space' as const, targetId: spaceId };
    if (Object.keys(discovery).length)
      await audit(tx, { ...entry, action: 'space.discovery.update', changes: discovery });
    if (welcome !== undefined)
      await audit(tx, {
        ...entry,
        action: 'space.welcome_screen.update',
        changes: { enabled: welcome?.enabled ?? false, channels: welcome?.channels.length ?? 0 },
      });
    if (onboarding !== undefined)
      await audit(tx, {
        ...entry,
        action: 'space.onboarding.update',
        changes: { enabled: onboarding?.enabled ?? false, prompts: onboarding?.prompts.length ?? 0 },
      });
    // Members see the listing flag at once; clients refetch the rest when they need it.
    fxSpaceUpdated(fx, spaceId, { isDiscoverable: row!.isDiscoverable });
    if (patch.vanityCode !== undefined) fxSpaceUpsert(fx, me, spaceId);
    return toSpaceCommunity(row!, true);
  }).catch((err: unknown) => {
    // Two Spaces claiming one vanity code at once: the unique index decides.
    if (isUniqueViolation(err, 'spaces_vanity_code_uq')) throw conflict(VANITY_TAKEN);
    throw err;
  });
  res.json(out);
});

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------

// POST /spaces/:spaceId/onboarding/answers { optionIds } → Space. Validated against the current
// prompts (required, single-select); the roles of my picks are added (none removed) with one
// perm_version bump: space:member-updated → room, my channel list refetches; onboardedAt set;
// space:upsert → U(me).
router.post('/spaces/:spaceId/onboarding/answers', async (req, res) => {
  const me = authUserId(req);
  const { spaceId } = parse(P.space, req.params);
  const { optionIds } = parse(onboardingAnswersSchema, req.body ?? {});
  assertUserLimit(me, 'onboardingAnswers', ONBOARDING_LIMIT);
  await transact(async (tx, fx) => {
    const space = await lockSpace(tx, spaceId);
    const access = await requireSpaceMember(tx, spaceId, me);
    if (!onboardingActive(space.onboarding)) throw badRequest('This Space has no onboarding');
    const byId = new Map(access.ctx.roles.map((r) => [r.id, r]));
    // Roles deleted since the prompts were saved are skipped.
    const added = rolesForAnswers(space.onboarding, optionIds).filter(
      (id) => byId.has(id) && !byId.get(id)!.isDefault && !access.me.roleIds.includes(id),
    );
    if (added.length) {
      await tx
        .insert(spaceMemberRoles)
        .values(added.map((roleId) => ({ spaceId, userId: me, roleId })))
        .onConflictDoNothing();
      await bumpPermVersion(tx, spaceId);
      await audit(tx, {
        spaceId,
        actorId: me,
        action: 'member.roles',
        targetType: 'member',
        targetId: me,
        changes: { roles: { added, removed: [] } },
        reason: 'Onboarding',
      });
    }
    const [row] = await tx
      .update(spaceMembers)
      .set({ onboardedAt: sql`coalesce(${spaceMembers.onboardedAt}, now())` })
      .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.userId, me)))
      .returning();
    if (added.length) {
      const [member] = await toSpaceMembers(tx, [
        { member: row!, roleIds: [...access.me.roleIds, ...added] },
      ]);
      fxMemberEvent(fx, space, () => ({ event: 'space:member-updated', member: member! }));
      fxMemberChanged(fx, spaceId, me);
      // New roles can open channels: my devices refetch the list.
      fxChannelsChanged(fx, spaceId, me);
    }
    fxSpaceUpsert(fx, me, spaceId);
  });
  const space = await toSpace(db, me, spaceId);
  if (!space) throw notFound('Space');
  res.json(space);
});
