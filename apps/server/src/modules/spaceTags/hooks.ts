/**
 * Server tags' membership hook (services/spaceMemberHooks.ts), inside the transaction that
 * removes the member (the Space is locked): leaving a Space — on one's own, kicked, banned or
 * with the account — takes its tag off. After commit the wearer's `user:changed` reaches their
 * devices, the people a profile change reaches and the Space they left. Imported once by
 * ./routes.ts.
 */
import { and, eq } from 'drizzle-orm';
import { users } from '../../db/schema.js';
import { onSpaceMemberLeft } from '../../services/spaceMemberHooks.js';
import { fxTagWorn } from './service.js';

onSpaceMemberLeft(async (tx, fx, { spaceId, userId }) => {
  const [off] = await tx
    .update(users)
    .set({ tagSpaceId: null, updatedAt: new Date() })
    .where(and(eq(users.id, userId), eq(users.tagSpaceId, spaceId)))
    .returning({ id: users.id });
  if (off) fxTagWorn(fx, userId, spaceId);
});
