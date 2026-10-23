/**
 * AutoMod rules of a Space (matching and enforcement: services/automod.ts).
 *
 * - GET    /spaces/:spaceId/automod/rules           MANAGE_SPACE → AutoModRule[] (creation order)
 * - POST   /spaces/:spaceId/automod/rules           MANAGE_SPACE → AutoModRule (201)
 * - PATCH  /spaces/:spaceId/automod/rules/:ruleId   MANAGE_SPACE → AutoModRule
 * - DELETE /spaces/:spaceId/automod/rules/:ruleId   MANAGE_SPACE → 204
 * Non-members get 404, members without MANAGE_SPACE 403.
 *
 * Limits (Discord's model): at most MAX_AUTOMOD_RULES per Space (409 `limit_reached`), and one
 * `mention_spam`, one `spam_links` and one `preset` rule (409 `conflict`); keyword rules fill
 * the rest. Checks (400): a keyword rule needs a keyword or a pattern, every pattern passes
 * `regexProblem` (no backreferences, lookarounds or nested quantifiers), a preset rule needs a
 * list, one action of each type, the alert channel is a text channel of the Space, exempt
 * roles are roles of the Space (not @everyone) and exempt channels its channels. Metadata is
 * kept per type only (a keyword rule has no `mentionLimit`…); `mention_spam` defaults to
 * DEFAULT_MENTION_LIMIT. A PATCH checks the fields it sends (the trigger type never changes;
 * `triggerMetadata`, `actions` and the exemption lists are replaced whole); unchanged → no
 * write, no event.
 *
 * Mutations lock the Space row, bump `spaces.perm_version` (the AutoMod cache key on every
 * process), write an audit entry (`automod.rule.create|update|delete`, target = the rule) and,
 * after commit, send `automod:rules { spaceId, rules }` (the whole list) to the managers: the
 * owner and the members whose roles grant MANAGE_SPACE or ADMINISTRATOR — the Space room when
 * @everyone grants it. The editor's other devices and fellow managers refresh from it.
 */
import { Router } from 'express';
import { and, eq, inArray } from 'drizzle-orm';
import {
  MAX_AUTOMOD_RULES,
  PERM,
  createAutoModRuleSchema,
  idParamSchema,
  rooms,
  updateAutoModRuleSchema,
  type AutoModAction,
  type AutoModRule,
  type AutoModTriggerMetadata,
  type AutoModTriggerType,
} from '@enbox/shared';
import type { z } from 'zod';
import { db, type DbOrTx, type Tx } from '../../db/index.js';
import { automodRules, chats, spaceMemberRoles } from '../../db/schema.js';
import { authUserId } from '../../http/auth.js';
import { badRequest, conflict, limitReached, notFound } from '../../lib/errors.js';
import { assertUserLimit } from '../../lib/userLimit.js';
import { parse } from '../../lib/validate.js';
import { emitToRooms, emitToUsers } from '../../realtime/emit.js';
import {
  DEFAULT_MENTION_LIMIT,
  forgetAutoModRules,
  loadAutoModRules,
  regexProblem,
  toAutoModRule,
  type AutoModRuleRow,
} from '../../services/automod.js';
import { transact, type Effects } from '../../services/effects.js';
import {
  bumpPermVersion,
  loadSpacePermCtx,
  lockSpace,
  requireSpacePermission,
  type SpaceAccess,
} from '../../services/spaceAccess.js';
import { audit } from '../../services/spaces.js';
import { uniq } from '../../services/sql.js';

export const router = Router();

const P = {
  space: idParamSchema('spaceId'),
  rule: idParamSchema('spaceId', 'ruleId'),
};

/** Rule creations, edits and deletions per user (server-side abuse limit). */
const AUTOMOD_UPDATE_LIMIT = { limit: 120, windowMs: 10 * 60_000 };
const SINGLE_RULE_TYPES = new Set<AutoModTriggerType>(['mention_spam', 'spam_links', 'preset']);
const MANAGERS = PERM.MANAGE_SPACE | PERM.ADMINISTRATOR;

