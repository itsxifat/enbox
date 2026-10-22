/**
 * Spaces hooks: account deletion (leave every Space; an owned Space passes to the member with
 * the highest role, then the longest-standing member, or is deleted when nobody is left).
 */
import { and, asc, eq, ne } from 'drizzle-orm';
import { highestRolePosition } from '@enbox/shared';
import { chats, spaceMembers, spaces } from '../../db/schema.js';
import { registerAccountDeletionHook, runChatDeletionHooks } from '../../services/hooks.js';
import {
  bumpPermVersion,
  loadSpaceMembers,
  loadSpacePermCtx,
  lockSpace,
} from '../../services/spaceAccess.js';
import {
  audit,
  fxSpaceUpdated,
  fxStructureChanged,
  removeSpaceMemberTx,
} from '../../services/spaces.js';
import { emitToRooms } from '../../realtime/emit.js';
import { spaceDeleted } from '../../realtime/spaceRegistry.js';

registerAccountDeletionHook('spaces', async (tx, fx, userId) => {
  const mine = await tx
    .select({ spaceId: spaceMembers.spaceId })
    .from(spaceMembers)
    .where(eq(spaceMembers.userId, userId))
    .orderBy(asc(spaceMembers.spaceId));
  for (const { spaceId } of mine) {
    const space = await lockSpace(tx, spaceId);
    if (space.ownerId === userId) {
      // Successor: highest role, then earliest join (bounded: candidates come in join order).
      const others = await tx
        .select({ userId: spaceMembers.userId, joinedAt: spaceMembers.joinedAt })
        .from(spaceMembers)
        .where(and(eq(spaceMembers.spaceId, spaceId), ne(spaceMembers.userId, userId)))
        .orderBy(asc(spaceMembers.joinedAt))
        .limit(1000);
      if (others.length === 0) {
        const channelIds = (
          await tx.select({ id: chats.id }).from(chats).where(eq(chats.spaceId, spaceId))
        ).map((r) => r.id);
        await runChatDeletionHooks(tx, fx, channelIds);
        await tx.delete(spaces).where(eq(spaces.id, spaceId));
        fx.add(() => {
          emitToRooms([`space:${spaceId}`], 'space:removed', { spaceId, reason: 'deleted' });
          spaceDeleted(spaceId);
        });
        continue;
      }
      const ctx = await loadSpacePermCtx(tx, spaceId);
      const members = await loadSpaceMembers(
        tx,
        spaceId,
        others.map((o) => o.userId),
      );
      let next = others[0]!.userId;
      let best = -1;
      for (const o of others) {
        const pos = highestRolePosition(ctx?.roles ?? [], members.get(o.userId)?.roleIds ?? []);
        if (pos > best) {
          best = pos;
          next = o.userId;
        }
      }
      await tx
        .update(spaces)
        .set({ ownerId: next, updatedAt: new Date() })
        .where(eq(spaces.id, spaceId));
      await bumpPermVersion(tx, spaceId);
      await audit(tx, {
        spaceId,
        actorId: null,
        action: 'space.transfer',
        targetType: 'member',
        targetId: next,
        reason: 'owner deleted their account',
      });
      fxSpaceUpdated(fx, spaceId, { ownerId: next });
      fxStructureChanged(fx, spaceId);
    }
    await removeSpaceMemberTx(tx, fx, spaceId, userId, 'left');
  }
});
