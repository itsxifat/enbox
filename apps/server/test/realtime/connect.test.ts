/**
 * Socket connect sequence (docs "Rooms and connection"): room membership mirrors active
 * visibility even when a leave races the connect, presence counts only sockets that finished
 * their setup, handshake tokens of any type are handled, and per-socket event limits.
 * Regression tests for P6 / F2 / C3, C2 / R2, R13 and R6.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as ioClient } from 'socket.io-client';
import { rooms, type Message } from '@enbox/shared';
import { config } from '../../src/config.js';
import { resetUserLimits } from '../../src/lib/userLimit.js';
import { isOnline } from '../../src/realtime/presence.js';
import { createSession } from '../../src/services/sessions.js';
import { rawAck, until } from '../calls/helpers.js';
import {
  sleep,
  startTestServer,
  type TestServer,
  type TestSocket,
  type TestUser,
} from '../helpers.js';
import { leaveGroup, memberOf, sendOk } from '../messaging/support.js';
import { createGroup, memberRow, recordEvents, settle } from '../services/fixtures.js';
import { afterNextResult, delayNextResult } from '../support/db-hooks.js';

/** The connect handler's "load my active non-hidden memberships" query for `userId`. */
const membershipsQueryOf = (userId: string) => (text: string, params: unknown[]) =>
  /^select "chat_id" from "chat_members"/.test(text) &&
  text.includes('"hidden"') &&
  params[0] === userId;

