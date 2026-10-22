/**
 * Helpers shared by the Spaces routes (modules/spaces/*.ts): channel lookup, hierarchy and
 * grant checks, overwrite writes and their fan-out.
 */
import { and, asc, eq, max, sql } from 'drizzle-orm';
import {
  PERM,
  canManageRole,
  grantableBits,
  hasPerm,
  highestRolePosition,
  isSpaceAdmin,
  isSpaceChatType,
  type PermissionOverwrite,
} from '@enbox/shared';
import type { DbOrTx, Tx } from '../../db/index.js';
import {
  chats,
  spaceCategories,
  spaceCategoryOverwrites,
  spaceChannelOverwrites,
  type ChatRow,
} from '../../db/schema.js';
import { forbidden, notFound } from '../../lib/errors.js';
import type { Effects } from '../../services/effects.js';
import {
  channelBits,
  loadChannelOverwrites,
  type MemberCtx,
  type SpaceAccess,
} from '../../services/spaceAccess.js';
import { fxChannelsChanged, fxStructureChanged } from '../../services/spaces.js';
import { toSpaceChannelInfo } from '../../services/spaceSummaries.js';

/** A channel of this Space (404 otherwise, also for channels of other Spaces). */
export async function requireSpaceChannel(
  dbx: DbOrTx,
  spaceId: string,
  chatId: string,
  opts: { lock?: boolean } = {},
): Promise<ChatRow> {
  const q = dbx
    .select()
    .from(chats)
    .where(and(eq(chats.id, chatId), eq(chats.spaceId, spaceId)));
  const [row] = opts.lock ? await q.for('update') : await q;
  if (!row || !isSpaceChatType(row.type)) throw notFound('Channel');
  return row;
}

/** My bits in a channel (from my Space access). */
export async function myChannelBits(
  dbx: DbOrTx,
  access: SpaceAccess,
  userId: string,
  chat: ChatRow,
): Promise<{ bits: number; overwrites: PermissionOverwrite[] }> {
  const overwrites = (await loadChannelOverwrites(dbx, [chat.id])).get(chat.id) ?? [];
  const bits = channelBits(
    access.ctx,
    userId,
    access.me,
    chat.type as 'space_text',
    overwrites,
    access.base,
  );
  return { bits, overwrites };
}

/** 403 unless my bits in the channel include `perm` (404 when I cannot see it). */
export async function requireChannelBit(
  dbx: DbOrTx,
  access: SpaceAccess,
  userId: string,
  chat: ChatRow,
  perm: number,
  message?: string,
): Promise<{ bits: number; overwrites: PermissionOverwrite[] }> {
  const r = await myChannelBits(dbx, access, userId, chat);
  if (!hasPerm(r.bits, PERM.VIEW_CHANNEL)) throw notFound('Channel');
  if (!hasPerm(r.bits, perm)) throw forbidden(message);
  return r;
}

/** Position of my highest role (owner = Infinity). */
export function myTop(access: SpaceAccess, userId: string): number {
  return highestRolePosition(access.ctx.roles, access.me.roleIds, access.ctx.ownerId === userId);
}

export function topOf(access: SpaceAccess, userId: string, m: MemberCtx): number {
  return highestRolePosition(access.ctx.roles, m.roleIds, access.ctx.ownerId === userId);
}

/** 403 unless every changed bit is one I may grant (administrators: anything assignable). */
export function assertGrantable(actorBits: number, changed: number): void {
  if (isSpaceAdmin(actorBits)) return;
  if ((changed & ~grantableBits(actorBits)) !== 0)
    throw forbidden('You can only grant or remove permissions you have yourself');
}

/** 403 unless the role is below my highest role. */
export function assertRoleManageable(access: SpaceAccess, userId: string, position: number): void {
  if (!canManageRole(myTop(access, userId), position))
    throw forbidden('You can only manage roles below your highest role');
}

