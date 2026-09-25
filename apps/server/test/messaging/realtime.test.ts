import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ChatSummary } from '@enbox/shared';
import { config } from '../../src/config.js';
import { resetUserLimits } from '../../src/lib/userLimit.js';
import { domainEvents, type DomainEventMap } from '../../src/services/events.js';
import { emitAck, startTestServer, type TestServer, type TestSocket, type TestUser } from '../helpers.js';
import { block, createChannel, createGroup, goOffline, recordEvents, setSettings, settle } from '../services/fixtures.js';
import { activeDirect, follow, leaveGroup, openDirect, sendOk, summaryOf } from './support.js';

describe('chats realtime (typing, chat:read, ticks)', () => {
  let t: TestServer;
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;

  beforeAll(async () => {
    t = await startTestServer();
    alice = await t.createUser({ displayName: 'Alice' });
    bob = await t.createUser({ displayName: 'Bob' });
    carol = await t.createUser({ displayName: 'Carol' });
  });
  afterAll(() => t.close());

  const typing = (s: TestSocket, chatId: string, state: 'typing' | 'recording' | 'idle' = 'typing') => s.emit('chat:typing', { chatId, state });
  const disconnectAll = (...sockets: TestSocket[]) => sockets.forEach((s) => s.disconnect());
  /** The typing relay does a few async permission queries before emitting. */
  const relaySettle = () => settle(400);

  describe('chat:typing', () => {
    it('is relayed to the room except all of the typist’s sockets', async () => {
      const g = await createGroup(alice, [bob, carol]);
      const [a1, a2, b1, c1] = [await t.connect(alice), await t.connect(alice), await t.connect(bob), await t.connect(carol)];
      const [la2, lb, lc] = [recordEvents(a2), recordEvents(b1), recordEvents(c1)];
      const la1 = recordEvents(a1);
      typing(a1, g, 'recording');
      await relaySettle();
      expect(lb.of('chat:typing')).toEqual([{ chatId: g, userId: alice.id, state: 'recording' }]);
      expect(lc.of('chat:typing')).toEqual([{ chatId: g, userId: alice.id, state: 'recording' }]);
      expect(la1.of('chat:typing')).toEqual([]);
      expect(la2.of('chat:typing')).toEqual([]);
      // Invalid payloads are ignored (no relay, no crash).
      a1.emit('chat:typing', { chatId: g, state: 'dancing' } as never);
      a1.emit('chat:typing', { chatId: 'x', state: 'typing' } as never);
      await relaySettle();
      expect(lb.of('chat:typing')).toHaveLength(1);
      disconnectAll(a1, a2, b1, c1);
    });

    it('never for channels, members who cannot send, former members, or direct chats with a block either way', async () => {
      const ch = await createChannel(alice);
      await follow(ch, [bob]);
      const adminsOnly = await createGroup(alice, [bob, carol], { settings: { onlyAdminsCanSend: true } });
      const leftGroup = await createGroup(alice, [bob, carol]);
      await leaveGroup(leftGroup, carol);
      const u1 = await t.createUser();
      const u2 = await t.createUser();
      const d = await activeDirect(t, u1, u2);
      await sendOk(t, u2, d, 'hi');

      const [a, b, c, s1, s2] = [await t.connect(alice), await t.connect(bob), await t.connect(carol), await t.connect(u1), await t.connect(u2)];
      const [la, lb, lc, l1, l2] = [a, b, c, s1, s2].map(recordEvents);
      typing(a, ch); // channel admin
      typing(b, adminsOnly); // cannot send
      typing(c, leftGroup); // former member
      await relaySettle();
      expect([...la.of('chat:typing'), ...lb.of('chat:typing'), ...lc.of('chat:typing')]).toEqual([]);
      // Admin in the admins-only group is relayed.
      typing(a, adminsOnly);
      await relaySettle();
      expect(lb.of('chat:typing')).toEqual([{ chatId: adminsOnly, userId: alice.id, state: 'typing' }]);

      // Direct: works without blocks...
      typing(s1, d);
      await relaySettle();
      expect(l2.of('chat:typing')).toHaveLength(1);
      // ...but not when either side blocked the other.
      await block(u2, u1);
      l2.clear();
      l1.clear();
      typing(s1, d, 'idle');
      typing(s2, d, 'idle');
      await relaySettle();
      expect(l2.of('chat:typing')).toEqual([]);
      expect(l1.of('chat:typing')).toEqual([]);
      disconnectAll(a, b, c, s1, s2);
    });

    it('is throttled per socket and chat (excess dropped silently); an idle right after typing still passes', async () => {
      const g = await createGroup(alice, [bob]);
      const a = await t.connect(alice);
      const b = await t.connect(bob);
      const lb = recordEvents(b);
      config.rateLimit = true;
      resetUserLimits();
      try {
        typing(a, g);
        typing(a, g);
        typing(a, g);
        typing(a, g, 'idle');
        await relaySettle();
        expect(lb.of('chat:typing').map((p) => p.state).sort()).toEqual(['idle', 'typing']);
        // A second socket of the same user has its own budget.
        const a2 = await t.connect(alice);
        typing(a2, g);
        await relaySettle();
        expect(lb.of('chat:typing')).toHaveLength(3);
        await settle(1100);
        typing(a, g);
        await relaySettle();
        expect(lb.of('chat:typing')).toHaveLength(4);
        a2.disconnect();
      } finally {
        config.rateLimit = false;
        resetUserLimits();
      }
      disconnectAll(a, b);
    });
  });

  describe('chat:read (socket) — same semantics as POST /chats/:chatId/read', () => {
    it('clamps, is monotonic, emits chat:read to all my devices and chat:watermarks to members whose ticks changed', async () => {
      const g = await createGroup(alice, [bob]);
      const m1 = await sendOk(t, alice, g, 'one');
      const m2 = await sendOk(t, alice, g, 'two');
      const [a, b1, b2] = [await t.connect(alice), await t.connect(bob), await t.connect(bob)];
      const [la, lb1, lb2] = [recordEvents(a), recordEvents(b1), recordEvents(b2)];
      const reads: DomainEventMap['chat.read'][] = [];
      const off = domainEvents.on('chat.read', (p) => void reads.push(p));
      try {
        await emitAck(b1, 'chat:read', { chatId: g, seq: m1.seq });
        await settle();
        for (const l of [lb1, lb2]) {
          expect(l.of('chat:read')).toEqual([{ chatId: g, lastReadSeq: m1.seq, unreadCount: 1, unreadMentionCount: 0, markedUnread: false }]);
        }
        expect(la.of('chat:watermarks')).toEqual([{ chatId: g, readWatermark: m1.seq, deliveredWatermark: m2.seq }]);
        expect(reads.at(-1)).toMatchObject({ userId: bob.id, chatId: g, lastReadSeq: m1.seq, clearedUnread: true });

        // Clamped to the latest visible seq; reading backwards never regresses.
        await emitAck(b2, 'chat:read', { chatId: g, seq: 10_000 });
        await emitAck(b2, 'chat:read', { chatId: g, seq: 1 });
        await settle();
        expect(lb1.of('chat:read').map((p) => p.lastReadSeq)).toEqual([m1.seq, m2.seq, m2.seq]);
        expect((await summaryOf(t, bob, g)).lastReadSeq).toBe(m2.seq);
        expect(la.of('chat:watermarks').map((p) => p.readWatermark)).toEqual([m1.seq, m2.seq]);
        expect(reads.at(-1)).toMatchObject({ lastReadSeq: m2.seq, clearedUnread: false });

        // REST is identical.
        const m3 = await sendOk(t, alice, g, 'three');
        await t.api(bob).post(`/api/chats/${g}/read`).send({ seq: m3.seq }).expect(204);
        await settle();
        expect(lb2.of('chat:read').at(-1)).toMatchObject({ lastReadSeq: m3.seq, unreadCount: 0 });
        await t.api(bob).post(`/api/chats/${g}/read`).send({ seq: -1 }).expect(400);
        await t.api(carol).post(`/api/chats/${g}/read`).send({ seq: 1 }).expect(404);
      } finally {
        off();
      }
      // Errors are acked.
      await expect(emitAck(b1, 'chat:read', { chatId: g, seq: 'x' })).rejects.toMatchObject({ ack: { ok: false, error: { code: 'validation_error' } } });
      const c = await t.connect(carol);
      await expect(emitAck(c, 'chat:read', { chatId: g, seq: 1 })).rejects.toMatchObject({ ack: { ok: false, error: { code: 'not_found' } } });
      disconnectAll(a, b1, b2, c);
    });
  });

  describe('ticks across two users', () => {
    it('delivered on send (recipient online) and on connect; read via chat:read; direct chats honour read receipts', async () => {
      const u1 = await t.createUser();
      const u2 = await t.createUser();
      const d = await openDirect(t, u1, u2);
      const s1 = await t.connect(u1);
      const l1 = recordEvents(s1);

      // Recipient offline: single tick.
      const m1 = await sendOk(t, u1, d.id, 'are you there?');
      let mine = await summaryOf(t, u1, d.id);
      expect(mine).toMatchObject({ deliveredWatermark: 0, readWatermark: 0 });

      // Recipient connects: delivered advanced before `ready`, sender notified.
      l1.clear();
      const s2 = await t.connect(u2);
      await settle();
      expect(l1.of('chat:watermarks')).toEqual([{ chatId: d.id, readWatermark: 0, deliveredWatermark: m1.seq }]);

      // Recipient online: delivered in the send transaction.
      l1.clear();
      const m2 = await sendOk(t, u1, d.id, 'hello?');
      await settle();
      expect(l1.of('chat:watermarks').at(-1)).toEqual({ chatId: d.id, readWatermark: 0, deliveredWatermark: m2.seq });

      // Read → blue ticks.
      l1.clear();
      await emitAck(s2, 'chat:read', { chatId: d.id, seq: m2.seq });
      await settle();
      expect(l1.of('chat:watermarks')).toEqual([{ chatId: d.id, readWatermark: m2.seq, deliveredWatermark: m2.seq }]);

      // Recipient turns read receipts off: reads are no longer reported (delivery still is).
      await setSettings(u2.id, { readReceipts: false });
      const m3 = await sendOk(t, u1, d.id, 'third');
      l1.clear();
      await emitAck(s2, 'chat:read', { chatId: d.id, seq: m3.seq });
      await settle();
      expect(l1.of('chat:watermarks').filter((p) => p.readWatermark > 0)).toEqual([]);
      mine = await summaryOf(t, u1, d.id);
      expect(mine).toMatchObject({ readWatermark: 0, deliveredWatermark: m3.seq });
      // ...and the recipient doesn't see the sender's reads either ("either side").
      await sendOk(t, u2, d.id, 'reply');
      expect((await summaryOf(t, u2, d.id)).readWatermark).toBe(0);
      disconnectAll(s1, s2);
    });

    it('groups: min over the other active members; read receipts are always on; watermarks recomputed when the slowest leaves', async () => {
      const g = await createGroup(alice, [bob, carol]);
      await setSettings(bob.id, { readReceipts: false });
      const a = await t.connect(alice);
      const b = await t.connect(bob);
      await goOffline(carol);
      const la = recordEvents(a);
      const m = await sendOk(t, alice, g, 'group ticks');
      await settle();
      let s: ChatSummary = await summaryOf(t, alice, g);
      expect(s.deliveredWatermark).toBeLessThan(m.seq); // carol offline
      await emitAck(b, 'chat:read', { chatId: g, seq: m.seq });
      s = await summaryOf(t, alice, g);
      expect(s.readWatermark).toBeLessThan(m.seq); // carol hasn't read
      la.clear();
      await leaveGroup(g, carol);
      await settle();
      const w = la.of('chat:watermarks').at(-1)!;
      expect(w.readWatermark).toBeGreaterThanOrEqual(m.seq); // bob read it (receipts always on in groups)
      disconnectAll(a, b);
    });
  });
});