describe('socket connect', () => {
  let t: TestServer;

  beforeAll(async () => {
    t = await startTestServer();
  });
  afterAll(() => t.close());

  const mentioning = (log: { event: string; payload: unknown }[], id: string) =>
    log.filter((e) => JSON.stringify(e.payload ?? null).includes(id));

  describe('a leave racing the connect leaves no stale chat room', () => {
    it('removal committed (and flushed) between the membership SELECT and socket.join', async () => {
      const [alice, carol] = [await t.createUser(), await t.createUser()];
      const g = await createGroup(alice, [carol]);
      const hook = afterNextResult(membershipsQueryOf(carol.id), () =>
        leaveGroup(g, carol, alice).then(() => undefined),
      );
      let sc: TestSocket;
      try {
        sc = await t.connect(carol);
      } finally {
        hook.restore();
      }
      expect(hook.fired()).toBe(true);
      expect((await memberOf(g, carol))!.leftAt).not.toBeNull();
      const lc = recordEvents(sc);
      const after = await sendOk(t, alice, g, 'after removal');
      await settle();
      expect(mentioning(lc.log, after.id)).toEqual([]);
      expect(t.io.of('/').adapter.rooms.get(rooms.chat(g))?.has(sc.id!) ?? false).toBe(false);
      sc.disconnect();
    });

    it('removal committed while the membership SELECT response is in flight (real PostgreSQL interleaving)', async () => {
      const [owner, u] = [await t.createUser(), await t.createUser()];
      const g = await createGroup(owner, [u]);
      const d = delayNextResult(membershipsQueryOf(u.id));
      const connecting = t.connect(u);
      await d.hit; // the snapshot (still containing g) has been read
      await t.api(owner).delete(`/api/groups/${g}/members/${u.id}`).expect(204); // committed + flushed
      await settle(100);
      d.release();
      const s = await connecting;
      const rec = recordEvents(s);
      await sendOk(t, owner, g, 'said after U was removed');
      await settle(300);
      expect({
        inRoom: t.io.of('/').adapter.rooms.get(rooms.chat(g))?.has(s.id!) ?? false,
        leaked: rec
          .of('message:new')
          .filter((p: { message: Message }) => p.message.chatId === g)
          .map((p) => p.message.text),
      }).toEqual({ inRoom: false, leaked: [] });
      s.disconnect();
    });

    it('chats that stay visible are joined as usual', async () => {
      const [owner, u] = [await t.createUser(), await t.createUser()];
      const g = await createGroup(owner, [u]);
      const s = await t.connect(u);
      expect(t.io.of('/').adapter.rooms.get(rooms.chat(g))?.has(s.id!)).toBe(true);
      s.disconnect();
    });
  });

  describe('presence counts only sockets that finished their setup', () => {
    it('a device dropping while its connect handler loads memberships does not take the user offline', async () => {
      const [u, peer] = [await t.createUser(), await t.createUser()];
      const g = await createGroup(peer, [u]);
      const phone = await t.connect(u);
      expect(isOnline(u.id)).toBe(true);

      const laptopSession = await createSession({ userId: u.id, deviceName: 'laptop' });
      const d = delayNextResult(membershipsQueryOf(u.id));
      const laptop = ioClient(t.url, {
        auth: { token: laptopSession.token },
        transports: ['websocket'],
        forceNew: true,
        reconnection: false,
      });
      await d.hit;
      if (!laptop.connected) await new Promise((r) => laptop.once('connect', () => r(undefined)));
      const deadId = laptop.id!;
      laptop.disconnect();
      await until(() => !t.io.of('/').sockets.has(deadId), 3000, 'server-side disconnect');
      d.release();
      await settle(300);

      expect(isOnline(u.id)).toBe(true);
      // Still online → a new message is delivered to U.
      const m = await sendOk(t, peer, g, 'are you there?');
      expect(Number((await memberRow(g, u)).lastDeliveredSeq)).toBeGreaterThanOrEqual(m.seq);
      phone.disconnect();
      await until(() => !isOnline(u.id), 3000, 'offline after the last socket');
    });

    it('a socket dropping during slow room joins does not mark a still-connected user offline', async () => {
      const u = await t.createUser();
      const s1 = await t.connect(u);
      const adapter = t.io.of('/').adapter;
      const orig = adapter.addAll.bind(adapter);
      adapter.addAll = ((id: string, set: Set<string>) =>
        new Promise<void>((resolve) =>
          setTimeout(() => resolve(orig(id, set) as void), 150),
        )) as typeof adapter.addAll;
      try {
        const flaky = ioClient(t.url, {
          auth: { token: u.token },
          transports: ['websocket'],
          forceNew: true,
          reconnection: false,
        });
        await new Promise<void>((resolve) => flaky.once('connect', () => resolve()));
        flaky.disconnect();
        await sleep(400);
      } finally {
        adapter.addAll = orig;
      }
      expect(s1.connected).toBe(true);
      expect(isOnline(u.id)).toBe(true);
      s1.disconnect();
    });
  });

  it('a non-string handshake token is rejected as unauthorized (not internal_error)', async () => {
    for (const token of [12345, { nested: true }, ['x']]) {
      const socket = ioClient(t.url, {
        auth: { token },
        transports: ['websocket'],
        forceNew: true,
        reconnection: false,
      });
      const msg = await new Promise<string>((resolve) => {
        socket.once('connect_error', (err) => resolve(err.message));
        socket.once('connect', () => resolve('connected'));
      });
      socket.disconnect();
      expect(msg).toBe('unauthorized');
    }
  });

  it('per-socket limits: a chat:read flood is refused with rate_limited acks (the user stays connected)', async () => {
    const [owner, u]: TestUser[] = [await t.createUser(), await t.createUser()];
    const g = await createGroup(owner, [u]);
    const s = await t.connect(u);
    config.rateLimit = true;
    resetUserLimits();
    try {
      const acks = await Promise.all(
        Array.from({ length: 110 }, () => rawAck(s, 'chat:read', { chatId: g, seq: 1 })),
      );
      const limited = acks.filter((a) => !a.ok && a.error.code === 'rate_limited').length;
      expect(limited).toBe(10);
      expect(s.connected).toBe(true);
    } finally {
      config.rateLimit = false;
      resetUserLimits();
    }
    s.disconnect();
  });
});
