/**
 * Real cluster (docs "Cluster"): two Enbox PROCESSES sharing PostgreSQL and Valkey/Redis.
 * Presence, messages, calls, session revocation and the jobs leader must behave as if there
 * were one process, and a process going away must not end the calls it carried.
 *
 * Skipped unless both are set (each run creates and drops its own database):
 *   ENBOX_TEST_PG_URL=postgres://enbox:enbox@127.0.0.1:5442/postgres
 *   ENBOX_TEST_REDIS_URL=redis://127.0.0.1:6390
 */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as ioClient, type Socket as RawSocket } from 'socket.io-client';
import type { Ack, AuthResponse, Call, ChatSummary, Presence } from '@enbox/shared';
import type { TestSocket } from '../helpers.js';

const PG_ADMIN_URL = process.env.ENBOX_TEST_PG_URL;
const REDIS_URL = process.env.ENBOX_TEST_REDIS_URL;
const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(here, '../..');

interface Node {
  port: number;
  url: string;
  proc: ChildProcess;
  log: string[];
}

function withDb(url: string, db: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

async function waitFor(fn: () => Promise<boolean> | boolean, ms: number, what: string) {
  const end = Date.now() + ms;
  for (;;) {
    try {
      if (await fn()) return;
    } catch {
      // not yet
    }
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe.skipIf(!PG_ADMIN_URL || !REDIS_URL)('cluster: two processes', () => {
  const dbName = `enbox_cluster_${Date.now().toString(36)}`;
  let databaseUrl = '';
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enbox-cluster-'));
  const nodes: Node[] = [];
  const sockets: TestSocket[] = [];
  let admin: pg.Client;

  function startNode(port: number): Node {
    const proc = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
      cwd: serverDir,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        HOST: '127.0.0.1',
        PORT: String(port),
        DATABASE_URL: databaseUrl,
        REDIS_URL,
        DATA_DIR: dataDir,
        RATE_LIMIT: 'off',
        LOG_LEVEL: 'warn',
        CORS_ORIGINS: '*',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const node: Node = { port, url: `http://127.0.0.1:${port}`, proc, log: [] };
    proc.stdout?.on('data', (d: Buffer) => node.log.push(d.toString()));
    proc.stderr?.on('data', (d: Buffer) => node.log.push(d.toString()));
    nodes.push(node);
    return node;
  }

  async function healthy(node: Node) {
    await waitFor(
      async () => (await fetch(`${node.url}/api/health`)).ok,
      60_000,
      `node ${node.port} health (log: ${node.log.join('').slice(-2000)})`,
    );
  }

  async function stopNode(node: Node) {
    if (node.proc.exitCode !== null) return;
    const exited = new Promise((r) => node.proc.once('exit', r));
    // Windows has no SIGTERM delivery to a Node child: ask it to stop through stdin-less kill.
    node.proc.kill('SIGTERM');
    await Promise.race([exited, new Promise((r) => setTimeout(r, 10_000))]);
    if (node.proc.exitCode === null) node.proc.kill('SIGKILL');
  }

  async function api<T>(node: Node, method: string, p: string, token?: string, body?: unknown) {
    const res = await fetch(`${node.url}${p}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
  }

  async function register(node: Node, name: string): Promise<AuthResponse> {
    const res = await api<AuthResponse>(node, 'POST', '/api/auth/register', undefined, {
      username: `${name}${Math.random().toString(36).slice(2, 8)}`,
      displayName: name,
      password: 'password123',
    });
    expect(res.status).toBeLessThan(300);
    return res.body;
  }

  async function connect(node: Node, token: string): Promise<TestSocket> {
    const socket: TestSocket = ioClient(node.url, {
      auth: { token },
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('ready', () => resolve());
      socket.once('connect_error', reject);
    });
    return socket;
  }

  function ack<T>(socket: TestSocket, event: string, payload: unknown): Promise<Ack<T>> {
    return (socket as unknown as RawSocket).timeout(10_000).emitWithAck(event, payload) as Promise<
      Ack<T>
    >;
  }

  function next<T>(socket: TestSocket, event: string, filter: (p: T) => boolean = () => true) {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), 15_000);
      const on = (p: T) => {
        if (!filter(p)) return;
        clearTimeout(timer);
        (socket as unknown as RawSocket).off(event, on);
        resolve(p);
      };
      (socket as unknown as RawSocket).on(event, on);
    });
  }

  let A: Node;
  let B: Node;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: PG_ADMIN_URL });
    await admin.connect();
    await admin.query(`create database ${dbName}`);
    databaseUrl = withDb(PG_ADMIN_URL!, dbName);
    // Both boot together: the migration lock makes one migrate and the other wait.
    A = startNode(47_101);
    B = startNode(47_102);
    await Promise.all([healthy(A), healthy(B)]);
  }, 120_000);

  afterAll(async () => {
    for (const s of sockets) s.disconnect();
    await Promise.all(nodes.map(stopNode));
    if (admin) {
      await admin.query(`drop database if exists ${dbName} with (force)`).catch(() => {});
      await admin.end();
    }
  }, 60_000);

  it('migrated once and elected exactly one jobs leader', async () => {
    const c = new pg.Client({ connectionString: databaseUrl });
    await c.connect();
    try {
      await waitFor(
        async () => {
          const r = await c.query(
            `select count(*)::int as n from pg_locks where locktype = 'advisory' and classid = $1 and objid = 2 and granted`,
            [0x656e62],
          );
          return r.rows[0].n === 1;
        },
        10_000,
        'one leader lock',
      );
      const nodesRows = await c.query('select id from cluster_nodes');
      expect(nodesRows.rowCount).toBe(2);
    } finally {
      await c.end();
    }
  });

  it('presence and messages cross processes', async () => {
    const alice = await register(A, 'alice');
    const bob = await register(B, 'bob');
    const sb = await connect(B, bob.token);
    // Bob (on B) watches Alice, who is offline.
    const first = await ack<Presence[]>(sb, 'presence:subscribe', { userIds: [alice.user.id] });
    expect(first.ok && first.data[0]?.online).toBe(false);
    const online = next<Presence>(sb, 'presence:update', (p) => p.userId === alice.user.id);
    const sa = await connect(A, alice.token);
    expect((await online).online).toBe(true);

    // A message sent through A reaches Bob's socket on B.
    const chat = await api<ChatSummary>(A, 'POST', '/api/chats/direct', alice.token, {
      userId: bob.user.id,
    });
    expect(chat.status).toBeLessThan(300);
    const got = next<{ message: { text: string | null } }>(sb, 'message:new');
    const sent = await api(A, 'POST', `/api/chats/${chat.body.id}/messages`, alice.token, {
      clientId: 'c1',
      type: 'text',
      text: 'hello across nodes',
    });
    expect(sent.status).toBeLessThan(300);
    expect((await got).message.text).toBe('hello across nodes');

    // Alice's last socket (on A) closes: Bob on B sees her offline with a last seen.
    const offline = next<Presence>(sb, 'presence:update', (p) => p.userId === alice.user.id);
    sa.disconnect();
    const p = await offline;
    expect(p.online).toBe(false);
    expect(p.lastSeenAt).not.toBeNull();
  });

  it('a session revoked on one process stops working on the other at once', async () => {
    const carol = await register(A, 'carol');
    // Warm B's token cache, then revoke through A.
    expect((await api(B, 'GET', '/api/me', carol.token)).status).toBe(200);
    const sessions = await api<{ id: string; current: boolean }[]>(
      A,
      'GET',
      '/api/auth/sessions',
      carol.token,
    );
    const current = sessions.body.find((s) => s.current)!;
    // A second device revokes the first.
    const login = await api<AuthResponse>(A, 'POST', '/api/auth/login', undefined, {
      identifier: carol.user.username,
      password: 'password123',
    });
    expect(
      (await api(A, 'DELETE', `/api/auth/sessions/${current.id}`, login.body.token)).status,
    ).toBeLessThan(300);
    await waitFor(
      async () => (await api(B, 'GET', '/api/me', carol.token)).status === 401,
      2_000,
      'revoked on B',
    );
  });

  it('Spaces: channel messages cross processes through the virtual rooms; private channels stay private until a role grants access', async () => {
    const owner = await register(A, 'sowner');
    const member = await register(B, 'smember');
    const so = await connect(A, owner.token);
    const sm = await connect(B, member.token);
    const created = await api<{ space: { id: string }; channels: { id: string; name: string }[] }>(
      A,
      'POST',
      '/api/spaces',
      owner.token,
      { name: 'Cluster Space' },
    );
    expect(created.status).toBe(201);
    const spaceId = created.body.space.id;
    const general = created.body.channels.find((c) => c.name === 'general')!.id;
    const inv = await api<{ code: string }>(
      A,
      'POST',
      `/api/spaces/${spaceId}/invites`,
      owner.token,
      {},
    );
    const upsert = next(sm, 'space:upsert');
    expect((await api(B, 'POST', `/api/invites/${inv.body.code}/join`, member.token)).status).toBe(
      200,
    );
    await upsert;
    await new Promise((r) => setTimeout(r, 300)); // the member's process registers the Space

    const got = next<{ message: { text: string } }>(
      sm,
      'message:new',
      (p) => p.message.text === 'across processes',
    );
    expect(
      (
        await api(A, 'POST', `/api/chats/${general}/messages`, owner.token, {
          clientId: 'sp1',
          type: 'text',
          text: 'across processes',
        })
      ).status,
    ).toBe(201);
    expect((await got).message.text).toBe('across processes');

    const role = await api<{ id: string }>(A, 'POST', `/api/spaces/${spaceId}/roles`, owner.token, {
      name: 'Inner',
    });
    const secret = await api<{ id: string }>(
      A,
      'POST',
      `/api/spaces/${spaceId}/channels`,
      owner.token,
      {
        type: 'space_text',
        name: 'inner',
        privateRoleIds: [role.body.id],
      },
    );
    await new Promise((r) => setTimeout(r, 300));
    let leaked = false;
    const onLeak = (p: { message: { text: string } }) => {
      if (p.message.text === 'hidden') leaked = true;
    };
    (sm as unknown as RawSocket).on('message:new', onLeak);
    await api(A, 'POST', `/api/chats/${secret.body.id}/messages`, owner.token, {
      clientId: 'sp2',
      type: 'text',
      text: 'hidden',
    });
    await new Promise((r) => setTimeout(r, 500));
    (sm as unknown as RawSocket).off('message:new', onLeak);
    expect(leaked).toBe(false);

    const changed = next(sm, 'space:channels-changed');
    await api(
      A,
      'PUT',
      `/api/spaces/${spaceId}/members/${member.user.id}/roles/${role.body.id}`,
      owner.token,
    );
    await changed;
    await new Promise((r) => setTimeout(r, 300));
    const visible = next<{ message: { text: string } }>(
      sm,
      'message:new',
      (p) => p.message.text === 'now visible',
    );
    await api(A, 'POST', `/api/chats/${secret.body.id}/messages`, owner.token, {
      clientId: 'sp3',
      type: 'text',
      text: 'now visible',
    });
    expect((await visible).message.text).toBe('now visible');
    so.disconnect();
    sm.disconnect();
  }, 60_000);

  it('a call survives the process carrying one side: the client rejoins through the other', async () => {
    const dave = await register(A, 'dave');
    const erin = await register(B, 'erin');
    const sd = await connect(A, dave.token);
    const se = await connect(B, erin.token);
    const chat = await api<ChatSummary>(A, 'POST', '/api/chats/direct', dave.token, {
      userId: erin.user.id,
    });
    const incoming = next<{ call: Call }>(se, 'call:incoming');
    const started = await ack<{ call: Call }>(sd, 'call:start', {
      chatId: chat.body.id,
      type: 'audio',
    });
    expect(started.ok).toBe(true);
    const callId = (await incoming).call.id;
    expect((await ack<{ call: Call }>(se, 'call:accept', { callId })).ok).toBe(true);

    // Signalling between call sockets on different processes.
    const signal = next<{ fromUserId: string }>(se, 'call:signal');
    sd.emit('call:signal', {
      callId,
      toUserId: erin.user.id,
      signal: { type: 'offer', sdp: 'v=0' },
    });
    expect((await signal).fromUserId).toBe(dave.user.id);

    // Process A goes away. A graceful stop (Linux: SIGTERM) removes its node row at once; a
    // crash (Windows has no SIGTERM: the child is killed) is noticed after CLUSTER_NODE_TTL_MS.
    // Either way Dave reconnects through B and rejoins: the reconnect grace starts only once
    // the leader saw A dead, so it cannot run out first.
    await stopNode(A);
    const sd2 = await connect(B, dave.token);
    await waitFor(
      async () => (await ack<{ call: Call }>(sd2, 'call:rejoin', { callId })).ok,
      45_000,
      'rejoin through B',
    );
    const active = await api<Call[]>(B, 'GET', '/api/calls/active', dave.token);
    const call = active.body.find((c) => c.id === callId);
    expect(call?.status).toBe('ongoing');
    expect(call?.participants.map((p) => p.status)).toEqual(['joined', 'joined']);
  }, 90_000);
});
