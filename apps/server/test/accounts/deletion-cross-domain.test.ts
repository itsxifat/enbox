/**
 * Account deletion across every domain at once (docs "Accounts, sessions and deletion"),
 * and its lock order (every chat row locked in ONE sorted batch — review finding F3 / C6b).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { Community } from '@enbox/shared';
import { db } from '../../src/db/index.js';
import { chatMembers, communityMembers, statuses } from '../../src/db/schema.js';
import { logger } from '../../src/lib/logger.js';
import { resetCallState } from '../../src/modules/calls/state.js';
import { startTestServer, type TestServer } from '../helpers.js';
import { ackCall, callRow, partOf, until } from '../calls/helpers.js';
import { systemKinds } from '../groups/util.js';
import { createGroup, memberRow, recordEvents, settle } from '../services/fixtures.js';
import { recordChatLocks } from '../support/db-hooks.js';

describe('DELETE /me across domains', () => {
  let t: TestServer;

  beforeAll(async () => {
    t = await startTestServer();
  });
  afterAll(async () => {
    resetCallState();
    await t.close();
  });

  it('community owner + channel owner + linked group + live group call + status: succession, handover, call leave, status:deleted, no errors', async () => {
    const [u, a, b, c] = [
      await t.createUser(),
      await t.createUser(),
      await t.createUser(),
      await t.createUser(),
    ];

    // Community owned by u: a is admin, b member; linked group L created by u with a and b.
    const community = (await t.api(u).post('/api/communities').send({ name: 'K' }).expect(201))
      .body as Community;
    await t
      .api(u)
      .post(`/api/communities/${community.id}/members`)
      .send({ userIds: [a.id, b.id] })
      .expect(200);
    await t
      .api(u)
      .put(`/api/communities/${community.id}/members/${a.id}/role`)
      .send({ role: 'admin' })
      .expect(204);
    const linked = (
      (
        await t
          .api(u)
          .post(`/api/communities/${community.id}/groups`)
          .send({ name: 'L', memberIds: [a.id, b.id] })
          .expect(201)
      ).body as { chat: { id: string } }
    ).chat.id;
    const ann = community.announcementChatId;
    const annKindsBefore = await systemKinds(ann);

    // Channel owned by u with admin c (and b following).
    const channel = (
      (await t.api(u).post('/api/channels').send({ name: 'Ch' }).expect(201)).body as { id: string }
    ).id;
    await t.api(c).put(`/api/channels/${channel}/follow`).expect(200);
    await t.api(b).put(`/api/channels/${channel}/follow`).expect(200);
    await t
      .api(u)
      .put(`/api/channels/${channel}/admins/${c.id}`)
      .expect((r) => expect(r.status).toBeLessThan(300));

    // A status for u's contacts a and b.
    await t.api(u).post('/api/contacts').send({ userId: a.id }).expect(201);
    await t.api(u).post('/api/contacts').send({ userId: b.id }).expect(201);
    const status = (
      await t.api(u).post('/api/status').send({ type: 'text', text: 'bye soon' }).expect(201)
    ).body as { id: string };

    // A live group call in L: u and a joined, b still ringing.
    const su = await t.connect(u);
    const sa = await t.connect(a);
    const sb = await t.connect(b);
    const sc = await t.connect(c);
    const [ra, rb, rc] = [recordEvents(sa), recordEvents(sb), recordEvents(sc)];
    const call = await ackCall(su, 'call:start', {
      chatId: linked,
      type: 'audio',
      userIds: [a.id, b.id],
    });
    await until(
      () => ra.of('call:incoming').length === 1 && rb.of('call:incoming').length === 1,
      3000,
      'incoming',
    );
    await ackCall(sa, 'call:accept', { callId: call.id });
    await settle(200);
    [ra, rb, rc].forEach((r) => r.clear());

    const errors = vi.spyOn(logger, 'error');
    const locks = recordChatLocks();
    try {
      await t.api(u).delete('/api/me').send({ password: u.password }).expect(204);
    } finally {
      locks.restore();
    }
    await settle(400);

    // No error was logged anywhere (post-commit steps, hooks, listeners).
    expect(errors.mock.calls).toEqual([]);
    errors.mockRestore();
    // Every chat row was locked in globally sorted order.
    expect(locks.violations()).toEqual([]);

    // Community: the admin a succeeds as owner; u is gone; the community lives on.
    const roles = await db
      .select()
      .from(communityMembers)
      .where(eq(communityMembers.communityId, community.id));
    expect(Object.fromEntries(roles.map((r) => [r.userId, r.role]))).toEqual({
      [a.id]: 'owner',
      [b.id]: 'member',
    });
    expect((await memberRow(ann, a)).role).toBe('owner');
    expect(
      ra
        .of('community:upsert')
        .some((p) => p.community.id === community.id && p.community.myRole === 'owner'),
    ).toBe(true);
    // The announcement group gets no join/leave messages; u's row is left and hidden.
    expect(await systemKinds(ann)).toEqual(annKindsBefore);
    const annRow = await memberRow(ann, u);
    expect({ left: !!annRow.leftAt, hidden: annRow.hidden }).toEqual({ left: true, hidden: true });

    // Linked group: u left (member_left) and ownership passed on (owner_changed).
    const lKinds = await systemKinds(linked);
    expect(lKinds.slice(-2)).toEqual(['member_left', 'owner_changed']);
    expect((await memberRow(linked, u)).leftAt).not.toBeNull();
    const lOwners = await db
      .select({ userId: chatMembers.userId })
      .from(chatMembers)
      .where(and(eq(chatMembers.chatId, linked), eq(chatMembers.role, 'owner')));
    expect(lOwners.map((o) => o.userId)).toEqual([
      expect.stringMatching(new RegExp(`^(${a.id}|${b.id})$`)),
    ]);

    // Channel: handed over to the admin c; u's follower row is gone; the channel lives on.
    expect((await memberRow(channel, c)).role).toBe('owner');
    expect(
      await db
        .select()
        .from(chatMembers)
        .where(and(eq(chatMembers.chatId, channel), eq(chatMembers.userId, u.id))),
    ).toEqual([]);
    expect(
      rc.of('chat:upsert').some((p) => p.chat.id === channel && p.chat.myRole === 'owner'),
    ).toBe(true);

    // Call: u was forced out; a is still in (b is still ringing), and learned about it.
    expect((await partOf(call.id, u.id)).status).toBe('left');
    expect((await callRow(call.id)).status).toBe('ongoing');
    expect(ra.of('call:participant-left')).toEqual([{ callId: call.id, userId: u.id }]);

    // Status: deleted, and its audience was told.
    expect(await db.select().from(statuses).where(eq(statuses.id, status.id))).toEqual([]);
    for (const r of [ra, rb])
      expect(r.of('status:deleted')).toEqual([{ statusId: status.id, userId: u.id }]);

    [sa, sb, sc].forEach((s) => s.disconnect());
  });

  it('locks every chat it may touch in one sorted batch — linked groups the user never joined included (F3 / C6b)', async () => {
    const [owner, u] = [await t.createUser(), await t.createUser()];
    const cGroup = await createGroup(owner, [u], { name: 'C' });
    // A group u is NOT in whose id sorts below C: it must be locked before C.
    let lGroup = await createGroup(owner, [], { name: 'L' });
    for (let i = 0; i < 40 && lGroup > cGroup; i++)
      lGroup = await createGroup(owner, [], { name: 'L' });
    expect(lGroup < cGroup).toBe(true);
    const community = (
      await t
        .api(owner)
        .post('/api/communities')
        .send({ name: 'K2', groupIds: [cGroup, lGroup] })
        .expect(201)
    ).body as Community;
    expect(community.groups.map((x) => x.chatId)).toEqual(expect.arrayContaining([cGroup, lGroup]));

    const locks = recordChatLocks();
    try {
      await t.api(u).delete('/api/me').send({ password: u.password }).expect(204);
    } finally {
      locks.restore();
    }
    expect(locks.held().has(lGroup)).toBe(true);
    expect(locks.violations()).toEqual([]);
  });
});
