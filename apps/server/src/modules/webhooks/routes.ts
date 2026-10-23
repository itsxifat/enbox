import { Router } from 'express';

/**
 * Webhooks module — owns: /spaces/:spaceId/webhooks, /chats/:chatId/webhooks, /webhooks/** (the public execute routes are on `publicRouter`). Paths are relative to /api (see ApiRoutes in @enbox/shared); mounted behind
 * requireAuth. Business rules: ./service.ts.
 */
export const router = Router();

/** Mounted under /api without authentication: executing a webhook needs only its secret URL. */
export const publicRouter = Router();
