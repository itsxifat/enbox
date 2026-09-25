import { Router } from 'express';

/**
 * Chats module — owns: /chats, /chats/:chatId, /chats/direct, /chats/:chatId/{prefs,read,clear,disappearing,members,media,pins}.
 * Paths are relative to /api (see ApiRoutes in @enbox/shared). This router is mounted
 * behind requireAuth; use req.auth / authUserId(req).
 */
export const router = Router();
