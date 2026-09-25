/**
 * Account deletion (docs "Accounts, sessions and deletion", step 2): the deleted user leaves
 * every community through the community pipeline — out of every linked group (member_left)
 * and the announcement group, `community:removed`, owner succession (oldest admin, else the
 * oldest member; mirrored into the announcement group), and deactivation when nobody is left.
 * Robust to the accounts module having already left some of the groups (only active rows
 * are touched).
 */
import { eq } from 'drizzle-orm';
import { communityMembers } from '../../db/schema.js';
import { lockCommunityScope, removeCommunityMember } from '../../services/communities.js';
import { registerAccountDeletionHook } from '../../services/hooks.js';

registerAccountDeletionHook('communities', async (tx, fx, userId) => {
  const rows = await tx
    .select({ communityId: communityMembers.communityId })
    .from(communityMembers)
    .where(eq(communityMembers.userId, userId));
  for (const { communityId } of rows.sort((a, b) => a.communityId.localeCompare(b.communityId))) {
    const scope = await lockCommunityScope(tx, communityId, { groups: true });
    await removeCommunityMember(tx, fx, scope, userId, { reason: 'left', actorId: userId });
  }
});
