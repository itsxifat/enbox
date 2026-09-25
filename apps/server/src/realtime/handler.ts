import type { z } from 'zod';
import type { Ack } from '@enbox/shared';
import { toHttpError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { parse } from '../lib/validate.js';
import type { AppSocket } from './types.js';

export interface SocketCtx {
  socket: AppSocket;
  userId: string;
  sessionId: string;
}

/**
 * Wrap a socket event handler: validates the payload with `schema`, runs `fn`, and replies via
 * the ack callback (if the client passed one) with `{ ok: true, data }` or `{ ok: false, error }`
 * (`error.details` carries HttpError details, e.g. `{ callId }` for a call:start conflict).
 * Per-socket throttling: call `limitUser(socket.id, ...)` (lib/userLimit.ts) inside `fn`.
 */
export function socketHandler<S extends z.ZodType, R>(
  socket: AppSocket,
  schema: S,
  fn: (payload: z.output<S>, ctx: SocketCtx) => Promise<R> | R,
) {
  return async (raw: unknown, ack?: (res: Ack<R>) => void) => {
    try {
      const payload = parse(schema, raw);
      const data = await fn(payload, {
        socket,
        userId: socket.data.userId,
        sessionId: socket.data.sessionId,
      });
      if (typeof ack === 'function') ack({ ok: true, data });
    } catch (err) {
      const e = toHttpError(err);
      if (e.status >= 500) logger.error({ err }, 'socket handler failed');
      if (typeof ack === 'function') {
        ack({
          ok: false,
          error: {
            code: e.code,
            message: e.message,
            ...(e.details !== undefined ? { details: e.details } : {}),
          },
        });
      }
    }
  };
}
