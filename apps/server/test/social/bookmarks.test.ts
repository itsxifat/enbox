/**
 * Bookmarks and reminders (modules/bookmarks): saving a message I can see (never system or
 * deleted ones; 404 for the rest), a bookmark keeping its place while its reminder changes or
 * clears, MAX_BOOKMARKS, removing (idempotent), events to my devices only, my list (newest
 * first, keyset pages, messages as I see them now, null once gone, users side-loaded), Space
 * channels (no read row needed, hidden once I lose VIEW_CHANNEL), the reminders filter
 * (upcoming by time, then done) and the reminder job (each fires once: `reminder:due` and a
 * push while the message is still there for me).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import {
  MAX_BOOKMARKS,
  PERM,
  type Bookmark,
  type BookmarksPage,
  type PushPayload,
  type SpaceDetail,
  type SpaceInvite,
} from '@enbox/shared';
import { db } from '../../src/db/index.js';
import { messageBookmarks } from '../../src/db/schema.js';
import { sendDueReminders } from '../../src/modules/bookmarks/routes.js';
import { pushIdle, setPushSender, type PushTarget } from '../../src/modules/push/sender.js';
import { spaceRegistryIdle } from '../../src/realtime/spaceRegistry.js';
import {
  expectNoEvent,
  startTestServer,
  waitForEvent,
  type TestServer,
  type TestUser,
} from '../helpers.js';
import { createGroup, recordEvents, settle } from '../services/fixtures.js';
import { historyOf, sendOk } from '../messaging/support.js';

const HOUR_MS = 3_600_000;
const inHours = (h: number) => new Date(Date.now() + h * HOUR_MS).toISOString();

describe('bookmarks and reminders', () => {
  let t: TestServer;
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let pushes: { endpoint: string; payload: PushPayload }[];

  beforeAll(async () => {
    t = await startTestServer();
    setPushSender(async (target: PushTarget, payload: PushPayload) => {
      pushes.push({ endpoint: target.endpoint, payload });
    });
    alice = await t.createUser({ displayName: 'Alice' });
    bob = await t.createUser({ displayName: 'Bob' });
    carol = await t.createUser({ displayName: 'Carol' });
  });
  afterAll(async () => {
    setPushSender(undefined);
    await t.close();
  });
  beforeEach(() => {
    pushes = [];
  });

  const save = (user: TestUser, messageId: string, body: object = {}) =>
    t.api(user).put(`/api/messages/${messageId}/bookmark`).send(body);
  const unsave = (user: TestUser, messageId: string) =>
    t.api(user).delete(`/api/messages/${messageId}/bookmark`);
  const list = async (user: TestUser, query: Record<string, string | number> = {}) =>
    (await t.api(user).get('/api/me/bookmarks').query(query).expect(200)).body as BookmarksPage;
  const ids = (page: BookmarksPage) => page.bookmarks.map((b) => b.messageId);
  const mine = (user: TestUser, messageId: string) =>
    and(eq(messageBookmarks.userId, user.id), eq(messageBookmarks.messageId, messageId));
  /** Make a reminder due `agoMs` ago (the job only fires the ones whose time passed). */
  const makeDue = (user: TestUser, messageId: string, agoMs = 60_000) =>
    db
      .update(messageBookmarks)
      .set({ remindAt: new Date(Date.now() - agoMs) })
      .where(mine(user, messageId));

  async function subscribe(user: TestUser): Promise<string> {
    const endpoint = `https://fcm.googleapis.com/fcm/send/bookmarks-${user.id}`;
    await t
      .api(user)
      .post('/api/push/subscriptions')
      .send({ endpoint, keys: { p256dh: 'BPublicKey', auth: 'authSecret' } })
      .expect(204);
    return endpoint;
  }

  it('saves a message I can see and changes its reminder in place; events reach my devices only', async () => {
    const g = await createGroup(alice, [bob]);
    const m = await sendOk(t, bob, g, 'hello');
    const [a1, a2, b1] = [await t.connect(alice), await t.connect(alice), await t.connect(bob)];
    const changed = waitForEvent(a2, 'bookmark:changed');
    const saved = (await save(alice, m.id).expect(200)).body as Bookmark;
    expect(saved).toMatchObject({
      messageId: m.id,
      chatId: g,
      remindAt: null,
      remindedAt: null,
      message: { id: m.id, text: 'hello' },
    });
    expect((await changed).bookmark).toEqual(saved);
    await expectNoEvent(b1, 'bookmark:changed');

    // A reminder: the same bookmark, in the same place.
    const at = inHours(1);
    const reminded = (await save(alice, m.id, { remindAt: at }).expect(200)).body as Bookmark;
    expect(reminded).toMatchObject({ createdAt: saved.createdAt, remindAt: at, remindedAt: null });
    // Saving again without a change says nothing.
    const log = recordEvents(a1);
    await save(alice, m.id).expect(200);
    await settle();
    expect(log.of('bookmark:changed')).toEqual([]);
    // Cleared; a time in the past is refused.
    expect((await save(alice, m.id, { remindAt: null }).expect(200)).body.remindAt).toBeNull();
    const past = new Date(Date.now() - 1000).toISOString();
    expect((await save(alice, m.id, { remindAt: past }).expect(400)).body.error.code).toBe(
      'validation_error',
    );

    const removed = waitForEvent(a1, 'bookmark:removed');
    await unsave(alice, m.id).expect(204);
    expect(await removed).toEqual({ messageId: m.id });
    log.clear();
    await unsave(alice, m.id).expect(204);
    await settle();
    expect(log.of('bookmark:removed')).toEqual([]);
    expect(ids(await list(alice))).not.toContain(m.id);
    for (const s of [a1, a2, b1]) s.disconnect();
  });

  it('only messages I can see, never system or deleted ones', async () => {
    const g = await createGroup(alice, [bob]);
    const m = await sendOk(t, bob, g, 'secret');
    await save(carol, m.id).expect(404);
    await save(alice, randomUUID()).expect(404);
    await t.api(alice).put('/api/messages/not-a-uuid/bookmark').send({}).expect(400);
    const system = (await historyOf(t, alice, g)).find((x) => x.type === 'system')!;
    await save(alice, system.id).expect(400);
    const gone = await sendOk(t, bob, g, 'oops');
    await t.api(bob).delete(`/api/messages/${gone.id}`).query({ for: 'everyone' }).expect(204);
    await save(alice, gone.id).expect(400);
  });

  it('lists newest first in pages, the messages as I see them now, with their users', async () => {
    const dave = await t.createUser({ displayName: 'Dave' });
    const g = await createGroup(dave, [bob]);
    const [m1, m2, m3] = [
      await sendOk(t, bob, g, 'one'),
      await sendOk(t, bob, g, 'two'),
      await sendOk(t, bob, g, 'three'),
    ];
    // Saved a second apart (the list's order).
    for (const [i, m] of [m1, m2, m3].entries()) {
      await save(dave, m.id).expect(200);
      await db
        .update(messageBookmarks)
        .set({ createdAt: new Date(Date.now() - (3 - i) * 1000) })
        .where(mine(dave, m.id));
    }
    const p1 = await list(dave, { limit: 2 });
    expect(ids(p1)).toEqual([m3.id, m2.id]);
    expect(p1.users.map((u) => u.id)).toContain(bob.id);
    const p2 = await list(dave, { limit: 2, before: p1.nextCursor! });
    expect(ids(p2)).toEqual([m1.id]);
    expect(p2.nextCursor).toBeNull();

    // Deleted for everyone, or deleted for me: still listed, without the message.
    await t.api(bob).delete(`/api/messages/${m3.id}`).query({ for: 'everyone' }).expect(204);
    await t.api(dave).delete(`/api/messages/${m2.id}`).query({ for: 'me' }).expect(204);
    expect((await list(dave)).bookmarks.map((b) => [b.messageId, b.message?.text ?? null])).toEqual(
      [
        [m3.id, null],
        [m2.id, null],
        [m1.id, 'one'],
      ],
    );
    // …and removable.
    await unsave(dave, m3.id).expect(204);
    expect(ids(await list(dave))).toEqual([m2.id, m1.id]);
    await t.api(dave).get('/api/me/bookmarks').query({ before: 'nope' }).expect(400);
  });

  it('Space channels: no read row needed; gone once the channel is hidden from me', async () => {
    const detail = (await t.api(alice).post('/api/spaces').send({ name: 'Saved' }).expect(201))
      .body as SpaceDetail;
    const invite = (
      await t.api(alice).post(`/api/spaces/${detail.space.id}/invites`).send({}).expect(201)
    ).body as SpaceInvite;
    await t.api(carol).post(`/api/invites/${invite.code}/join`).expect(200);
    await spaceRegistryIdle();
    const general = detail.channels.find((c) => c.name === 'general')!;
    const m = await sendOk(t, alice, general.id, 'in the space');
    // Carol never opened #general.
    const saved = (await save(carol, m.id).expect(200)).body as Bookmark;
    expect(saved.message?.text).toBe('in the space');
    expect((await list(carol)).bookmarks.find((b) => b.messageId === m.id)?.message?.text).toBe(
      'in the space',
    );

    const everyone = detail.space.roles.find((r) => r.isDefault)!;
    await t
      .api(alice)
      .put(`/api/spaces/${detail.space.id}/channels/${general.id}/overwrites/role/${everyone.id}`)
      .send({ allow: 0, deny: PERM.VIEW_CHANNEL })
      .expect(200);
    expect((await list(carol)).bookmarks.find((b) => b.messageId === m.id)?.message).toBeNull();
    await save(carol, m.id).expect(404);
  });

  it(`caps bookmarks at ${MAX_BOOKMARKS} (409 limit_reached)`, async () => {
    const erin = await t.createUser();
    const g = await createGroup(erin, [bob]);
    const m = await sendOk(t, bob, g, 'one too many');
    await db.execute(sql`with filler as (
        insert into messages (chat_id, seq, sender_id, type, text)
        select ${g}::uuid, 1000 + i, ${bob.id}::uuid, 'text', 'filler'
        from generate_series(1, ${MAX_BOOKMARKS}::int) i
        returning id)
      insert into message_bookmarks (user_id, message_id, chat_id)
      select ${erin.id}::uuid, id, ${g}::uuid from filler`);
    expect((await save(erin, m.id).expect(409)).body.error.code).toBe('limit_reached');
    // A reminder on one I have is no new bookmark.
    const [one] = await db
      .select()
      .from(messageBookmarks)
      .where(eq(messageBookmarks.userId, erin.id))
      .limit(1);
    await save(erin, one!.messageId, { remindAt: inHours(1) }).expect(200);
    await unsave(erin, one!.messageId).expect(204);
    await save(erin, m.id).expect(200);
  });

  it('reminders: upcoming by time, then done; the job fires each once, with an event and a push', async () => {
    const frank = await t.createUser({ displayName: 'Frank' });
    const g = await createGroup(frank, [bob], { name: 'Plans' });
    const [m1, m2, m3] = [
      await sendOk(t, bob, g, 'call the bank'),
      await sendOk(t, bob, g, 'pay rent'),
      await sendOk(t, bob, g, 'just saved'),
    ];
    await save(frank, m2.id, { remindAt: inHours(2) }).expect(200);
    await save(frank, m1.id, { remindAt: inHours(1) }).expect(200);
    await save(frank, m3.id).expect(200);
    expect(ids(await list(frank, { filter: 'reminders' }))).toEqual([m1.id, m2.id]);

    const endpoint = await subscribe(frank);
    const sock = await t.connect(frank);
    const log = recordEvents(sock);
    await makeDue(frank, m1.id);
    expect(await sendDueReminders()).toBe(1);
    await settle();
    await pushIdle();
    expect(log.of('reminder:due').map((e) => e.bookmark)).toEqual([
      expect.objectContaining({
        messageId: m1.id,
        remindedAt: expect.any(String),
        message: expect.objectContaining({ text: 'call the bank' }),
      }),
    ]);
    expect(pushes).toEqual([
      {
        endpoint,
        payload: expect.objectContaining({
          type: 'message',
          title: 'Plans',
          body: 'Reminder: call the bank',
          tag: `reminder:${m1.id}`,
          url: `/chats/${g}?m=${m1.seq}&mid=${m1.id}`,
          chatId: g,
        }),
      },
    ]);
    // Once.
    log.clear();
    pushes = [];
    expect(await sendDueReminders()).toBe(0);
    await settle();
    await pushIdle();
    expect(log.of('reminder:due')).toEqual([]);
    expect(pushes).toEqual([]);

    // Upcoming first, then done, paged across both.
    const p1 = await list(frank, { filter: 'reminders', limit: 1 });
    expect(ids(p1)).toEqual([m2.id]);
    expect(p1.nextCursor).toMatch(/^u\|/);
    const p2 = await list(frank, { filter: 'reminders', limit: 1, before: p1.nextCursor! });
    expect(ids(p2)).toEqual([m1.id]);
    expect(p2.bookmarks[0]!.remindedAt).not.toBeNull();
    expect(p2.nextCursor).toBeNull();
    await t
      .api(frank)
      .get('/api/me/bookmarks')
      .query({ filter: 'reminders', before: 'x|y' })
      .expect(400);

    // A new time arms it again.
    const again = (await save(frank, m1.id, { remindAt: inHours(3) }).expect(200)).body as Bookmark;
    expect(again.remindedAt).toBeNull();
    expect(ids(await list(frank, { filter: 'reminders' }))).toEqual([m2.id, m1.id]);
    sock.disconnect();
  });

  it('fires in batches; a message I can no longer see is reminded without a push', async () => {
    const gina = await t.createUser();
    const g = await createGroup(gina, [bob]);
    const m1 = await sendOk(t, bob, g, 'first');
    const m2 = await sendOk(t, bob, g, 'second');
    await save(gina, m1.id, { remindAt: inHours(1) }).expect(200);
    await save(gina, m2.id, { remindAt: inHours(2) }).expect(200);
    await subscribe(gina);
    await makeDue(gina, m1.id, 120_000);
    await makeDue(gina, m2.id);
    await t.api(gina).post(`/api/chats/${g}/clear`).expect(204);
    const sock = await t.connect(gina);
    const log = recordEvents(sock);
    expect(await sendDueReminders(1)).toBe(2);
    await settle();
    await pushIdle();
    expect(log.of('reminder:due').map((e) => [e.bookmark.messageId, e.bookmark.message])).toEqual([
      [m1.id, null],
      [m2.id, null],
    ]);
    expect(pushes).toEqual([]);
    sock.disconnect();
  });
});
