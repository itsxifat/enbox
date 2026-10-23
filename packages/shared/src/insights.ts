/**
 * Contracts of Space insights (docs/design/discord-parity.md W12-F): daily activity counted as
 * it happens (messages, joins, leaves, active members, voice minutes) and the Insights page.
 */
import { z } from 'zod';
import type { ID, ISODate } from './models.js';

export interface InsightsDay {
  /** UTC day, `YYYY-MM-DD`. */
  day: string;
  messages: number;
  joins: number;
  leaves: number;
  /** Members who sent a message or joined voice that day. */
  activeMembers: number;
  voiceMinutes: number;
}

/** `GET /api/spaces/:spaceId/insights?days=` (MANAGE_SPACE or VIEW_AUDIT_LOG). */
export interface SpaceInsights {
  spaceId: ID;
  /** Oldest first, one entry per day of the range (zeros for quiet days). */
  days: InsightsDay[];
  memberCount: number;
  /** When counting started for this Space (older days are zeros). */
  since: ISODate;
  /** The busiest channels in the range (messages), up to 10. */
  topChannels: { channelId: ID; name: string; messages: number }[];
}

export const INSIGHTS_RANGES = [7, 30, 90] as const;
export const insightsQuerySchema = z.object({
  days: z.coerce
    .number()
    .int()
    .refine((n) => (INSIGHTS_RANGES as readonly number[]).includes(n), 'days: 7, 30 or 90')
    .default(30),
});
export type InsightsQuery = z.input<typeof insightsQuerySchema>;
