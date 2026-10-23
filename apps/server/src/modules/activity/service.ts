/**
 * Active Now (docs/design/discord-parity.md W9-E): which voice and Stage channels my friends are
 * in. A friend is a mutual contact (modules/friends: accepting a request saves both users as
 * each other's contacts), a live account with no block between us either way; a friend I
 * ignore (modules/ignores) makes no card either, though they still count as someone there.
 *
 * `listFriendActivity` → one `FriendActivity` per channel with friends of mine in it, only in
 * Spaces I am a member of and channels I can see (VIEW_CHANNEL after overwrites, the same rule
 * as `listSpaceVoiceStates`). Bounded queries whatever the numbers:
 * 1. my friends' voice states (at most one each) in Spaces I am in, with the Space, its icon and
 *    the channel — one statement, at most ACTIVITY_STATES_MAX rows;
 * 2. my member rows and roles in those Spaces (one statement each), their roles (cached per
 *    perm_version) and every channel's overwrites (one statement) → VIEW_CHANNEL per channel;
 * 3. for the channels I can see: the first ACTIVITY_PARTICIPANTS people there (friends first,
 *    each group by join time), how many in all and whether anyone streams — one statement.
 *
 * Order: the most friends first, then the longest running (the oldest `since`), then the
 * channel id. `since` is when the friend who has been there longest joined.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { PERM, hasPerm, type FriendActivity, type ID } from '@enbox/shared';
import type { DbOrTx } from '../../db/index.js';
import { spaceMemberRoles, spaceMembers } from '../../db/schema.js';
import { staticMediaUrl } from '../../services/media.js';
import {
  channelBits,
  loadChannelOverwrites,
  loadSpacePermCtx,
  type MemberCtx,
  type SpacePermCtx,
} from '../../services/spaceAccess.js';
import { rawRows, toDate, uniq, uuidArray } from '../../services/sql.js';

/** Everyone there shown on a card (friends first); the rest is a count. */
export const ACTIVITY_PARTICIPANTS = 8;
/** Friends' voice states looked at (the longest running first). */
export const ACTIVITY_STATES_MAX = 1_000;

type ActivityChannelType = FriendActivity['channelType'];

interface FriendVoiceRow {
  user_id: string;
  space_id: string;
  channel_id: string;
  joined_at: unknown;
  space_name: string;
  storage_key: string | null;
  thumbnail_key: string | null;
  animated: boolean | null;
  channel_name: string | null;
  channel_type: ActivityChannelType;
}

interface ParticipantRow {
  channel_id: string;
  user_id: string;
  total: unknown;
  streaming: boolean;
}

/** Step 1: my friends' voice states in Spaces I am a member of, the longest running first. */
function friendVoiceStates(dbx: DbOrTx, me: ID): Promise<FriendVoiceRow[]> {
  return rawRows<FriendVoiceRow>(
    dbx,
    sql`with friends as (
          select c1.contact_id as id
          from contacts c1
          join contacts c2 on c2.owner_id = c1.contact_id and c2.contact_id = c1.owner_id
          join users u on u.id = c1.contact_id and u.deleted_at is null
          where c1.owner_id = ${me}
            and c1.contact_id <> ${me}
            and not exists (
              select 1 from blocks b
              where (b.blocker_id = ${me} and b.blocked_id = c1.contact_id)
                 or (b.blocker_id = c1.contact_id and b.blocked_id = ${me})
            )
            and not exists (
              select 1 from user_ignores i
              where i.user_id = ${me} and i.ignored_id = c1.contact_id
            )
        )
        select v.user_id, v.space_id, v.channel_id, v.joined_at,
               s.name as space_name, md.storage_key, md.thumbnail_key, md.animated,
               c.name as channel_name, c.type as channel_type
        from friends f
        join voice_states v on v.user_id = f.id
        join space_members sm on sm.space_id = v.space_id and sm.user_id = ${me}
        join spaces s on s.id = v.space_id
        join chats c on c.id = v.channel_id and c.type in ('space_voice', 'space_stage')
        left join media md on md.id = s.icon_media_id
        order by v.joined_at, v.user_id
        limit ${ACTIVITY_STATES_MAX}`,
  );
}

