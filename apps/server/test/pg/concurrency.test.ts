/**
 * Concurrency regressions that only real PostgreSQL can interleave (PGlite runs one
 * transaction at a time): review findings C4, C5, C6, C7, C8, C9 and CALLS-3, the
 * `status:viewed` firstView race, plus a PostgreSQL check of the media-counts SQL.
 *
 * Skipped unless ENBOX_TEST_PG_URL points at a database whose role may CREATE DATABASE, e.g.
 *   ENBOX_TEST_PG_URL=postgres://enbox:enbox@127.0.0.1:5432/postgres npm test -w @enbox/server
 * Each run creates and drops its own database. A concurrent transaction is played by a raw
 * connection (`raw()`) or timed by holding a server query just before it is sent
 * (`patchPgQuery`) — never by changing product code.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { eq } from 'drizzle-orm';
import { io as ioClient } from 'socket.io-client';
import type { Message } from '@enbox/shared';
import { db, initDb } from '../../src/db/index.js';
import { chatMembers, users } from '../../src/db/schema.js';
import { resetCallState } from '../../src/modules/calls/state.js';
import { startTestServer, type TestServer, type TestSocket, type TestUser } from '../helpers.js';
import { ackCall, partOf, until } from '../calls/helpers.js';
import { mkStatus, sendOk } from '../messaging/support.js';
import { createDirect, createGroup, memberRow, recordEvents, settle } from '../services/fixtures.js';

const PG_ADMIN_URL = process.env.ENBOX_TEST_PG_URL;

type AnyFn = (...args: unknown[]) => Promise<unknown>;

/**
 * Hook every promise-style query of node-postgres clients (transaction clients included).
 * When `hook` returns a promise, the query waits for it before being sent.
 */
function patchPgQuery(hook: (client: object, text: string, values: unknown[]) => Promise<void> | void): () => void {
  const proto = pg.Client.prototype as unknown as { query: AnyFn };
  const original = proto.query;
  proto.query = function (this: object, ...args: unknown[]) {
    if (typeof args[args.length - 1] === 'function') return original.apply(this, args);
    const a0 = args[0] as string | { text?: string; values?: unknown[] };
    const text = typeof a0 === 'string' ? a0 : (a0?.text ?? '');
    const values = (args[1] as unknown[] | undefined) ?? (typeof a0 === 'object' ? a0?.values : undefined) ?? [];
    const wait = hook(this, text, values);
    if (!wait) return original.apply(this, args);
    return wait.then(() => original.apply(this, args));
  } as AnyFn;
  return () => {
    proto.query = original;
  };
}

function gate() {
  let open!: () => void;
  const opened = new Promise<void>((r) => (open = r));
  let hit!: () => void;
  const reached = new Promise<void>((r) => (hit = r));
  return { opened, open, reached, hit };
}

