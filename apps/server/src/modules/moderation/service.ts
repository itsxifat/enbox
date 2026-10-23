/**
 * Moderation (docs/design/discord-parity.md W11; contracts in @enbox/shared moderation.ts),
 * members side: the Members page (filters, sorting, paging, a capped count), bulk actions
 * and Mod View. Security actions and raid alerts: ./security.ts; the join / leave audit
 * entries and the raid check run in the membership hooks (./hooks.ts).
 *
 * - Who: any moderator bit (KICK, BAN, MODERATE, MANAGE_ROLES or MANAGE_NICKNAMES).
 * - Bulk actions run each member through the single-member service functions of
 *   modules/spaces/members.ts (own transaction, the same permission, hierarchy, owner and
 *   self checks, the same audit entries and events) and report what was refused and why.
 * - Mod View reads a member's messages through the sender index (messages_sender_created_idx)
 *   in the channels the moderator can see; threads follow their parent channel.
 */
import { and, asc, desc, eq, gt, gte, isNull, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import {
  BAN_DELETE_MESSAGE_OPTIONS,
  PERM,
  hasAnyPerm,
  hasPerm,
  isSpaceChatType,
  type BulkMemberAction,
  type BulkMembersResult,
  type ChatType,
  type MemberSort,
  type ModMember,
  type ModMemberPage,
  type ModView,
  type SpaceChannelType,
  type bulkMembersSchema,
  type memberSearchQuerySchema,
} from '@enbox/shared';
import { db, type DbOrTx } from '../../db/index.js';
import {
  chatMembers,
  chats,
  messageHidden,
  messages,
  spaceAuditLog,
  spaceMemberRoles,
  spaceMembers,
  users,
  voiceStates,
  type MessageRow,
  type SpaceMemberRow,
} from '../../db/schema.js';
import { HttpError, badRequest, forbidden, notFound } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { toMessages } from '../../services/messages.js';
import {
  channelBits,
  loadChannelOverwrites,
  loadSpaceMember,
  loadSpaceMembers,
  requireSpaceMember,
  type MemberCtx,
  type SpaceAccess,
} from '../../services/spaceAccess.js';
import { toSpaceMembers } from '../../services/spaces.js';
import { rawRows, uniq, uuidArray } from '../../services/sql.js';
import { toUserPublicMap } from '../../services/users.js';
import { banUser, kickMember, setMemberRole, updateMember } from '../spaces/members.js';
import { myTop } from '../spaces/service.js';

export type MemberSearchParams = z.output<typeof memberSearchQuerySchema>;
export type BulkMembersParams = z.output<typeof bulkMembersSchema>;

/** Any of these opens the Members page and Mod View (Discord's moderator permissions). */
export const MODERATOR_BITS =
  PERM.KICK_MEMBERS |
  PERM.BAN_MEMBERS |
  PERM.MODERATE_MEMBERS |
  PERM.MANAGE_ROLES |
  PERM.MANAGE_NICKNAMES;

/** `ModMemberPage.total` stops counting here. */
export const MEMBER_SEARCH_TOTAL_CAP = 10_000;
/** Mod View: newest messages shown, and how far back the message count looks. */
const MOD_VIEW_MESSAGES = 20;
const MOD_VIEW_AUDIT = 20;
const MESSAGE_COUNT_DAYS = 30;
const MESSAGE_COUNT_CAP = 10_000;

/** 404 unless a member, 403 without a moderator bit. */
export async function requireModerator(
  dbx: DbOrTx,
  spaceId: string,
  me: string,
): Promise<SpaceAccess> {
  const access = await requireSpaceMember(dbx, spaceId, me);
  if (!hasAnyPerm(access.base, MODERATOR_BITS))
    throw forbidden('You cannot moderate members in this Space');
  return access;
}

// ---------------------------------------------------------------------------
// Members page
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The page's last row as a cursor: the sort, its key (sort name or join time) and the user. */
function cursorOf(sort: MemberSort, m: SpaceMemberRow): string {
  const key = sort === 'name' ? m.sortName : m.joinedAt.toISOString();
  return Buffer.from(JSON.stringify([sort, key, m.userId]), 'utf8').toString('base64url');
}

function parseCursor(
  sort: MemberSort,
  c: string | undefined,
): { key: string; userId: string } | null {
  if (!c) return null;
  let parts: unknown;
  try {
    parts = JSON.parse(Buffer.from(c, 'base64url').toString('utf8'));
  } catch {
    throw badRequest('after: invalid cursor');
  }
  if (!Array.isArray(parts) || parts.length !== 3) throw badRequest('after: invalid cursor');
  const [s, key, userId] = parts as unknown[];
  if (
    s !== sort ||
    typeof key !== 'string' ||
    typeof userId !== 'string' ||
    !UUID_RE.test(userId) ||
    (sort !== 'name' && Number.isNaN(Date.parse(key)))
  )
    throw badRequest('after: invalid cursor');
  return { key, userId };
}

const likePrefix = (s: string) => `${s.replace(/[%_\\]/g, '\\$&')}%`;

/** Filters of the Members page (members whose account still exists). */
function searchConditions(spaceId: string, q: MemberSearchParams, now: Date): SQL[] {
  const conds: SQL[] = [eq(spaceMembers.spaceId, spaceId), isNull(users.deletedAt)];
  const prefix = q.q?.toLowerCase().replace(/^@/, '');
  if (prefix) {
    const match = or(
      sql`${spaceMembers.sortName} like ${likePrefix(prefix)}`,
      sql`${users.username} like ${likePrefix(prefix)}`,
      // A user id pasted into the search box finds them too.
      UUID_RE.test(prefix) ? eq(spaceMembers.userId, prefix) : undefined,
    );
    if (match) conds.push(match);
  }
  for (const roleId of uniq(q.roleIds))
    conds.push(
      sql`exists (select 1 from ${spaceMemberRoles} r where r.space_id = ${spaceId} and r.user_id = ${spaceMembers.userId} and r.role_id = ${roleId})`,
    );
  if (q.joinedAfter) conds.push(gte(spaceMembers.joinedAt, new Date(q.joinedAfter)));
  if (q.joinedBefore) conds.push(lt(spaceMembers.joinedAt, new Date(q.joinedBefore)));
  if (q.accountCreatedAfter) conds.push(gte(users.createdAt, new Date(q.accountCreatedAfter)));
  if (q.timedOut === 'true') conds.push(gt(spaceMembers.timedOutUntil, now));
  if (q.timedOut === 'false') {
    const free = or(isNull(spaceMembers.timedOutUntil), lte(spaceMembers.timedOutUntil, now));
    if (free) conds.push(free);
  }
  return conds;
}

/** Keyset condition after the cursor's row, in the order of `sort`. */
function afterCondition(sort: MemberSort, after: { key: string; userId: string }): SQL | undefined {
  if (sort === 'name')
    return or(
      gt(spaceMembers.sortName, after.key),
      and(eq(spaceMembers.sortName, after.key), gt(spaceMembers.userId, after.userId)),
    );
  const at = new Date(after.key);
  return sort === 'joined_desc'
    ? or(
        lt(spaceMembers.joinedAt, at),
        and(eq(spaceMembers.joinedAt, at), lt(spaceMembers.userId, after.userId)),
      )
    : or(
        gt(spaceMembers.joinedAt, at),
        and(eq(spaceMembers.joinedAt, at), gt(spaceMembers.userId, after.userId)),
      );
}

function orderOf(sort: MemberSort) {
  if (sort === 'name') return [asc(spaceMembers.sortName), asc(spaceMembers.userId)];
  return sort === 'joined_desc'
    ? [desc(spaceMembers.joinedAt), desc(spaceMembers.userId)]
    : [asc(spaceMembers.joinedAt), asc(spaceMembers.userId)];
}

/** Members as moderators see them: the member, its user (as `me` sees them), account age. */
export async function toModMembers(
  dbx: DbOrTx,
  me: string,
  list: readonly MemberCtx[],
): Promise<ModMember[]> {
  if (list.length === 0) return [];
  const ids = list.map((m) => m.member.userId);
  const [members, people, created] = await Promise.all([
    toSpaceMembers(dbx, list),
    toUserPublicMap(dbx, me, ids),
    dbx
      .select({ id: users.id, createdAt: users.createdAt })
      .from(users)
      .where(sql`${users.id} = any(${uuidArray(ids)})`),
  ]);
  const createdAt = new Map(created.map((r) => [r.id, r.createdAt.toISOString()]));
  const out: ModMember[] = [];
  for (const m of members) {
    const user = people.get(m.userId);
    const at = createdAt.get(m.userId);
    if (user && at) out.push({ ...m, user, accountCreatedAt: at });
  }
  return out;
}

/** `GET /spaces/:spaceId/members/search`: one page of the Members page. */
export async function searchMembers(
  me: string,
  spaceId: string,
  q: MemberSearchParams,
): Promise<ModMemberPage> {
  await requireModerator(db, spaceId, me);
  const now = new Date();
  const conds = searchConditions(spaceId, q, now);
  const after = parseCursor(q.sort, q.after);
  const where = and(...conds)!;
  const rows = await db
    .select({ m: spaceMembers })
    .from(spaceMembers)
    .innerJoin(users, eq(users.id, spaceMembers.userId))
    .where(after ? and(where, afterCondition(q.sort, after)) : where)
    .orderBy(...orderOf(q.sort))
    .limit(q.limit + 1);
  const page = rows.slice(0, q.limit).map((r) => r.m);
  const [count] = await rawRows<{ n: number }>(
    db,
    sql`select count(*)::int as n from (select 1 from ${spaceMembers} inner join ${users} on ${users.id} = ${spaceMembers.userId} where ${where} limit ${MEMBER_SEARCH_TOTAL_CAP}) hits`,
  );
  const roles = await loadSpaceMembers(
    db,
    spaceId,
    page.map((m) => m.userId),
  );
  return {
    members: await toModMembers(
      db,
      me,
      page.map((member) => ({ member, roleIds: roles.get(member.userId)?.roleIds ?? [] })),
    ),
    nextCursor: rows.length > q.limit ? cursorOf(q.sort, page[page.length - 1]!) : null,
    total: Number(count?.n ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Bulk actions
// ---------------------------------------------------------------------------

/** The Space-wide bit each bulk action needs (checked once for the whole request). */
const BULK_NEEDS: Record<BulkMemberAction, { bit: number; what: string }> = {
  kick: { bit: PERM.KICK_MEMBERS, what: 'kick members' },
  ban: { bit: PERM.BAN_MEMBERS, what: 'ban members' },
  add_role: { bit: PERM.MANAGE_ROLES, what: 'manage roles' },
  remove_role: { bit: PERM.MANAGE_ROLES, what: 'manage roles' },
  timeout: { bit: PERM.MODERATE_MEMBERS, what: 'time members out' },
};

/**
 * `POST /spaces/:spaceId/members/bulk`: the request is refused as a whole when I lack the
 * action's permission or its input (role, duration, deletion window) is wrong; otherwise each
 * member goes through the single-member service function on its own, and the result lists
 * who was done and who was refused with the reason the single routes give.
 */
export async function bulkMembers(
  me: string,
  spaceId: string,
  body: BulkMembersParams,
): Promise<BulkMembersResult> {
  const access = await requireSpaceMember(db, spaceId, me);
  const need = BULK_NEEDS[body.action];
  if (!hasPerm(access.base, need.bit)) throw forbidden(`You cannot ${need.what} in this Space`);
  let run: (userId: string) => Promise<void>;
  switch (body.action) {
    case 'kick':
      run = (userId) => kickMember(me, spaceId, userId, body.reason ?? null);
      break;
    case 'ban': {
      const deleteMessageSeconds = body.deleteMessageSeconds ?? 0;
      if (!(BAN_DELETE_MESSAGE_OPTIONS as readonly number[]).includes(deleteMessageSeconds))
        throw badRequest(`deleteMessageSeconds: one of ${BAN_DELETE_MESSAGE_OPTIONS.join(', ')}`);
      run = (userId) => banUser(me, spaceId, userId, { reason: body.reason, deleteMessageSeconds });
      break;
    }
    case 'add_role':
    case 'remove_role': {
      const roleId = body.roleId;
      if (!roleId) throw badRequest('roleId: required');
      const role = access.ctx.roles.find((r) => r.id === roleId);
      if (!role || role.isDefault) throw notFound('Role');
      if (role.position >= myTop(access, me))
        throw forbidden('You can only assign roles below your highest role');
      const add = body.action === 'add_role';
      run = (userId) => setMemberRole(me, spaceId, userId, roleId, add);
      break;
    }
    case 'timeout': {
      if (!body.durationSec) throw badRequest('durationSec: required');
      const timedOutUntil = new Date(Date.now() + body.durationSec * 1000).toISOString();
      run = (userId) => updateMember(me, spaceId, userId, { timedOutUntil, reason: body.reason });
      break;
    }
  }
  const result: BulkMembersResult = { ok: [], failed: [] };
  for (const userId of uniq(body.userIds)) {
    try {
      await run(userId);
      result.ok.push(userId);
    } catch (e) {
      if (!(e instanceof HttpError))
        logger.error({ err: e, spaceId, userId, action: body.action }, 'bulk member action failed');
      result.failed.push({
        userId,
        reason: e instanceof HttpError ? e.message : 'Something went wrong',
      });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Mod View
// ---------------------------------------------------------------------------

/** The Space's channels (not threads) `me` can see, with their types. */
async function visibleChannels(
  dbx: DbOrTx,
  access: SpaceAccess,
  me: string,
  spaceId: string,
): Promise<Map<string, ChatType>> {
  const rows = await dbx
    .select({ id: chats.id, type: chats.type })
    .from(chats)
    .where(and(eq(chats.spaceId, spaceId), isNull(chats.parentId)));
  const channels = rows.filter((r) => isSpaceChatType(r.type) && r.type !== 'space_thread');
  const overwrites = await loadChannelOverwrites(
    dbx,
    channels.map((c) => c.id),
  );
  const out = new Map<string, ChatType>();
  for (const c of channels) {
    const bits = channelBits(
      access.ctx,
      me,
      access.me,
      c.type as SpaceChannelType,
      overwrites.get(c.id) ?? [],
      access.base,
    );
    if (hasPerm(bits, PERM.VIEW_CHANNEL)) out.set(c.id, c.type);
  }
  return out;
}

/**
 * `GET /spaces/:spaceId/members/:userId/mod-view` (any moderator bit; 404 unless they are a
 * member): the member, their newest messages and 30-day count in the channels I can see (and
 * their threads; my own window, hidden and expired messages apply as when reading), the
 * audit entries about them and their voice channel (when I can see it).
 */
export async function modView(me: string, spaceId: string, userId: string): Promise<ModView> {
  const access = await requireModerator(db, spaceId, me);
  const target = await loadSpaceMember(db, spaceId, userId);
  if (!target) throw notFound('Member');
  const [member] = await toModMembers(db, me, [target]);
  if (!member) throw notFound('Member');
  const visible = await visibleChannels(db, access, me, spaceId);

  let recentMessages: ModView['recentMessages'] = [];
  let messageCount30d = 0;
  if (visible.size) {
    const ids = uuidArray(visible.keys());
    const myRow = and(eq(chatMembers.chatId, messages.chatId), eq(chatMembers.userId, me));
    const where = and(
      eq(messages.senderId, userId),
      eq(chats.spaceId, spaceId),
      sql`coalesce(${chats.parentId}, ${chats.id}) = any(${ids})`,
      isNull(messages.deletedAt),
      sql`${messages.type} not in ('system', 'call')`,
      // My read row's window where I have one (converted channels), as in search.
      sql`${messages.seq} > greatest(coalesce(${chatMembers.joinedSeq}, 0), coalesce(${chatMembers.clearedSeq}, 0))`,
      sql`(${messages.expiresAt} is null or ${messages.expiresAt} > now())`,
      sql`not exists (select 1 from ${messageHidden} where ${messageHidden.userId} = ${me} and ${messageHidden.messageId} = ${messages.id})`,
    )!;
    const rows: MessageRow[] = (
      await db
        .select({ m: messages })
        .from(messages)
        .innerJoin(chats, eq(chats.id, messages.chatId))
        .leftJoin(chatMembers, myRow)
        .where(where)
        .orderBy(desc(messages.createdAt), desc(messages.id))
        .limit(MOD_VIEW_MESSAGES)
    ).map((r) => r.m);
    const since = new Date(Date.now() - MESSAGE_COUNT_DAYS * 86_400_000);
    const [count] = await rawRows<{ n: number }>(
      db,
      sql`select count(*)::int as n from (select 1 from ${messages} inner join ${chats} on ${chats.id} = ${messages.chatId} left join ${chatMembers} on ${myRow} where ${where} and ${messages.createdAt} >= ${since} limit ${MESSAGE_COUNT_CAP}) hits`,
    );
    messageCount30d = Number(count?.n ?? 0);
    recentMessages = await toMessages(db, me, rows);
  }

  const audit = await db
    .select({
      action: spaceAuditLog.action,
      actorId: spaceAuditLog.actorId,
      reason: spaceAuditLog.reason,
      createdAt: spaceAuditLog.createdAt,
    })
    .from(spaceAuditLog)
    .where(
      and(
        eq(spaceAuditLog.spaceId, spaceId),
        eq(spaceAuditLog.targetType, 'member'),
        eq(spaceAuditLog.targetId, userId),
      ),
    )
    .orderBy(desc(spaceAuditLog.createdAt), desc(spaceAuditLog.id))
    .limit(MOD_VIEW_AUDIT);

  const [voice] = await db
    .select({ channelId: voiceStates.channelId })
    .from(voiceStates)
    .where(and(eq(voiceStates.userId, userId), eq(voiceStates.spaceId, spaceId)))
    .limit(1);

  return {
    member,
    recentMessages,
    messageCount30d,
    auditEntries: audit.map((a) => ({
      action: a.action,
      actorId: a.actorId,
      reason: a.reason,
      createdAt: a.createdAt.toISOString(),
    })),
    voiceChannelId: voice && visible.has(voice.channelId) ? voice.channelId : null,
  };
}