/** Next position at the end of a category (or of the uncategorised channels). */
export async function nextChannelPosition(
  dbx: DbOrTx,
  spaceId: string,
  categoryId: string | null,
): Promise<number> {
  const [row] = await dbx
    .select({ n: max(chats.position) })
    .from(chats)
    .where(
      and(
        eq(chats.spaceId, spaceId),
        categoryId ? eq(chats.categoryId, categoryId) : sql`${chats.categoryId} is null`,
      ),
    );
  return row?.n == null ? 0 : Number(row.n) + 1;
}

export async function requireCategory(dbx: DbOrTx, spaceId: string, categoryId: string) {
  const [row] = await dbx
    .select()
    .from(spaceCategories)
    .where(and(eq(spaceCategories.id, categoryId), eq(spaceCategories.spaceId, spaceId)))
    .limit(1);
  if (!row) throw notFound('Category');
  return row;
}

export async function categoryOverwrites(
  dbx: DbOrTx,
  categoryId: string,
): Promise<PermissionOverwrite[]> {
  const rows = await dbx
    .select()
    .from(spaceCategoryOverwrites)
    .where(eq(spaceCategoryOverwrites.categoryId, categoryId))
    .orderBy(asc(spaceCategoryOverwrites.targetType), asc(spaceCategoryOverwrites.targetId));
  return rows.map((r) => ({
    targetType: r.targetType,
    targetId: r.targetId,
    allow: r.allow,
    deny: r.deny,
  }));
}

/** Replace a channel's overwrites (sync / create from template). */
export async function setChannelOverwrites(
  tx: Tx,
  chatId: string,
  overwrites: readonly PermissionOverwrite[],
): Promise<void> {
  await tx.delete(spaceChannelOverwrites).where(eq(spaceChannelOverwrites.chatId, chatId));
  if (overwrites.length)
    await tx.insert(spaceChannelOverwrites).values(
      overwrites.map((o) => ({
        chatId,
        targetType: o.targetType,
        targetId: o.targetId,
        allow: o.allow,
        deny: o.deny,
      })),
    );
}

const sameOverwrites = (a: readonly PermissionOverwrite[], b: readonly PermissionOverwrite[]) => {
  const key = (o: PermissionOverwrite) => `${o.targetType}:${o.targetId}:${o.allow}:${o.deny}`;
  const as = new Set(a.map(key));
  return a.length === b.length && b.every((o) => as.has(key(o)));
};

/** VIEW_CHANNEL appears or disappears in some overwrite between two sets. */
export function viewChanged(
  before: readonly PermissionOverwrite[],
  after: readonly PermissionOverwrite[],
): boolean {
  const mask = (list: readonly PermissionOverwrite[]) =>
    new Map(
      list.map((o) => [
        `${o.targetType}:${o.targetId}`,
        `${o.allow & PERM.VIEW_CHANNEL}:${o.deny & PERM.VIEW_CHANNEL}`,
      ]),
    );
  const a = mask(before);
  const b = mask(after);
  for (const k of new Set([...a.keys(), ...b.keys()]))
    if ((a.get(k) ?? '0:0') !== (b.get(k) ?? '0:0')) return true;
  return false;
}

/**
 * After a channel's overwrites changed (in this tx): registry reload everywhere, and the
 * fan-out — a visibility change makes the members refetch the channel list (never broadcast
 * a private channel's data to members who can't see it); otherwise `chat:updated { space }`
 * reaches the channel's (virtual) room.
 */
export async function overwritesChangedFx(
  tx: Tx,
  fx: Effects,
  chat: ChatRow,
  before: readonly PermissionOverwrite[],
): Promise<PermissionOverwrite[]> {
  const after = (await loadChannelOverwrites(tx, [chat.id])).get(chat.id) ?? [];
  const [fresh] = await tx.select().from(chats).where(eq(chats.id, chat.id));
  fxStructureChanged(fx, chat.spaceId!);
  if (viewChanged(before, after)) fxChannelsChanged(fx, chat.spaceId!);
  else if (!sameOverwrites(before, after))
    fx.chatUpdated(chat.id, { space: toSpaceChannelInfo(fresh!, after) });
  return after;
}
