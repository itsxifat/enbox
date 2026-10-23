import { Router } from 'express';
import { z } from 'zod';
import {
  createSpaceEventSchema,
  idParamSchema,
  idSchema,
  updateSpaceEventSchema,
} from '@enbox/shared';
import { authUserId } from '../../http/auth.js';
import { parse } from '../../lib/validate.js';
import {
  INTERESTED_PAGE_LIMIT,
  createEvent,
  deleteEvent,
  listEvents,
  listInterested,
  setInterested,
  updateEvent,
} from './service.js';

/**
 * Events module — owns the scheduled events of a Space. Paths are relative to /api (see
 * ApiRoutes in @enbox/shared); mounted behind requireAuth. Business rules: ./service.ts.
 *
 * - GET    /spaces/:spaceId/events                       members → SpaceEvent[] (scheduled and active, by start)
 * - POST   /spaces/:spaceId/events                       MANAGE_CHANNELS → SpaceEvent (201)
 * - PATCH  /spaces/:spaceId/events/:eventId              creator or MANAGE_SPACE → SpaceEvent
 * - DELETE /spaces/:spaceId/events/:eventId              creator or MANAGE_SPACE → 204
 * - PUT    /spaces/:spaceId/events/:eventId/interested   members → SpaceEvent (idempotent)
 * - DELETE /spaces/:spaceId/events/:eventId/interested   members → SpaceEvent (idempotent)
 * - GET    /spaces/:spaceId/events/:eventId/interested   members → UserPublic[] (`after`, `limit`)
 */
export const router = Router();

const P = {
  space: idParamSchema('spaceId'),
  event: idParamSchema('spaceId', 'eventId'),
};

const interestedQuerySchema = z.object({
  /** Keyset cursor: the last user id of the previous page. */
  after: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(INTERESTED_PAGE_LIMIT).default(INTERESTED_PAGE_LIMIT),
});

router.get('/spaces/:spaceId/events', async (req, res) => {
  const me = authUserId(req);
  const { spaceId } = parse(P.space, req.params);
  res.json(await listEvents(me, spaceId));
});

router.post('/spaces/:spaceId/events', async (req, res) => {
  const me = authUserId(req);
  const { spaceId } = parse(P.space, req.params);
  const body = parse(createSpaceEventSchema, req.body ?? {});
  res.status(201).json(await createEvent(me, spaceId, body));
});

router.patch('/spaces/:spaceId/events/:eventId', async (req, res) => {
  const me = authUserId(req);
  const { spaceId, eventId } = parse(P.event, req.params);
  const body = parse(updateSpaceEventSchema, req.body ?? {});
  res.json(await updateEvent(me, spaceId, eventId, body));
});

router.delete('/spaces/:spaceId/events/:eventId', async (req, res) => {
  const me = authUserId(req);
  const { spaceId, eventId } = parse(P.event, req.params);
  await deleteEvent(me, spaceId, eventId);
  res.status(204).end();
});

router.put('/spaces/:spaceId/events/:eventId/interested', async (req, res) => {
  const me = authUserId(req);
  const { spaceId, eventId } = parse(P.event, req.params);
  res.json(await setInterested(me, spaceId, eventId, true));
});

router.delete('/spaces/:spaceId/events/:eventId/interested', async (req, res) => {
  const me = authUserId(req);
  const { spaceId, eventId } = parse(P.event, req.params);
  res.json(await setInterested(me, spaceId, eventId, false));
});

router.get('/spaces/:spaceId/events/:eventId/interested', async (req, res) => {
  const me = authUserId(req);
  const { spaceId, eventId } = parse(P.event, req.params);
  const query = parse(interestedQuerySchema, req.query);
  res.json(await listInterested(me, spaceId, eventId, query));
});
