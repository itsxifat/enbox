import { Router } from 'express';
import { idParamSchema, insightsQuerySchema } from '@enbox/shared';
import { authUserId } from '../../http/auth.js';
import { parse } from '../../lib/validate.js';
import { getSpaceInsights, getSpaceInsightsCsv } from './service.js';
// Counting starts at startup: the message counters and the membership hooks register here.
import './counters.js';

/**
 * Insights module — owns: /spaces/:spaceId/insights(.csv). Paths are relative to /api (see ApiRoutes in @enbox/shared); mounted behind
 * requireAuth. Business rules: ./service.ts; counting: ./counters.ts (jobs: jobs/insights.ts).
 */
export const router = Router();

const P = { space: idParamSchema('spaceId') };

// GET /spaces/:spaceId/insights?days=7|30|90 (MANAGE_SPACE or VIEW_AUDIT_LOG) → SpaceInsights
router.get('/spaces/:spaceId/insights', async (req, res) => {
  const me = authUserId(req);
  const { spaceId } = parse(P.space, req.params);
  const { days } = parse(insightsQuerySchema, req.query);
  res.json(await getSpaceInsights(me, spaceId, days));
});

// GET /spaces/:spaceId/insights.csv?days= → text/csv attachment, one row per day
router.get('/spaces/:spaceId/insights.csv', async (req, res) => {
  const me = authUserId(req);
  const { spaceId } = parse(P.space, req.params);
  const { days } = parse(insightsQuerySchema, req.query);
  const { fileName, csv } = await getSpaceInsightsCsv(me, spaceId, days);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(csv);
});
