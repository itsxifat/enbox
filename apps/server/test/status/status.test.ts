import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { STATUS_TTL_MS, type MediaAttachment, type Status, type StatusFeed, type StatusViewer } from '@enbox/shared';
import { db } from '../../src/db/index.js';
import { blocks, media, statusViews, statuses, users } from '../../src/db/schema.js';
import { runJobsOnce } from '../../src/jobs/index.js';
import { runMediaGc } from '../../src/jobs/mediaGc.js';
import { purgeExpiredStatuses } from '../../src/modules/status/service.js';
import { loadMessages } from '../../src/services/messages.js';
import { resolveStatusReply } from '../../src/services/statuses.js';
import { requireChat } from '../../src/services/chats.js';
import { startTestServer, type TestServer, type TestSocket, type TestUser } from '../helpers.js';
import { block, createDirect, recordEvents, saveContact, send, setSettings, settle } from '../services/fixtures.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const WEBM = Buffer.from([
  0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0x42, 0xf2, 0x81, 0x04, 0x42, 0xf3, 0x81, 0x08, 0x42, 0x82, 0x84, 0x77, 0x65,
  0x62, 0x6d, 0x42, 0x87, 0x81, 0x02, 0x42, 0x85, 0x81, 0x02, ...Array(64).fill(0),
]);

type Rec = ReturnType<typeof recordEvents>;

