import { Router, type NextFunction, type Request, type Response } from 'express';
import {
  createWebhookSchema,
  editWebhookMessageSchema,
  executeWebhookQuerySchema,
  executeWebhookSchema,
  idParamSchema,
  idSchema,
  updateWebhookSchema,
} from '@enbox/shared';
import { config } from '../../config.js';
import { authUserId } from '../../http/auth.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { parse } from '../../lib/validate.js';
import { WebhookRateLimited } from './limits.js';
import {
  createWebhook,
  deleteWebhook,
  deleteWebhookMessage,
  editWebhookMessage,
  executeWebhook,
  listChannelWebhooks,
  listSpaceWebhooks,
  regenerateWebhookToken,
  updateWebhook,
} from './service.js';

/**
 * Webhooks module — owns: /spaces/:spaceId/webhooks, /chats/:chatId/webhooks, /webhooks/**
 * (the public execute routes are on `publicRouter`). Paths are relative to /api (see
 * ApiRoutes in @enbox/shared); `router` is mounted behind requireAuth. Business rules:
 * ./service.ts.
 *
 * - GET    /spaces/:spaceId/webhooks        MANAGE_WEBHOOKS → Webhook[] (channels where I keep it)
 * - GET    /chats/:chatId/webhooks          MANAGE_WEBHOOKS there → Webhook[]
 * - POST   /chats/:chatId/webhooks          → WebhookWithUrl (201; the URL is shown once)
 * - PATCH  /webhooks/:webhookId             name, avatar, channel → Webhook
 * - DELETE /webhooks/:webhookId             → 204
 * - POST   /webhooks/:webhookId/token       → WebhookWithUrl (the old URL stops working)
 *
 * Public (no session; the URL's secret is the credential, 404 when wrong):
 * - POST   /webhooks/:webhookId/:token                       ?wait=true → 200 Message, else 204
 * - PATCH  /webhooks/:webhookId/:token/messages/:messageId   → Message
 * - DELETE /webhooks/:webhookId/:token/messages/:messageId   → 204
 *
 * JSON bodies only (no file uploads). Over a limit → 429 with Discord's `retry_after`
 * (seconds) next to the usual error body, and a Retry-After header.
 */
export const router = Router();

/** Mounted under /api without authentication: executing a webhook needs only its secret URL. */
export const publicRouter = Router();

const P = {
  space: idParamSchema('spaceId'),
  chat: idParamSchema('chatId'),
  webhook: idParamSchema('webhookId'),
};

/** Where the app is reached: PUBLIC_URL, else the origin this request came to. */
function appOrigin(req: Request): string {
  return config.publicUrl ?? `${req.protocol}://${req.get('host') ?? 'localhost'}`;
}

router.get('/spaces/:spaceId/webhooks', async (req, res) => {
  const { spaceId } = parse(P.space, req.params);
  res.json(await listSpaceWebhooks(authUserId(req), spaceId));
});

router.get('/chats/:chatId/webhooks', async (req, res) => {
  const { chatId } = parse(P.chat, req.params);
  res.json(await listChannelWebhooks(authUserId(req), chatId));
});

router.post('/chats/:chatId/webhooks', async (req, res) => {
  const me = authUserId(req);
  const { chatId } = parse(P.chat, req.params);
  const body = parse(createWebhookSchema, req.body ?? {});
  res.status(201).json(await createWebhook(me, chatId, body, appOrigin(req)));
});

router.patch('/webhooks/:webhookId', async (req, res) => {
  const me = authUserId(req);
  const { webhookId } = parse(P.webhook, req.params);
  const body = parse(updateWebhookSchema, req.body ?? {});
  res.json(await updateWebhook(me, webhookId, body));
});

router.delete('/webhooks/:webhookId', async (req, res) => {
  const me = authUserId(req);
  const { webhookId } = parse(P.webhook, req.params);
  await deleteWebhook(me, webhookId);
  res.status(204).end();
});

router.post('/webhooks/:webhookId/token', async (req, res) => {
  const me = authUserId(req);
  const { webhookId } = parse(P.webhook, req.params);
  res.json(await regenerateWebhookToken(me, webhookId, appOrigin(req)));
});

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

/** Ids that aren't ours (a Discord snowflake, a typo) are simply unknown webhooks. */
function idOr404(raw: unknown, what: string): string {
  const id = idSchema.safeParse(raw);
  if (!id.success) throw notFound(what);
  return id.data;
}

/** Discord treats `null` as "not given"; so do we (any depth). */
function withoutNulls(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(withoutNulls);
  if (v && typeof v === 'object')
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .filter(([, x]) => x !== null)
        .map(([k, x]) => [k, withoutNulls(x)]),
    );
  return v;
}

function jsonBody(req: Request): unknown {
  if (!req.is('application/json'))
    throw badRequest('Send a JSON body (Content-Type: application/json); files are not supported');
  return withoutNulls(req.body ?? {});
}

/** Run a public handler; a 429 is answered with Discord's fields and a Retry-After header. */
function publicRoute(handler: (req: Request, res: Response) => Promise<void>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await handler(req, res);
    } catch (err) {
      if (!(err instanceof WebhookRateLimited)) return next(err);
      res
        .status(429)
        .set('Retry-After', String(Math.ceil(err.retryAfter)))
        .json({ ...err.toBody(), retry_after: err.retryAfter, global: false });
    }
  };
}

publicRouter.post(
  '/webhooks/:webhookId/:token',
  // `POST /webhooks/:webhookId/token` is the signed-in regenerate route (mounted later).
  (req, _res, next) => (req.params.token === 'token' ? next('route') : next()),
  publicRoute(async (req, res) => {
    const webhookId = idOr404(req.params.webhookId, 'Webhook');
    const token = String(req.params.token);
    const body = parse(executeWebhookSchema, jsonBody(req));
    const { wait } = parse(executeWebhookQuerySchema, req.query);
    const message = await executeWebhook(webhookId, token, body, {
      wait: wait === 'true',
      ip: req.ip ?? '',
    });
    if (message) res.json(message);
    else res.status(204).end();
  }),
);

publicRouter.patch(
  '/webhooks/:webhookId/:token/messages/:messageId',
  publicRoute(async (req, res) => {
    const webhookId = idOr404(req.params.webhookId, 'Webhook');
    const messageId = idOr404(req.params.messageId, 'Message');
    const body = parse(editWebhookMessageSchema, jsonBody(req));
    res.json(
      await editWebhookMessage(webhookId, String(req.params.token), messageId, body, req.ip ?? ''),
    );
  }),
);

publicRouter.delete(
  '/webhooks/:webhookId/:token/messages/:messageId',
  publicRoute(async (req, res) => {
    const webhookId = idOr404(req.params.webhookId, 'Webhook');
    const messageId = idOr404(req.params.messageId, 'Message');
    await deleteWebhookMessage(webhookId, String(req.params.token), messageId, req.ip ?? '');
    res.status(204).end();
  }),
);
