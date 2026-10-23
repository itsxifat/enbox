import { Router } from 'express';

/**
 * Group DMs module — owns: /chats/group-dm, /chats/:chatId/group-dm/members/**. Paths are relative to /api (see ApiRoutes in @enbox/shared); mounted behind
 * requireAuth. Business rules: ./service.ts.
 */
export const router = Router();
