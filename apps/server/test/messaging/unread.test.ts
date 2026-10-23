/**
 * Mark Unread (`POST /chats/:chatId/unread`): my read position goes back to just before a
 * message (or forward, for one that was already unread), the chat is marked unread, my devices
 * get `chat:read` + `chat:upsert`, nobody else hears about it; Space channels work through
 * their lazy read row; non-members, former members and other chats' messages are refused.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ChatReadState, SpaceDetail, SpaceInvite } from '@enbox/shared';
import { spaceRegistryIdle } from '../../src/realtime/spaceRegistry.js';
import { startTestServer, type TestServer, type TestUser } from '../helpers.js';
import { createGroup, recordEvents, settle } from '../services/fixtures.js';
import { leaveGroup, memberOf, sendOk, summaryOf } from './support.js';

describe('mark unread', () => {
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

  const markUnread = (user: TestUser, chatId: string, messageId: string) =>
    t.api(user).post(`/api/chats/${chatId}/unread`).send({ messageId });

  it('moves my read position back: the unread count comes back and my other devices get chat:read and chat:upsert', async () => {
    const g = await createGroup(alice, [bob]);
    await sendOk(t, alice, g, 'one');
    const m2 = await sendOk(t, alice, g, `two @{${bob.id}}`);
    const m3 = await sendOk(t, alice, g, 'three');
    await t.api(bob).post(`/api/chats/${g}/read`).send({ seq: m3.seq }).expect(204);
    expect(await summaryOf(t, bob, g)).toMatchObject({ unreadCount: 0, lastReadSeq: m3.seq });

    const [b1, b2, a] = [await t.connect(bob), await t.connect(bob), await t.connect(alice)];
    const [lb1, lb2, la] = [recordEvents(b1), recordEvents(b2), recordEvents(a)];
    const res = await markUnread(bob, g, m2.id).expect(200);
    const state: ChatReadState = {
      chatId: g,
      lastReadSeq: m2.seq - 1,
      unreadCount: 2,
      unreadMentionCount: 1,
      markedUnread: true,
    };
    expect(res.body).toEqual(state);
    await settle();
    const { chatId: _, ...fields } = state;
    for (const l of [lb1, lb2]) {
      expect(l.of('chat:read')).toEqual([state]);
      // Clients drop a chat:read that goes backwards: the summary carries the new position.
      expect(l.of('chat:upsert').map((p) => p.chat)).toEqual([
        expect.objectContaining({ id: g, ...fields }),
      ]);
      expect(l.names().indexOf('chat:read')).toBeLessThan(l.names().indexOf('chat:upsert'));
    }
    // Nobody else hears about it (tick watermarks only move forward).
    expect(la.of('chat:read')).toEqual([]);
    expect(la.of('chat:watermarks')).toEqual([]);
    expect(la.of('chat:upsert')).toEqual([]);
    expect(await summaryOf(t, bob, g)).toMatchObject({
      lastReadSeq: m2.seq - 1,
      unreadCount: 2,
      unreadMentionCount: 1,
      markedUnread: true,
    });
    // Delivered stays where it was.
    expect(Number((await memberOf(g, bob))!.lastDeliveredSeq)).toBe(m3.seq);

    // Reading again clears it all.
    await t.api(bob).post(`/api/chats/${g}/read`).send({ seq: m3.seq }).expect(204);
    expect(await summaryOf(t, bob, g)).toMatchObject({
      lastReadSeq: m3.seq,
      unreadCount: 0,
      unreadMentionCount: 0,
      markedUnread: false,
    });
    for (const s of [b1, b2, a]) s.disconnect();
  });

  it('a message that was still unread: the messages above it become read (and delivered)', async () => {
    const g = await createGroup(alice, [bob]);
    await sendOk(t, alice, g, 'one');
    await sendOk(t, alice, g, 'two');
    const m3 = await sendOk(t, alice, g, 'three');
    expect((await summaryOf(t, bob, g)).unreadCount).toBe(3);
    const a = await t.connect(alice);
    const la = recordEvents(a);
    const res = await markUnread(bob, g, m3.id).expect(200);
    expect(res.body).toMatchObject({ lastReadSeq: m3.seq - 1, unreadCount: 1, markedUnread: true });
    const row = (await memberOf(g, bob))!;
    expect(Number(row.lastDeliveredSeq)).toBeGreaterThanOrEqual(m3.seq - 1);
    await settle();
    // Moving forward is a read: Alice's ticks advance.
    expect(la.of('chat:watermarks').at(-1)).toMatchObject({ chatId: g, readWatermark: m3.seq - 1 });
    a.disconnect();
  });

  it('works on my own message: it never counts, but the chat is marked unread', async () => {
    const g = await createGroup(alice, [bob]);
    const mine = await sendOk(t, bob, g, 'my own');
    const res = await markUnread(bob, g, mine.id).expect(200);
    expect(res.body).toMatchObject({
      lastReadSeq: mine.seq - 1,
      unreadCount: 0,
      markedUnread: true,
    });
    expect(await summaryOf(t, bob, g)).toMatchObject({ markedUnread: true, unreadCount: 0 });
  });

  it('Space channels: the read row is created, the channel turns unread again', async () => {
    const detail = (await t.api(alice).post('/api/spaces').send({ name: 'Unread' }).expect(201))
      .body as SpaceDetail;
    const invite = (
      await t.api(alice).post(`/api/spaces/${detail.space.id}/invites`).send({}).expect(201)
    ).body as SpaceInvite;
    await t.api(bob).post(`/api/invites/${invite.code}/join`).expect(200);
    await spaceRegistryIdle();
    const general = detail.channels.find((c) => c.name === 'general')!;
    const m1 = await sendOk(t, alice, general.id, 'hello space');
    const m2 = await sendOk(t, alice, general.id, 'second');
    await t.api(bob).post(`/api/chats/${general.id}/read`).send({ seq: m2.seq }).expect(204);
    const b = await t.connect(bob);
    const lb = recordEvents(b);
    const res = await markUnread(bob, general.id, m1.id).expect(200);
    expect(res.body).toMatchObject({
      chatId: general.id,
      lastReadSeq: m1.seq - 1,
      unreadCount: 2,
      markedUnread: true,
    });
    await settle();
    expect(lb.of('chat:read').at(-1)).toMatchObject({
      chatId: general.id,
      lastReadSeq: m1.seq - 1,
    });
    expect(lb.of('chat:upsert').at(-1)?.chat).toMatchObject({
      id: general.id,
      lastReadSeq: m1.seq - 1,
    });
    const s = await summaryOf(t, bob, general.id);
    expect(s.lastSeq).toBeGreaterThan(s.lastReadSeq);
    b.disconnect();

    // Members who can't see the Space get 404.
    await markUnread(carol, general.id, m1.id).expect(404);
  });

  it('is refused to non-members (404), former members (403) and for other chats’ messages (404)', async () => {
    const g = await createGroup(alice, [bob, carol]);
    const m = await sendOk(t, alice, g, 'hello');
    const other = await createGroup(alice, [bob]);
    const elsewhere = await sendOk(t, alice, other, 'elsewhere');
    const dave = await t.createUser({ displayName: 'Dave' });

    await markUnread(dave, g, m.id).expect(404);
    await markUnread(bob, g, elsewhere.id).expect(404);
    await t.api(bob).post(`/api/chats/${g}/unread`).send({}).expect(400);
    await t.api(bob).post(`/api/chats/${g}/unread`).send({ messageId: 'nope' }).expect(400);

    await leaveGroup(g, carol);
    const former = await markUnread(carol, g, m.id).expect(403);
    expect(former.body.error.code).toBe('not_member');
  });
});
