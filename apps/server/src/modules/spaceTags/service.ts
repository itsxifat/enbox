/**
 * Server tags (docs/design/discord-parity.md W3-D): a Space's tag — 2-4 letters or digits, a
 * badge and its colour (`spaces.tag*`) — and who wears one (`users.tag_space_id`).
 *
 * - MANAGE_SPACE sets, changes or removes it: audited (`space.tag`), `space:updated { tag }`
 *   → Space room. Wearers keep `tag_space_id`: `getUserRows` only joins tags that exist, so a
 *   removed tag disappears from every profile and comes back if the Space sets one again.
 * - A member wears the tag of a Space they are in that has one (else 404 / 409); leaving the
 *   Space (left, kicked, banned, account deleted) takes it off in that transaction (./hooks.ts).
 * - Wearing or losing a tag is a profile change: `user:changed` where `PATCH /me` sends it
 *   (users/fanout.ts), plus the wearer's own devices and the Space they just left.
 */
import { eq } from 'drizzle-orm';
import {
  LARGE_SPACE_THRESHOLD,
  PERM,
  rooms,
  type ID,
  type Space,
  type SpaceTag,
  type UserPublic,
} from '@enbox/shared';
import type { DbOrTx } from '../../db/index.js';
import { spaces, users, type SpaceRow } from '../../db/schema.js';
import { conflict, notFound } from '../../lib/errors.js';
import { transact, type Effects } from '../../services/effects.js';
import {
  lockSpace,
  requireSpaceMember,
  requireSpacePermission,
} from '../../services/spaceAccess.js';
import { audit, fxSpaceUpdated, type SpaceSettingsChanges } from '../../services/spaces.js';
import { toUserPublic } from '../../services/users.js';
import { emitUserChanged, userChangedTargets, type UserChangedTargets } from '../users/fanout.js';

/** A Space row's tag (null = none; the CHECK keeps the three columns set together). */
export function tagOf(s: Pick<SpaceRow, 'tag' | 'tagBadge' | 'tagColor'>): SpaceTag | null {
  return s.tag && s.tagBadge && s.tagColor
    ? { tag: s.tag, badge: s.tagBadge, color: s.tagColor }
    : null;
}

function sameTag(a: SpaceTag | null, b: SpaceTag): boolean {
  return !!a && a.tag === b.tag && a.badge === b.badge && a.color === b.color;
}

/** `space:updated { tag }` → Space room (members patch the wearers they have cached). */
function fxSpaceTag(fx: Effects, spaceId: ID, tag: SpaceTag | null): void {
  const changes: SpaceSettingsChanges & Pick<Space, 'tag'> = { tag };
  fxSpaceUpdated(fx, spaceId, changes);
}

/** The room that hears about a member of `spaceId` (all members, or the open member lists of a large Space). */
async function spaceRoomOf(dbx: DbOrTx, spaceId: ID): Promise<string[]> {
  const [s] = await dbx
    .select({ n: spaces.memberCount })
    .from(spaces)
    .where(eq(spaces.id, spaceId))
    .limit(1);
  if (!s) return [];
  return [s.n > LARGE_SPACE_THRESHOLD ? rooms.spaceMembers(spaceId) : rooms.space(spaceId)];
}

/**
 * `user:changed { userId }` after commit, once per socket: where a profile change goes, the
 * user's own devices and, after a leave, the Space they left (no longer among theirs).
 */
export function fxTagWorn(fx: Effects, userId: ID, leftSpaceId?: ID): void {
  let targets: UserChangedTargets = { chatIds: [], userIds: [] };
  fx.add(
    () => emitUserChanged(userId, targets),
    async (dbx) => {
      const t = await userChangedTargets(dbx, userId);
      const left = leftSpaceId ? await spaceRoomOf(dbx, leftSpaceId) : [];
      targets = {
        ...t,
        userIds: [...t.userIds, userId],
        spaceRooms: [...(t.spaceRooms ?? []), ...left],
      };
    },
  );
}

/** Set or change a Space's tag (MANAGE_SPACE); the same tag again writes and emits nothing. */
export async function setSpaceTag(me: ID, spaceId: ID, tag: SpaceTag): Promise<SpaceTag> {
  return transact(async (tx, fx) => {
    const space = await lockSpace(tx, spaceId);
    await requireSpacePermission(tx, spaceId, me, PERM.MANAGE_SPACE);
    const prev = tagOf(space);
    if (sameTag(prev, tag)) return prev!;
    await tx
      .update(spaces)
      .set({ tag: tag.tag, tagBadge: tag.badge, tagColor: tag.color, updatedAt: new Date() })
      .where(eq(spaces.id, spaceId));
    await audit(tx, {
      spaceId,
      actorId: me,
      action: 'space.tag',
      targetType: 'space',
      targetId: spaceId,
      changes: { ...tag },
    });
    fxSpaceTag(fx, spaceId, tag);
    return tag;
  });
}

/** Remove a Space's tag (MANAGE_SPACE; idempotent): it stops showing on every wearer. */
export async function removeSpaceTag(me: ID, spaceId: ID): Promise<void> {
  await transact(async (tx, fx) => {
    const space = await lockSpace(tx, spaceId);
    await requireSpacePermission(tx, spaceId, me, PERM.MANAGE_SPACE);
    if (!tagOf(space)) return;
    await tx
      .update(spaces)
      .set({ tag: null, tagBadge: null, tagColor: null, updatedAt: new Date() })
      .where(eq(spaces.id, spaceId));
    await audit(tx, {
      spaceId,
      actorId: me,
      action: 'space.tag',
      targetType: 'space',
      targetId: spaceId,
      changes: { removed: true },
    });
    fxSpaceTag(fx, spaceId, null);
  });
}

/**
 * Wear the tag of a Space I'm in (404 when I'm not, 409 when it has no tag), or none (null).
 * Returns my UserPublic; a real change emits `user:changed`.
 */
export async function wearSpaceTag(me: ID, spaceId: ID | null): Promise<UserPublic> {
  return transact(async (tx, fx) => {
    if (spaceId) {
      // FOR SHARE: a kick or leave (which locks the Space FOR UPDATE) waits for this commit,
      // so its hook sees the tag and takes it off.
      const [space] = await tx
        .select({ tag: spaces.tag })
        .from(spaces)
        .where(eq(spaces.id, spaceId))
        .for('share');
      if (!space) throw notFound('Space');
      await requireSpaceMember(tx, spaceId, me);
      if (!space.tag) throw conflict('This Space has no tag');
    }
    const [row] = await tx
      .select({ tagSpaceId: users.tagSpaceId })
      .from(users)
      .where(eq(users.id, me))
      .for('no key update');
    if (!row) throw notFound('User');
    if (row.tagSpaceId !== spaceId) {
      await tx
        .update(users)
        .set({ tagSpaceId: spaceId, updatedAt: new Date() })
        .where(eq(users.id, me));
      fxTagWorn(fx, me);
    }
    const user = await toUserPublic(tx, me, me);
    if (!user) throw notFound('User');
    return user;
  });
}
