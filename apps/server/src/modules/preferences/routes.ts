import { Router } from 'express';

/**
 * Synced preferences (everyday wave, agent 3): the device preferences I sync across devices.
 * Paths are relative to /api (see ApiRoutes in @enbox/shared); mounted behind requireAuth.
 *
 *   GET   /me/preferences   SyncedPreferences
 *   PATCH /me/preferences   SyncedPreferences: merge keys (null deletes); me:preferences → my devices
 */
export const router = Router();
