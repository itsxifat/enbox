/**
 * Server Guide module — owns /spaces/:spaceId/guide/**, /spaces/:spaceId/channel-prefs and
 * PUT /spaces/:spaceId/onboarding/answers (docs/design/discord-parity.md W12-B). Paths are
 * relative to /api (see ApiRoutes in @enbox/shared); mounted behind requireAuth, before the
 * Spaces router. Business rules: ./service.ts.
 *
 * - The guide (welcome sign, new member to-dos, resource pages) is JSONB on the Space:
 *   MANAGE_SPACE replaces it whole; its channels must be text channels everyone can see.
 *   Saving is audited (`space.guide`) and ends in `space:guide` → Space room.
 * - To-do progress is mine (`space_members.guide_done`): visiting a to-do's channel ticks it.
 * - Browse Channels: my choices that differ from each channel's default (opt-in channels are
 *   hidden until shown) → `me:channel-prefs` to my devices.
 * - Channels & Roles: changing my onboarding answers adds and removes roles
 *   (`answerRoleChanges`) like other role changes (perm_version bump, member update).
 */
import { Router } from 'express';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  PERM,
  channelPrefsSchema,
  idParamSchema,
  rooms,
  serverGuideSchema,
  type GuideProgress,
} from '@enbox/shared';
import { spaceMemberRoles, spaceMembers, spaces } from '../../db/schema.js';
import { authUserId } from '../../http/auth.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { assertUserLimit } from '../../lib/userLimit.js';
import { parse } from '../../lib/validate.js';
import { emitToRooms } from '../../realtime/emit.js';
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
  fxSpaceUpsert,
  toSpaceMembers,
} from '../../services/spaces.js';
import { onboardingActive } from '../community/service.js';
import {
  answerRoleChanges,
  changeAnswersSchema,
  loadChannelPrefs,
  normalizeGuide,
  saveChannelPrefs,
  validateAnswers,
} from './service.js';
import './hooks.js';

export const router = Router();

const P = {
  space: idParamSchema('spaceId'),
  todo: idParamSchema('spaceId', 'channelId'),
};

/** Guide saves per user. */
const GUIDE_LIMIT = { limit: 30, windowMs: 60_000 } as const;
/** To-dos ticked per user (each at most once per Space). */
const TODO_LIMIT = { limit: 60, windowMs: 60_000 } as const;
/** Browse Channels saves per user (batched by the client). */
const PREFS_LIMIT = { limit: 60, windowMs: 60_000 } as const;
/** Answer changes per user (the onboarding submissions' bucket). */
const ANSWERS_LIMIT = { limit: 20, windowMs: 60_000 } as const;

// ---------------------------------------------------------------------------
// Server Guide
// ---------------------------------------------------------------------------

// PUT /spaces/:spaceId/guide (MANAGE_SPACE) { guide } → ServerGuide; no body = remove it (null).
// At most GUIDE_MAX_TODOS to-dos and GUIDE_MAX_RESOURCES resources (schema); channels: text
// channels of this Space everyone can see, each once per list (400). Audited; space:guide → room.
router.put('/spaces/:spaceId/guide', async (req, res) => {
  const me = authUserId(req);
  const { spaceId } = parse(P.space, req.params);
  const body = parse(serverGuideSchema, req.body ?? null);
  assertUserLimit(me, 'guideUpdate', GUIDE_LIMIT);
  const guide = await transact(async (tx, fx) => {
    await lockSpace(tx, spaceId);
    const access = await requireSpacePermission(tx, spaceId, me, PERM.MANAGE_SPACE);
    const next = body ? await normalizeGuide(tx, access, spaceId, body) : null;
    await tx
      .update(spaces)
      .set({ guide: next, updatedAt: new Date() })
      .where(eq(spaces.id, spaceId));
    await audit(tx, {
      spaceId,
      actorId: me,
      action: 'space.guide',
      targetType: 'space',
      targetId: spaceId,
      changes: next
        ? { enabled: next.enabled, todos: next.todos.length, resources: next.resources.length }
        : { removed: true },
    });
    // Viewer-neutral: the guide only names channels everyone can see.
    fx.add(() => emitToRooms([rooms.space(spaceId)], 'space:guide', { spaceId, guide: next }));
    return next;
  });
  res.json(guide);
});

