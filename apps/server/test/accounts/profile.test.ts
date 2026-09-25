import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  DEFAULT_ABOUT,
  DEFAULT_USER_SETTINGS,
  type UserSelf,
  type UserSettings,
} from '@enbox/shared';
import { db } from '../../src/db/index.js';
import { users } from '../../src/db/schema.js';
import { transact } from '../../src/services/effects.js';
import { toChatSummary } from '../../src/services/summaries.js';
import { advanceRead } from '../../src/services/watermarks.js';
import {
  expectNoEvent,
  startTestServer,
  waitForEvent,
  type TestServer,
  type TestSocket,
  type TestUser,
} from '../helpers.js';
import {
  createChannel,
  createDirect,
  createGroup,
  recordEvents,
  saveContact,
  send,
  settle,
} from '../services/fixtures.js';
import { newDevice, uniquePhone } from './util.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

describe('profile: GET/PATCH /me, PATCH /me/settings', () => {
  let t: TestServer;

  beforeAll(async () => {
    t = await startTestServer();
  });
  afterAll(() => t.close());

  async function uploadImage(user: TestUser, kind: 'image' | 'file' = 'image'): Promise<string> {
    const res = await t
      .api(user)
      .post('/api/media')
      .field('kind', kind)
      .attach('file', PNG, { filename: 'a.png', contentType: 'image/png' })
      .expect(201);
    return res.body.id as string;
  }

  describe('GET /me and PATCH /me', () => {
    it('returns my own profile with complete settings', async () => {
      const u = await t.createUser({ displayName: 'Me Myself', phone: uniquePhone() });
      const me = (await t.api(u).get('/api/me').expect(200)).body as UserSelf;
      expect(me).toMatchObject({
        id: u.id,
        username: u.username,
        displayName: 'Me Myself',
        about: DEFAULT_ABOUT,
        avatarUrl: null,
        settings: DEFAULT_USER_SETTINGS,
      });
      expect(me.phone).toMatch(/^\+1555/);
    });

    it('updates display name, about, username, phone and avatar; omitted fields are unchanged', async () => {
      const u = await t.createUser({ displayName: 'Before' });
      const mediaId = await uploadImage(u);
      const phone = uniquePhone();
      const res = await t
        .api(u)
        .patch('/api/me')
        .send({
          displayName: '  After ',
          about: 'Busy',
          username: 'New_Name1',
          phone: phone.replace('+1', '+1 '),
          avatarMediaId: mediaId,
        })
        .expect(200);
      const me = res.body as UserSelf;
      expect(me).toMatchObject({
        displayName: 'After',
        about: 'Busy',
        username: 'new_name1',
        phone,
      });
      expect(me.avatarUrl).toMatch(/^\/uploads\/.+\.png$/);
      const again = (await t.api(u).patch('/api/me').send({ about: '' }).expect(200))
        .body as UserSelf;
      expect(again).toMatchObject({
        displayName: 'After',
        about: '',
        username: 'new_name1',
        phone,
        avatarUrl: me.avatarUrl,
      });
      // null / '' remove the phone and the avatar
      const cleared = (
        await t.api(u).patch('/api/me').send({ phone: '', avatarMediaId: null }).expect(200)
      ).body as UserSelf;
      expect(cleared).toMatchObject({ phone: null, avatarUrl: null });
      const [row] = await db.select().from(users).where(eq(users.id, u.id));
      expect(row!.avatarMediaId).toBeNull();
    });

    it('rejects taken usernames/phones (409), reserved or invalid values (400) and foreign or non-image avatars', async () => {
      const taken = await t.createUser({ username: 'taken_name', phone: uniquePhone() });
      const [takenRow] = await db.select().from(users).where(eq(users.id, taken.id));
      const u = await t.createUser();
      expect(
        (await t.api(u).patch('/api/me').send({ username: 'TAKEN_NAME' }).expect(409)).body.error
          .code,
      ).toBe('conflict');
      expect(
        (await t.api(u).patch('/api/me').send({ phone: takenRow!.phone }).expect(409)).body.error
          .code,
      ).toBe('conflict');
      await t.api(u).patch('/api/me').send({ username: 'deleted_me' }).expect(400);
      await t.api(u).patch('/api/me').send({ username: '1234' }).expect(400);
      await t.api(u).patch('/api/me').send({ displayName: '' }).expect(400);
      await t
        .api(u)
        .patch('/api/me')
        .send({ about: 'x'.repeat(141) })
        .expect(400);
      await t.api(u).patch('/api/me').send({ phone: 'call me' }).expect(400);
      await t.api(u).patch('/api/me').send({ avatarMediaId: 'nope' }).expect(400);
      const foreign = await uploadImage(taken);
      await t.api(u).patch('/api/me').send({ avatarMediaId: foreign }).expect(404);
      const doc = await uploadImage(u, 'file');
      await t.api(u).patch('/api/me').send({ avatarMediaId: doc }).expect(400);
      // Keeping my own username/phone is not a conflict.
      await t
        .api(taken)
        .patch('/api/me')
        .send({ username: 'taken_name', phone: takenRow!.phone })
        .expect(200);
    });

    it('emits me:updated → my devices and user:changed once per socket to my direct/group chats and to users who saved me (not channels)', async () => {
      const alice = await t.createUser({ displayName: 'Alice' });
      const aliceTablet = await newDevice(alice, 'Tablet');
      const bob = await t.createUser(); // direct chat
      const carol = await t.createUser(); // group
      const dave = await t.createUser(); // saved alice, no chat
      const erin = await t.createUser(); // follows alice's channel only
      const frank = await t.createUser(); // unrelated
      const gina = await t.createUser(); // direct + group + saved alice
      const direct = await createDirect(alice, bob);
      await send(alice, direct);
      const direct2 = await createDirect(gina, alice);
      await send(gina, direct2);
      await createGroup(alice, [carol, gina]);
      await createChannel(alice, { admins: [erin] });
      await saveContact(dave, alice);
      await saveContact(gina, alice);

      const [sA, sA2, sBob, sCarol, sDave, sErin, sFrank, sGina] = await Promise.all(
        [alice, aliceTablet, bob, carol, dave, erin, frank, gina].map((u) => t.connect(u)),
      );
      const logs = new Map<TestSocket, ReturnType<typeof recordEvents>>(
        [sA, sA2, sBob, sCarol, sDave, sErin, sFrank, sGina].map((s) => [s, recordEvents(s)]),
      );
      const res = await t
        .api(alice)
        .patch('/api/me')
        .send({ displayName: 'Alice Cooper' })
        .expect(200);
      await settle(250);
      for (const s of [sA, sA2])
        expect(logs.get(s)!.of('me:updated')).toEqual([{ user: res.body }]);
      for (const s of [sBob, sCarol, sDave, sGina])
        expect(logs.get(s)!.of('user:changed')).toEqual([{ userId: alice.id }]);
      for (const s of [sErin, sFrank]) expect(logs.get(s)!.names()).not.toContain('user:changed');
      for (const s of [sBob, sFrank]) expect(logs.get(s)!.names()).not.toContain('me:updated');
      // What they refetch reflects the change.
      const seen = await t
        .api(bob)
        .post('/api/users/batch')
        .send({ userIds: [alice.id] })
        .expect(200);
      expect(seen.body[0].displayName).toBe('Alice Cooper');
    });

    it('emits nothing when nothing changed', async () => {
      const u = await t.createUser({ displayName: 'Same' });
      const s = await t.connect(u);
      await t.api(u).patch('/api/me').send({ displayName: 'Same' }).expect(200);
      await t.api(u).patch('/api/me').send({}).expect(200);
      await expectNoEvent(s, 'me:updated');
    });
  });

  describe('PATCH /me/settings', () => {
    it('merges partial updates and returns the complete settings', async () => {
      const u = await t.createUser();
      const first = (
        await t
          .api(u)
          .patch('/api/me/settings')
          .send({ lastSeenVisibility: 'contacts', readReceipts: false })
          .expect(200)
      ).body as UserSettings;
      expect(first).toEqual({
        ...DEFAULT_USER_SETTINGS,
        lastSeenVisibility: 'contacts',
        readReceipts: false,
      });
      const second = (
        await t
          .api(u)
          .patch('/api/me/settings')
          .send({ defaultDisappearingSeconds: 86_400, notificationPreviews: false })
          .expect(200)
      ).body as UserSettings;
      expect(second).toEqual({
        ...first,
        defaultDisappearingSeconds: 86_400,
        notificationPreviews: false,
      });
      expect(((await t.api(u).get('/api/me').expect(200)).body as UserSelf).settings).toEqual(
        second,
      );
      // Stored as overrides only.
      const [row] = await db.select().from(users).where(eq(users.id, u.id));
      expect(row!.settings).toEqual({
        lastSeenVisibility: 'contacts',
        readReceipts: false,
        defaultDisappearingSeconds: 86_400,
        notificationPreviews: false,
      });
    });

    it.each([
      [{ lastSeenVisibility: 'friends' }],
      [{ onlineVisibility: 'contacts' }],
      [{ readReceipts: 'yes' }],
      [{ defaultDisappearingSeconds: 5 }],
      [{ statusExcludeUserIds: ['not-a-uuid'] }],
    ])('rejects %j with 400', async (body) => {
      const u = await t.createUser();
      expect(
        (await t.api(u).patch('/api/me/settings').send(body).expect(400)).body.error.code,
      ).toBe('validation_error');
    });

    it('keeps only my contacts in the status privacy lists (deduplicated)', async () => {
      const u = await t.createUser();
      const friend = await t.createUser();
      const stranger = await t.createUser();
      await saveContact(u, friend);
      const res = await t
        .api(u)
        .patch('/api/me/settings')
        .send({
          statusPrivacy: 'contacts_except',
          statusExcludeUserIds: [friend.id, stranger.id, friend.id.toUpperCase()],
          statusOnlyShareWithUserIds: [stranger.id],
        })
        .expect(200);
      expect(res.body).toMatchObject({
        statusPrivacy: 'contacts_except',
        statusExcludeUserIds: [friend.id],
        statusOnlyShareWithUserIds: [],
      });
    });

    it('emits me:updated to all my devices only on a real change', async () => {
      const u = await t.createUser();
      const other = await newDevice(u);
      const s1 = await t.connect(u);
      const s2 = await t.connect(other);
      const e1 = waitForEvent(s1, 'me:updated');
      const e2 = waitForEvent(s2, 'me:updated');
      await t
        .api(u)
        .patch('/api/me/settings')
        .send({ groupsAddPermission: 'contacts' })
        .expect(200);
      expect((await e1).user.settings.groupsAddPermission).toBe('contacts');
      expect((await e2).user.settings.groupsAddPermission).toBe('contacts');
      await t
        .api(u)
        .patch('/api/me/settings')
        .send({ groupsAddPermission: 'contacts' })
        .expect(200);
      await expectNoEvent(s2, 'me:updated');
    });

    it('turning read receipts off/on recomputes direct-chat read watermarks for me and the peer', async () => {
      const alice = await t.createUser();
      const bob = await t.createUser();
      const chatId = await createDirect(alice, bob);
      await send(alice, chatId, 'hi bob');
      await send(bob, chatId, 'hi alice');
      await transact((tx, fx) => advanceRead(tx, fx, { chatId, userId: alice.id, seq: 2 }));
      await transact((tx, fx) => advanceRead(tx, fx, { chatId, userId: bob.id, seq: 2 }));
      const sA = await t.connect(alice);
      const sB = await t.connect(bob);
      const wa = waitForEvent(sA, 'chat:watermarks');
      const wb = waitForEvent(sB, 'chat:watermarks');
      await t.api(alice).patch('/api/me/settings').send({ readReceipts: false }).expect(200);
      expect(await wa).toEqual({ chatId, readWatermark: 0, deliveredWatermark: 2 });
      expect(await wb).toEqual({ chatId, readWatermark: 0, deliveredWatermark: 2 });
      expect((await toChatSummary(db, bob.id, chatId))!.readWatermark).toBe(0);

      const wa2 = waitForEvent(sA, 'chat:watermarks');
      const wb2 = waitForEvent(sB, 'chat:watermarks');
      await t.api(alice).patch('/api/me/settings').send({ readReceipts: true }).expect(200);
      expect(await wa2).toEqual({ chatId, readWatermark: 2, deliveredWatermark: 2 });
      expect(await wb2).toEqual({ chatId, readWatermark: 2, deliveredWatermark: 2 });
      // Other settings leave watermarks alone.
      await t
        .api(alice)
        .patch('/api/me/settings')
        .send({ aboutVisibility: 'contacts' })
        .expect(200);
      await expectNoEvent(sB, 'chat:watermarks');
    });

    it('hiding my profile photo or about tells others to refetch me (user:changed)', async () => {
      const alice = await t.createUser();
      const bob = await t.createUser();
      await send(alice, await createDirect(alice, bob));
      const sB = await t.connect(bob);
      const changed = waitForEvent(sB, 'user:changed');
      await t
        .api(alice)
        .patch('/api/me/settings')
        .send({ profilePhotoVisibility: 'nobody' })
        .expect(200);
      expect(await changed).toEqual({ userId: alice.id });
      await t
        .api(alice)
        .patch('/api/me/settings')
        .send({ messageNotifications: false })
        .expect(200);
      await expectNoEvent(sB, 'user:changed');
    });
  });
});
