/**
 * Integration-test harness: boots the real Express app + Socket.IO server on a random port
 * against a fresh in-memory PGlite database (one per test file).
 *
 *   const t = await startTestServer();
 *   const alice = await t.createUser({ username: 'alice' });
 *   await t.api(alice).post('/api/chats/direct').send({ userId: bob.id }).expect(200);
 *   const sock = await t.connect(alice);           // resolves after 'ready'
 *   const evt = await waitForEvent(sock, 'message:new');
 *   afterAll(() => t.close());
 */
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import supertest from 'supertest';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@enbox/shared';
import { initConfig } from '../src/config.js';
import { closeDb, db, initDb } from '../src/db/index.js';
import { users } from '../src/db/schema.js';
import { createApp } from '../src/app.js';
import { createSocketServer } from '../src/realtime/io.js';
import { setIo } from '../src/realtime/emit.js';
import { resetPresence } from '../src/realtime/presence.js';
import { hashPassword } from '../src/lib/crypto.js';
import { createSession } from '../src/services/sessions.js';
import '../src/jobs/register.js';

export type TestSocket = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

export interface TestUser {
  id: string;
  username: string;
  displayName: string;
  token: string;
  sessionId: string;
  password: string;
}

let counter = 0;
// Precomputed once: hashing is deliberately slow.
let defaultHash: Promise<string> | undefined;

export async function startTestServer() {
  const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enbox-test-uploads-'));
  initConfig({ env: 'test', uploadDir, rateLimit: false, publicUrl: 'http://localhost:5173' });
  await initDb({ pgliteDir: 'memory' });
  const app = createApp();
  const server = http.createServer(app);
  const io = await createSocketServer(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}`;
  const sockets: TestSocket[] = [];

  const t = {
    url,
    app,
    io,
    db,
    uploadDir,

    /** Authenticated supertest agent helpers for a user (or anonymous when omitted). */
    api(user?: Pick<TestUser, 'token'>) {
      const agent = supertest(app);
      const auth = <T extends supertest.Test>(req: T) =>
        user ? req.set('Authorization', `Bearer ${user.token}`) : req;
      return {
        get: (p: string) => auth(agent.get(p)),
        post: (p: string) => auth(agent.post(p)),
        put: (p: string) => auth(agent.put(p)),
        patch: (p: string) => auth(agent.patch(p)),
        delete: (p: string) => auth(agent.delete(p)),
      };
    },

    /** Insert a user directly (bypassing the register endpoint) and create a session. */
    async createUser(
      overrides: {
        username?: string;
        displayName?: string;
        phone?: string;
        password?: string;
      } = {},
    ): Promise<TestUser> {
      counter += 1;
      const username =
        overrides.username ?? `user${counter}_${Math.random().toString(36).slice(2, 7)}`;
      const password = overrides.password ?? 'password123';
      const passwordHash = overrides.password
        ? await hashPassword(password)
        : await (defaultHash ??= hashPassword('password123'));
      const [row] = await db
        .insert(users)
        .values({
          username,
          displayName: overrides.displayName ?? username,
          phone: overrides.phone ?? null,
          passwordHash,
          about: 'Hey there! I am using Enbox.',
        })
        .returning();
      const { token, session } = await createSession({ userId: row!.id, deviceName: 'test' });
      return {
        id: row!.id,
        username,
        displayName: row!.displayName,
        token,
        sessionId: session.id,
        password,
      };
    },

    /** Connect an authenticated socket; resolves once the server emitted `ready`. */
    async connect(user: Pick<TestUser, 'token'>): Promise<TestSocket> {
      const socket: TestSocket = ioClient(url, {
        auth: { token: user.token },
        transports: ['websocket'],
        forceNew: true,
        reconnection: false,
      });
      sockets.push(socket);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('socket ready timeout')), 5000);
        socket.once('ready', () => {
          clearTimeout(timer);
          resolve();
        });
        socket.once('connect_error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
      });
      return socket;
    },

    async close() {
      for (const s of sockets) s.disconnect();
      io.close();
      setIo(undefined);
      await new Promise<void>((resolve) => server.close(() => resolve()));
      resetPresence();
      await closeDb();
      fs.rmSync(uploadDir, { recursive: true, force: true });
    },
  };
  return t;
}

export type TestServer = Awaited<ReturnType<typeof startTestServer>>;

/** Resolve with the next payload of `event` (rejects after `timeoutMs`). */
export function waitForEvent<E extends keyof ServerToClientEvents>(
  socket: TestSocket,
  event: E,
  opts: {
    timeoutMs?: number;
    filter?: (payload: Parameters<ServerToClientEvents[E]>[0]) => boolean;
  } = {},
): Promise<Parameters<ServerToClientEvents[E]>[0]> {
  const { timeoutMs = 3000, filter } = opts;
  return new Promise((resolve, reject) => {
    const handler = (payload: Parameters<ServerToClientEvents[E]>[0]) => {
      if (filter && !filter(payload)) return;
      clearTimeout(timer);
      (socket as unknown as ClientSocket).off(event as string, handler as never);
      resolve(payload);
    };
    const timer = setTimeout(() => {
      (socket as unknown as ClientSocket).off(event as string, handler as never);
      reject(new Error(`timed out waiting for ${String(event)}`));
    }, timeoutMs);
    (socket as unknown as ClientSocket).on(event as string, handler as never);
  });
}

/** Assert that `event` is NOT received within `ms`. */
export async function expectNoEvent(
  socket: TestSocket,
  event: keyof ServerToClientEvents,
  ms = 300,
): Promise<void> {
  let got: unknown;
  const handler = (p: unknown) => (got = p);
  (socket as unknown as ClientSocket).on(event as string, handler);
  await new Promise((r) => setTimeout(r, ms));
  (socket as unknown as ClientSocket).off(event as string, handler);
  if (got !== undefined) throw new Error(`unexpected ${String(event)}: ${JSON.stringify(got)}`);
}

/** Emit with ack and unwrap `{ ok, data }` (throws on `{ ok: false }`). */
export function emitAck<T = unknown>(
  socket: TestSocket,
  event: keyof ClientToServerEvents,
  payload: unknown,
): Promise<T> {
  return new Promise((resolve, reject) => {
    (socket as unknown as ClientSocket)
      .timeout(5000)
      .emit(
        event as string,
        payload,
        (err: unknown, res: { ok: boolean; data?: T; error?: { message: string } }) => {
          if (err) return reject(err);
          if (!res.ok)
            return reject(
              Object.assign(new Error(res.error?.message ?? 'ack error'), { ack: res }),
            );
          resolve(res.data as T);
        },
      );
  });
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