type CreateBody = z.output<typeof createAutoModRuleSchema>;
type UpdateBody = z.output<typeof updateAutoModRuleSchema>;

/** The metadata a rule of this type keeps (see the header). */
function metadataFor(type: AutoModTriggerType, md: AutoModTriggerMetadata): AutoModTriggerMetadata {
  switch (type) {
    case 'keyword': {
      const keywords = uniq(md.keywords ?? []);
      const regexPatterns = uniq(md.regexPatterns ?? []);
      for (const p of regexPatterns) {
        const problem = regexProblem(p);
        if (problem) throw badRequest(`triggerMetadata.regexPatterns: ${JSON.stringify(p)} ${problem}`);
      }
      if (keywords.length === 0 && regexPatterns.length === 0)
        throw badRequest('triggerMetadata.keywords: Add at least one keyword or pattern');
      return { keywords, regexPatterns, allowList: uniq(md.allowList ?? []) };
    }
    case 'preset': {
      const presets = uniq(md.presets ?? []);
      if (presets.length === 0) throw badRequest('triggerMetadata.presets: Choose at least one word list');
      return { presets, allowList: uniq(md.allowList ?? []) };
    }
    case 'mention_spam':
      return { mentionLimit: md.mentionLimit ?? DEFAULT_MENTION_LIMIT };
    case 'spam_links':
      return {};
  }
}

async function checkActions(tx: DbOrTx, spaceId: string, actions: AutoModAction[]): Promise<AutoModAction[]> {
  const seen = new Set<string>();
  const out: AutoModAction[] = [];
  for (const a of actions) {
    if (seen.has(a.type)) throw badRequest(`actions: Only one ${a.type} action per rule`);
    seen.add(a.type);
    if (a.type === 'alert') {
      const [ch] = await tx
        .select({ id: chats.id })
        .from(chats)
        .where(and(eq(chats.id, a.channelId), eq(chats.spaceId, spaceId), eq(chats.type, 'space_text')))
        .limit(1);
      if (!ch) throw badRequest('actions: The alert channel must be a text channel of this Space');
      out.push({ type: 'alert', channelId: a.channelId });
    } else if (a.type === 'block') {
      out.push({ type: 'block', customMessage: a.customMessage?.trim() || null });
    } else out.push({ type: 'timeout', durationSeconds: a.durationSeconds });
  }
  return out;
}

function checkExemptRoles(access: SpaceAccess, roleIds: string[]): string[] {
  const out = uniq(roleIds);
  const roles = new Map(access.ctx.roles.map((r) => [r.id, r]));
  for (const id of out) if (!roles.get(id) || roles.get(id)!.isDefault) throw badRequest('exemptRoleIds: Unknown role');
  return out;
}

async function checkExemptChannels(tx: DbOrTx, spaceId: string, channelIds: string[]): Promise<string[]> {
  const out = uniq(channelIds);
  if (out.length === 0) return out;
  const found = await tx
    .select({ id: chats.id })
    .from(chats)
    .where(
      and(
        eq(chats.spaceId, spaceId),
        inArray(chats.id, out),
        inArray(chats.type, ['space_text', 'space_voice', 'space_forum']),
      ),
    );
  if (found.length !== out.length) throw badRequest('exemptChannelIds: Unknown channel');
  return out;
}

/** The checked, normalized fields of a new rule. */
async function checkRule(tx: Tx, access: SpaceAccess, rule: CreateBody) {
  return {
    name: rule.name,
    triggerType: rule.triggerType,
    triggerMetadata: metadataFor(rule.triggerType, rule.triggerMetadata),
    actions: await checkActions(tx, access.ctx.spaceId, rule.actions),
    enabled: rule.enabled,
    exemptRoleIds: checkExemptRoles(access, rule.exemptRoleIds),
    exemptChannelIds: await checkExemptChannels(tx, access.ctx.spaceId, rule.exemptChannelIds),
  };
}