describe('status updates', () => {
  let t: TestServer;

  beforeAll(async () => {
    t = await startTestServer();
  });
  afterAll(() => t.close());

  const post = (u: TestUser, body: unknown, status = 201) => t.api(u).post('/api/status').send(body as object).expect(status);
  const feed = async (u: TestUser) => (await t.api(u).get('/api/status/feed').expect(200)).body as StatusFeed;
  const audienceOf = async (id: string) => {
    const [row] = await db.select({ audience: statuses.audience }).from(statuses).where(eq(statuses.id, id));
    return [...row!.audience].sort();
  };
  const sorted = (...us: TestUser[]) => us.map((u) => u.id).sort();
  const upload = async (u: TestUser, kind: 'image' | 'video') => {
    const res = await t
      .api(u)
      .post('/api/media')
      .field('kind', kind)
      .attach('file', kind === 'image' ? PNG : WEBM, { filename: kind === 'image' ? 'p.png' : 'v.webm', contentType: 'application/octet-stream' })
      .expect(201);
    return res.body as MediaAttachment;
  };

  async function people(n: number) {
    const out: TestUser[] = [];
    for (let i = 0; i < n; i++) out.push(await t.createUser({ displayName: `P${i}` }));
    return out;
  }

  describe('audience', () => {
    it('contacts (default): my contacts minus blocks either way and deleted users; status:new to each of them and to me', async () => {
      const [alice, bob, carol, dave, erin, frank, gone] = await people(7);
      for (const c of [bob, carol, dave, erin, gone]) await saveContact(alice!, c!);
      await block(dave!, alice!); // blocked me
      await block(alice!, erin!); // I blocked
      await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, gone!.id));
      const socks: TestSocket[] = [];
      for (const u of [alice, bob, carol, dave, erin, frank]) socks.push(await t.connect(u!));
      const [ra, rb, rc, rd, re, rf] = socks.map(recordEvents) as Rec[];

      const res = await post(alice!, { type: 'text', text: '  hello world  ' });
      const s = res.body as Status;
      expect(s).toMatchObject({ userId: alice!.id, type: 'text', text: 'hello world', backgroundColor: '#6D5DFC', font: 0, media: null, viewed: true, viewCount: 0 });
      expect(Date.parse(s.expiresAt) - Date.parse(s.createdAt)).toBe(STATUS_TTL_MS);
      expect(await audienceOf(s.id)).toEqual(sorted(bob!, carol!));

      for (const r of [rb!, rc!]) {
        await until(() => r.of('status:new').length === 1);
        const evt = r.of('status:new')[0]!;
        expect(evt.status).toEqual({ ...s, viewed: false, viewCount: null });
        expect(evt.user).toMatchObject({ id: alice!.id, displayName: 'P0' });
      }
      await until(() => ra!.of('status:new').length === 1);
      expect(ra!.of('status:new')[0]!.status).toEqual(s);
      await settle(150);
      for (const r of [rd!, re!, rf!]) expect(r.of('status:new')).toHaveLength(0);
    });

    it('contacts_except / only_share_with (lists ∩ contacts)', async () => {
      const [alice, bob, carol, dave, stranger] = await people(5);
      for (const c of [bob, carol, dave]) await saveContact(alice!, c!);

      await setSettings(alice!, { statusPrivacy: 'contacts_except', statusExcludeUserIds: [carol!.id, stranger!.id] });
      expect(await audienceOf((await post(alice!, { type: 'text', text: 'a' })).body.id)).toEqual(sorted(bob!, dave!));

      await setSettings(alice!, { statusPrivacy: 'only_share_with', statusOnlyShareWithUserIds: [carol!.id, stranger!.id] });
      expect(await audienceOf((await post(alice!, { type: 'text', text: 'b' })).body.id)).toEqual(sorted(carol!));

      await setSettings(alice!, { statusPrivacy: 'only_share_with', statusOnlyShareWithUserIds: [] });
      expect(await audienceOf((await post(alice!, { type: 'text', text: 'c' })).body.id)).toEqual([]);

      await setSettings(alice!, { statusPrivacy: 'contacts' });
      expect(await audienceOf((await post(alice!, { type: 'text', text: 'd' })).body.id)).toEqual(sorted(bob!, carol!, dave!));
      // The audience is a snapshot: a contact added later doesn't see older statuses.
      await saveContact(alice!, stranger!);
      const f = await feed(stranger!);
      expect(f.updates).toEqual([]);
    });
  });

  describe('POST /status', () => {
    it('media statuses: my upload of the matching kind, caption trimmed, no colors', async () => {
      const [alice, bob] = await people(2);
      const img = await upload(alice!, 'image');
      const vid = await upload(alice!, 'video');
      const s1 = (await post(alice!, { type: 'image', mediaId: img.id, text: ' look ' })).body as Status;
      expect(s1).toMatchObject({ type: 'image', text: 'look', backgroundColor: null, font: null, media: { id: img.id, kind: 'image', url: img.url } });
      const s2 = (await post(alice!, { type: 'video', mediaId: vid.id })).body as Status;
      expect(s2).toMatchObject({ type: 'video', text: null, media: { id: vid.id, kind: 'video' } });
      expect((await post(alice!, { type: 'video', mediaId: img.id }, 400)).body.error.code).toBe('validation_error');
      expect((await post(bob!, { type: 'image', mediaId: img.id }, 404)).body.error.code).toBe('not_found');
      expect((await post(alice!, { type: 'image', mediaId: crypto.randomUUID() }, 404)).body.error.code).toBe('not_found');
    });

    it('validates bodies (discriminated, strict)', async () => {
      const [alice] = await people(1);
      const bad = [
        {},
        { type: 'text' },
        { type: 'text', text: '   ' },
        { type: 'text', text: 'x'.repeat(701) },
        { type: 'text', text: 'hi', backgroundColor: 'red' },
        { type: 'text', text: 'hi', font: 5 },
        { type: 'text', text: 'hi', mediaId: crypto.randomUUID() },
        { type: 'image', text: 'no media' },
        { type: 'audio', mediaId: crypto.randomUUID() },
      ];
      for (const body of bad) expect((await post(alice!, body, 400)).body.error.code).toBe('validation_error');
      const ok = (await post(alice!, { type: 'text', text: 'styled', backgroundColor: '#112233', font: 4 })).body as Status;
      expect(ok).toMatchObject({ backgroundColor: '#112233', font: 4 });
      await t.api().post('/api/status').send({ type: 'text', text: 'x' }).expect(401);
    });
  });

  describe('feed, views, reactions, viewers', () => {
    let alice: TestUser, bob: TestUser, carol: TestUser, dave: TestUser, stranger: TestUser;
    let ra: Rec;

    beforeAll(async () => {
      [alice, bob, carol, dave, stranger] = (await people(5)) as [TestUser, TestUser, TestUser, TestUser, TestUser];
      // bob and carol share with alice; alice shares with bob, carol, dave.
      await saveContact(bob, alice);
      await saveContact(carol, alice);
      for (const c of [bob, carol, dave]) await saveContact(alice, c);
      ra = recordEvents(await t.connect(alice));
    });
    beforeEach(() => ra.clear());

    it('groups other users by author: unviewed first, then most recent; mine oldest first', async () => {
      const b1 = (await post(bob, { type: 'text', text: 'b1' })).body as Status;
      const b2 = (await post(bob, { type: 'text', text: 'b2' })).body as Status;
      const c1 = (await post(carol, { type: 'text', text: 'c1' })).body as Status;
      const m1 = (await post(alice, { type: 'text', text: 'm1' })).body as Status;
      const m2 = (await post(alice, { type: 'text', text: 'm2' })).body as Status;

      let f = await feed(alice);
      expect(f.mine.map((s) => s.id)).toEqual([m1.id, m2.id]);
      expect(f.mine.every((s) => s.viewed && s.viewCount === 0)).toBe(true);
      expect(f.updates.map((u) => u.user.id)).toEqual([carol.id, bob.id]); // both unviewed, carol most recent
      const bobItem = f.updates[1]!;
      expect(bobItem.statuses.map((s) => s.id)).toEqual([b1.id, b2.id]);
      expect(bobItem).toMatchObject({ allViewed: false, lastUpdatedAt: b2.createdAt });
      expect(bobItem.statuses[0]).toMatchObject({ viewed: false, viewCount: null });

      await t.api(alice).post(`/api/status/${c1.id}/view`).expect(204);
      await t.api(alice).post(`/api/status/${b1.id}/view`).expect(204);
      f = await feed(alice);
      expect(f.updates.map((u) => [u.user.id, u.allViewed])).toEqual([
        [bob.id, false],
        [carol.id, true],
      ]);
      expect(f.updates[0]!.statuses.map((s) => s.viewed)).toEqual([true, false]);

      // Expired statuses, non-audience viewers, blocked and deleted authors are left out.
      await db
        .update(statuses)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(statuses.id, b2.id));
      f = await feed(alice);
      expect(f.updates.find((u) => u.user.id === bob.id)!.statuses.map((s) => s.id)).toEqual([b1.id]);
      expect(f.updates.find((u) => u.user.id === bob.id)!.allViewed).toBe(true);
      expect((await feed(stranger)).updates).toEqual([]);
      expect((await feed(dave)).updates.map((u) => u.user.id)).toEqual([alice.id]);
    });

    it('views: audience only; the first view notifies the author; read receipts off records silently', async () => {
      const s = (await post(alice, { type: 'text', text: 'seen?' })).body as Status;
      await t.api(bob).post(`/api/status/${s.id}/view`).expect(204);
      await until(() => ra.of('status:viewed').length === 1);
      const evt = ra.of('status:viewed')[0]!;
      expect(evt.statusId).toBe(s.id);
      expect(evt.viewer).toMatchObject({ user: { id: bob.id }, reaction: null });
      await t.api(bob).post(`/api/status/${s.id}/view`).expect(204); // again: no event
      await t.api(alice).post(`/api/status/${s.id}/view`).expect(204); // author: no-op
      expect(await db.select().from(statusViews).where(eq(statusViews.statusId, s.id))).toHaveLength(1);
      await t.api(stranger).post(`/api/status/${s.id}/view`).expect(404);
      await t.api(bob).post(`/api/status/${crypto.randomUUID()}/view`).expect(404);
      expect((await t.api(bob).post('/api/status/nope/view').expect(400)).body.error.code).toBe('validation_error');

      await setSettings(dave, { readReceipts: false });
      await t.api(dave).post(`/api/status/${s.id}/view`).expect(204);
      await settle(150);
      expect(ra.of('status:viewed')).toHaveLength(1);
      expect((await feed(dave)).updates.find((u) => u.user.id === alice.id)!.statuses.find((x) => x.id === s.id)!.viewed).toBe(true);
      expect((await feed(alice)).mine.find((x) => x.id === s.id)!.viewCount).toBe(1);
      const viewers = (await t.api(alice).get(`/api/status/${s.id}/viewers`).expect(200)).body as StatusViewer[];
      expect(viewers.map((v) => v.user.id)).toEqual([bob.id]);
      // Turning receipts back on reveals the (recorded) view.
      await setSettings(dave, { readReceipts: true });
      const again = (await t.api(alice).get(`/api/status/${s.id}/viewers`).expect(200)).body as StatusViewer[];
      expect(again.map((v) => v.user.id)).toEqual([dave.id, bob.id]); // newest first
      expect((await feed(alice)).mine.find((x) => x.id === s.id)!.viewCount).toBe(2);
      // A blocked author's status is invisible (404) even to a stored audience member.
      await block(carol, alice);
      await t.api(carol).post(`/api/status/${s.id}/view`).expect(404);
      expect((await feed(carol)).updates.find((u) => u.user.id === alice.id)).toBeUndefined();
      await db.delete(blocks).where(eq(blocks.blockerId, carol.id));
    });

    it('reactions: one emoji, audience only, replaced; the author gets status:viewed with it', async () => {
      const s = (await post(alice, { type: 'text', text: 'react' })).body as Status;
      await t.api(bob).post(`/api/status/${s.id}/view`).expect(204);
      await until(() => ra.of('status:viewed').length === 1);
      const viewedAt = ra.of('status:viewed')[0]!.viewer.viewedAt;
      await t.api(bob).put(`/api/status/${s.id}/reaction`).send({ emoji: '❤️' }).expect(204);
      await until(() => ra.of('status:viewed').length === 2);
      expect(ra.of('status:viewed')[1]!.viewer).toMatchObject({ user: { id: bob.id }, reaction: '❤️', viewedAt });
      await t.api(bob).put(`/api/status/${s.id}/reaction`).send({ emoji: '😂' }).expect(204);
      for (const emoji of ['hi', '👍👍', '']) {
        expect((await t.api(bob).put(`/api/status/${s.id}/reaction`).send({ emoji }).expect(400)).body.error.code).toBe('validation_error');
      }
      expect((await t.api(alice).put(`/api/status/${s.id}/reaction`).send({ emoji: '👍' }).expect(403)).body.error.code).toBe('forbidden');
      await t.api(stranger).put(`/api/status/${s.id}/reaction`).send({ emoji: '👍' }).expect(404);
      // Reacting without a prior view records the view too.
      await t.api(carol).put(`/api/status/${s.id}/reaction`).send({ emoji: '👍' }).expect(204);
      const viewers = (await t.api(alice).get(`/api/status/${s.id}/viewers`).expect(200)).body as StatusViewer[];
      expect(viewers.map((v) => [v.user.id, v.reaction])).toEqual([
        [carol.id, '👍'],
        [bob.id, '😂'],
      ]);
      // Viewers with receipts off never surface, reactions included.
      await setSettings(dave, { readReceipts: false });
      ra.clear();
      await t.api(dave).put(`/api/status/${s.id}/reaction`).send({ emoji: '🙏' }).expect(204);
      await settle(150);
      expect(ra.of('status:viewed')).toHaveLength(0);
      expect(((await t.api(alice).get(`/api/status/${s.id}/viewers`).expect(200)).body as StatusViewer[]).map((v) => v.user.id)).not.toContain(dave.id);
      await setSettings(dave, { readReceipts: true });
    });

    it('viewers: author only (audience 403, others 404)', async () => {
      const s = (await post(alice, { type: 'text', text: 'who' })).body as Status;
      expect((await t.api(alice).get(`/api/status/${s.id}/viewers`).expect(200)).body).toEqual([]);
      expect((await t.api(bob).get(`/api/status/${s.id}/viewers`).expect(403)).body.error.code).toBe('forbidden');
      await t.api(stranger).get(`/api/status/${s.id}/viewers`).expect(404);
    });
  });

  describe('deletion and expiry', () => {
    it('DELETE: author only; status:deleted → audience + me; replies become unavailable; media freed', async () => {
      const [alice, bob, carol, stranger] = await people(4);
      await saveContact(alice!, bob!);
      await saveContact(alice!, carol!);
      const socks = [await t.connect(alice!), await t.connect(bob!), await t.connect(carol!), await t.connect(stranger!)];
      const [ra, rb, rc, rs] = socks.map(recordEvents) as Rec[];
      const img = await upload(alice!, 'image');
      const s = (await post(alice!, { type: 'image', mediaId: img.id })).body as Status;
      await t.api(carol!).post(`/api/status/${s.id}/view`).expect(204);

      // Bob replies to the status in his direct chat with Alice.
      const chatId = await createDirect(bob!, alice!);
      const chat = await requireChat(db, chatId);
      const statusReply = await resolveStatusReply(db, { senderId: bob!.id, chat, statusId: s.id });
      const { message } = await send(bob!, chatId, { text: 'nice', metadata: { statusReply } });
      expect((await loadMessages(db, bob!.id, [message.id]))[0]!.statusReply).toMatchObject({ available: true, mediaUrl: img.url });

      expect((await t.api(bob!).delete(`/api/status/${s.id}`).expect(403)).body.error.code).toBe('forbidden');
      await t.api(stranger!).delete(`/api/status/${s.id}`).expect(404);
      await t.api(alice!).delete(`/api/status/${s.id}`).expect(204);
      for (const r of [ra!, rb!, rc!]) {
        await until(() => r.of('status:deleted').length === 1);
        expect(r.of('status:deleted')[0]).toEqual({ statusId: s.id, userId: alice!.id });
      }
      await settle(100);
      expect(rs!.of('status:deleted')).toHaveLength(0);
      await t.api(alice!).delete(`/api/status/${s.id}`).expect(404);
      await t.api(bob!).post(`/api/status/${s.id}/view`).expect(404);
      expect(await db.select().from(statusViews).where(eq(statusViews.statusId, s.id))).toEqual([]);
      expect((await loadMessages(db, bob!.id, [message.id]))[0]!.statusReply).toMatchObject({ available: false, text: null, mediaUrl: null });
      // The media is no longer referenced: the GC may collect it.
      expect(await runMediaGc({ ttlMs: 0 })).toBeGreaterThanOrEqual(1);
      expect(await db.select().from(media).where(eq(media.id, img.id))).toEqual([]);
    });

    it('the expiry job purges expired statuses (views cascade) in batches', async () => {
      await purgeExpiredStatuses(); // statuses expired by earlier tests
      const [alice, bob] = await people(2);
      await saveContact(alice!, bob!);
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) ids.push(((await post(alice!, { type: 'text', text: `e${i}` })).body as Status).id);
      const keep = ((await post(alice!, { type: 'text', text: 'fresh' })).body as Status).id;
      await t.api(bob!).post(`/api/status/${ids[0]}/view`).expect(204);
      await db
        .update(statuses)
        .set({ expiresAt: new Date(Date.now() - 1) })
        .where(inArray(statuses.id, ids.slice(0, 3)));
      // Expired statuses vanish from the feed and can't be viewed before the purge.
      expect((await feed(bob!)).updates[0]!.statuses.map((s) => s.id)).toEqual([...ids.slice(3), keep]);
      await t.api(bob!).post(`/api/status/${ids[1]}/view`).expect(404);

      expect(await purgeExpiredStatuses({ batchSize: 2 })).toBe(3);
      expect((await db.select({ id: statuses.id }).from(statuses).where(inArray(statuses.id, [...ids, keep]))).map((r) => r.id).sort()).toEqual([...ids.slice(3), keep].sort());
      expect(await db.select().from(statusViews).where(eq(statusViews.statusId, ids[0]!))).toEqual([]);

      // Registered as a job.
      await db
        .update(statuses)
        .set({ expiresAt: new Date(Date.now() - 1) })
        .where(inArray(statuses.id, ids.slice(3)));
      await runJobsOnce();
      expect(await db.select().from(statuses).where(inArray(statuses.id, ids))).toEqual([]);
    });
  });
});

async function until(cond: () => boolean, timeoutMs = 3000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}
