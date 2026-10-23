/**
 * The Inbox's Mentions tab (docs/design/discord-parity.md W5-C): messages of the last
 * INBOX_MENTION_DAYS that mention me, newest first, keyset-paged by (created_at, id).
 *
 * Scope: the channels and threads of my Spaces, and the groups I am an active member of
 * (inside my visibility window: nothing before my join or my clear, nothing hidden for me).
 * Never deleted or expired messages, never my own.
 * - Direct mentions (`mentions @> array[me]`) come through the GIN index `messages_mentions_gin`.
 * - @everyone/@here (`everyone`) and mentions of my roles (`roles`) are computed at read time,
 *   unless I suppress them in that Space: per channel with activity in the window, through the
 *   partial `messages_mentions_idx`, among its newest BROAD_SCAN_MESSAGES messages (a bounded
 *   scan however long the history).
 *
 * Access is re-checked before anything is serialized: Space channels need VIEW_CHANNEL from
 * the computed permissions (threads take their parent's overwrites), so a private channel
 * never leaks. READ_MESSAGE_HISTORY is reserved (not enforced anywhere yet). Candidates the
 * viewer cannot see are skipped; a page can therefore be short (even empty) and still carry a
 * `nextCursor` — clients keep paging until it is null.
 *
 * A fixed number of queries per page, however many chats and Spaces it touches: candidates,
 * chats, Spaces with roles, my member rows and roles, overwrites, Space icons, the page's rows,
 * then the batch serializers (`toMessages`, `toUserPublics`).
 */
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  PERM,
  hasPerm,
  isSpaceChatType,
  referencedUserIds,
  type ChatType,
  type InboxMention,
  type InboxMentionsPage,
  type PermissionOverwrite,
} from '@enbox/shared';
import { db, type DbOrTx } from '../../db/index.js';
import {
  chats,
  messages,
  spaceMemberRoles,
  spaceMembers,
  spaceRoles,
  spaces,
  type MessageRow,
  type SpaceRoleRow,
} from '../../db/schema.js';
import { badRequest } from '../../lib/errors.js';
import { loadMediaMap, staticMediaUrl } from '../../services/media.js';
import { toMessages } from '../../services/messages.js';
import {
  channelBits,
  loadChannelOverwrites,
  type MemberCtx,
  type SpacePermCtx,
} from '../../services/spaceAccess.js';
import { rawRows, toDate, uniq, uuidArray } from '../../services/sql.js';
import { toUserPublics } from '../../services/users.js';

/** How far back the Mentions tab looks. */
export const INBOX_MENTION_DAYS = 30;
/**
 * @everyone and role mentions are looked for among each channel's newest this-many messages
 * (direct mentions have their own index and no such limit).
 */
export const BROAD_SCAN_MESSAGES = 5_000;
/** Candidates looked at per page, at most (some may turn out not visible). */
const MAX_SCAN = 100;

/** Output of `inboxMentionsQuerySchema`. */
export interface MentionsQuery {
  before?: string;
  limit: number;
  spaceId?: string;
  everyone: boolean;
  roles: boolean;
}