/** The managers (or the Space room when @everyone manages) as of the end of the transaction. */
async function managerTargets(dbx: DbOrTx, spaceId: string): Promise<{ room: string } | { users: string[] }> {
  const ctx = await loadSpacePermCtx(dbx, spaceId);
  if (!ctx) return { users: [] };
  if (ctx.roles.some((r) => r.isDefault && (r.permissions & MANAGERS) !== 0)) return { room: rooms.space(spaceId) };
  const roleIds = ctx.roles.filter((r) => !r.isDefault && (r.permissions & MANAGERS) !== 0).map((r) => r.id);
  const rows = roleIds.length
    ? await dbx
        .selectDistinct({ userId: spaceMemberRoles.userId })
        .from(spaceMemberRoles)
        .where(and(eq(spaceMemberRoles.spaceId, spaceId), inArray(spaceMemberRoles.roleId, roleIds)))
    : [];
  return { users: uniq([ctx.ownerId, ...rows.map((r) => r.userId)]) };
}

/** `automod:rules` with the whole list → the managers, after commit; the local cache goes too. */
function fxRulesChanged(fx: Effects, spaceId: string): void {
  let rules: AutoModRule[] = [];
  let to: { room: string } | { users: string[] } = { users: [] };
  fx.add(
    () => {
      forgetAutoModRules(spaceId);
      if ('room' in to) emitToRooms([to.room], 'automod:rules', { spaceId, rules });
      else emitToUsers(to.users, 'automod:rules', { spaceId, rules });
    },
    async (dbx) => {
      rules = (await loadAutoModRules(dbx, spaceId)).map(toAutoModRule);
      to = await managerTargets(dbx, spaceId);
    },
  );
}

async function requireRule(tx: DbOrTx, spaceId: string, ruleId: string): Promise<AutoModRuleRow> {
  const [row] = await tx
    .select()
    .from(automodRules)
    .where(and(eq(automodRules.id, ruleId), eq(automodRules.spaceId, spaceId)))
    .limit(1);
  if (!row) throw notFound('Rule');
  return row;
}

// GET /spaces/:spaceId/automod/rules (MANAGE_SPACE) → AutoModRule[]
router.get('/spaces/:spaceId/automod/rules', async (req, res) => {
  const me = authUserId(req);
  const { spaceId } = parse(P.space, req.params);
  await requireSpacePermission(db, spaceId, me, PERM.MANAGE_SPACE);
  res.json((await loadAutoModRules(db, spaceId)).map(toAutoModRule));
});

// POST /spaces/:spaceId/automod/rules (MANAGE_SPACE) → AutoModRule (201)
router.post('/spaces/:spaceId/automod/rules', async (req, res) => {
  const me = authUserId(req);
  const { spaceId } = parse(P.space, req.params);
  const body = parse(createAutoModRuleSchema, req.body ?? {});
  assertUserLimit(me, 'automodUpdate', AUTOMOD_UPDATE_LIMIT);
  const out = await transact(async (tx, fx) => {
    await lockSpace(tx, spaceId);
    const access = await requireSpacePermission(tx, spaceId, me, PERM.MANAGE_SPACE);
    const existing = await tx
      .select({ triggerType: automodRules.triggerType })
      .from(automodRules)
      .where(eq(automodRules.spaceId, spaceId));
    if (existing.length >= MAX_AUTOMOD_RULES)
      throw limitReached(`A Space can have at most ${MAX_AUTOMOD_RULES} AutoMod rules`);
    if (SINGLE_RULE_TYPES.has(body.triggerType) && existing.some((r) => r.triggerType === body.triggerType))
      throw conflict('This Space already has a rule of this kind: edit that one');
    const fields = await checkRule(tx, access, body);
    const [row] = await tx
      .insert(automodRules)
      .values({ spaceId, ...fields, creatorId: me })
      .returning();
    await bumpPermVersion(tx, spaceId);
    await audit(tx, {
      spaceId,
      actorId: me,
      action: 'automod.rule.create',
      targetId: row!.id,
      changes: { name: row!.name, triggerType: row!.triggerType },
    });
    fxRulesChanged(fx, spaceId);
    return toAutoModRule(row!);
  });
  res.status(201).json(out);
});

