import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { chatMembers, messageHidden, messages } from '../../src/db/schema.js';
import { transact } from '../../src/services/effects.js';
import { domainEvents } from '../../src/services/events.js';
import { upsertMembership } from '../../src/services/membership.js';
import { toChatSummary } from '../../src/services/summaries.js';
import {
  advanceDelivered,
  advanceRead,
  aggregateMarks,
  computeWatermarks,
  markDeliveredOnConnect,
  readReceiptsChanged,
  viewerWatermarks,
} from '../../src/services/watermarks.js';
import { expectNoEvent, startTestServer, waitForEvent, type TestServer, type TestUser } from '../helpers.js';
import { block, createChannel, createDirect, createGroup, goOffline, memberRow, recordEvents, send, setSettings, settle } from './fixtures.js';

describe('services/watermarks', () => {
  let t: TestServer;
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;

  beforeAll(async () => {
    t = await startTestServer();
    alice = await t.createUser();
    bob = await t.createUser();
    carol = await t.createUser();
  });
  afterAll(() => t.close());

  const read = (userId: string, chatId: string, seq: number) => transact((tx, fx) => advanceRead(tx, fx, { chatId, userId, seq }));

  describe('pure computation', () => {
    it('min over the other active members, from the two smallest values', () => {
      const agg = aggregateMarks([
        { userId: 'a', read: 5, delivered: 9 },
        { userId: 'b', read: 7, delivered: 8 },
        { userId: 'c', read: 9, delivered: 9 },
      ]);
      const p = { chatType: 'group' as const, viewerActive: true, lastSeq: 10, readReceiptsOff: false };
      expect(viewerWatermarks(agg, { ...p, viewerId: 'a' })).toEqual({ readWatermark: 7, deliveredWatermark: 8 });
      expect(viewerWatermarks(agg, { ...p, viewerId: 'b' })).toEqual({ readWatermark: 5, deliveredWatermark: 9 });
      expect(viewerWatermarks(agg, { ...p, viewerId: 'x', viewerActive: false })).toEqual({ readWatermark: 5, deliveredWatermark: 8 });
      // ties: another holder of the minimum keeps it
      const tie = aggregateMarks([
        { userId: 'a', read: 3, delivered: 3 },
        { userId: 'b', read: 3, delivered: 3 },
      ]);
      expect(viewerWatermarks(tie, { ...p, viewerId: 'a' })).toEqual({ readWatermark: 3, deliveredWatermark: 3 });
      // nobody else → lastSeq; channels → 0; receipts off → read 0
      expect(viewerWatermarks(aggregateMarks([{ userId: 'a', read: 1, delivered: 1 }]), { ...p, viewerId: 'a' })).toEqual({ readWatermark: 10, deliveredWatermark: 10 });
      expect(viewerWatermarks(agg, { ...p, viewerId: 'a', chatType: 'channel' })).toEqual({ readWatermark: 0, deliveredWatermark: 0 });
      expect(viewerWatermarks(agg, { ...p, viewerId: 'a', readReceiptsOff: true })).toEqual({ readWatermark: 0, deliveredWatermark: 8 });
    });
  });

  describe('advanceRead', () => {
    it('is monotonic, raises delivered, clears markedUnread and emits chat:read with counts', async () => {
      const chatId = await createGroup(alice, [bob]);
      const m1 = await send(alice, chatId, 'one');
      const m2 = await send(alice, chatId, 'two');
      await db.update(chatMembers).set({ markedUnread: true }).where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, bob.id)));
      const bobSock = await t.connect(bob);
      const reads: unknown[] = [];
      const off = domainEvents.on('chat.read', (e) => void reads.push(e));
      const evt = waitForEvent(bobSock, 'chat:read');
      const r = await read(bob.id, chatId, Number(m1.message.seq));
      expect(r).toEqual({ seq: Number(m1.message.seq), advanced: true });
      expect(await evt).toEqual({ chatId, lastReadSeq: Number(m1.message.seq), unreadCount: 1, unreadMentionCount: 0, markedUnread: false });
      const row = await memberRow(chatId, bob);
      expect(Number(row.lastDeliveredSeq)).toBeGreaterThanOrEqual(Number(m1.message.seq));
      expect(row.lastReadAt).not.toBeNull();
      // lower seq never moves it back
      const back = await read(bob.id, chatId, 1);
      expect(back).toEqual({ seq: Number(m1.message.seq), advanced: false });
      await read(bob.id, chatId, Number(m2.message.seq));
      off();
      await goOffline(bob, bobSock);
      expect(reads[0]).toMatchObject({ userId: bob.id, chatId, clearedUnread: true });
      expect(reads[1]).toMatchObject({ clearedUnread: false });
      expect(reads[2]).toMatchObject({ clearedUnread: true, lastReadSeq: Number(m2.message.seq) });
    });

    it('clamps to the highest VISIBLE seq ≤ requested (withheld/hidden/expired/future never count)', async () => {
      await goOffline(bob);
      const chatId = await createGroup(alice, [bob]);
      const visible = await send(alice, chatId, 'visible');
      const hidden = await send(alice, chatId, 'hidden for bob');
      await db.insert(messageHidden).values({ userId: bob.id, messageId: hidden.message.id });
      const expired = await send(alice, chatId, 'expired');
      await db.update(messages).set({ expiresAt: new Date(Date.now() - 1) }).where(eq(messages.id, expired.message.id));
      const r = await read(bob.id, chatId, 10_000);
      expect(r.seq).toBe(Number(visible.message.seq));
      const row = await memberRow(chatId, bob);
      expect(Number(row.lastReadSeq)).toBe(Number(visible.message.seq));
      expect(Number(row.lastDeliveredSeq)).toBe(Number(visible.message.seq));
      // Alice's ticks: read watermark = the visible message only.
      const w = (await computeWatermarks(db, chatId, [alice.id])).get(alice.id)!;
      expect(w.readWatermark).toBe(Number(visible.message.seq));
    });

    it('404 for non-members; former members may read their window', async () => {
      const chatId = await createGroup(alice, [bob]);
      await expect(read(carol.id, chatId, 5)).rejects.toMatchObject({ status: 404 });
      const m = await send(alice, chatId, 'x');
      await transact((tx, fx) => upsertMembership(tx, fx, { kind: 'deactivate', chatId, userId: bob.id, reason: 'left', systemEvent: { kind: 'member_left', actorId: bob.id } }));
      await send(alice, chatId, 'after bob left');
      const r = await read(bob.id, chatId, 10_000);
      expect(r.seq).toBeGreaterThanOrEqual(Number(m.message.seq));
      const s = (await toChatSummary(db, bob.id, chatId))!;
      expect(s.lastReadSeq).toBe(s.lastSeq); // clamped to left_seq
      expect(s.unreadCount).toBe(0);
    });

    it('emits chat:watermarks only to members whose ticks changed', async () => {
      const [u1, u2, u3] = [await t.createUser(), await t.createUser(), await t.createUser()];
      const chatId = await createGroup(u1, [u2, u3]);
      const socks = [await t.connect(u1), await t.connect(u2), await t.connect(u3)];
      const m = await send(u1, chatId, 'tick'); // all online → delivered everywhere
      const seq = Number(m.message.seq);
      await settle();
      const recs = socks.map(recordEvents);
      const marks = (i: number) => recs[i]!.of('chat:watermarks').filter((w) => w.chatId === chatId);

      // u2 reads: u1's view = min(u2, u3 = 0) unchanged; u2's own view unchanged;
      // u3's view = min(u1 = seq, u2) → seq: changed.
      await read(u2.id, chatId, seq);
      await settle();
      expect(marks(0)).toHaveLength(0);
      expect(marks(1)).toHaveLength(0);
      expect(marks(2)).toEqual([{ chatId, readWatermark: seq, deliveredWatermark: seq }]);

      // u3 reads: u1 and u2 now see everything read; u3's view unchanged.
      await read(u3.id, chatId, seq);
      await settle();
      expect(marks(0)).toEqual([{ chatId, readWatermark: seq, deliveredWatermark: seq }]);
      expect(marks(1)).toEqual([{ chatId, readWatermark: seq, deliveredWatermark: seq }]);
      expect(marks(2)).toHaveLength(1);
      await goOffline(u1, socks[0]!);
      await goOffline(u2, socks[1]!);
      await goOffline(u3, socks[2]!);
    });
  });

  describe('join / receipts privacy / empty others', () => {
    it('does not regress anyone’s ticks when a member joins', async () => {
      const chatId = await createGroup(alice, [bob]);
      const m = await send(alice, chatId, 'all read');
      await read(bob.id, chatId, Number(m.message.seq));
      const before = (await computeWatermarks(db, chatId, [alice.id])).get(alice.id)!;
      expect(before.readWatermark).toBe(Number(m.message.seq));
      await transact((tx, fx) =>
        upsertMembership(tx, fx, { kind: 'activate', chatId, userIds: [carol.id], addedBy: alice.id, systemEvent: { kind: 'members_added', actorId: alice.id, userIds: [carol.id] } }),
      );
      const after = (await computeWatermarks(db, chatId, [alice.id])).get(alice.id)!;
      expect(after.readWatermark).toBeGreaterThanOrEqual(before.readWatermark);
      expect(after.deliveredWatermark).toBeGreaterThanOrEqual(before.deliveredWatermark);
      const carolRow = await memberRow(chatId, carol);
      expect(Number(carolRow.lastReadSeq)).toBe(Number(carolRow.joinedSeq));
      expect(Number(carolRow.lastDeliveredSeq)).toBe(Number(carolRow.joinedSeq));
    });

    it('direct chats hide read ticks when either side disabled read receipts (delivered still works)', async () => {
      const dan = await t.createUser();
      const chatId = await createDirect(dan, alice);
      const m = await send(dan, chatId, 'hello');
      await read(alice.id, chatId, Number(m.message.seq));
      let s = (await toChatSummary(db, dan.id, chatId))!;
      expect(s.readWatermark).toBe(Number(m.message.seq));
      await setSettings(alice, { readReceipts: false });
      s = (await toChatSummary(db, dan.id, chatId))!;
      expect(s.readWatermark).toBe(0);
      expect(s.deliveredWatermark).toBe(Number(m.message.seq));
      await setSettings(alice, { readReceipts: true });
      await setSettings(dan, { readReceipts: false }); // my own setting hides others' read ticks too
      s = (await toChatSummary(db, dan.id, chatId))!;
      expect(s.readWatermark).toBe(0);
      // Flipping the setting back re-emits watermarks to both sides where they changed.
      await setSettings(dan, { readReceipts: true });
      const danSock = await t.connect(dan);
      const evt = waitForEvent(danSock, 'chat:watermarks', { filter: (p) => p.chatId === chatId });
      await transact(async (tx, fx) => readReceiptsChanged(tx, fx, dan.id, false));
      expect(await evt).toMatchObject({ chatId, readWatermark: Number(m.message.seq) });
      danSock.disconnect();
    });

    it('uses the chat lastSeq when there are no other active members (self chat, last member)', async () => {
      const self = await createDirect(bob, bob);
      const bobSock = await t.connect(bob);
      const evt = waitForEvent(bobSock, 'chat:watermarks', { filter: (p) => p.chatId === self });
      const m = await send(bob, self, 'note');
      expect(await evt).toEqual({ chatId: self, readWatermark: Number(m.message.seq), deliveredWatermark: Number(m.message.seq) });
      bobSock.disconnect();

      const chatId = await createGroup(carol, [bob]);
      await transact((tx, fx) => upsertMembership(tx, fx, { kind: 'deactivate', chatId, userId: bob.id, reason: 'left', systemEvent: { kind: 'member_left', actorId: bob.id } }));
      const last = await send(carol, chatId, 'alone');
      const s = (await toChatSummary(db, carol.id, chatId))!;
      expect(s).toMatchObject({ readWatermark: Number(last.message.seq), deliveredWatermark: Number(last.message.seq), lastSeq: Number(last.message.seq) });
    });

    it('channels never have ticks nor chat:watermarks', async () => {
      const channelId = await createChannel(alice);
      await transact((tx, fx) => upsertMembership(tx, fx, { kind: 'activate', chatId: channelId, userIds: [bob.id] }));
      const aliceSock = await t.connect(alice);
      await send(alice, channelId, 'post');
      await read(bob.id, channelId, 100);
      await expectNoEvent(aliceSock, 'chat:watermarks');
      expect((await computeWatermarks(db, channelId)).get(alice.id)).toEqual({ readWatermark: 0, deliveredWatermark: 0 });
      aliceSock.disconnect();
    });
  });

  describe('delivered receipts (server-driven)', () => {
    it('advances delivered for online recipients on send and notifies the sender', async () => {
      await goOffline(carol);
      const chatId = await createGroup(alice, [bob, carol]);
      const aliceSock = await t.connect(alice);
      const bobSock = await t.connect(bob);
      const m1 = await send(alice, chatId, 'bob online, carol offline');
      expect(Number((await memberRow(chatId, bob)).lastDeliveredSeq)).toBe(Number(m1.message.seq));
      expect(Number((await memberRow(chatId, carol)).lastDeliveredSeq)).toBeLessThan(Number(m1.message.seq));
      // carol connects → delivered advanced before ready → alice's delivered watermark reaches m1
      const evt = waitForEvent(aliceSock, 'chat:watermarks', { filter: (p) => p.chatId === chatId && p.deliveredWatermark === Number(m1.message.seq) });
      const carolSock = await t.connect(carol);
      expect(await evt).toMatchObject({ chatId, deliveredWatermark: Number(m1.message.seq) });
      expect(Number((await memberRow(chatId, carol)).lastDeliveredSeq)).toBe(Number(m1.message.seq));
      aliceSock.disconnect();
      bobSock.disconnect();
      carolSock.disconnect();
    });

    it('markDeliveredOnConnect skips withheld messages and channels', async () => {
      const gina = await t.createUser();
      const hank = await t.createUser();
      const dm = await createDirect(gina, hank);
      await send(gina, dm, 'first');
      await block(hank, gina);
      const withheld = await send(gina, dm, 'withheld');
      const channelId = await createChannel(gina);
      await transact((tx, fx) => upsertMembership(tx, fx, { kind: 'activate', chatId: channelId, userIds: [hank.id] }));
      await send(gina, channelId, 'post');
      await markDeliveredOnConnect(hank.id);
      expect(Number((await memberRow(dm, hank)).lastDeliveredSeq)).toBeLessThan(Number(withheld.message.seq));
      const channelRow = await memberRow(channelId, hank);
      expect(Number(channelRow.lastDeliveredSeq)).toBe(Number(channelRow.lastReadSeq)); // untouched
    });

    it('advanceDelivered is clamped and monotonic', async () => {
      const chatId = await createGroup(alice, [bob]);
      const m = await send(alice, chatId, 'x');
      const r = await transact((tx, fx) => advanceDelivered(tx, fx, { chatId, userId: bob.id, seq: 999 }));
      expect(r.seq).toBe(Number(m.message.seq));
      const r2 = await transact((tx, fx) => advanceDelivered(tx, fx, { chatId, userId: bob.id, seq: 1 }));
      expect(r2).toEqual({ seq: Number(m.message.seq), advanced: false });
    });
  });
});
