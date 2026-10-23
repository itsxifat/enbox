/**
 * Contracts of the moderation wave (docs/design/discord-parity.md W11): the member list's
 * filters and bulk actions, Mod View, security actions (pause invites, pause DMs), raid alerts
 * and the safety alerts channel. All additive.
 */
import { z } from 'zod';
import type { ID, ISODate, Message, SpaceMember, UserPublic } from './models.js';
import { idSchema } from './schemas.js';

// ---------------------------------------------------------------------------
// Member list: filters, sorting, bulk actions
// ---------------------------------------------------------------------------

export const MEMBER_SORTS = ['name', 'joined_desc', 'joined_asc'] as const;
export type MemberSort = (typeof MEMBER_SORTS)[number];

/**
 * `GET /api/spaces/:spaceId/members/search` (moderators: KICK, BAN, MODERATE, MANAGE_ROLES or
 * MANAGE_NICKNAMES): the Members settings page with filters. The plain member list keeps
 * `membersQuerySchema`.
 */
export const memberSearchQuerySchema = z.object({
  q: z.string().trim().max(64).optional(),
  /** Every one of these roles (comma separated in the query string). */
  roleIds: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(',').filter(Boolean) : []))
    .pipe(z.array(idSchema).max(10)),
  joinedAfter: z.iso.datetime({ offset: true }).optional(),
  joinedBefore: z.iso.datetime({ offset: true }).optional(),
  /** Accounts created after this (new accounts: raids). */
  accountCreatedAfter: z.iso.datetime({ offset: true }).optional(),
  timedOut: z.enum(['true', 'false']).optional(),
  sort: z.enum(MEMBER_SORTS).default('joined_desc'),
  after: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type MemberSearchQuery = z.input<typeof memberSearchQuerySchema>;

/** A member as moderators see it in the Members page: the member, its user, account age. */
export interface ModMember extends SpaceMember {
  user: UserPublic;
  /** When the account was created (`UserPublic.createdAt`, repeated for sorting/filtering). */
  accountCreatedAt: ISODate;
}

export interface ModMemberPage {
  members: ModMember[];
  nextCursor: string | null;
  /** Members matching the filters (capped at 10 000 for speed). */
  total: number;
}

export const BULK_MEMBER_ACTIONS = ['kick', 'ban', 'add_role', 'remove_role', 'timeout'] as const;
export type BulkMemberAction = (typeof BULK_MEMBER_ACTIONS)[number];

/** `POST /api/spaces/:spaceId/members/bulk`: up to 100 members at once (each checked as alone). */
export const bulkMembersSchema = z.object({
  action: z.enum(BULK_MEMBER_ACTIONS),
  userIds: z.array(idSchema).min(1).max(100),
  /** add_role / remove_role. */
  roleId: idSchema.optional(),
  /** timeout: seconds (≤ 28 days). */
  durationSec: z
    .number()
    .int()
    .min(60)
    .max(28 * 24 * 3600)
    .optional(),
  /** ban: delete their messages of the last N seconds (SPACE_BAN_PURGE_OPTIONS). */
  deleteMessageSeconds: z
    .number()
    .int()
    .min(0)
    .max(7 * 24 * 3600)
    .optional(),
  reason: z.string().trim().max(512).optional(),
});
export type BulkMembersRequest = z.input<typeof bulkMembersSchema>;

export interface BulkMembersResult {
  /** Done. */
  ok: ID[];
  /** Refused, with why ("Their highest role is above yours", …). */
  failed: { userId: ID; reason: string }[];
}

// ---------------------------------------------------------------------------
// Mod View (a member's moderation panel)
// ---------------------------------------------------------------------------

/** `GET /api/spaces/:spaceId/members/:userId/mod-view` (any moderator bit). */
export interface ModView {
  member: ModMember;
  /** Their messages in this Space's channels I can see, newest first (up to 20). */
  recentMessages: Message[];
  /** Messages they sent here in the last 30 days (channels I can see). */
  messageCount30d: number;
  /** Audit log entries about them (newest first, up to 20). */
  auditEntries: { action: string; actorId: ID | null; reason: string | null; createdAt: ISODate }[];
  /** Their voice channel now, if any. */
  voiceChannelId: ID | null;
}

// ---------------------------------------------------------------------------
// Security actions and raid alerts
// ---------------------------------------------------------------------------

/** Discord's "Pause invites" / "Pause DMs" choices (seconds; null = resume now). */
export const PAUSE_DURATIONS = [3600, 6 * 3600, 12 * 3600, 24 * 3600] as const;

export interface SpaceSecurity {
  /** No one joins with an invite until then (null = invites work). */
  invitesPausedUntil: ISODate | null;
  /** Members who aren't friends can't start DMs through this Space until then. */
  dmsPausedUntil: ISODate | null;
  /** Where raid and security alerts go (a text channel), or null. */
  safetyAlertsChannelId: ID | null;
  /** Alert when many accounts join quickly. */
  raidAlerts: boolean;
}

/** `PATCH /api/spaces/:spaceId/security` (MANAGE_SPACE, or MODERATE_MEMBERS for pauses). */
export const updateSpaceSecuritySchema = z.object({
  /** Pause for these seconds, or null to resume. */
  pauseInvitesSec: z
    .number()
    .int()
    .min(60)
    .max(24 * 3600)
    .nullable()
    .optional(),
  pauseDmsSec: z
    .number()
    .int()
    .min(60)
    .max(24 * 3600)
    .nullable()
    .optional(),
  safetyAlertsChannelId: idSchema.nullable().optional(),
  raidAlerts: z.boolean().optional(),
});
export type UpdateSpaceSecurityRequest = z.input<typeof updateSpaceSecuritySchema>;

/** Joins within RAID_WINDOW_SEC that raise a raid alert (once per window). */
export const RAID_JOIN_THRESHOLD = 10;
export const RAID_WINDOW_SEC = 120;
