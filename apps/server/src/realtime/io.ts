import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { and, eq, inArray, isNull, lte, ne, notInArray, or, sql } from 'drizzle-orm';
import { rooms } from '@enbox/shared';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { chatMembers, chats, users } from '../db/schema.js';
import { logger } from '../lib/logger.js';
import { SERVER_RATE_LIMITS, limitUser } from '../lib/userLimit.js';
import { resolveToken } from '../services/sessions.js';
import { socketRegistrars } from '../modules/index.js';
import { setIo } from './emit.js';
import { afterReadyHooks, beforeReadyHooks, type ConnectHook } from './hooks.js';
import { dropPresenceSocket, markConnected, markDisconnected, presenceEvents } from './presence.js';
import {
  addSocketToSpaces,
  installSpaceRooms,
  memberSpaceIds,
  removeSocketFromSpaces,
} from './spaceRegistry.js';
import type { AppSocket, IO } from './types.js';

/**
 * Record these users' last seen time — unless they are invisible, whose `last_seen_at` stays
 * the value written when they went invisible (docs "Invisible invariants"; the re-evaluation
 * ignores the in-memory value for them too). An invisible choice whose `until` has passed no
 * longer hides them (`effectiveAvailability` shows them online until the expiry job reverts
 * the row), so it is written then. Several processes may record the same user (their last
 * sockets on different nodes): `greatest` keeps the latest. Fire-and-forget.
 */
function recordLastSeen(userIds: string[], lastSeenAt: Date): void {
  if (userIds.length === 0) return;
  db.update(users)
    .set({ lastSeenAt: sql`greatest(${users.lastSeenAt}, ${lastSeenAt})` })
    .where(
      and(
        inArray(users.id, userIds),
        or(ne(users.availability, 'invisible'), lte(users.availabilityUntil, lastSeenAt)),
      ),
    )
    .catch((err) => logger.error({ err }, 'failed to update last seen'));
}

// A vanished process took the last sockets of these users with it: nobody recorded their
// disconnect (every process hears this; `greatest` makes the repeats harmless).
presenceEvents.on('lost', (userIds, lastSeenAt) => recordLastSeen(userIds, lastSeenAt));

/**
 * Chats whose room the user's sockets belong in: active, non-hidden memberships. Space
 * channels have no rooms of their own (their `chat:<id>` is virtual, see spaceRegistry.ts);
 * their chat_members rows are only read state.
 */
async function visibleChatIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ chatId: chatMembers.chatId })
    .from(chatMembers)
    .innerJoin(chats, eq(chats.id, chatMembers.chatId))
    .where(
      and(
        eq(chatMembers.userId, userId),
        isNull(chatMembers.leftAt),
        eq(chatMembers.hidden, false),
        notInArray(chats.type, ['space_text', 'space_voice', 'space_thread']),
      ),
    );
  return rows.map((r) => r.chatId);
}

async function runHooks(kind: string, hooks: readonly ConnectHook[], socket: AppSocket) {
  for (const hook of hooks) {
    if (socket.disconnected) return;
    try {
      await hook(socket);
    } catch (err) {
      logger.error({ err, kind }, 'socket connect hook failed');
    }
  }
}

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
    // node-redis reconnects by itself; without a listener an 'error' event would be thrown.
    pub.on('error', (err) => logger.error({ err }, 'redis (pub) error'));
    sub.on('error', (err) => logger.error({ err }, 'redis (sub) error'));
    await Promise.all([pub.connect(), sub.connect()]);
    io.adapter(createAdapter(pub, sub));
    logger.info('Socket.IO Redis adapter enabled');
  }

  io.use(async (socket, next) => {
    try {
      const token = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
      const ctx = await resolveToken(token);
      if (!ctx) return next(new Error('unauthorized'));
      // Handshakes bypass the HTTP limiters; each one costs a few queries (memberships,
      // delivered advance, late-device rings), so reconnect loops are capped per user.
      const { limit, windowMs } = SERVER_RATE_LIMITS.connect;
      if (!limitUser(ctx.userId, 'socket:connect', limit, windowMs))
        return next(new Error('rate_limited'));
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
    /** This socket was counted by `markConnected` (only those may be uncounted on disconnect). */
    let counted = false;

    // Register module listeners synchronously so no early client event is dropped.
    for (const register of socketRegistrars) {
      try {
        register(io, socket);
      } catch (err) {
        logger.error({ err }, 'socket registrar failed');
      }
    }

    socket.on('disconnect', () => {
      dropPresenceSocket(socket.id);
      removeSocketFromSpaces(socket.id);
      if (!counted) return; // dropped during setup: it never counted towards "online"
      counted = false;
      // The registry fires the cluster-wide transitions ('offline', or 'activity' when the
      // devices left are all idle); this process records the last seen time when its own
      // last socket of the user closed.
      const lastSeenAt = new Date();
      if (markDisconnected(userId, socket.id, lastSeenAt)) recordLastSeen([userId], lastSeenAt);
    });

    try {
      // User/session rooms FIRST: a membership change committed while we load memberships
      // then still reaches this socket through `io.in(user:<id>).socketsJoin(...)`.
      await socket.join([rooms.user(userId), rooms.session(sessionId)]);
      const joined = await visibleChatIds(userId);
      if (joined.length) {
        await socket.join(joined.map(rooms.chat));
        // A leave/removal/hide committed after that snapshot but before the join flushed its
        // `socketsLeave` while this socket was not in the room yet: re-read (a new snapshot)
        // and leave what is no longer visible. A leave committing after the re-read flushes
        // after the join, so it reaches this socket itself.
        const current = new Set(await visibleChatIds(userId));
        for (const chatId of joined)
          if (!current.has(chatId)) await socket.leave(rooms.chat(chatId));
      }
      // Spaces: one room each (+ this process's registry state). Same double read: a leave
      // published before this socket was in the room is caught by the re-read.
      const spaceIds = await memberSpaceIds(userId);
      if (spaceIds.length) {
        await addSocketToSpaces(socket, spaceIds);
        const still = new Set(await memberSpaceIds(userId));
        const gone = spaceIds.filter((id) => !still.has(id));
        if (gone.length) {
          for (const id of gone) await socket.leave(rooms.space(id));
          removeSocketFromSpaces(socket.id, gone);
        }
      }
    } catch (err) {
      logger.error({ err }, 'failed to join rooms');
      socket.disconnect(true);
      return;
    }

    if (socket.disconnected) return;
    counted = true;
    // Fires 'online' (first socket in the cluster) or 'activity' (a fresh socket is active:
    // a user whose other devices were all idle is active again).
    markConnected(userId, socket.id);
    // e.g. advance delivered watermarks (server-driven delivered receipts).
    await runHooks('beforeReady', beforeReadyHooks(), socket);
    if (socket.disconnected) return;
    socket.emit('ready', { userId, sessionId, serverTime: new Date().toISOString() });
    // e.g. re-emit call:incoming for calls still ringing this user.
    await runHooks('afterReady', afterReadyHooks(), socket);
  });

  installSpaceRooms(io);
  setIo(io);
  return io;
}
