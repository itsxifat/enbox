/**
 * Security actions and raid alerts (contracts in @enbox/shared moderation.ts):
 * - Pause Invites: until `spaces.invites_paused_until` nobody joins (invites, vanity codes,
 *   Discovery): 403 `invites_paused` (`joinSpaceViaInvite`), and invite previews say so.
 * - Pause DMs: until `spaces.dms_paused_until` the Space doesn't count as shared for the DM
 *   gate (services/dmGate.ts), so members who aren't friends can't start DMs through it.
 * - The safety alerts channel (a text channel of the Space) and the raid alerts switch.
 *   `PATCH /security` needs MANAGE_SPACE, or MODERATE_MEMBERS for the pauses only; it emits
 *   `space:security` → the Space room and is audited as `space.security`.
 * - Raid alerts (`checkRaid`, from the join hook): RAID_JOIN_THRESHOLD joins within
 *   RAID_WINDOW_SEC post one `raid_alert` system message in the safety alerts channel, at most
 *   once per window. Joins are counted from their `member.join` audit entries (indexed by
 *   Space and time, unlike `space_members.joined_at`); joins are serialised by the Space lock.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import {
  PERM,
  RAID_JOIN_THRESHOLD,
  RAID_WINDOW_SEC,
  hasPerm,
  rooms,
  type SpaceSecurity,
  type SystemEvent,
  type updateSpaceSecuritySchema,
} from '@enbox/shared';
import { db, type Tx } from '../../db/index.js';
import { chats, messages, spaceAuditLog, spaces, type SpaceRow } from '../../db/schema.js';
import { HttpError, forbidden, notFound } from '../../lib/errors.js';
import { emitToRooms } from '../../realtime/emit.js';
import { transact, type Effects } from '../../services/effects.js';
import { createMessage } from '../../services/messages.js';
import { lockSpace, requireSpaceMember } from '../../services/spaceAccess.js';
import { audit, toSpaceSecurity } from '../../services/spaces.js';
import { rawRows } from '../../services/sql.js';

export type UpdateSecurityParams = z.output<typeof updateSpaceSecuritySchema>;

export const INVITES_PAUSED_MESSAGE = 'Invites to this Space are paused';

/** Invites (and every other way in) are paused right now. */
export function invitesPausedNow(
  space: Pick<SpaceRow, 'invitesPausedUntil'>,
  now = Date.now(),
): boolean {
  return !!space.invitesPausedUntil && space.invitesPausedUntil.getTime() > now;
}

export const invitesPaused = () => new HttpError(403, 'invites_paused', INVITES_PAUSED_MESSAGE);

/** MANAGE_SPACE or MODERATE_MEMBERS (who sees `Space.security`). */
function canSeeSecurity(base: number): boolean {
  return hasPerm(base, PERM.MANAGE_SPACE) || hasPerm(base, PERM.MODERATE_MEMBERS);
}

/** `GET /spaces/:spaceId/security`. */
export async function getSecurity(me: string, spaceId: string): Promise<SpaceSecurity> {
  const access = await requireSpaceMember(db, spaceId, me);
  if (!canSeeSecurity(access.base))
    throw forbidden('You cannot see the security actions of this Space');
  const [row] = await db.select().from(spaces).where(eq(spaces.id, spaceId)).limit(1);
  if (!row) throw notFound('Space');
  return toSpaceSecurity(row);
}

/** `PATCH /spaces/:spaceId/security`: pauses (null resumes), alerts channel, raid alerts. */
export async function updateSecurity(
  me: string,
  spaceId: string,
  body: UpdateSecurityParams,
): Promise<SpaceSecurity> {
  return transact(async (tx, fx) => {
    const space = await lockSpace(tx, spaceId);
    const access = await requireSpaceMember(tx, spaceId, me);
    const manage = hasPerm(access.base, PERM.MANAGE_SPACE);
    const alerts = body.safetyAlertsChannelId !== undefined || body.raidAlerts !== undefined;
    if (!manage && (alerts || !hasPerm(access.base, PERM.MODERATE_MEMBERS)))
      throw forbidden(
        alerts
          ? 'You cannot change the safety alerts of this Space'
          : 'You cannot pause invites or DMs in this Space',
      );
    const now = Date.now();
    const before = toSpaceSecurity(space, now);
    const until = (sec: number | null) => (sec === null ? null : new Date(now + sec * 1000));
    const patch: Partial<typeof spaces.$inferInsert> = {};
    if (body.pauseInvitesSec !== undefined) patch.invitesPausedUntil = until(body.pauseInvitesSec);
    if (body.pauseDmsSec !== undefined) patch.dmsPausedUntil = until(body.pauseDmsSec);
    if (body.safetyAlertsChannelId !== undefined) {
      if (body.safetyAlertsChannelId) {
        const [chat] = await tx
          .select({ id: chats.id })
          .from(chats)
          .where(
            and(
              eq(chats.id, body.safetyAlertsChannelId),
              eq(chats.spaceId, spaceId),
              eq(chats.type, 'space_text'),
            ),
          )
          .limit(1);
        if (!chat) throw notFound('Channel');
      }
      patch.safetyAlertsChannelId = body.safetyAlertsChannelId;
    }
    if (body.raidAlerts !== undefined) patch.raidAlerts = body.raidAlerts;
    if (Object.keys(patch).length === 0) return before;
    const [row] = await tx.update(spaces).set(patch).where(eq(spaces.id, spaceId)).returning();
    const security = toSpaceSecurity(row!, now);
    const changes: Record<string, unknown> = {};
    for (const k of Object.keys(security) as (keyof SpaceSecurity)[])
      if (before[k] !== security[k]) changes[k] = [before[k], security[k]];
    // Re-pausing changes the end time; resuming what had already ended changes nothing.
    if (Object.keys(changes).length) {
      await audit(tx, {
        spaceId,
        actorId: me,
        action: 'space.security',
        targetType: 'space',
        targetId: spaceId,
        changes,
      });
      fx.add(() => emitToRooms([rooms.space(spaceId)], 'space:security', { spaceId, security }));
    }
    return security;
  });
}