/**
 * The fields a PATCH really sent: `updateAutoModRuleSchema` is the create schema `.partial()`,
 * and zod 4 still applies its `.default()`s there (`{ name }` would parse with `enabled: true`
 * and empty exemption lists), so keys missing from the raw body are dropped again.
 */
function sentFields(raw: unknown): UpdateBody {
  const body = parse(updateAutoModRuleSchema, raw ?? {});
  const keys = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out: UpdateBody = {};
  for (const k of Object.keys(body) as (keyof UpdateBody)[])
    if (keys[k] !== undefined) Object.assign(out, { [k]: body[k] });
  return out;
}

// PATCH /spaces/:spaceId/automod/rules/:ruleId (MANAGE_SPACE) → AutoModRule
router.patch('/spaces/:spaceId/automod/rules/:ruleId', async (req, res) => {
  const me = authUserId(req);
  const { spaceId, ruleId } = parse(P.rule, req.params);
  const body = sentFields(req.body);
  assertUserLimit(me, 'automodUpdate', AUTOMOD_UPDATE_LIMIT);
  const out = await transact(async (tx, fx) => {
    await lockSpace(tx, spaceId);
    const access = await requireSpacePermission(tx, spaceId, me, PERM.MANAGE_SPACE);
    const current = await requireRule(tx, spaceId, ruleId);
    // Only what was sent is checked again (a deleted alert channel never blocks a rename).
    const fields = {
      name: body.name ?? current.name,
      enabled: body.enabled ?? current.enabled,
      triggerMetadata: body.triggerMetadata
        ? metadataFor(current.triggerType, body.triggerMetadata)
        : current.triggerMetadata,
      actions: body.actions ? await checkActions(tx, spaceId, body.actions) : current.actions,
      exemptRoleIds: body.exemptRoleIds ? checkExemptRoles(access, body.exemptRoleIds) : current.exemptRoleIds,
      exemptChannelIds: body.exemptChannelIds
        ? await checkExemptChannels(tx, spaceId, body.exemptChannelIds)
        : current.exemptChannelIds,
    };
    const changes: Record<string, unknown> = {};
    if (fields.name !== current.name) changes.name = [current.name, fields.name];
    if (fields.enabled !== current.enabled) changes.enabled = [current.enabled, fields.enabled];
    for (const key of ['triggerMetadata', 'actions', 'exemptRoleIds', 'exemptChannelIds'] as const)
      if (JSON.stringify(fields[key]) !== JSON.stringify(current[key])) changes[key] = true;
    if (Object.keys(changes).length === 0) return toAutoModRule(current);
    const [row] = await tx
      .update(automodRules)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(automodRules.id, ruleId))
      .returning();
    await bumpPermVersion(tx, spaceId);
    await audit(tx, { spaceId, actorId: me, action: 'automod.rule.update', targetId: ruleId, changes });
    fxRulesChanged(fx, spaceId);
    return toAutoModRule(row!);
  });
  res.json(out);
});

// DELETE /spaces/:spaceId/automod/rules/:ruleId (MANAGE_SPACE) → 204
router.delete('/spaces/:spaceId/automod/rules/:ruleId', async (req, res) => {
  const me = authUserId(req);
  const { spaceId, ruleId } = parse(P.rule, req.params);
  assertUserLimit(me, 'automodUpdate', AUTOMOD_UPDATE_LIMIT);
  await transact(async (tx, fx) => {
    await lockSpace(tx, spaceId);
    await requireSpacePermission(tx, spaceId, me, PERM.MANAGE_SPACE);
    const current = await requireRule(tx, spaceId, ruleId);
    await tx.delete(automodRules).where(eq(automodRules.id, ruleId));
    await bumpPermVersion(tx, spaceId);
    await audit(tx, {
      spaceId,
      actorId: me,
      action: 'automod.rule.delete',
      targetId: ruleId,
      changes: { name: current.name, triggerType: current.triggerType },
    });
    fxRulesChanged(fx, spaceId);
  });
  res.status(204).end();
});
