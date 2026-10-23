import { Router } from 'express';

/**
 * Friend invite links (everyday wave, agent 5). Paths are relative to /api (see ApiRoutes in
 * @enbox/shared); mounted behind requireAuth.
 *
 *   GET    /me/friend-invites                 FriendInvite[]: my live links
 *   POST   /me/friend-invites                 FriendInvite: a new link (a week, five uses)
 *   DELETE /me/friend-invites                 revoke all of mine
 *   GET    /friend-invites/:code              FriendInvitePreview
 *   POST   /friend-invites/:code/accept       FriendInviteAccepted: we become friends
 */
export const router = Router();
