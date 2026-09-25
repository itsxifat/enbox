/**
 * Account deletion (docs "Accounts, sessions and deletion", step 2, and "Ownership
 * succession"): the deleted user's follower rows are deleted; channels they own pass to the
 * oldest admin, or are deleted when there is no admin.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { chatMembers, chats } from '../../db/schema.js';
import { lockChats } from '../../services/chats.js';
import { registerAccountDeletionHook } from '../../services/hooks.js';
import { ensureOwner, upsertMembership } from '../../services/membership.js';
import { deleteChannelTx } from './service.js';

registerAccountDeletionHook('channels', async (tx, fx, userId) => {
  const rows = await tx
    .select({ chatId: chatMembers.chatId, role: chatMembers.role })
    .from(chatMembers)
    .innerJoin(chats, eq(chats.id, chatMembers.chatId))
    .where(
      and(eq(chatMembers.userId, userId), eq(chats.type, 'channel'), isNull(chatMembers.leftAt)),
    );
  if (rows.length === 0) return;
  const locked = await lockChats(
    tx,
    rows.map((r) => r.chatId),
  );
  for (const chat of locked) {
    const role = rows.find((r) => r.chatId === chat.id)!.role;
    if (role !== 'owner') {
      await upsertMembership(tx, fx, { kind: 'unfollow', chatId: chat.id, userId });
      fx.memberCountChanged(chat.id).membersChanged(chat);
      continue;
    }
    // The owner row goes first (ensureOwner only promotes when no owner exists).
    await tx
      .delete(chatMembers)
      .where(and(eq(chatMembers.chatId, chat.id), eq(chatMembers.userId, userId)));
    fx.removeChat(userId, chat.id);
    fx.domain('member.left', { chatId: chat.id, userId, reason: 'unfollowed' });
    const newOwner = await ensureOwner(tx, fx, chat.id);
    if (newOwner) {
      fx.chatUpsert(newOwner, chat.id);
      fx.memberCountChanged(chat.id).membersChanged(chat);
    } else {
      await deleteChannelTx(tx, fx, chat.id);
    }
  }
});
