/**
 * User search (docs "Users, privacy and presence" → "User search"), for viewer V and query q
 * (leading '@' already stripped by the schema):
 * - exact username (case-insensitive: usernames are stored lowercase);
 * - username prefix when q.length ≥ USER_SEARCH_MIN_PREFIX;
 * - exact canonical phone when q parses as a phone (never substring phone matching);
 * - display-name (or V's saved contact name) substring ONLY among V's contacts and users who
 *   share an active direct chat or regular group with V (channels and community announcement
 *   groups don't count: their members are not visible to each other);
 * - never deleted users, V themself, or users who blocked V; ≤ USER_SEARCH_LIMIT results.
 * Ranking: exact username/phone, then contacts/chat partners by name, then username prefixes
 * (shortest first). Each branch is an indexed lookup (username / phone / prefix index, or
 * V's own contacts and chats), never a scan of all users.
 */
import { sql } from 'drizzle-orm';
import { USER_SEARCH_LIMIT, USER_SEARCH_MIN_PREFIX, phoneSchema } from '@enbox/shared';
import type { DbOrTx } from '../../db/index.js';
import { rawRows } from '../../services/sql.js';

/** Escape LIKE wildcards (usernames may contain '_'); '\' is Postgres' default LIKE escape. */
function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Candidate prefix matches considered before the blocker filter. */
const PREFIX_CANDIDATES = 5 * USER_SEARCH_LIMIT;

export async function searchUserIds(dbx: DbOrTx, viewerId: string, q: string): Promise<string[]> {
  const lower = q.toLowerCase();
  const parsedPhone = phoneSchema.safeParse(q);
  const phone = parsedPhone.success ? parsedPhone.data : null;
  const prefix = lower.length >= USER_SEARCH_MIN_PREFIX ? `${likeEscape(lower)}%` : null;
  const substring = `%${likeEscape(lower)}%`;

  const rows = await rawRows<{ id: string }>(
    dbx,
    sql`with circle as (
          select c.contact_id as id from contacts c where c.owner_id = ${viewerId}
          union
          select other.user_id
          from chat_members mine
          join chats ch on ch.id = mine.chat_id
            and (ch.type = 'direct' or (ch.type = 'group' and not ch.is_announcement))
          join chat_members other on other.chat_id = mine.chat_id
            and other.user_id <> mine.user_id and other.left_at is null
          where mine.user_id = ${viewerId} and mine.left_at is null
        ),
        hits as (
          select u.id, 0 as rank from users u where u.username = ${lower}
          union all
          select u.id, 0 from users u where ${phone}::text is not null and u.phone = ${phone}::text
          union all
          select u.id, 1
          from circle x
          join users u on u.id = x.id
          left join contacts c on c.owner_id = ${viewerId} and c.contact_id = u.id
          where lower(u.display_name) like ${substring} or lower(coalesce(c.name, '')) like ${substring}
          union all
          (select u.id, 2 from users u
           where ${prefix}::text is not null and u.username like ${prefix}::text and u.deleted_at is null
           order by length(u.username), u.username
           limit ${PREFIX_CANDIDATES})
        ),
        best as (select id, min(rank) as rank from hits group by id)
        select b.id
        from best b
        join users u on u.id = b.id
        left join contacts c on c.owner_id = ${viewerId} and c.contact_id = u.id
        where u.deleted_at is null
          and u.id <> ${viewerId}
          and not exists (select 1 from blocks bl where bl.blocker_id = u.id and bl.blocked_id = ${viewerId})
        order by b.rank, case when b.rank = 2 then length(u.username) end,
          lower(coalesce(c.name, u.display_name)), u.username
        limit ${USER_SEARCH_LIMIT}`,
  );
  return rows.map((r) => r.id);
}
