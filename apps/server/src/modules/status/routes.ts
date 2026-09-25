import { Router } from 'express';
import { createStatusSchema, idParamSchema, statusReactSchema } from '@enbox/shared';
import { db } from '../../db/index.js';
import { authUserId } from '../../http/auth.js';
import { parse } from '../../lib/validate.js';
import { registerAccountDeletionHook } from '../../services/hooks.js';
import { createStatus, deleteStatus, deleteUserStatusesTx, loadStatusFeed, loadStatusViewers, reactToStatus, viewStatus } from './service.js';

/**
 * Status module — owns: /status/* (service.ts has the rules).
 * - GET /status/feed → StatusFeed
 * - POST /status → 201 Status (text/image/video; audience snapshot; `status:new`)
 * - DELETE /status/:statusId → 204 (author; `status:deleted`)
 * - POST /status/:statusId/view → 204 (audience; `status:viewed` unless read receipts off)
 * - PUT /status/:statusId/reaction → 204 (audience only)
 * - GET /status/:statusId/viewers → StatusViewer[] (author only)
 */
export const router = Router();

// Account deletion: the user's statuses disappear for their audiences (if still present).
registerAccountDeletionHook('status', deleteUserStatusesTx);

const statusParams = idParamSchema('statusId');

router.get('/status/feed', async (req, res) => {
  res.json(await loadStatusFeed(db, authUserId(req)));
});

router.post('/status', async (req, res) => {
  const me = authUserId(req);
  const body = parse(createStatusSchema, req.body);
  res.status(201).json(await createStatus(me, body));
});

router.delete('/status/:statusId', async (req, res) => {
  const me = authUserId(req);
  const { statusId } = parse(statusParams, req.params);
  await deleteStatus(me, statusId);
  res.status(204).end();
});

router.post('/status/:statusId/view', async (req, res) => {
  const me = authUserId(req);
  const { statusId } = parse(statusParams, req.params);
  await viewStatus(me, statusId);
  res.status(204).end();
});

router.put('/status/:statusId/reaction', async (req, res) => {
  const me = authUserId(req);
  const { statusId } = parse(statusParams, req.params);
  const { emoji } = parse(statusReactSchema, req.body);
  await reactToStatus(me, statusId, emoji);
  res.status(204).end();
});

router.get('/status/:statusId/viewers', async (req, res) => {
  const me = authUserId(req);
  const { statusId } = parse(statusParams, req.params);
  res.json(await loadStatusViewers(db, me, statusId));
});
