import { Router } from 'express';
import {
  createReportSchema,
  idParamSchema,
  spaceReportsQuerySchema,
  updateReportSchema,
} from '@enbox/shared';
import { authUserId } from '../../http/auth.js';
import { parse } from '../../lib/validate.js';
import { createReport, listSpaceReports, updateSpaceReport } from './service.js';

/**
 * Reports module — owns: /reports, /spaces/:spaceId/reports/**. Paths are relative to /api (see ApiRoutes in @enbox/shared); mounted behind
 * requireAuth. Business rules: ./service.ts.
 */
export const router = Router();

/** Report a message, a user or a Space (201 `{ id }`; 404 for anything I can't see). */
router.post('/reports', async (req, res) => {
  const me = authUserId(req);
  const body = parse(createReportSchema, req.body ?? {});
  res.status(201).json(await createReport(me, body));
});

/** The Space's reports for its moderators, newest first. */
router.get('/spaces/:spaceId/reports', async (req, res) => {
  const me = authUserId(req);
  const { spaceId } = parse(idParamSchema('spaceId'), req.params);
  const q = parse(spaceReportsQuerySchema, req.query);
  res.json(await listSpaceReports(me, spaceId, q));
});

router.patch('/spaces/:spaceId/reports/:reportId', async (req, res) => {
  const me = authUserId(req);
  const { spaceId, reportId } = parse(idParamSchema('spaceId', 'reportId'), req.params);
  const { status } = parse(updateReportSchema, req.body ?? {});
  res.json(await updateSpaceReport(me, spaceId, reportId, status));
});
