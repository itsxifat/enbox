/**
 * `user:changed { userId }` fan-out (docs matrix, `PATCH /me`): rooms of the user's active
 * direct and group chats (never channels) plus `user:<x>` of everyone who saved the user as
 * a contact. One broadcast to the union of rooms, so a socket in several of them receives
 * the event once.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { rooms } from '@enbox/shared';
import type { DbOrTx } from '../../db/index.js';
import { chatMembers, chats } from '../../db/schema.js';
import { getIo } from '../../realtime/emit.js';
import type { Effects } from '../../services/effects.js';
import { uniq } from '../../services/sql.js';
import { usersWhoSaved } from '../../services/users.js';

export interface UserChangedTargets {
  chatIds: string[];
  userIds: string[];
}

/** Direct/group chats where the user has an active row (hidden rows included: the peer still has the chat). */
export async function activeDirectAndGroupChatIds(dbx: DbOrTx, userId: string): Promise<string[]> {
  const rows = await dbx
    .select({ chatId: chatMembers.chatId })
    .from(chatMembers)
    .innerJoin(chats, eq(chats.id, chatMembers.chatId))
    .where(and(eq(chatMembers.userId, userId), isNull(chatMembers.leftAt), inArray(chats.type, ['direct', 'group'])));
  return rows.map((r) => r.chatId);
}

/** Who must hear about a profile change of `userId`. */
export async function userChangedTargets(dbx: DbOrTx, userId: string): Promise<UserChangedTargets> {
  const [chatIds, userIds] = await Promise.all([activeDirectAndGroupChatIds(dbx, userId), usersWhoSaved(dbx, userId)]);
  return { chatIds, userIds };
}

/** Emit `user:changed { userId }` once per socket in any of the target rooms. */
export function emitUserChanged(userId: string, targets: UserChangedTargets): void {
  const io = getIo();
  const list = uniq([...targets.chatIds.map(rooms.chat), ...targets.userIds.map(rooms.user)]);
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