// POST /spaces/:spaceId/guide/todos/:channelId/done → GuideProgress (idempotent): a to-do of
// the Space's enabled guide (404 otherwise). The first time: space:upsert → my devices.
router.post('/spaces/:spaceId/guide/todos/:channelId/done', async (req, res) => {
  const me = authUserId(req);
  const { spaceId, channelId } = parse(P.todo, req.params);
  assertUserLimit(me, 'guideTodoDone', TODO_LIMIT);
  const progress = await transact(async (tx, fx): Promise<GuideProgress> => {
    await requireSpaceMember(tx, spaceId, me);
    const [row] = await tx
      .select({ guide: spaces.guide })
      .from(spaces)
      .where(eq(spaces.id, spaceId))
      .limit(1);
    if (!row?.guide?.enabled || !row.guide.todos.some((t) => t.channelId === channelId))
      throw notFound('To-do');
    const mine = and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.userId, me));
    const [ticked] = await tx
      .update(spaceMembers)
      .set({ guideDone: sql`array_append(${spaceMembers.guideDone}, ${channelId}::uuid)` })
      .where(and(mine, sql`not (${channelId}::uuid = any(${spaceMembers.guideDone}))`))
      .returning({ done: spaceMembers.guideDone });
    if (ticked) {
      fxSpaceUpsert(fx, me, spaceId);
      return { doneChannelIds: ticked.done };
    }
    const [cur] = await tx.select({ done: spaceMembers.guideDone }).from(spaceMembers).where(mine);
    return { doneChannelIds: cur?.done ?? [] };
  });
  res.json(progress);
});

// ---------------------------------------------------------------------------
// Browse Channels
// ---------------------------------------------------------------------------

// PUT /spaces/:spaceId/channel-prefs { prefs } → ChannelPref[] (all of mine in the Space).
// Channels I can see (404 otherwise); me:channel-prefs → my devices.
router.put('/spaces/:spaceId/channel-prefs', async (req, res) => {
  const me = authUserId(req);
  const { spaceId } = parse(P.space, req.params);
  const { prefs } = parse(channelPrefsSchema, req.body ?? {});
  assertUserLimit(me, 'channelPrefs', PREFS_LIMIT);
  const out = await transact(async (tx, fx) => {
    const access = await requireSpaceMember(tx, spaceId, me);
    await saveChannelPrefs(tx, access, spaceId, me, prefs);
    const all = await loadChannelPrefs(tx, spaceId, me);
    fx.toUser(me, 'me:channel-prefs', { spaceId, prefs: all });
    return all;
  });
  res.json(out);
});

// ---------------------------------------------------------------------------
// Channels & Roles
// ---------------------------------------------------------------------------

// PUT /spaces/:spaceId/onboarding/answers { answers } → { roleIds } (mine). Checked against the
// current questions (400 when they changed, a required one is unanswered or a single-select
// one has two picks); roles follow (`answerRoleChanges`) with one perm_version bump, audited:
// space:member-updated → room, my channel list refetches. The answers are saved, I count as
// onboarded; space:upsert → my devices.
router.put('/spaces/:spaceId/onboarding/answers', async (req, res) => {
  const me = authUserId(req);
  const { spaceId } = parse(P.space, req.params);
  const { answers } = parse(changeAnswersSchema, req.body ?? {});
  assertUserLimit(me, 'onboardingAnswers', ANSWERS_LIMIT);
  const roleIds = await transact(async (tx, fx) => {
    const space = await lockSpace(tx, spaceId);
    const access = await requireSpaceMember(tx, spaceId, me);
    if (!onboardingActive(space.onboarding)) throw badRequest('This Space has no onboarding');
    const next = validateAnswers(space.onboarding, answers);
    const grantable = new Set(access.ctx.roles.filter((r) => !r.isDefault).map((r) => r.id));
    const { added, removed } = answerRoleChanges(
      space.onboarding,
      access.me.member.onboardingAnswers,
      next,
      access.me.roleIds,
      grantable,
    );
    if (removed.length)
      await tx
        .delete(spaceMemberRoles)
        .where(
          and(
            eq(spaceMemberRoles.spaceId, spaceId),
            eq(spaceMemberRoles.userId, me),
            inArray(spaceMemberRoles.roleId, removed),
          ),
        );
    if (added.length)
      await tx
        .insert(spaceMemberRoles)
        .values(added.map((roleId) => ({ spaceId, userId: me, roleId })))
        .onConflictDoNothing();
    const [row] = await tx
      .update(spaceMembers)
      .set({
        onboardingAnswers: next,
        onboardedAt: sql`coalesce(${spaceMembers.onboardedAt}, now())`,
      })
      .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.userId, me)))
      .returning();
    const roleIds = [...access.me.roleIds.filter((id) => !removed.includes(id)), ...added];
    if (added.length || removed.length) {
      await bumpPermVersion(tx, spaceId);
      await audit(tx, {
        spaceId,
        actorId: me,
        action: 'member.roles',
        targetType: 'member',
        targetId: me,
        changes: { roles: { added, removed } },
        reason: 'Channels & Roles',
      });
      const [member] = await toSpaceMembers(tx, [{ member: row!, roleIds }]);
      fxMemberEvent(fx, space, () => ({ event: 'space:member-updated', member: member! }));
      fxMemberChanged(fx, spaceId, me);
      // Roles open and close channels: my devices refetch the list.
      fxChannelsChanged(fx, spaceId, me);
    }
    fxSpaceUpsert(fx, me, spaceId);
    return roleIds;
  });
  res.json({ roleIds });
});
