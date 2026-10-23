/**
 * Space templates (Discord's server templates, docs/design/discord-parity.md W12-F): a
 * snapshot of a Space's roles, categories and channels that anyone with its code can build a
 * new Space from (`POST /spaces { template }` → services/spaces.ts `createSpaceTx`). The
 * starters of "Create Your Space" are snapshots too (STARTER_TEMPLATES).
 *
 * The snapshot never holds members, messages, emoji, stickers or invites. Its references are
 * indexes into its own arrays: role 0 is @everyone and the others follow by position; member
 * overwrites are dropped (no member travels). One template per Space (Discord; 409 for a
 * second), with a random 12-character code. Sync (`PUT`) re-snapshots the Space and moves
 * `updated_at`; `isDirty` compares the stored snapshot with one built from the Space as it is
 * now (a handful of indexed queries, on the template pages only), so it is exact: renames,
 * topics, overwrites and reorders count, member roles and messages don't.
 */
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import {
  PERM,
  isVoiceChannelType,
  starterTemplate,
  type PermissionOverwrite,
  type SpaceTemplate,
  type SpaceTemplateSnapshot,
  type TemplateChannel,
  type TemplateOverwrite,
} from '@enbox/shared';
import { db, type DbOrTx, type Tx } from '../../db/index.js';
import { chats, spaceRoles, spaceTemplates, spaces } from '../../db/schema.js';
import { generateInviteCode } from '../../lib/crypto.js';
import { conflict, notFound } from '../../lib/errors.js';
import { assertUserLimit } from '../../lib/userLimit.js';
import { transact } from '../../services/effects.js';
import {
  loadChannelOverwrites,
  lockSpace,
  requireSpacePermission,
} from '../../services/spaceAccess.js';
import { audit, loadCategories } from '../../services/spaces.js';

export const TEMPLATE_CODE_LENGTH = 12;

/** Create, sync, edit and delete, per user. */
const TEMPLATE_WRITE_LIMIT = { limit: 30, windowMs: 60 * 60_000 } as const;

type TemplateRow = typeof spaceTemplates.$inferSelect;

const TEMPLATE_TYPES = new Set(['space_text', 'space_voice', 'space_forum', 'space_stage']);

/**
 * The template snapshot of a Space as it is now: roles (@everyone first, then by position),
 * categories by position, channels in sidebar order (uncategorised first, then category by
 * category; text and forums before voice and Stages, then by position), role overwrites by
 * index (member overwrites dropped), the system and AFK channels by index.
 */
export async function buildSnapshot(dbx: DbOrTx, spaceId: string): Promise<SpaceTemplateSnapshot> {
  const [space] = await dbx
    .select({ systemChannelId: spaces.systemChannelId, afkChannelId: spaces.afkChannelId })
    .from(spaces)
    .where(eq(spaces.id, spaceId))
    .limit(1);
  if (!space) throw notFound('Space');
  const roleRows = await dbx
    .select()
    .from(spaceRoles)
    .where(eq(spaceRoles.spaceId, spaceId))
    .orderBy(asc(spaceRoles.position), asc(spaceRoles.createdAt));
  const ordered = [...roleRows.filter((r) => r.isDefault), ...roleRows.filter((r) => !r.isDefault)];
  const roleIndex = new Map(ordered.map((r, i) => [r.id, i]));
  const mapOverwrites = (list: readonly PermissionOverwrite[]): TemplateOverwrite[] =>
    list
      .filter((o) => o.targetType === 'role' && roleIndex.has(o.targetId))
      .map((o) => ({ role: roleIndex.get(o.targetId)!, allow: o.allow, deny: o.deny }))
      .sort((a, b) => a.role - b.role);

  const cats = (await loadCategories(dbx, [spaceId])).get(spaceId) ?? [];
  const catIndex = new Map(cats.map((c, i) => [c.id, i]));
  const rows = (
    await dbx
      .select()
      .from(chats)
      .where(and(eq(chats.spaceId, spaceId), isNull(chats.parentId)))
  )
    .filter((c) => TEMPLATE_TYPES.has(c.type))
    .sort((a, b) => {
      const ka = [
        a.categoryId ? (catIndex.get(a.categoryId) ?? 0) : -1,
        isVoiceChannelType(a.type) ? 1 : 0,
        a.position ?? 0,
      ];
      const kb = [
        b.categoryId ? (catIndex.get(b.categoryId) ?? 0) : -1,
        isVoiceChannelType(b.type) ? 1 : 0,
        b.position ?? 0,
      ];
      for (let i = 0; i < 3; i++) if (ka[i] !== kb[i]) return ka[i]! - kb[i]!;
      return a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1);
    });
  const overwrites = await loadChannelOverwrites(
    dbx,
    rows.map((c) => c.id),
  );
  const channels: TemplateChannel[] = rows.map((c) => ({
    type: c.type as TemplateChannel['type'],
    name: c.name ?? 'channel',
    topic: c.topic,
    category: c.categoryId ? (catIndex.get(c.categoryId) ?? null) : null,
    nsfw: c.nsfw,
    slowmodeSeconds: c.slowmodeSeconds,
    userLimit: c.userLimit,
    isNews: c.type === 'space_text' && c.isNews,
    overwrites: mapOverwrites(overwrites.get(c.id) ?? []),
  }));
  const indexOf = (id: string | null) => {
    const i = id ? rows.findIndex((c) => c.id === id) : -1;
    return i >= 0 ? i : null;
  };
  return {
    roles: ordered.map((r) => ({
      name: r.name,
      isDefault: r.isDefault,
      color: r.color,
      permissions: r.permissions,
      hoist: r.hoist,
      mentionable: r.mentionable,
    })),
    categories: cats.map((c) => ({ name: c.name, overwrites: mapOverwrites(c.overwrites) })),
    channels,
    systemChannel: indexOf(space.systemChannelId),
    afkChannel: indexOf(space.afkChannelId),
  };
}