interface Cursor {
  at: Date;
  id: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** `createdAt|id` (the `nextCursor` format). 400 when malformed. */
export function parseMentionsCursor(before: string | undefined): Cursor | null {
  if (!before) return null;
  const bar = before.lastIndexOf('|');
  const at = new Date(before.slice(0, bar));
  const id = before.slice(bar + 1).toLowerCase();
  if (bar <= 0 || Number.isNaN(at.getTime()) || !UUID_RE.test(id))
    throw badRequest('before: Invalid cursor');
  return { at, id };
}

function cursorOf(createdAt: Date, id: string): string {
  return `${createdAt.toISOString()}|${id}`;
}

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

interface Candidate {
  id: string;
  chat_id: string;
  created_at: string | Date;
}

/**
 * Up to `n` candidate messages, newest first: direct mentions UNION (when asked for) the
 * @everyone/role mentions of my Spaces' channels. Membership, windows and suppress flags are
 * applied here; VIEW_CHANNEL is checked by the caller.
 */
function candidatesQuery(me: string, q: MentionsQuery, cursor: Cursor | null, n: number): SQL {
  const since = new Date(Date.now() - INBOX_MENTION_DAYS * 86_400_000).toISOString();
  const after = cursor
    ? sql`and (m.created_at, m.id) < (${cursor.at.toISOString()}::timestamptz, ${cursor.id}::uuid)`
    : sql``;
  // Shared by both parts: the window, the cursor, nothing deleted/expired/hidden/mine.
  const common = sql`m.created_at > ${since}::timestamptz ${after}
      and m.deleted_at is null
      and (m.expires_at is null or m.expires_at > now())
      and m.sender_id is distinct from ${me}::uuid
      and m.type <> 'system'
      and not exists (select 1 from message_hidden mh where mh.user_id = ${me}::uuid and mh.message_id = m.id)`;
  const inSpace = q.spaceId ? sql`and ch.space_id = ${q.spaceId}::uuid` : sql``;
  const groups = q.spaceId
    ? sql`false`
    : sql`cm.user_id is not null and cm.left_at is null
          and m.seq > greatest(cm.joined_seq, cm.cleared_seq)`;

  const direct = sql`(select m.id, m.chat_id, m.created_at
      from messages m
      join chats ch on ch.id = m.chat_id
      left join chat_members cm on cm.chat_id = m.chat_id and cm.user_id = ${me}::uuid
      where m.mentions @> ${uuidArray([me])}
        and ${common}
        and (case
          when ch.type in ('space_text', 'space_voice', 'space_thread', 'space_stage') then
            exists (select 1 from space_members sm where sm.space_id = ch.space_id and sm.user_id = ${me}::uuid)
            and m.seq > coalesce(greatest(cm.joined_seq, cm.cleared_seq), 0) ${inSpace}
          when ch.type = 'group' then ${groups}
          else false end)
      order by m.created_at desc, m.id desc
      limit ${n})`;
  const top = (from: SQL) => sql`select u.id, u.chat_id, u.created_at from (${from}) u
      order by u.created_at desc, u.id desc
      limit ${n}`;
  if (!q.everyone && !q.roles) return top(direct);

  const broad = sql`(select x.id, x.chat_id, x.created_at
      from (
        select sm.space_id,
               (${q.everyone}::boolean and not sm.suppress_everyone) as want_everyone,
               (${q.roles}::boolean and not sm.suppress_roles) as want_roles,
               coalesce((select array_agg(r.role_id) from space_member_roles r
                         where r.space_id = sm.space_id and r.user_id = sm.user_id), '{}'::uuid[]) as role_ids
        from space_members sm
        where sm.user_id = ${me}::uuid ${q.spaceId ? sql`and sm.space_id = ${q.spaceId}::uuid` : sql``}
      ) s
      join chats ch on ch.space_id = s.space_id
        and ch.last_message_at > ${since}::timestamptz
        and (s.want_everyone or (s.want_roles and cardinality(s.role_ids) > 0))
      left join chat_members cm on cm.chat_id = ch.id and cm.user_id = ${me}::uuid
      cross join lateral (
        select m.id, m.chat_id, m.created_at
        from messages m
        where m.chat_id = ch.id
          and (m.mention_everyone or m.mentions <> '{}'::uuid[] or m.mention_role_ids <> '{}'::uuid[])
          and m.seq > greatest(coalesce(greatest(cm.joined_seq, cm.cleared_seq), 0), ch.last_seq - ${BROAD_SCAN_MESSAGES}::int)
          and ((s.want_everyone and m.mention_everyone) or (s.want_roles and m.mention_role_ids && s.role_ids))
          and ${common}
        order by m.seq desc
        limit ${n}
      ) x
      order by x.created_at desc, x.id desc
      limit ${n})`;
  return top(sql`${direct} union ${broad}`);
}

// ---------------------------------------------------------------------------
// Access (batched: one query per kind of data, whatever the number of Spaces)
// ---------------------------------------------------------------------------

/** Roles of several Spaces (the shape of `loadSpacePermCtx`, in one statement). */
async function loadPermContexts(
  dbx: DbOrTx,
  spaceIds: string[],
): Promise<{ ctxs: Map<string, SpacePermCtx>; info: Map<string, { name: string; iconMediaId: string | null }> }> {
  const ctxs = new Map<string, SpacePermCtx>();
  const info = new Map<string, { name: string; iconMediaId: string | null }>();
  if (spaceIds.length === 0) return { ctxs, info };
  const rows = await dbx
    .select({
      spaceId: spaces.id,
      name: spaces.name,
      iconMediaId: spaces.iconMediaId,
      ownerId: spaces.ownerId,
      permVersion: spaces.permVersion,
      role: spaceRoles,
    })
    .from(spaces)
    .leftJoin(spaceRoles, eq(spaceRoles.spaceId, spaces.id))
    .where(inArray(spaces.id, spaceIds));
  const roles = new Map<string, SpaceRoleRow[]>();
  for (const r of rows) {
    if (!info.has(r.spaceId)) {
      info.set(r.spaceId, { name: r.name, iconMediaId: r.iconMediaId });
      roles.set(r.spaceId, []);
      ctxs.set(r.spaceId, {
        spaceId: r.spaceId,
        ownerId: r.ownerId,
        permVersion: r.permVersion,
        roles: [],
        everyoneRoleId: '',
      });
    }
    if (r.role) roles.get(r.spaceId)!.push(r.role);
  }
  for (const [spaceId, ctx] of ctxs) {
    ctx.roles = roles.get(spaceId)!.sort((a, b) => a.position - b.position);
    const everyone = ctx.roles.find((r) => r.isDefault);
    if (everyone) ctx.everyoneRoleId = everyone.id;
    else ctxs.delete(spaceId); // never happens for a valid Space: no access
  }
  return { ctxs, info };
}

/** My member rows (with role ids) in several Spaces, keyed by Space id. */
async function loadMyMemberships(
  dbx: DbOrTx,
  me: string,
  spaceIds: string[],
): Promise<Map<string, MemberCtx>> {
  const out = new Map<string, MemberCtx>();
  if (spaceIds.length === 0) return out;
  const rows = await dbx
    .select()
    .from(spaceMembers)
    .where(and(eq(spaceMembers.userId, me), inArray(spaceMembers.spaceId, spaceIds)));
  for (const member of rows) out.set(member.spaceId, { member, roleIds: [] });
  if (out.size === 0) return out;
  const roles = await dbx
    .select({ spaceId: spaceMemberRoles.spaceId, roleId: spaceMemberRoles.roleId })
    .from(spaceMemberRoles)
    .where(
      and(eq(spaceMemberRoles.userId, me), inArray(spaceMemberRoles.spaceId, [...out.keys()])),
    );
  for (const r of roles) out.get(r.spaceId)?.roleIds.push(r.roleId);
  return out;
}

const parentChats = alias(chats, 'parent');

interface ChatInfo {
  id: string;
  type: ChatType;
  name: string | null;
  spaceId: string | null;
  parentId: string | null;
  parentName: string | null;
}

// ---------------------------------------------------------------------------
// GET /me/mentions
// ---------------------------------------------------------------------------

export async function listMentions(me: string, q: MentionsQuery): Promise<InboxMentionsPage> {
  const cursor = parseMentionsCursor(q.before);
  const scan = Math.min(q.limit * 2, MAX_SCAN);
  const found = await rawRows<Candidate>(db, candidatesQuery(me, q, cursor, scan + 1));
  const more = found.length > scan;
  const scanned = found.slice(0, scan);
  if (scanned.length === 0) return { items: [], nextCursor: null, users: [] };

  // The chats (threads with their parent channel), then access to the Space ones.
  const chatRows: ChatInfo[] = await db
    .select({
      id: chats.id,
      type: chats.type,
      name: chats.name,
      spaceId: chats.spaceId,
      parentId: chats.parentId,
      parentName: parentChats.name,
    })
    .from(chats)
    .leftJoin(parentChats, eq(parentChats.id, chats.parentId))
    .where(inArray(chats.id, uniq(scanned.map((c) => c.chat_id))));
  const chatById = new Map(chatRows.map((c) => [c.id, c]));
  const spaceChats = chatRows.filter((c) => isSpaceChatType(c.type) && c.spaceId);
  const spaceIds = uniq(spaceChats.map((c) => c.spaceId!));
  const { ctxs, info } = await loadPermContexts(db, spaceIds);
  const mine = await loadMyMemberships(db, me, spaceIds);
  /** Threads are computed with their parent's overwrites. */
  const overwriteTarget = (c: ChatInfo) => (c.type === 'space_thread' ? c.parentId : c.id);
  const overwrites = await loadChannelOverwrites(
    db,
    uniq(spaceChats.map(overwriteTarget).filter((x): x is string => !!x)),
  );

  const visible = new Set<string>();
  for (const c of chatRows) {
    if (c.type === 'group') {
      visible.add(c.id); // membership and window were checked by the query
      continue;
    }
    if (!isSpaceChatType(c.type) || !c.spaceId) continue;
    const ctx = ctxs.get(c.spaceId);
    const m = mine.get(c.spaceId);
    const target = overwriteTarget(c);
    if (!ctx || !m || !target) continue;
    const ow: PermissionOverwrite[] = overwrites.get(target) ?? [];
    if (hasPerm(channelBits(ctx, me, m, c.type, ow), PERM.VIEW_CHANNEL)) visible.add(c.id);
  }

  const shown = scanned.filter((c) => visible.has(c.chat_id));
  const page = shown.slice(0, q.limit);
  const last = shown.length > q.limit ? page.at(-1) : more ? scanned.at(-1) : undefined;
  const nextCursor = last ? cursorOf(toDate(last.created_at)!, last.id) : null;
  if (page.length === 0) return { items: [], nextCursor, users: [] };

  const rows = await db
    .select()
    .from(messages)
    .where(
      inArray(
        messages.id,
        page.map((c) => c.id),
      ),
    );
  const rowById = new Map(rows.map((r) => [r.id, r]));
  // A message purged or deleted since the candidate query is simply gone.
  const ordered = page
    .map((c) => rowById.get(c.id))
    .filter((r): r is MessageRow => !!r && !r.deletedAt);
  const serialized = await toMessages(db, me, ordered, {
    chatTypes: new Map(chatRows.map((c) => [c.id, c.type])),
  });
  const users = await toUserPublics(db, me, uniq(serialized.flatMap((m) => referencedUserIds(m))));

  const icons = await loadMediaMap(
    db,
    [...info.values()].map((s) => s.iconMediaId),
  );
  const items: InboxMention[] = [];
  for (const message of serialized) {
    const c = chatById.get(message.chatId);
    if (!c) continue;
    const space = c.spaceId ? info.get(c.spaceId) : undefined;
    const icon = space?.iconMediaId ? icons.get(space.iconMediaId) : undefined;
    items.push({
      message,
      chat: {
        id: c.id,
        type: c.type,
        name: c.name,
        spaceId: c.spaceId,
        spaceName: space?.name ?? null,
        spaceIconUrl: icon ? staticMediaUrl(icon) : null,
        parentName: c.type === 'space_thread' ? c.parentName : null,
      },
    });
  }
  return { items, nextCursor, users };
}
