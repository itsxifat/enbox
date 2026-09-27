import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  BIO_MAX_LENGTH,
  DEFAULT_ABOUT,
  DEFAULT_USER_SETTINGS,
  MAX_BANNER_BYTES,
  PRESENCE_NOTE_MAX_LENGTH,
  PRONOUNS_MAX_LENGTH,
  USER_RATE_LIMITS,
  type Presence,
  type UserPublic,
  type UserSelf,
  type UserSettings,
} from '@enbox/shared';
import { config } from '../../src/config.js';
import { db } from '../../src/db/index.js';
import { users } from '../../src/db/schema.js';
import { resetUserLimits } from '../../src/lib/userLimit.js';
import { transact } from '../../src/services/effects.js';
import { toChatSummary } from '../../src/services/summaries.js';
import { advanceRead } from '../../src/services/watermarks.js';
import {
  emitAck,
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
import { insertImage, newDevice, uniquePhone } from './util.js';

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

  describe('PATCH /me profile fields: banner, pronouns, bio, colours', () => {
    it('sets and clears them; colours are lowercased; omitted fields are unchanged; an empty bio is null for others', async () => {
      const u = await t.createUser();
      const viewer = await t.createUser();
      const bannerId = await uploadImage(u);
      const me = (
        await t
          .api(u)
          .patch('/api/me')
          .send({
            bannerMediaId: bannerId,
            pronouns: ' she/her ',
            bio: 'Hello\nworld',
            profileColor: '#FF8800',
            accentColor: '#00AAFF',
          })
          .expect(200)
      ).body as UserSelf;
      expect(me).toMatchObject({
        pronouns: 'she/her',
        bio: 'Hello\nworld',
        profileColor: '#ff8800',
        accentColor: '#00aaff',
        bannerAnimatedUrl: null,
      });
      expect(me.bannerUrl).toMatch(/^\/uploads\/.+\.png$/);
      const seen = (await t.api(viewer).get(`/api/users/${u.id}`).expect(200)).body as UserPublic;
      expect(seen).toMatchObject({
        bannerUrl: me.bannerUrl,
        bannerAnimatedUrl: null,
        pronouns: 'she/her',
        bio: 'Hello\nworld',
        profileColor: '#ff8800',
        accentColor: '#00aaff',
      });
      const again = (await t.api(u).patch('/api/me').send({ about: 'x' }).expect(200))
        .body as UserSelf;
      expect(again).toMatchObject({
        bannerUrl: me.bannerUrl,
        pronouns: 'she/her',
        bio: 'Hello\nworld',
        profileColor: '#ff8800',
        accentColor: '#00aaff',
      });
      const cleared = (
        await t
          .api(u)
          .patch('/api/me')
          .send({
            bannerMediaId: null,
            pronouns: '',
            bio: '',
            profileColor: null,
            accentColor: null,
          })
          .expect(200)
      ).body as UserSelf;
      expect(cleared).toMatchObject({
        bannerUrl: null,
        bannerAnimatedUrl: null,
        pronouns: null,
        bio: '',
        profileColor: null,
        accentColor: null,
      });
      const [row] = await db.select().from(users).where(eq(users.id, u.id));
      expect(row).toMatchObject({
        bannerMediaId: null,
        pronouns: null,
        bio: '',
        profileColor: null,
        accentColor: null,
      });
      expect(
        ((await t.api(viewer).get(`/api/users/${u.id}`).expect(200)).body as UserPublic).bio,
      ).toBeNull();
    });

    it('serves an animated avatar or banner as its static poster plus the animation', async () => {
      const u = await t.createUser();
      const viewer = await t.createUser();
      const avatar = await insertImage(u.id, { mimeType: 'image/gif', animated: true });
      const banner = await insertImage(u.id, { mimeType: 'image/webp', animated: true });
      const me = (
        await t
          .api(u)
          .patch('/api/me')
          .send({ avatarMediaId: avatar.id, bannerMediaId: banner.id })
          .expect(200)
      ).body as UserSelf;
      const urls = {
        avatarUrl: `/uploads/${avatar.thumbnailKey}`,
        avatarAnimatedUrl: `/uploads/${avatar.storageKey}`,
        bannerUrl: `/uploads/${banner.thumbnailKey}`,
        bannerAnimatedUrl: `/uploads/${banner.storageKey}`,
      };
      expect(me).toMatchObject(urls);
      expect((await t.api(viewer).get(`/api/users/${u.id}`).expect(200)).body).toMatchObject(urls);
    });

    it.each([
      [{ pronouns: 'x'.repeat(PRONOUNS_MAX_LENGTH + 1) }],
      [{ bio: 'x'.repeat(BIO_MAX_LENGTH + 1) }],
      [{ bio: 'bad\u0000char' }],
      [{ profileColor: 'red' }],
      [{ profileColor: '#12345' }],
      [{ profileColor: '#gggggg' }],
      [{ accentColor: 'ff8800' }],
      [{ accentColor: 'rgb(1, 2, 3)' }],
      [{ bannerMediaId: 'nope' }],
    ])('rejects %j with 400', async (body) => {
      const u = await t.createUser();
      expect((await t.api(u).patch('/api/me').send(body).expect(400)).body.error.code).toBe(
        'validation_error',
      );
    });

    it('banner: foreign → 404; a document, a too-large image or an animated upload without a poster → 400 (avatars too)', async () => {
      const u = await t.createUser();
      const other = await t.createUser();
      await t
        .api(u)
        .patch('/api/me')
        .send({ bannerMediaId: await uploadImage(other) })
        .expect(404);
      await t
        .api(u)
        .patch('/api/me')
        .send({ bannerMediaId: await uploadImage(u, 'file') })
        .expect(400);
      const huge = await insertImage(u.id, { size: MAX_BANNER_BYTES + 1 });
      await t.api(u).patch('/api/me').send({ bannerMediaId: huge.id }).expect(400);
      const noPoster = await insertImage(u.id, {
        mimeType: 'image/gif',
        animated: true,
        poster: false,
      });
      expect(
        (await t.api(u).patch('/api/me').send({ bannerMediaId: noPoster.id }).expect(400)).body
          .error.message,
      ).toMatch(/poster/);
      expect(
        (await t.api(u).patch('/api/me').send({ avatarMediaId: noPoster.id }).expect(400)).body
          .error.message,
      ).toMatch(/poster/);
      // A static GIF is a banner type but not an avatar type.
      const staticGif = await insertImage(u.id, { mimeType: 'image/gif' });
      await t.api(u).patch('/api/me').send({ avatarMediaId: staticGif.id }).expect(400);
      await t.api(u).patch('/api/me').send({ bannerMediaId: staticGif.id }).expect(200);
      const [row] = await db.select().from(users).where(eq(users.id, u.id));
      expect(row!.bannerMediaId).toBe(staticGif.id);
    });

    it('profile fields fan out me:updated and user:changed; profileUpdate is rate-limited (shared with the presence routes)', async () => {
      const alice = await t.createUser();
      const bob = await t.createUser();
      await send(alice, await createDirect(alice, bob));
      const sA = await t.connect(alice);
      const sB = await t.connect(bob);
      const updated = waitForEvent(sA, 'me:updated');
      const changed = waitForEvent(sB, 'user:changed');
      await t
        .api(alice)
        .patch('/api/me')
        .send({ bio: 'new bio', profileColor: '#000000' })
        .expect(200);
      expect((await updated).user).toMatchObject({ bio: 'new bio', profileColor: '#000000' });
      expect(await changed).toEqual({ userId: alice.id });
      config.rateLimit = true;
      try {
        resetUserLimits();
        for (let i = 0; i < USER_RATE_LIMITS.profileUpdate.limit; i++)
          await t.api(alice).patch('/api/me').send({}).expect(200);
        expect((await t.api(alice).patch('/api/me').send({}).expect(429)).body.error.code).toBe(
          'rate_limited',
        );
        await t.api(alice).put('/api/me/presence').send({ availability: 'dnd' }).expect(429);
        await t.api(alice).put('/api/me/presence-note').send({ text: 'x' }).expect(429);
        await t.api(alice).delete('/api/me/presence-note').expect(429);
      } finally {
        config.rateLimit = false;
        resetUserLimits();
      }
    });
  });

  describe('PUT /me/presence, PUT|DELETE /me/presence-note', () => {
    /** Alice with a direct-chat peer (bob) who subscribed to her presence — and must never get `user:changed`. */
    async function withPeer() {
      const alice = await t.createUser();
      const bob = await t.createUser();
      await send(alice, await createDirect(alice, bob));
      const sA = await t.connect(alice);
      const sB = await t.connect(bob);
      const bobLog = recordEvents(sB);
      await emitAck<Presence[]>(sB, 'presence:subscribe', { userIds: [alice.id] });
      return { alice, bob, sA, sB, bobLog };
    }

    it('stores the availability choice (optional until) and emits me:updated + presence:update — never user:changed', async () => {
      const { alice, sA, sB, bobLog } = await withPeer();
      const until = new Date(Date.now() + 3_600_000).toISOString();
      const updated = waitForEvent(sA, 'me:updated');
      const presence = waitForEvent(sB, 'presence:update');
      const me = (
        await t.api(alice).put('/api/me/presence').send({ availability: 'dnd', until }).expect(200)
      ).body as UserSelf;
      expect(me).toMatchObject({ availability: 'dnd', availabilityUntil: until });
      expect((await updated).user).toEqual(me);
      expect(await presence).toEqual({
        userId: alice.id,
        online: true,
        state: 'dnd',
        note: null,
        lastSeenAt: null,
      });
      // The same choice again: nothing to say.
      await t.api(alice).put('/api/me/presence').send({ availability: 'dnd', until }).expect(200);
      await expectNoEvent(sA, 'me:updated');
      // `online` drops `until`.
      const updated2 = waitForEvent(sA, 'me:updated');
      const back = (
        await t
          .api(alice)
          .put('/api/me/presence')
          .send({ availability: 'online', until })
          .expect(200)
      ).body as UserSelf;
      expect(back).toMatchObject({ availability: 'online', availabilityUntil: null });
      await updated2;
      await settle(200);
      expect(bobLog.names()).not.toContain('user:changed');
      expect(bobLog.of('presence:update').map((p) => p.state)).toEqual(['dnd', 'online']);
    });

    it.each([
      [{}],
      [{ availability: 'busy' }],
      [{ availability: 'dnd', until: 'tomorrow' }],
      [{ availability: 'dnd', until: '0000-01-01T00:00:00Z' }],
    ])('PUT /me/presence rejects %j with 400', async (body) => {
      const u = await t.createUser();
      expect((await t.api(u).put('/api/me/presence').send(body).expect(400)).body.error.code).toBe(
        'validation_error',
      );
    });

    it('replaces, validates and clears the presence note; me:updated + presence:update only — never user:changed', async () => {
      const { alice, sA, sB, bobLog } = await withPeer();
      const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
      let updated = waitForEvent(sA, 'me:updated');
      const presence = waitForEvent(sB, 'presence:update');
      const me = (
        await t
          .api(alice)
          .put('/api/me/presence-note')
          .send({ text: '  Out for lunch ', emoji: '🍜', expiresAt })
          .expect(200)
      ).body as UserSelf;
      expect(me.presenceNote).toEqual({ text: 'Out for lunch', emoji: '🍜', expiresAt });
      expect((await updated).user).toEqual(me);
      expect((await presence).note).toEqual(me.presenceNote);
      // PUT replaces the whole note (omitted fields become null).
      updated = waitForEvent(sA, 'me:updated');
      const emojiOnly = (
        await t.api(alice).put('/api/me/presence-note').send({ emoji: '🎧' }).expect(200)
      ).body as UserSelf;
      expect(emojiOnly.presenceNote).toEqual({ text: null, emoji: '🎧', expiresAt: null });
      await updated;
      // The same note again: silent.
      await t.api(alice).put('/api/me/presence-note').send({ emoji: '🎧' }).expect(200);
      await expectNoEvent(sA, 'me:updated');
      for (const body of [
        {},
        { text: '  ' },
        { text: 'x'.repeat(PRESENCE_NOTE_MAX_LENGTH + 1) },
        { emoji: 'ab' },
        { text: 'x', expiresAt: 'soon' },
      ])
        expect(
          (await t.api(alice).put('/api/me/presence-note').send(body).expect(400)).body.error.code,
        ).toBe('validation_error');
      // An already-expired note is stored but never shown.
      updated = waitForEvent(sA, 'me:updated');
      expect(
        (
          (
            await t
              .api(alice)
              .put('/api/me/presence-note')
              .send({ text: 'stale', expiresAt: new Date(Date.now() - 1000).toISOString() })
              .expect(200)
          ).body as UserSelf
        ).presenceNote,
      ).toBeNull();
      await updated;
      // DELETE clears it; a second DELETE emits nothing.
      updated = waitForEvent(sA, 'me:updated');
      expect(
        ((await t.api(alice).delete('/api/me/presence-note').expect(200)).body as UserSelf)
          .presenceNote,
      ).toBeNull();
      await updated;
      const [row] = await db.select().from(users).where(eq(users.id, alice.id));
      expect(row).toMatchObject({
        presenceNoteText: null,
        presenceNoteEmoji: null,
        presenceNoteExpiresAt: null,
      });
      await t.api(alice).delete('/api/me/presence-note').expect(200);
      await expectNoEvent(sA, 'me:updated');
      expect(bobLog.names()).not.toContain('user:changed');
      expect(bobLog.of('presence:update').map((p) => p.note)).toEqual([
        { text: 'Out for lunch', emoji: '🍜', expiresAt },
        { text: null, emoji: '🎧', expiresAt: null },
        null,
      ]);
    });
  });
});