// ---------------------------------------------------------------------------
// Raid alerts
// ---------------------------------------------------------------------------

/** Last raid alert per Space on this process (ms); the channel check covers other processes. */
const lastAlert = new Map<string, number>();
const LAST_ALERT_MAX = 1_000;
/** A raid alert of another process within the window is among this many newest messages. */
const RECENT_ALERT_SCAN = 30;

function rememberAlert(spaceId: string, at: number): void {
  if (lastAlert.size >= LAST_ALERT_MAX)
    for (const [id, t] of lastAlert) if (at - t >= RAID_WINDOW_SEC * 1000) lastAlert.delete(id);
  lastAlert.set(spaceId, at);
}

/** Forget the alerts this process raised (tests). */
export function resetRaidAlerts(): void {
  lastAlert.clear();
}

/**
 * After a join with a notice (inside its transaction, the Space locked): count the window's
 * joins; at RAID_JOIN_THRESHOLD, with raid alerts on and an alerts channel, post one
 * `raid_alert` there unless one went out within the window.
 */
export async function checkRaid(tx: Tx, fx: Effects, spaceId: string, at: Date): Promise<void> {
  const now = at.getTime();
  const last = lastAlert.get(spaceId);
  if (last !== undefined && now - last < RAID_WINDOW_SEC * 1000) return;
  const [space] = await tx
    .select({ raidAlerts: spaces.raidAlerts, channelId: spaces.safetyAlertsChannelId })
    .from(spaces)
    .where(eq(spaces.id, spaceId))
    .limit(1);
  if (!space?.raidAlerts || !space.channelId) return;
  // The audit entries' times are the database's (now() of each join's transaction).
  const window = sql`now() - (${RAID_WINDOW_SEC} * interval '1 second')`;
  const [count] = await rawRows<{ n: number }>(
    tx,
    sql`select count(*)::int as n from (select 1 from ${spaceAuditLog}
        where ${spaceAuditLog.spaceId} = ${spaceId} and ${spaceAuditLog.action} = 'member.join'
          and ${spaceAuditLog.createdAt} > ${window}
        limit 1000) joins`,
  );
  const joins = Number(count?.n ?? 0);
  if (joins < RAID_JOIN_THRESHOLD) return;
  const [chat] = await tx
    .select({ id: chats.id })
    .from(chats)
    .where(
      and(eq(chats.id, space.channelId), eq(chats.spaceId, spaceId), eq(chats.type, 'space_text')),
    )
    .limit(1);
  if (!chat) return;
  const recent = await tx
    .select({ metadata: messages.metadata, createdAt: messages.createdAt })
    .from(messages)
    .where(eq(messages.chatId, chat.id))
    .orderBy(desc(messages.seq))
    .limit(RECENT_ALERT_SCAN);
  const recentAlert = recent.find(
    (m) =>
      m.metadata?.system?.kind === 'raid_alert' &&
      now - m.createdAt.getTime() < RAID_WINDOW_SEC * 1000,
  );
  if (recentAlert) {
    rememberAlert(spaceId, recentAlert.createdAt.getTime());
    return;
  }
  const event: SystemEvent = { kind: 'raid_alert', joins, windowSec: RAID_WINDOW_SEC };
  await createMessage(tx, fx, {
    chatId: chat.id,
    senderId: null,
    type: 'system',
    metadata: { system: event },
  });
  fx.add(() => rememberAlert(spaceId, now));
}
