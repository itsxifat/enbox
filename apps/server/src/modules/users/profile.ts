/**
 * Full profiles and private notes (mounted with the users module, behind requireAuth):
 *
 *   GET /users/:userId/profile   UserProfile: the user, mutual Spaces, mutual friends, the
 *                                number of groups we share and my private note about them
 *   PUT /users/:userId/note      { note } → { note | null }; '' deletes it
 *
 * The profile costs a fixed number of queries whatever the lists hold: four in parallel
 * (mutual Spaces, mutual friend ids, shared group count, my note), then `toUserPublicMap` for
 * the subject and the friends together (users, contacts, blocks). Both mutual lists are capped
 * at MUTUALS_LIMIT. Mutual friends — the people we both saved as contacts — would reveal part
 * of their contact list, so they stay empty while a block exists either way (which way is
 * never told), and never include deleted accounts or anyone blocked either way by me. My own
 * profile has no mutuals. Notes are private: only their owner ever reads them.
 */
import { Router } from 'express';
import { and, eq, sql } from 'drizzle-orm';
import {
  MUTUALS_LIMIT,
  USER_RATE_LIMITS,
  idParamSchema,
  userNoteSchema,
  type MutualSpace,
  type UserProfile,
} from '@enbox/shared';
import { db } from '../../db/index.js';
import { userNotes } from '../../db/schema.js';
import { authUserId } from '../../http/auth.js';
import { notFound } from '../../lib/errors.js';
import { assertUserLimit } from '../../lib/userLimit.js';
import { parse } from '../../lib/validate.js';
import { staticMediaUrl } from '../../services/media.js';
import { num, rawRows } from '../../services/sql.js';
import { requireUser, toUserPublicMap } from '../../services/users.js';

export const router = Router();

interface MutualSpaceRow {
  id: string;
  name: string;
  nickname: string | null;
  storage_key: string | null;
  thumbnail_key: string | null;
  animated: boolean | null;
}

/** Spaces we are both members of, by name, with their nickname there and the static icon. */
function mutualSpaces(me: string, them: string): Promise<MutualSpaceRow[]> {
  return rawRows<MutualSpaceRow>(
    db,
    sql`select s.id, s.name, b.nickname, m.storage_key, m.thumbnail_key, m.animated
        from space_members a
        join space_members b on b.space_id = a.space_id and b.user_id = ${them}
        join spaces s on s.id = a.space_id
        left join media m on m.id = s.icon_media_id
        where a.user_id = ${me}
        order by lower(s.name), s.id
        limit ${MUTUALS_LIMIT}`,
  );
}

/**
 * People both of us saved as contacts, by the name I see them under: none while a block
 * exists between us, and never deleted accounts or anyone with a block with me either way.
 */
function mutualFriendIds(me: string, them: string): Promise<{ id: string }[]> {
  return rawRows<{ id: string }>(
    db,
    sql`select c1.contact_id as id
        from contacts c1
        join contacts c2 on c2.contact_id = c1.contact_id and c2.owner_id = ${them}
        join users u on u.id = c1.contact_id and u.deleted_at is null
        where c1.owner_id = ${me}
          and c1.contact_id <> ${them}
          and not exists (
            select 1 from blocks b
            where (b.blocker_id = ${me} and b.blocked_id = ${them})
               or (b.blocker_id = ${them} and b.blocked_id = ${me})
          )
          and not exists (
            select 1 from blocks b
            where (b.blocker_id = ${me} and b.blocked_id = c1.contact_id)
               or (b.blocker_id = c1.contact_id and b.blocked_id = ${me})
          )
        order by lower(coalesce(c1.name, u.display_name)), c1.contact_id
        limit ${MUTUALS_LIMIT}`,
  );
}

/** Active regular groups we are both in (the same set as GET /users/:userId/common-groups). */
async function mutualGroupCount(me: string, them: string): Promise<number> {
  const [row] = await rawRows<{ n: unknown }>(
    db,
    sql`select count(*) as n from chats c
        join chat_members a on a.chat_id = c.id and a.user_id = ${me} and a.left_at is null and not a.hidden
        join chat_members b on b.chat_id = c.id and b.user_id = ${them} and b.left_at is null
        where c.type = 'group' and not c.is_announcement`,
  );
  return num(row?.n);
}

async function myNote(me: string, them: string): Promise<string | null> {
  const [row] = await db
    .select({ note: userNotes.note })
    .from(userNotes)
    .where(and(eq(userNotes.ownerId, me), eq(userNotes.subjectId, them)))
    .limit(1);
  return row?.note ?? null;
}

function toMutualSpace(r: MutualSpaceRow): MutualSpace {
  return {
    id: r.id,
    name: r.name,
    // Always the static image (the poster of an animated icon), like Space.iconUrl.
    iconUrl: r.storage_key
      ? staticMediaUrl({
          storageKey: r.storage_key,
          thumbnailKey: r.thumbnail_key,
          animated: !!r.animated,
        })
      : null,
    nickname: r.nickname,
  };
}

router.get('/users/:userId/profile', async (req, res) => {
  const me = authUserId(req);
  const { userId } = parse(idParamSchema('userId'), req.params);
  const self = userId === me;
  const [spaceRows, friendRows, groupCount, note] = await Promise.all([
    self ? [] : mutualSpaces(me, userId),
    self ? [] : mutualFriendIds(me, userId),
    self ? 0 : mutualGroupCount(me, userId),
    myNote(me, userId),
  ]);
  const friendIds = friendRows.map((r) => r.id);
  const publics = await toUserPublicMap(db, me, [userId, ...friendIds]);
  const user = publics.get(userId);
  if (!user) throw notFound('User');
  const gone = user.isDeleted;
  const profile: UserProfile = {
    user,
    mutualSpaces: gone ? [] : spaceRows.map(toMutualSpace),
    mutualFriends: gone
      ? []
      : friendIds.flatMap((id) => {
          const u = publics.get(id);
          return u && !u.isDeleted ? [u] : [];
        }),
    mutualGroupCount: gone ? 0 : groupCount,
    note,
  };
  res.json(profile);
});

router.put('/users/:userId/note', async (req, res) => {
  const me = authUserId(req);
  const { userId } = parse(idParamSchema('userId'), req.params);
  const { note } = parse(userNoteSchema, req.body ?? {});
  assertUserLimit(me, 'userNote', USER_RATE_LIMITS.userNote);
  await requireUser(db, userId);
  const mine = and(eq(userNotes.ownerId, me), eq(userNotes.subjectId, userId));
  if (!note) {
    await db.delete(userNotes).where(mine);
    res.json({ note: null });
    return;
  }
  const [row] = await db
    .insert(userNotes)
    .values({ ownerId: me, subjectId: userId, note })
    .onConflictDoUpdate({
      target: [userNotes.ownerId, userNotes.subjectId],
      set: { note, updatedAt: new Date() },
    })
    .returning({ note: userNotes.note });
  res.json({ note: row?.note ?? note });
});
