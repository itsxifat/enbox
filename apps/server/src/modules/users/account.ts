/**
 * Account deletion (`DELETE /api/me`, docs "Accounts, sessions and deletion"), one
 * transaction:
 * 1. locks in the normative order: my communities → in ONE sorted `lockChats` call every chat
 *    the deletion may touch (chats I'm active in, the announcement and linked groups of my
 *    communities, chats of live calls I'm in) → my users row (a concurrent deletion fails
 *    with 404). Then the memberships are re-read: one added before the users-row lock (a
 *    chat outside the locked set) → `409 conflict`, retry (later adds wait for this
 *    transaction and skip the deleted account, see `lockLiveUsers`);
 * 2. leave every active regular group through the membership pipeline (`member_left`,
 *    ownership succession with `owner_changed`, LEAVE, memberCount, members-changed);
 * 3. delete sessions, push subscriptions, contacts and blocks (both directions) and scrub the
 *    row (`scrubDeletedUser`, statuses kept for step 4);
 * 4. `runAccountDeletionHooks` — the communities, channels, calls and status modules register
 *    their own cleanup there (community pipeline, channel succession/deletion, forced call
 *    leave, `status:deleted`); then any remaining statuses are deleted.
 * After commit (in this order): the membership events, `user:changed` → rooms of my direct
 * chats and of the groups I just left and → users who had saved me, `contacts:changed` →
 * users who had saved me, `blocks:changed` → users who had blocked me (their lists lost an
 * entry), `invalidateSessions` + `disconnectUser`, presence re-evaluation (→ hidden).
 * Direct-chat memberships and messages stay (the sender shows as "Deleted account").
 */
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { blocks, callParticipants, calls, chatMembers, chats, communities, communityMembers, statuses, users } from '../../db/schema.js';
import { conflict, notFound } from '../../lib/errors.js';
import { disconnectUser, emitToUsers } from '../../realtime/emit.js';
import { lockChats } from '../../services/chats.js';
import { transact } from '../../services/effects.js';
import { runAccountDeletionHooks } from '../../services/hooks.js';
import { upsertMembership } from '../../services/membership.js';
import { invalidateSessions } from '../../services/sessions.js';
import { scrubDeletedUser, usersWhoSaved } from '../../services/users.js';
import { emitUserChanged } from './fanout.js';
import { reevaluatePresence } from './presence.js';

export async function deleteAccount(userId: string): Promise<void> {
  await transact(async (tx, fx) => {
    // Lock order: communities → chats (sorted) → everything else.
    const communityIds = (
      await tx.select({ id: communityMembers.communityId }).from(communityMembers).where(eq(communityMembers.userId, userId))
    ).map((r) => r.id);
    if (communityIds.length) {
      await tx.select({ id: communities.id }).from(communities).where(inArray(communities.id, communityIds)).orderBy(asc(communities.id)).for('update');
    }
    const loadMemberships = () =>
      tx
        .select({ chatId: chatMembers.chatId, type: chats.type, isAnnouncement: chats.isAnnouncement })
        .from(chatMembers)
        .innerJoin(chats, eq(chats.id, chatMembers.chatId))
        .where(and(eq(chatMembers.userId, userId), isNull(chatMembers.leftAt)));
    const memberships = await loadMemberships();
    // Every chat the pipelines and hooks below may lock, in ONE sorted call (the community
    // hook locks the linked groups I never joined; the calls hook the chats of my live calls).
    const communityChats = communityIds.length
      ? await tx.select({ id: chats.id }).from(chats).where(inArray(chats.communityId, communityIds))
      : [];
    const callChats = await tx
      .selectDistinct({ id: calls.chatId })
      .from(callParticipants)
      .innerJoin(calls, eq(calls.id, callParticipants.callId))
      .where(
        and(
          eq(callParticipants.userId, userId),
          inArray(callParticipants.status, ['joined', 'invited', 'ringing']),
          inArray(calls.status, ['ringing', 'ongoing']),
        ),
      );
    const lockedChatIds = new Set([...memberships.map((m) => m.chatId), ...communityChats.map((c) => c.id), ...callChats.map((c) => c.id)]);
    await lockChats(tx, lockedChatIds);
    const [me] = await tx.select({ deletedAt: users.deletedAt }).from(users).where(eq(users.id, userId)).for('no key update');
    if (!me || me.deletedAt) throw notFound('User');
    // Memberships/communities gained after the reads above live in chats outside the locked
    // set: locking them now would break the lock order, so the client retries.
    const communitiesNow = await tx.select({ id: communityMembers.communityId }).from(communityMembers).where(eq(communityMembers.userId, userId));
    const current = await loadMemberships();
    if (communitiesNow.some((c) => !communityIds.includes(c.id)) || current.some((m) => !lockedChatIds.has(m.chatId))) {
      throw conflict('Your chats changed while deleting the account, try again');
    }

    // (2) Regular groups: the normal leave pipeline, with ownership succession.
    const groupIds = current
      .filter((m) => m.type === 'group' && !m.isAnnouncement)
      .map((m) => m.chatId)
      .sort();
    for (const chatId of groupIds) {
      const { chat } = await upsertMembership(tx, fx, {
        kind: 'deactivate',
        chatId,
        userId,
        reason: 'left',
        systemEvent: { kind: 'member_left', actorId: userId },
      });
      fx.memberCountChanged(chatId).membersChanged(chat);
    }
    const directChatIds = current.filter((m) => m.type === 'direct').map((m) => m.chatId);

    // Audiences resolved before their rows are deleted.
    const savedBy = await usersWhoSaved(tx, userId);
    const blockedBy = (await tx.select({ id: blocks.blockerId }).from(blocks).where(eq(blocks.blockedId, userId))).map((r) => r.id);

    // (3) + (4): sessions, push subscriptions, contacts, blocks; scrub the row.
    const { sessionIds } = await scrubDeletedUser(tx, userId, { keepStatuses: true });
    // Communities, channels, calls, statuses… (each module registers its own cleanup).
    await runAccountDeletionHooks(tx, fx, userId);
    await tx.delete(statuses).where(eq(statuses.userId, userId));

    fx.add(() => {
      emitUserChanged(userId, { chatIds: [...directChatIds, ...groupIds], userIds: savedBy });
      emitToUsers(savedBy, 'contacts:changed', {});
      emitToUsers(blockedBy, 'blocks:changed', {});
      invalidateSessions(sessionIds);
      disconnectUser(userId);
      void reevaluatePresence(userId);
    });
  });
}
