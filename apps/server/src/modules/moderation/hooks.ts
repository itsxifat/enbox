/**
 * Moderation's membership hooks (services/spaceMemberHooks.ts), inside the transaction that
 * adds or removes the member (the Space is locked). Imported once by ./routes.ts.
 * - `member.join` for every join with a notice (not the creator, not conversions), then the
 *   raid check (./security.ts `checkRaid`);
 * - `member.leave` when someone leaves on their own (kicks and bans have their own entries).
 */
import { onSpaceMemberJoined, onSpaceMemberLeft } from '../../services/spaceMemberHooks.js';
import { audit } from '../../services/spaces.js';
import { checkRaid } from './security.js';

onSpaceMemberJoined(async (tx, fx, e) => {
  if (e.silent) return;
  await audit(tx, {
    spaceId: e.spaceId,
    actorId: e.userId,
    action: 'member.join',
    targetType: 'member',
    targetId: e.userId,
  });
  await checkRaid(tx, fx, e.spaceId, e.at);
});

onSpaceMemberLeft(async (tx, _fx, e) => {
  if (e.reason !== 'left') return;
  await audit(tx, {
    spaceId: e.spaceId,
    actorId: e.userId,
    action: 'member.leave',
    targetType: 'member',
    targetId: e.userId,
  });
});
