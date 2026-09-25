import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { and, eq, isNull } from 'drizzle-orm';
import { rooms } from '@enbox/shared';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { chatMembers, users } from '../db/schema.js';
import { logger } from '../lib/logger.js';
import { resolveToken } from '../services/sessions.js';
import { socketRegistrars } from '../modules/index.js';
import { sessionRoom, setIo } from './emit.js';
import { markConnected, markDisconnected, presenceEvents } from './presence.js';
import type { IO } from './types.js';

export async function createSocketServer(httpServer: HttpServer): Promise<IO> {
  const io: IO = new Server(httpServer, {
    cors: {
      origin: config.corsOrigins.includes('*') ? true : config.corsOrigins,
      credentials: true,
    },
    maxHttpBufferSize: 1e6,
    pingInterval: 20_000,
    pingTimeout: 20_000,
  });

  if (config.redisUrl) {
    const { createAdapter } = await import('@socket.io/redis-adapter');
    const { createClient } = await import('redis');
    const pub = createClient({ url: config.redisUrl });
    const sub = pub.duplicate();
    await Promise.all([pub.connect(), sub.connect()]);
    io.adapter(createAdapter(pub, sub));
    logger.info('Socket.IO Redis adapter enabled');
  }

  io.use(async (socket, next) => {
    try {
      const token = (socket.handshake.auth as { token?: string } | undefined)?.token;
      const ctx = await resolveToken(token);
      if (!ctx) return next(new Error('unauthorized'));
      socket.data.userId = ctx.userId;
      socket.data.sessionId = ctx.sessionId;
      next();
    } catch (err) {
      logger.error({ err }, 'socket auth failed');
      next(new Error('internal_error'));
    }
  });

  io.on('connection', async (socket) => {
    const { userId, sessionId } = socket.data;

    // Register module listeners synchronously so no early client event is dropped.
    for (const register of socketRegistrars) {
      try {
        register(io, socket);
      } catch (err) {
        logger.error({ err }, 'socket registrar failed');
      }
    }

    socket.on('disconnect', () => {
      if (markDisconnected(userId)) {
        const lastSeenAt = new Date();
        db.update(users)
          .set({ lastSeenAt })
          .where(eq(users.id, userId))
          .catch((err) => logger.error({ err }, 'failed to update last seen'));
        presenceEvents.emit('offline', userId, lastSeenAt);
      }
    });

    try {
      const memberships = await db
        .select({ chatId: chatMembers.chatId })
        .from(chatMembers)
        .where(and(eq(chatMembers.userId, userId), isNull(chatMembers.leftAt)));
      await socket.join([rooms.user(userId), sessionRoom(sessionId), ...memberships.map((m) => rooms.chat(m.chatId))]);
    } catch (err) {
      logger.error({ err }, 'failed to join rooms');
      socket.disconnect(true);
      return;
    }

    if (socket.disconnected) return;
    if (markConnected(userId)) presenceEvents.emit('online', userId);
    socket.emit('ready', { userId, sessionId, serverTime: new Date().toISOString() });
  });

  setIo(io);
  return io;
}