/** JSON with sorted keys (jsonb reorders object keys, so compare snapshots canonically). */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(value ?? null);
}

export function sameSnapshot(a: SpaceTemplateSnapshot, b: SpaceTemplateSnapshot): boolean {
  return canonical(a) === canonical(b);
}

function toSpaceTemplate(row: TemplateRow, isDirty: boolean): SpaceTemplate {
  return {
    code: row.code,
    name: row.name,
    description: row.description,
    sourceSpaceId: row.sourceSpaceId,
    creatorId: row.createdBy,
    usageCount: row.usageCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    isDirty,
    snapshot: row.snapshot,
  };
}

/** The template with `isDirty` against its source Space (false once the Space is gone). */
async function withDirty(dbx: DbOrTx, row: TemplateRow): Promise<SpaceTemplate> {
  if (!row.sourceSpaceId) return toSpaceTemplate(row, false);
  const now = await buildSnapshot(dbx, row.sourceSpaceId).catch(() => null);
  return toSpaceTemplate(row, !!now && !sameSnapshot(now, row.snapshot));
}

/** The Space's template with this code (404 for another Space's or an unknown code). */
async function requireSpaceTemplate(dbx: DbOrTx, spaceId: string, code: string) {
  const [row] = await dbx
    .select()
    .from(spaceTemplates)
    .where(and(eq(spaceTemplates.code, code), eq(spaceTemplates.sourceSpaceId, spaceId)))
    .limit(1);
  if (!row) throw notFound('Template');
  return row;
}

/**
 * The snapshot `POST /spaces { template }` builds from: a starter id (STARTER_TEMPLATE_IDS)
 * or a template code, whose usage count goes up in the creating transaction. 404 otherwise.
 */
export async function templateSnapshotFor(
  tx: Tx,
  idOrCode: string,
): Promise<SpaceTemplateSnapshot> {
  const starter = starterTemplate(idOrCode);
  if (starter) return starter.snapshot;
  const [row] = await tx
    .update(spaceTemplates)
    .set({ usageCount: sql`${spaceTemplates.usageCount} + 1` })
    .where(eq(spaceTemplates.code, idOrCode))
    .returning({ snapshot: spaceTemplates.snapshot });
  if (!row) throw notFound('Template');
  return row.snapshot;
}

/** `GET /templates/:code` (any signed-in user). */
export async function getTemplate(code: string): Promise<SpaceTemplate> {
  const [row] = await db
    .select()
    .from(spaceTemplates)
    .where(eq(spaceTemplates.code, code))
    .limit(1);
  if (!row) throw notFound('Template');
  return withDirty(db, row);
}

/** `GET /spaces/:spaceId/templates` (MANAGE_SPACE): its template, if any. */
export async function listTemplates(me: string, spaceId: string): Promise<SpaceTemplate[]> {
  await requireSpacePermission(db, spaceId, me, PERM.MANAGE_SPACE);
  const rows = await db
    .select()
    .from(spaceTemplates)
    .where(eq(spaceTemplates.sourceSpaceId, spaceId))
    .orderBy(asc(spaceTemplates.createdAt));
  if (rows.length === 0) return [];
  const now = await buildSnapshot(db, spaceId);
  return rows.map((r) => toSpaceTemplate(r, !sameSnapshot(now, r.snapshot)));
}

