/**
 * Contracts of the safety wave (docs/design/discord-parity.md W7-C, W7-F): who may start a DM
 * with me and message requests, per-Space DM privacy, Ignore, and reports. All additive: a
 * message request is a direct chat whose recipient row is `pending` (hidden from `GET /chats`,
 * so the APK simply doesn't list it).
 */
import { z } from 'zod';
import type { ID, ISODate } from './models.js';
import { idSchema } from './schemas.js';

// ---------------------------------------------------------------------------
// Direct messages: who may start one, and message requests
// ---------------------------------------------------------------------------

/**
 * Who may start a DM with me (Settings ▸ Privacy ▸ "Who can send you direct messages"):
 * `everyone`, members of a Space I share with DMs allowed in it (`spaces`), or `friends`.
 */
export const DM_POLICIES = ['everyone', 'spaces', 'friends'] as const;
export type DmPolicy = (typeof DM_POLICIES)[number];

/**
 * My side of a direct chat started by someone who isn't my friend (with
 * `UserSettings.messageRequests` on): `pending` until I accept (or reply), `ignored` once I
 * decline. Either way the chat stays out of `GET /chats`, counts no unreads and sends no push.
 */
export type ChatRequestState = 'pending' | 'ignored';

/*
 * Per-Space DM privacy (Discord: "Allow direct messages from server members") is
 * `SpaceMemberSelf.allowDms`, changed through `PATCH /api/spaces/:spaceId/members/@me`.
 * New memberships take `UserSettings.allowSpaceDms`.
 */

// ---------------------------------------------------------------------------
// Ignore (silent: the other person is never told)
// ---------------------------------------------------------------------------

export const MAX_IGNORED_USERS = 1000;

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export const REPORT_CATEGORIES = [
  'spam',
  'harassment',
  'hate',
  'violence',
  'self_harm',
  'sexual',
  'minor_safety',
  'illegal',
  'impersonation',
  'other',
] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

export const REPORT_TARGETS = ['message', 'user', 'space'] as const;
export type ReportTarget = (typeof REPORT_TARGETS)[number];

export const REPORT_STATUSES = ['open', 'resolved', 'dismissed'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const createReportSchema = z.object({
  targetType: z.enum(REPORT_TARGETS),
  targetId: idSchema,
  category: z.enum(REPORT_CATEGORIES),
  details: z.string().trim().max(1000).optional(),
  /** Also block the reported user (or the reported message's author). */
  alsoBlock: z.boolean().optional(),
});
export type CreateReportRequest = z.input<typeof createReportSchema>;

/** What was reported, as it was at the time (kept when the original is deleted or edited). */
export interface ReportEvidence {
  message?: {
    id: ID;
    chatId: ID;
    senderId: ID | null;
    text: string | null;
    mediaUrls: string[];
    createdAt: ISODate;
  };
  user?: { id: ID; username: string; displayName: string };
  space?: { id: ID; name: string };
}

/**
 * A report about a Space's content, as its moderators see it (Space Settings ▸ Reports).
 * The reporter is never shown to moderators.
 */
export interface SpaceReport {
  id: ID;
  spaceId: ID;
  targetType: ReportTarget;
  targetId: ID;
  category: ReportCategory;
  details: string | null;
  evidence: ReportEvidence;
  status: ReportStatus;
  createdAt: ISODate;
  resolvedAt: ISODate | null;
  resolvedBy: ID | null;
}

export interface SpaceReportPage {
  reports: SpaceReport[];
  /** Pass as `before` for the next page (null = done). */
  nextCursor: string | null;
}

export const spaceReportsQuerySchema = z.object({
  status: z.enum(REPORT_STATUSES).optional(),
  before: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const updateReportSchema = z.object({ status: z.enum(REPORT_STATUSES) });
export type SpaceReportsQuery = z.input<typeof spaceReportsQuerySchema>;
export type UpdateReportRequest = z.input<typeof updateReportSchema>;
