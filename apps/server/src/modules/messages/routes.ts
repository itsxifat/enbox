import { Router } from 'express';

/**
 * Messages module — owns: /chats/:chatId/messages, /messages/*, /search/messages.
 * Paths are relative to /api (see ApiRoutes in @enbox/shared). This router is mounted
 * behind requireAuth; use req.auth / authUserId(req).
 */
export const router = Router();
