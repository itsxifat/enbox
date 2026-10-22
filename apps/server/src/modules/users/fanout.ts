/**
 * `user:changed { userId }` fan-out (docs matrix, `PATCH /me`): rooms of the user's active
 * direct and group chats (never channels; announcement groups only where the user is an
 * admin) plus `user:<x>` of everyone who saved the user as
 * a contact. One broadcast to the union of rooms, so a socket in several of them receives
 * the event once.
 */
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { LARGE_SPACE_THRESHOLD, rooms } from '@enbox/shared';
import type { DbOrTx } from '../../db/index.js';
import { chatMembers, chats, spaceMembers, spaces } from '../../db/schema.js';
import { getIo } from '../../realtime/emit.js';
import type { Effects } from '../../services/effects.js';
import { uniq } from '../../services/sql.js';
import { usersWhoSaved } from '../../services/users.js';

export interface UserChangedTargets {
  chatIds: string[];
  userIds: string[];
  /** Rooms of the user's small Spaces (all members) and member-list rooms of large ones. */
  spaceRooms?: string[];
}

/**
 * Space rooms that hear about a member's profile change: the whole Space when it is small,
 * only the devices with the member list open when it is large (no Space-wide fan-out of
 * every profile edit in a 250k-member Space).
 */
export async function spaceRoomsOf(dbx: DbOrTx, userId: string): Promise<string[]> {
  const rows = await dbx
    .select({ id: spaces.id, n: spaces.memberCount })
    .from(spaceMembers)
    .innerJoin(spaces, eq(spaces.id, spaceMembers.spaceId))
    .where(eq(spaceMembers.userId, userId));
  return rows.map((r) =>
    r.n > LARGE_SPACE_THRESHOLD ? rooms.spaceMembers(r.id) : rooms.space(r.id),
  );
}

/**
 * Direct/group chats where the user has an active row (hidden rows included: the peer still
 * has the chat). Announcement groups only where the user is owner/admin: their member list is
 * admin-only, so a plain member's changes must not reveal them to the whole community, while
 * admins' names appear on the announcements everyone reads.
 */
export async function activeDirectAndGroupChatIds(dbx: DbOrTx, userId: string): Promise<string[]> {
  const rows = await dbx
    .select({ chatId: chatMembers.chatId })
    .from(chatMembers)
    .innerJoin(chats, eq(chats.id, chatMembers.chatId))
    .where(
      and(
        eq(chatMembers.userId, userId),
        isNull(chatMembers.leftAt),
        inArray(chats.type, ['direct', 'group']),
        or(eq(chats.isAnnouncement, false), inArray(chatMembers.role, ['owner', 'admin'])),
      ),
    );
  return rows.map((r) => r.chatId);
}

/** Who must hear about a profile change of `userId`. */
export async function userChangedTargets(dbx: DbOrTx, userId: string): Promise<UserChangedTargets> {
  const [chatIds, userIds, spaceRooms] = await Promise.all([
    activeDirectAndGroupChatIds(dbx, userId),
    usersWhoSaved(dbx, userId),
    spaceRoomsOf(dbx, userId),
  ]);
  return { chatIds, userIds, spaceRooms };
}

/** Emit `user:changed { userId }` once per socket in any of the target rooms. */
export function emitUserChanged(userId: string, targets: UserChangedTargets): void {
  const io = getIo();
  const list = uniq([
    ...targets.chatIds.map(rooms.chat),
    ...targets.userIds.map(rooms.user),
    ...(targets.spaceRooms ?? []),
  ]);
  if (!io || list.length === 0) return;
  io.to(list).emit('user:changed', { userId });
}

/** Register the `PATCH /me` fan-out (targets resolved at the end of the transaction). */
export function userChangedEffect(fx: Effects, userId: string): Effects {
  let targets: UserChangedTargets = { chatIds: [], userIds: [] };
  return fx.add(
    () => emitUserChanged(userId, targets),
    async (dbx) => {
      targets = await userChangedTargets(dbx, userId);
    },
  );
}
