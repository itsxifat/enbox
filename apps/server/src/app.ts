import fs from 'node:fs';
import path from 'node:path';
import express, { type ErrorRequestHandler } from 'express';
import compression from 'compression';
import cors from 'cors';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { config } from './config.js';
import { requireAuth } from './http/auth.js';
import { HttpError, toHttpError } from './lib/errors.js';
import { logger } from './lib/logger.js';
import { apiLimiter } from './lib/rateLimit.js';
import { authedRouters, publicRouters } from './modules/index.js';

/** Extensions browsers may render inline from /uploads; everything else is forced to download. */
const INLINE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.mp4', '.webm', '.ogg', '.oga', '.ogv', '.mov', '.mp3', '.m4a', '.aac', '.wav', '.opus']);

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Client IPs (per-IP rate limits, sessions.ip) come from X-Forwarded-For only behind a
  // configured reverse proxy (TRUST_PROXY); by default the socket address is used.
  app.set('trust proxy', config.trustProxy);

  app.use(
    helmet({
      contentSecurityPolicy: false, // the SPA sets its own CSP via meta; uploads get a strict one below
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(cors({ origin: config.corsOrigins.includes('*') ? true : config.corsOrigins, credentials: true }));
  app.use(compression());
  if (config.env !== 'test') {
    app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/health' } }));
  }

  // Uploaded media: unguessable keys, immutable, never executed as HTML/script.
  app.use(
    '/uploads',
    express.static(config.uploadDir, {
      immutable: true,
      maxAge: '365d',
      index: false,
      dotfiles: 'deny',
      setHeaders: (res, filePath) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
        if (!INLINE_EXT.has(path.extname(filePath).toLowerCase())) {
          res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filePath)}"`);
        }
      },
    }),
  );

  const api = express.Router();
  api.use(express.json({ limit: '1mb' }));
  api.use(apiLimiter);
  for (const r of publicRouters) api.use(r);
  api.use(requireAuth);
  for (const r of authedRouters) api.use(r);
  api.use((_req, _res, next) => next(new HttpError(404, 'not_found', 'Endpoint not found')));
  app.use('/api', api);

  // Serve the built web client (production single-container deployment).
  const indexHtml = path.join(config.webDistDir, 'index.html');
  if (fs.existsSync(indexHtml)) {
    app.use(express.static(config.webDistDir, { index: false, maxAge: '1h' }));
    // `root` keeps the dotfile check to the relative path, so a dist dir that lives under a
    // dot-directory (e.g. `.cache/…`) still serves.
    app.get(/^\/(?!api\/|uploads\/|socket\.io\/).*/, (_req, res) =>
      res.sendFile('index.html', { root: config.webDistDir }),
    );
  }

  const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
    // Body parser / multer errors carry a status.
    let e = toHttpError(err);
    const status = (err as { status?: number; statusCode?: number })?.status ?? (err as { statusCode?: number })?.statusCode;
    if (!(err instanceof HttpError) && status && status >= 400 && status < 500) {
      e = new HttpError(status, status === 413 ? 'payload_too_large' : 'validation_error', (err as Error).message);
    }
    if (e.status >= 500) (req.log ?? logger).error({ err }, 'request failed');
    res.status(e.status).json(e.toBody());
  };
  app.use(errorHandler);

  return app;
}
