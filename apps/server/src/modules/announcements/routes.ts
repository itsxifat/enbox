import { Router } from 'express';

/**
 * Announcement channels module — owns: /messages/:messageId/crosspost, /chats/:chatId/followers, /spaces/:spaceId/follows, /channel-follows/**. Paths are relative to /api (see ApiRoutes in @enbox/shared); mounted behind
 * requireAuth. Business rules: ./service.ts.
 */
export const router = Router();
