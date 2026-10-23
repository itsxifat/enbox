/**
 * Thread follows' membership hook (services/spaceMemberHooks.ts), inside the transaction that
 * removes the member: leaving a Space — on one's own, kicked, banned or with the account —
 * drops the posts and threads they followed there. Imported once by ./follow.ts.
 */
import { and, eq } from 'drizzle-orm';
import { threadFollows } from '../../db/schema.js';
import { onSpaceMemberLeft } from '../../services/spaceMemberHooks.js';

onSpaceMemberLeft(async (tx, _fx, { spaceId, userId }) => {
  await tx
    .delete(threadFollows)
    .where(and(eq(threadFollows.userId, userId), eq(threadFollows.spaceId, spaceId)));
});