describe.skipIf(!PG_ADMIN_URL)('concurrency on PostgreSQL', () => {
  let t: TestServer;
  let dbName: string;
  let dbUrl: string;
  let probe: pg.Client;
  const raws: pg.Client[] = [];

  beforeAll(async () => {
    dbName = `enbox_test_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const admin = new pg.Client({ connectionString: PG_ADMIN_URL });
    await admin.connect();
    await admin.query(`create database ${dbName}`);
    await admin.end();
    const url = new URL(PG_ADMIN_URL!);
    url.pathname = `/${dbName}`;
    dbUrl = url.toString();
    t = await startTestServer();
    await initDb({ databaseUrl: dbUrl }); // every module reads the live `db` binding
    probe = new pg.Client({ connectionString: dbUrl });
    await probe.connect();
  }, 60_000);

  afterAll(async () => {
    for (const r of raws) await r.end().catch(() => undefined);
    await probe?.end().catch(() => undefined);
    resetCallState();
    await t?.close();
    const admin = new pg.Client({ connectionString: PG_ADMIN_URL });
    await admin.connect();
    await admin.query(`drop database if exists ${dbName} with (force)`);
    await admin.end();
  }, 60_000);

  async function raw(): Promise<pg.Client> {
    const c = new pg.Client({ connectionString: dbUrl });
    await c.connect();
    raws.push(c);
    return c;
  }

  /** Wait until `n` backends wait on a lock while running a query matching `pattern` (ILIKE). */
  async function lockWaiters(pattern: string, n = 1): Promise<void> {
    await until(
      async () => {
        const { rows } = await probe.query<{ n: number }>(
          `select count(*)::int as n from pg_stat_activity
           where datname = current_database() and wait_event_type = 'Lock' and query ilike $1`,
          [pattern],
        );
        return rows[0]!.n >= n;
      },
      5000,
      `${n} lock waiter(s) on ${pattern}`,
    );
  }

  const mkUsers = async (n: number): Promise<TestUser[]> => {
    const out: TestUser[] = [];
    for (let i = 0; i < n; i++) out.push(await t.createUser());
    return out;
  };

  async function community(owner: TestUser, members: TestUser[]) {
    const c = (await t.api(owner).post('/api/communities').send({ name: 'Comm' }).expect(201)).body as { id: string; announcementChatId: string };
    if (members.length) await t.api(owner).post(`/api/communities/${c.id}/members`).send({ userIds: members.map((m) => m.id) }).expect(200);
    return c;
  }

  const isDeleted = async (u: TestUser) => !!(await db.select({ d: users.deletedAt }).from(users).where(eq(users.id, u.id)))[0]?.d;

  // -------------------------------------------------------------------------
  // C4 / R10: the connect-time delivered advance vs a multi-chat forward
  // -------------------------------------------------------------------------
  it('C4: the connect-time delivered advance waits for a forward holding the chats (chat-first lock order), no deadlock', async () => {
    const [s, v] = (await mkUsers(2)) as [TestUser, TestUser];
    let gA = await createGroup(s, [v]);
    let gB = await createGroup(s, [v]);
    if (gA > gB) [gA, gB] = [gB, gA];
    const gC = await createGroup(s, [v]); // not a forward target
    const mA = await sendOk(t, s, gA, 'a'); // V is offline: backlog everywhere
    await sendOk(t, s, gB, 'b');
    const mC = await sendOk(t, s, gC, 'c');

    const connectLocks = gate();
    const fwdBumpA = gate();
    const unpatch = patchPgQuery((_client, text, values) => {
      const vals = JSON.stringify(values);
      if (text.includes('for share of c') && vals.includes(v.id)) {
        connectLocks.hit();
        return connectLocks.opened;
      }
      // The forward's delivered bump of V in gA (after it bumped V in gB).
      if (text.includes('update chat_members c set') && vals.includes(gA) && vals.includes(v.id) && !vals.includes(s.id)) {
        fwdBumpA.hit();
        return fwdBumpA.opened;
      }
    });
    try {
      const sock = ioClient(t.url, { auth: { token: v.token }, transports: ['websocket'], forceNew: true, reconnection: false });
      const ready = new Promise<void>((r) => sock.once('ready', () => r()));
      await connectLocks.reached; // V is online (markConnected ran); its delivered advance is next
      const fwd = t
        .api(s)
        .post('/api/messages/forward')
        .send({ messageIds: [mA.id], chatIds: [gB, gA], clientId: 'fwd-c4' })
        .then((res) => res.status);
      await fwdBumpA.reached; // the forward holds gA+gB, bumped cm(gB, V), is about to bump cm(gA, V)
      connectLocks.open();
      await lockWaiters('%for share of c%'); // the connect waits for the chats, holding no member row
      fwdBumpA.open();
      expect(await fwd).toBe(201);
      await ready;
      await settle(200);
      expect(Number((await memberRow(gC, v)).lastDeliveredSeq)).toBeGreaterThanOrEqual(mC.seq);
      expect(Number((await memberRow(gA, v)).lastDeliveredSeq)).toBeGreaterThan(mA.seq);
      sock.disconnect();
    } finally {
      unpatch();
      connectLocks.open();
      fwdBumpA.open();
    }
  });

  // -------------------------------------------------------------------------
  // C7: a message delivered to a socket that just connected is marked delivered
  // -------------------------------------------------------------------------
  it('C7: a send committing while its recipient connects is marked delivered', async () => {
    const [s, u] = (await mkUsers(2)) as [TestUser, TestUser];
    const c = await createGroup(s, [u]);
    const sendTx = new WeakSet<object>();
    const commit = gate();
    let armed = true;
    const unpatch = patchPgQuery((client, text, values) => {
      if (/^update "chats" set "last_seq"/.test(text) && JSON.stringify(values).includes(c)) sendTx.add(client);
      if (armed && text === 'commit' && sendTx.has(client)) {
        armed = false;
        commit.hit();
        return commit.opened;
      }
    });
    try {
      const sent = t
        .api(s)
        .post(`/api/chats/${c}/messages`)
        .send({ type: 'text', text: 'hello', clientId: 'c7-1' })
        .then((res) => res.body as Message);
      await commit.reached; // the send evaluated isOnline(U) = false and is committing
      const su = ioClient(t.url, { auth: { token: u.token }, transports: ['websocket'], forceNew: true, reconnection: false }) as TestSocket;
      const rec = recordEvents(su);
      const ready = new Promise<void>((r) => su.once('ready', () => r()));
      await lockWaiters('%for share of c%'); // U's delivered advance waits for the send's chat lock
      commit.open();
      const msg = await sent;
      await ready;
      await until(() => rec.of('message:new').some((p) => p.message.id === msg.id), 3000, 'message:new on U');
      expect(Number((await memberRow(c, u)).lastDeliveredSeq)).toBeGreaterThanOrEqual(msg.seq);
      su.disconnect();
    } finally {
      unpatch();
      commit.open();
    }
  });

  // -------------------------------------------------------------------------
  // C5: users.deleted_at check-then-act
  // -------------------------------------------------------------------------
  it('C5a: a deletion that waited for a chat lock while the user was added elsewhere answers 409; the retry leaves that group too', async () => {
    const [x, u, y] = (await mkUsers(3)) as [TestUser, TestUser, TestUser];
    const g0 = await createGroup(y, [u]);
    const g = await createGroup(x, []);
    const r = await raw();
    await r.query('begin');
    await r.query('select id from chats where id = $1 for update', [g0]); // e.g. a send in g0
    const del = t
      .api(u)
      .delete('/api/me')
      .send({ password: u.password })
      .then((res) => res.status);
    await lockWaiters('%from "chats"%for update%'); // memberships already read, waiting for g0
    const add = await t.api(x).post(`/api/groups/${g}/members`).send({ userIds: [u.id] });
    expect(add.status).toBe(200);
    await r.query('commit');
    expect(await del).toBe(409);
    expect(await isDeleted(u)).toBe(false);
    await t.api(u).delete('/api/me').send({ password: u.password }).expect(204);
    expect((await memberRow(g, u)).leftAt).not.toBeNull();
  });

  it('C5b: an add that read the user before their deletion committed does not activate the deleted account', async () => {
    const [x, u] = (await mkUsers(2)) as [TestUser, TestUser];
    const g = await createGroup(x, []);
    // X's add is held right before it re-checks (FOR SHARE) the users it activates, while
    // U's deletion commits.
    const held = gate();
    const unpatch = patchPgQuery((_client, text, values) => {
      if (/from "users"/.test(text) && /for share/.test(text) && JSON.stringify(values).includes(u.id)) {
        held.hit();
        return held.opened;
      }
    });
    try {
      const add = t
        .api(x)
        .post(`/api/groups/${g}/members`)
        .send({ userIds: [u.id] })
        .then((res) => res);
      await held.reached;
      const delStatus = (await t.api(u).delete('/api/me').send({ password: u.password })).status;
      held.open();
      const res = await add;
      expect({ delStatus, addStatus: res.status, added: res.body.added, failed: res.body.failed }).toEqual({
        delStatus: 204,
        addStatus: 200,
        added: [],
        failed: [{ userId: u.id, reason: 'not_found' }],
      });
      const rows = await db.select().from(chatMembers).where(eq(chatMembers.userId, u.id));
      expect(rows.filter((r) => r.chatId === g)).toEqual([]);
    } finally {
      unpatch();
      held.open();
    }
  });

  it('C5b: a deletion arriving after the add re-checked the user waits for it, answers 409, and the retry leaves the group', async () => {
    const [x, u] = (await mkUsers(2)) as [TestUser, TestUser];
    const g = await createGroup(x, []);
    // X's add holds its FOR SHARE on U and is paused at its system-message insert.
    const held = gate();
    const unpatch = patchPgQuery((_client, text, values) => {
      if (/^insert into "messages"/.test(text) && JSON.stringify(values).includes(g)) {
        held.hit();
        return held.opened;
      }
    });
    try {
      const add = t
        .api(x)
        .post(`/api/groups/${g}/members`)
        .send({ userIds: [u.id] })
        .then((res) => res.status);
      await held.reached;
      const del = t
        .api(u)
        .delete('/api/me')
        .send({ password: u.password })
        .then((res) => res.status);
      await lockWaiters('%from "users"%for no key update%'); // the deletion waits for the add
      held.open();
      expect(await add).toBe(200);
      expect(await del).toBe(409);
      expect(await isDeleted(u)).toBe(false);
      await t.api(u).delete('/api/me').send({ password: u.password }).expect(204);
      expect((await memberRow(g, u)).leftAt).not.toBeNull();
    } finally {
      unpatch();
      held.open();
    }
  });

  // -------------------------------------------------------------------------
  // C6: lock-order inversions
  // -------------------------------------------------------------------------
  it('C6a: a group add racing a community link and a community member removal does not deadlock', async () => {
    const [o, v, w] = (await mkUsers(3)) as [TestUser, TestUser, TestUser];
    const c = await community(o, [v]);
    const g = await createGroup(o, []);
    const r = await raw();
    // A link of g in flight: community row, chats (sorted), community_id.
    await r.query('begin');
    await r.query('select id from communities where id = $1 for update', [c.id]);
    await r.query('select id from chats where id = any($1::uuid[]) order by id for update', [[c.announcementChatId, g]]);
    await r.query('update chats set community_id = $1 where id = $2', [c.id, g]);
    const add = t
      .api(o)
      .post(`/api/groups/${g}/members`)
      .send({ userIds: [w.id] })
      .then((res) => res.status);
    const remove = t
      .api(o)
      .delete(`/api/communities/${c.id}/members/${v.id}`)
      .then((res) => res.status);
    await lockWaiters('%for update%', 2); // add waits for g, removal waits for the community row
    await r.query('commit');
    expect({ add: await add, remove: await remove }).toEqual({ add: 200, remove: 204 });
  });

  it('C6b: account deletion racing a forward into a linked group it never joined does not deadlock', async () => {
    const [o, u, s, z] = (await mkUsers(4)) as [TestUser, TestUser, TestUser, TestUser];
    const c = await community(o, [u, s]);
    const g = ((await t.api(o).post(`/api/communities/${c.id}/groups`).send({ name: 'Linked', memberIds: [s.id] }).expect(201)).body as { chat: { id: string } }).chat.id;
    // d: a chat of U (and S) that sorts after g, so the forward locks g first and then d.
    let d = await createGroup(s, [u]);
    while (d < g) d = await createGroup(s, [u]);
    const m = await sendOk(t, s, g, 'forward me');
    await t.api(u).post('/api/contacts').send({ userId: z.id }).expect(201);

    const r = await raw();
    await r.query('begin');
    await r.query('select 1 from contacts where owner_id = $1 for update', [u.id]); // stalls the deletion after its locks
    const del = t
      .api(u)
      .delete('/api/me')
      .send({ password: u.password })
      .then((res) => res.status);
    await lockWaiters('%delete from "contacts"%');
    const fwd = t
      .api(s)
      .post('/api/messages/forward')
      .send({ messageIds: [m.id], chatIds: [g, d], clientId: 'fwd-c6b' })
      .then((res) => res.status);
    await lockWaiters('%from "chats"%for update%'); // the forward waits for g (held by the deletion)
    await r.query('commit');
    expect({ del: await del, fwd: await fwd }).toEqual({ del: 204, fwd: 201 });
  });

  // -------------------------------------------------------------------------
  // C8: status view / reaction racing a delete
  // -------------------------------------------------------------------------
  it('C8: viewing or reacting to a status deleted concurrently answers 404, not 500', async () => {
    const [author, viewer] = (await mkUsers(2)) as [TestUser, TestUser];
    const out: Record<string, number> = {};
    for (const action of ['view', 'reaction'] as const) {
      const st = await mkStatus(author.id, [viewer.id]);
      const r = await raw();
      await r.query('begin');
      await r.query('delete from statuses where id = $1', [st.id]); // the author's delete / the expiry purge, uncommitted
      const req = action === 'view' ? t.api(viewer).post(`/api/status/${st.id}/view`) : t.api(viewer).put(`/api/status/${st.id}/reaction`).send({ emoji: '👍' });
      const status = req.then((res) => res.status);
      await lockWaiters('%from "statuses"%for key share%');
      await r.query('commit');
      out[action] = await status;
    }
    expect(out).toEqual({ view: 404, reaction: 404 });
  });

  // -------------------------------------------------------------------------
  // status:viewed firstView: a reaction racing another device's first view
  // -------------------------------------------------------------------------
  it('STATUS-VIEWED: a reaction racing a first view from another device reports firstView exactly once', async () => {
    const [author, viewer] = (await mkUsers(2)) as [TestUser, TestUser];
    const sa = await t.connect(author);
    const rec = recordEvents(sa);
    const out: Record<string, unknown> = {};
    for (const outcome of ['commit', 'rollback'] as const) {
      const st = await mkStatus(author.id, [viewer.id]);
      const r = await raw();
      await r.query('begin');
      // The other device's first view, in flight (uncommitted).
      await r.query('insert into status_views (status_id, viewer_id, viewed_at) values ($1, $2, now())', [st.id, viewer.id]);
      const req = t.api(viewer).put(`/api/status/${st.id}/reaction`).send({ emoji: '👍' }).then((res) => res.status);
      await lockWaiters('%insert into "status_views"%');
      await r.query(outcome);
      expect(await req).toBe(204);
      await until(() => rec.of('status:viewed').some((e) => e.statusId === st.id), 3000, 'status:viewed');
      const evt = rec.of('status:viewed').find((e) => e.statusId === st.id)!;
      out[outcome] = { firstView: evt.firstView, viewCount: evt.viewCount, reaction: evt.viewer.reaction };
    }
    // Committed: the reaction only updated that view. Rolled back: the reaction recorded it.
    expect(out).toEqual({
      commit: { firstView: false, viewCount: 1, reaction: '👍' },
      rollback: { firstView: true, viewCount: 1, reaction: '👍' },
    });
    sa.disconnect();
  });

  it('PG-SQL: media counts (count … filter) match the gallery lists on PostgreSQL', async () => {
    const [a, b] = (await mkUsers(2)) as [TestUser, TestUser];
    const g = await createGroup(a, [b]);
    await sendOk(t, a, g, 'see https://example.com');
    await sendOk(t, a, g, 'www.enbox.dev');
    await sendOk(t, b, g, 'plain');
    const counts = (await t.api(b).get(`/api/chats/${g}/media/counts`).expect(200)).body;
    expect(counts).toEqual({ media: 0, docs: 0, links: 2, voice: 0 });
    const links = (await t.api(b).get(`/api/chats/${g}/media?kind=links`).expect(200)).body as Message[];
    expect(links).toHaveLength(counts.links);
  });

  // -------------------------------------------------------------------------
  // C9: concurrent duplicate POST /contacts
  // -------------------------------------------------------------------------
  it('C9: two concurrent POST /contacts for the same user answer 201 and 200 (idempotent), not 409', async () => {
    const [a, b] = (await mkUsers(2)) as [TestUser, TestUser];
    const r = await raw();
    await r.query('begin');
    await r.query('insert into contacts (owner_id, contact_id) values ($1, $2)', [a.id, b.id]);
    const req = () =>
      t
        .api(a)
        .post('/api/contacts')
        .send({ userId: b.id, name: 'Bee' })
        .then((res) => res.status);
    const p1 = req();
    const p2 = req();
    await lockWaiters('%insert into "contacts"%', 2);
    await r.query('rollback');
    expect((await Promise.all([p1, p2])).sort()).toEqual([200, 201]);
  });

  // -------------------------------------------------------------------------
  // CALLS-3: PUT /blocks racing an in-flight call:start
  // -------------------------------------------------------------------------
  it('CALLS-3: a callee who blocks the caller while call:start is in flight is not left ringing', async () => {
    const [a, b] = (await mkUsers(2)) as [TestUser, TestUser];
    const chatId = await createDirect(a, b);
    const sa = await t.connect(a);
    const sb = await t.connect(b);
    const rb = recordEvents(sb);

    // A's call:start checked blocks (none yet) and is about to insert the call.
    const held = gate();
    const unpatch = patchPgQuery((_client, text) => {
      if (/^insert into "calls"/.test(text)) {
        held.hit();
        return held.opened;
      }
    });
    let started: Promise<Awaited<ReturnType<typeof ackCall>>>;
    let blockStatus: Promise<number>;
    try {
      started = ackCall(sa, 'call:start', { chatId, type: 'audio' });
      await held.reached;
      blockStatus = t
        .api(b)
        .put(`/api/blocks/${a.id}`)
        .then((res) => res.status);
      await lockWaiters('%from "chats"%for update%'); // the block waits for the call to commit
    } finally {
      unpatch();
      held.open();
    }
    const call = await started!;
    expect(await blockStatus!).toBe(204);
    await settle(500); // the post-commit forced leave (domain user.blocked) ran

    const mine = await partOf(call.id, b.id);
    const ringStopped = rb.of('call:ring-stop').some((p) => p.callId === call.id);
    expect({
      bRungByBlockedUser: rb.of('call:incoming').some((p) => p.call.id === call.id) && !ringStopped,
      bStillRinging: (mine.status === 'invited' || mine.status === 'ringing') && !mine.hiddenAt,
    }).toEqual({ bRungByBlockedUser: false, bStillRinging: false });
    sa.disconnect();
    sb.disconnect();
  });
});