/** `POST /spaces/:spaceId/templates` (MANAGE_SPACE) → the new template (one per Space: 409). */
export async function createTemplate(
  me: string,
  spaceId: string,
  body: { name: string; description?: string | null },
): Promise<SpaceTemplate> {
  assertUserLimit(me, 'spaceTemplateWrite', TEMPLATE_WRITE_LIMIT);
  const row = await transact(async (tx) => {
    await lockSpace(tx, spaceId);
    await requireSpacePermission(tx, spaceId, me, PERM.MANAGE_SPACE);
    const [existing] = await tx
      .select({ code: spaceTemplates.code })
      .from(spaceTemplates)
      .where(eq(spaceTemplates.sourceSpaceId, spaceId))
      .limit(1);
    if (existing) throw conflict('This Space already has a template: sync it or delete it first');
    const snapshot = await buildSnapshot(tx, spaceId);
    // A code collision (unique index) just draws again; a failed insert would abort the tx.
    for (let attempt = 0; attempt < 5; attempt++) {
      const [created] = await tx
        .insert(spaceTemplates)
        .values({
          code: generateInviteCode(TEMPLATE_CODE_LENGTH),
          sourceSpaceId: spaceId,
          name: body.name,
          description: body.description?.trim() || null,
          snapshot,
          createdBy: me,
        })
        .onConflictDoNothing()
        .returning();
      if (created) {
        await audit(tx, {
          spaceId,
          actorId: me,
          action: 'template.create',
          targetType: 'space',
          targetId: spaceId,
          changes: { code: created.code, name: created.name },
        });
        return created;
      }
    }
    throw new Error('could not allocate a template code');
  });
  return toSpaceTemplate(row, false);
}

/** `PATCH /spaces/:spaceId/templates/:code`: name and description (the snapshot stays). */
export async function updateTemplate(
  me: string,
  spaceId: string,
  code: string,
  body: { name?: string; description?: string | null },
): Promise<SpaceTemplate> {
  assertUserLimit(me, 'spaceTemplateWrite', TEMPLATE_WRITE_LIMIT);
  const row = await transact(async (tx) => {
    await lockSpace(tx, spaceId);
    await requireSpacePermission(tx, spaceId, me, PERM.MANAGE_SPACE);
    const current = await requireSpaceTemplate(tx, spaceId, code);
    const patch: Partial<typeof spaceTemplates.$inferInsert> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.description !== undefined) patch.description = body.description?.trim() || null;
    if (Object.keys(patch).length === 0) return current;
    const [updated] = await tx
      .update(spaceTemplates)
      .set(patch)
      .where(eq(spaceTemplates.code, code))
      .returning();
    await audit(tx, {
      spaceId,
      actorId: me,
      action: 'template.update',
      targetType: 'space',
      targetId: spaceId,
      changes: { code, ...patch },
    });
    return updated!;
  });
  return withDirty(db, row);
}

/** `PUT /spaces/:spaceId/templates/:code`: snapshot the Space as it is now (not dirty after). */
export async function syncTemplate(
  me: string,
  spaceId: string,
  code: string,
): Promise<SpaceTemplate> {
  assertUserLimit(me, 'spaceTemplateWrite', TEMPLATE_WRITE_LIMIT);
  const row = await transact(async (tx) => {
    await lockSpace(tx, spaceId);
    await requireSpacePermission(tx, spaceId, me, PERM.MANAGE_SPACE);
    await requireSpaceTemplate(tx, spaceId, code);
    const [updated] = await tx
      .update(spaceTemplates)
      .set({ snapshot: await buildSnapshot(tx, spaceId), updatedAt: new Date() })
      .where(eq(spaceTemplates.code, code))
      .returning();
    await audit(tx, {
      spaceId,
      actorId: me,
      action: 'template.sync',
      targetType: 'space',
      targetId: spaceId,
      changes: { code },
    });
    return updated!;
  });
  return toSpaceTemplate(row, false);
}

/** `DELETE /spaces/:spaceId/templates/:code`: the code stops working. */
export async function deleteTemplate(me: string, spaceId: string, code: string): Promise<void> {
  assertUserLimit(me, 'spaceTemplateWrite', TEMPLATE_WRITE_LIMIT);
  await transact(async (tx) => {
    await lockSpace(tx, spaceId);
    await requireSpacePermission(tx, spaceId, me, PERM.MANAGE_SPACE);
    await requireSpaceTemplate(tx, spaceId, code);
    await tx.delete(spaceTemplates).where(eq(spaceTemplates.code, code));
    await audit(tx, {
      spaceId,
      actorId: me,
      action: 'template.delete',
      targetType: 'space',
      targetId: spaceId,
      changes: { code },
    });
  });
}
