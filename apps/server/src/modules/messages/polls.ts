import { Router } from 'express';

/**
 * Polls with an end (polish wave, agent 2) — owns: End Poll Now, the poll closer and the result
 * message. Paths are relative to /api (see ApiRoutes in @enbox/shared); mounted behind
 * requireAuth.
 *
 *   POST /messages/:messageId/poll/end   Message: close the poll now (its sender, or
 *                                        MANAGE_MESSAGES in a Space channel); posts the result
 */
export const router = Router();

/**
 * Close the polls whose end time passed (leader job jobs/pollClose.ts): set `poll_closed_at`,
 * emit `message:updated`, post the `poll_result` system message. Returns how many closed.
 */
export async function closeExpiredPolls(): Promise<number> {
  return 0;
}
