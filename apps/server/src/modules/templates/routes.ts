import { Router } from 'express';
import { z } from 'zod';
import { createTemplateSchema, idParamSchema, idSchema, updateTemplateSchema } from '@enbox/shared';
import { authUserId } from '../../http/auth.js';
import { parse } from '../../lib/validate.js';
import {
  createTemplate,
  deleteTemplate,
  getTemplate,
  listTemplates,
  syncTemplate,
  updateTemplate,
} from './service.js';

/**
 * Space templates module — owns: /templates/:code, /spaces/:spaceId/templates/** (starters: STARTER_TEMPLATES). Paths are relative to /api (see ApiRoutes in @enbox/shared); mounted behind
 * requireAuth. Business rules: ./service.ts.
 */
export const router = Router();

const code = z.string().trim().min(1).max(40);
const P = {
  code: z.object({ code }),
  space: idParamSchema('spaceId'),
  template: z.object({ spaceId: idSchema, code }),
};

router.get('/templates/:code', async (req, res) => {
  authUserId(req);
  const p = parse(P.code, req.params);
  res.json(await getTemplate(p.code));
});

router.get('/spaces/:spaceId/templates', async (req, res) => {
  const me = authUserId(req);
  const { spaceId } = parse(P.space, req.params);
  res.json(await listTemplates(me, spaceId));
});

// One template per Space (409 for a second); 201 with its code.
router.post('/spaces/:spaceId/templates', async (req, res) => {
  const me = authUserId(req);
  const { spaceId } = parse(P.space, req.params);
  const body = parse(createTemplateSchema, req.body ?? {});
  res.status(201).json(await createTemplate(me, spaceId, body));
});

router.patch('/spaces/:spaceId/templates/:code', async (req, res) => {
  const me = authUserId(req);
  const p = parse(P.template, req.params);
  const body = parse(updateTemplateSchema, req.body ?? {});
  res.json(await updateTemplate(me, p.spaceId, p.code, body));
});

// Sync: the template takes the Space's structure as it is now.
router.put('/spaces/:spaceId/templates/:code', async (req, res) => {
  const me = authUserId(req);
  const p = parse(P.template, req.params);
  res.json(await syncTemplate(me, p.spaceId, p.code));
});

router.delete('/spaces/:spaceId/templates/:code', async (req, res) => {
  const me = authUserId(req);
  const p = parse(P.template, req.params);
  await deleteTemplate(me, p.spaceId, p.code);
  res.status(204).end();
});
