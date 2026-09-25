import { Router } from 'express';
import { and, eq } from 'drizzle-orm';
import { pushSubscribeSchema, pushUnsubscribeSchema } from '@enbox/shared';
import { db } from '../../db/index.js';
import { pushSubscriptions } from '../../db/schema.js';
import { authCtx } from '../../http/auth.js';
import { unauthorized } from '../../lib/errors.js';
import { parse } from '../../lib/validate.js';
import { isForeignKeyViolation } from '../auth/service.js';
// Registers the domain-event listeners that send pushes (message, dismiss, call, call_cancel).
import './notifications.js';

/**
 * Push module — owns: /push/subscriptions (docs "Push").
 * - POST: endpoint must be https on an allow-listed push service host (`pushEndpointSchema`,
 *   anti-SSRF); upsert by endpoint, (re)assigned to the current user AND session (logout or
 *   revocation of the session removes it by cascade).
 * - DELETE: removes the endpoint only if it is mine (idempotent 204 either way).
 */
export const router = Router();

router.post('/push/subscriptions', async (req, res) => {
  const { userId, sessionId } = authCtx(req);
  const body = parse(pushSubscribeSchema, req.body ?? {});
  const values = { userId, sessionId, endpoint: body.endpoint, p256dh: body.keys.p256dh, auth: body.keys.auth };
  try {
    await db
      .insert(pushSubscriptions)
      .values(values)
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { userId, sessionId, p256dh: values.p256dh, auth: values.auth, createdAt: new Date() },
      });
  } catch (err) {
    // The session was revoked while this request was in flight.
    if (isForeignKeyViolation(err)) throw unauthorized();
    throw err;
  }
  res.status(204).end();
});

router.delete('/push/subscriptions', async (req, res) => {
  const { userId } = authCtx(req);
  const body = parse(pushUnsubscribeSchema, req.body ?? {});
  await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.endpoint, body.endpoint), eq(pushSubscriptions.userId, userId)));
  res.status(204).end();
});
