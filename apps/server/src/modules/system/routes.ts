import { Router } from 'express';
import { MAX_UPLOAD_BYTES } from '@enbox/shared';
import { config } from '../../config.js';

/** Public system endpoints: health check and client bootstrap config. */
export const publicRouter = Router();

publicRouter.get('/health', (_req, res) => {
  res.json({ ok: true, version: config.version });
});

publicRouter.get('/config', (_req, res) => {
  res.json({
    vapidPublicKey:
      config.vapid.publicKey && config.vapid.privateKey ? config.vapid.publicKey : null,
    maxUploadBytes: MAX_UPLOAD_BYTES,
    version: config.version,
  });
});