/** Step 2: the channels among `rows` I can see. */
async function visibleChannels(dbx: DbOrTx, me: ID, rows: FriendVoiceRow[]): Promise<Set<ID>> {
  const spaceIds = uniq(rows.map((r) => r.space_id));
  const channelIds = uniq(rows.map((r) => r.channel_id));
  const memberRows = await dbx
    .select()
    .from(spaceMembers)
    .where(and(eq(spaceMembers.userId, me), inArray(spaceMembers.spaceId, spaceIds)));
  const roleRows = await dbx
    .select({ spaceId: spaceMemberRoles.spaceId, roleId: spaceMemberRoles.roleId })
    .from(spaceMemberRoles)
    .where(and(eq(spaceMemberRoles.userId, me), inArray(spaceMemberRoles.spaceId, spaceIds)));
  const mine = new Map<ID, MemberCtx>();
  for (const member of memberRows) mine.set(member.spaceId, { member, roleIds: [] });
  for (const r of roleRows) mine.get(r.spaceId)?.roleIds.push(r.roleId);
  const ctxs = new Map<ID, SpacePermCtx>();
  for (const id of spaceIds) {
    const ctx = await loadSpacePermCtx(dbx, id);
    if (ctx) ctxs.set(id, ctx);
  }
  const overwrites = await loadChannelOverwrites(dbx, channelIds);

  const visible = new Set<ID>();
  for (const r of rows) {
    if (visible.has(r.channel_id)) continue;
    const ctx = ctxs.get(r.space_id);
    const m = mine.get(r.space_id);
    if (!ctx || !m) continue;
    const bits = channelBits(ctx, me, m, r.channel_type, overwrites.get(r.channel_id) ?? []);
    if (hasPerm(bits, PERM.VIEW_CHANNEL)) visible.add(r.channel_id);
  }
  return visible;
}

/** Step 3: per channel, the first people there (friends first), the total and streaming. */
function channelParticipants(
  dbx: DbOrTx,
  channelIds: ID[],
  friendIds: ID[],
): Promise<ParticipantRow[]> {
  return rawRows<ParticipantRow>(
    dbx,
    sql`select t.channel_id, t.user_id, t.total, t.streaming
        from (
          select v.channel_id, v.user_id,
                 row_number() over (
                   partition by v.channel_id
                   order by (v.user_id = any(${uuidArray(friendIds)})) desc, v.joined_at, v.user_id
                 ) as rn,
                 count(*) over (partition by v.channel_id) as total,
                 bool_or(v.self_stream) over (partition by v.channel_id) as streaming
          from voice_states v
          where v.channel_id = any(${uuidArray(channelIds)})
        ) t
        where t.rn <= ${ACTIVITY_PARTICIPANTS}
        order by t.channel_id, t.rn`,
  );
}

/** `GET /me/friends/activity`: my friends in voice, grouped by channel (see the module doc). */
export async function listFriendActivity(dbx: DbOrTx, me: ID): Promise<FriendActivity[]> {
  const states = await friendVoiceStates(dbx, me);
  if (!states.length) return [];
  const visible = await visibleChannels(dbx, me, states);
  if (!visible.size) return [];

  const byChannel = new Map<ID, FriendActivity>();
  for (const r of states) {
    if (!visible.has(r.channel_id)) continue;
    const card = byChannel.get(r.channel_id);
    if (card) {
      card.friendIds.push(r.user_id);
      continue;
    }
    byChannel.set(r.channel_id, {
      spaceId: r.space_id,
      spaceName: r.space_name,
      spaceIconUrl: r.storage_key
        ? staticMediaUrl({
            storageKey: r.storage_key,
            thumbnailKey: r.thumbnail_key,
            animated: !!r.animated,
          })
        : null,
      channelId: r.channel_id,
      channelName: r.channel_name ?? '',
      channelType: r.channel_type,
      friendIds: [r.user_id],
      participantIds: [],
      participantCount: 0,
      streaming: false,
      since: (toDate(r.joined_at) ?? new Date()).toISOString(),
    });
  }

  const friendIds = uniq([...byChannel.values()].flatMap((c) => c.friendIds));
  const people = await channelParticipants(dbx, [...byChannel.keys()], friendIds);
  for (const p of people) {
    const card = byChannel.get(p.channel_id);
    if (!card) continue;
    card.participantIds.push(p.user_id);
    card.participantCount = Number(p.total);
    card.streaming = card.streaming || !!p.streaming;
  }

  return [...byChannel.values()].sort(
    (a, b) =>
      b.friendIds.length - a.friendIds.length ||
      a.since.localeCompare(b.since) ||
      a.channelId.localeCompare(b.channelId),
  );
}
