import { Router } from 'express';

/**
 * Message requests module — owns: /chats/requests, /chats/:chatId/request/**. Paths are relative to /api (see ApiRoutes in @enbox/shared); mounted behind
 * requireAuth. Business rules: ./service.ts.
 */
export const router = Router();
