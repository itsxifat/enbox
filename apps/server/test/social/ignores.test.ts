/**
 * Ignore (W7-F): the list and its limits, `ignores:changed` to my devices only (the ignored
 * user is never told), cleanup on account deletion, and no pushes from ignored senders in
 * DMs, groups and Space mentions.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, or } from 'drizzle-orm';
import {
  MAX_IGNORED_USERS,
  mentionToken,
  type PushPayload,
  type SpaceDetail,
  type SpaceInvite,
  type UserPublic,
} from '@enbox/shared';
import { db } from '../../src/db/index.js';
import { pushSubscriptions, userIgnores } from '../../src/db/schema.js';
import { pushIdle, setPushSender, type PushTarget } from '../../src/modules/push/sender.js';
import { silencedRecipients } from '../../src/modules/ignores/service.js';
import { spaceRegistryIdle } from '../../src/realtime/spaceRegistry.js';
import {
  expectNoEvent,
  startTestServer,
  waitForEvent,
  type TestServer,
  type TestUser,
} from '../helpers.js';
import { block, createDirect, createGroup, saveContact, send } from '../services/fixtures.js';
import { bulkUsers } from '../groups/util.js';
import { newDevice } from '../accounts/util.js';

describe('ignore', () => {
  let t: TestServer;
  let pushes: { endpoint: string; payload: PushPayload }[];
  let endpoints = 0;

  beforeAll(async () => {
    t = await startTestServer();
    setPushSender(async (target: PushTarget, payload: PushPayload) => {
      pushes.push({ endpoint: target.endpoint, payload });
    });
  });
  afterAll(async () => {
    setPushSender(undefined);
    await t.close();
  });
  beforeEach(() => {
    pushes = [];
  });

  const ignore = (me: TestUser, other: { id: string }) =>
    t.api(me).put(`/api/users/${other.id}/ignore`);
  const unignore = (me: TestUser, other: { id: string }) =>
    t.api(me).delete(`/api/users/${other.id}/ignore`);
  const list = async (me: TestUser) =>
    ((await t.api(me).get('/api/me/ignores').expect(200)).body as UserPublic[]).map((u) => u.id);

  async function subscribe(user: TestUser): Promise<string> {
    const endpoint = `https://fcm.googleapis.com/fcm/send/ignore-${++endpoints}`;
    await t
      .api(user)
      .post('/api/push/subscriptions')
      .send({ endpoint, keys: { p256dh: 'BPublicKey', auth: 'authSecret' } })
      .expect(204);
    return endpoint;
  }
  const to = (endpoint: string) => pushes.filter((p) => p.endpoint === endpoint);

  describe('the list', () => {
    it('PUT adds (newest first), is idempotent, DELETE removes; GET lists my view of them', async () => {
      const me = await t.createUser();
      const a = await t.createUser({ displayName: 'Alpha' });
      const b = await t.createUser({ displayName: 'Beta' });
      await ignore(me, a).expect(204);
      await ignore(me, b).expect(204);
      await ignore(me, a).expect(204);
      const users = (await t.api(me).get('/api/me/ignores').expect(200)).body as UserPublic[];
      expect(users.map((u) => [u.id, u.displayName])).toEqual([
        [b.id, 'Beta'],
        [a.id, 'Alpha'],
      ]);
      await unignore(me, b).expect(204);
      await unignore(me, b).expect(204);
      expect(await list(me)).toEqual([a.id]);
      // One-way: nothing changes on their side.
      expect(await list(a)).toEqual([]);
    });

    it('refuses myself (400), unknown or deleted users (404) and bad ids (400)', async () => {
      const me = await t.createUser();
      await ignore(me, me).expect(400);
      await ignore(me, { id: crypto.randomUUID() }).expect(404);
      await t.api(me).put('/api/users/nope/ignore').expect(400);
      await unignore(me, { id: crypto.randomUUID() }).expect(404);
      const gone = await t.createUser();
      await t.api(gone).delete('/api/me').send({ password: gone.password }).expect(204);
      await ignore(me, gone).expect(404);
    });

    it(`caps the list at ${MAX_IGNORED_USERS}`, async () => {
      const me = await t.createUser();
      const ids = await bulkUsers(MAX_IGNORED_USERS);
      await db.insert(userIgnores).values(ids.map((ignoredId) => ({ userId: me.id, ignoredId })));
      const extra = await t.createUser();
      const res = await ignore(me, extra).expect(409);
      expect(res.body.error.code).toBe('limit_reached');
      // Already on the list: still fine.
      await ignore(me, { id: ids[0]! }).expect(204);
      await unignore(me, { id: ids[0]! }).expect(204);
      await ignore(me, extra).expect(204);
    });

    it('ignores:changed carries my whole list to all my devices; the ignored user hears nothing', async () => {
      const me = await t.createUser();
      const tablet = await newDevice(me, 'Tablet');
      const other = await t.createUser();
      const third = await t.createUser();
      const [s1, s2, sOther] = await Promise.all([
        t.connect(me),
        t.connect(tablet),
        t.connect(other),
      ]);
      const e1 = waitForEvent(s1, 'ignores:changed');
      const e2 = waitForEvent(s2, 'ignores:changed');
      await ignore(me, other).expect(204);
      expect(await e1).toEqual({ userIds: [other.id] });
      expect(await e2).toEqual({ userIds: [other.id] });
      const e3 = waitForEvent(s1, 'ignores:changed');
      await ignore(me, third).expect(204);
      expect(await e3).toEqual({ userIds: [third.id, other.id] });
      // No-ops emit nothing.
      await ignore(me, third).expect(204);
      await expectNoEvent(s1, 'ignores:changed');
      const e4 = waitForEvent(s2, 'ignores:changed');
      await unignore(me, other).expect(204);
      expect(await e4).toEqual({ userIds: [third.id] });
      await expectNoEvent(sOther, 'ignores:changed', 100);
      await expectNoEvent(sOther, 'user:changed', 100);
    });

    it('account deletion removes the rows on both sides', async () => {
      const a = await t.createUser();
      const b = await t.createUser();
      await ignore(a, b).expect(204);
      await ignore(b, a).expect(204);
      await t.api(b).delete('/api/me').send({ password: b.password }).expect(204);
      const rows = await db
        .select()
        .from(userIgnores)
        .where(or(eq(userIgnores.userId, b.id), eq(userIgnores.ignoredId, b.id)));
      expect(rows).toEqual([]);
      expect(await list(a)).toEqual([]);
    });
  });

  describe('pushes', () => {
    it('silencedRecipients: those who ignore or blocked the sender, in one query', async () => {
      const sender = await t.createUser();
      const [ig, bl, plain] = [await t.createUser(), await t.createUser(), await t.createUser()];
      await ignore(ig, sender).expect(204);
      await block(bl, sender);
      const out = await silencedRecipients(db, sender.id, [ig.id, bl.id, plain.id, sender.id]);
      expect([...out].sort()).toEqual([ig.id, bl.id].sort());
      expect(await silencedRecipients(db, sender.id, [])).toEqual(new Set());
    });

    it('DMs: no push from someone I ignore, until I unignore them', async () => {
      const me = await t.createUser({ displayName: 'Me' });
      const pest = await t.createUser({ displayName: 'Pest' });
      await saveContact(me, pest);
      await saveContact(pest, me);
      const chat = await createDirect(pest, me);
      const ep = await subscribe(me);
      await ignore(me, pest).expect(204);
      await send(pest, chat, 'hello?');
      await pushIdle();
      expect(to(ep)).toEqual([]);
      await unignore(me, pest).expect(204);
      await send(pest, chat, 'hello again');
      await pushIdle();
      expect(to(ep).map((p) => p.payload.body)).toEqual(['hello again']);
    });

    it('groups: the ignoring (or blocking) member gets no push; the others still do', async () => {
      const [me, pest, friend, blocker] = [
        await t.createUser(),
        await t.createUser({ displayName: 'Pest' }),
        await t.createUser(),
        await t.createUser(),
      ];
      const group = await createGroup(pest, [me, friend, blocker], { name: 'Club' });
      const [epMe, epFriend, epBlocker] = [
        await subscribe(me),
        await subscribe(friend),
        await subscribe(blocker),
      ];
      await ignore(me, pest).expect(204);
      await block(blocker, pest);
      await pushIdle();
      pushes = [];
      await send(pest, group, `hey ${mentionToken(me.id)}`);
      await pushIdle();
      expect(to(epMe)).toEqual([]);
      expect(to(epBlocker)).toEqual([]);
      expect(to(epFriend).map((p) => p.payload.body)).toEqual([
        expect.stringContaining('Pest: hey'),
      ]);
    });

    it('Spaces: a mention from someone I ignore sends no push; from others it does', async () => {
      const [owner, me, pest] = [
        await t.createUser({ displayName: 'Owner' }),
        await t.createUser({ displayName: 'Me' }),
        await t.createUser({ displayName: 'Pest' }),
      ];
      const detail = (await t.api(owner).post('/api/spaces').send({ name: 'Quiet' }).expect(201))
        .body as SpaceDetail;
      const invite = (
        await t.api(owner).post(`/api/spaces/${detail.space.id}/invites`).send({}).expect(201)
      ).body as SpaceInvite;
      for (const u of [me, pest])
        await t.api(u).post(`/api/invites/${invite.code}/join`).expect(200);
      await spaceRegistryIdle();
      const general = detail.channels.find((c) => c.name === 'general')!;
      const ep = await subscribe(me);
      await ignore(me, pest).expect(204);
      const mention = (u: TestUser, text: string) =>
        t
          .api(u)
          .post(`/api/chats/${general.id}/messages`)
          .send({ clientId: crypto.randomUUID(), type: 'text', text: `${text} @{${me.id}}` })
          .expect(201);
      await mention(pest, 'psst');
      await pushIdle();
      expect(to(ep)).toEqual([]);
      await mention(owner, 'welcome');
      await pushIdle();
      expect(to(ep).map((p) => p.payload.body)).toEqual([expect.stringContaining('welcome')]);
      await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.endpoint, ep)));
    });
  });
});
