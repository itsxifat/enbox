import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_USERS_BATCH, USER_RATE_LIMITS, USER_SEARCH_LIMIT, type ChatSummary, type Presence, type UserPublic } from '@enbox/shared';
import { config } from '../../src/config.js';
import { resetUserLimits } from '../../src/lib/userLimit.js';
import { transact } from '../../src/services/effects.js';
import { upsertMembership } from '../../src/services/membership.js';
import { expectNoEvent, startTestServer, type TestServer, type TestUser } from '../helpers.js';
import { block, createChannel, createCommunity, createDirect, createGroup, goOffline, saveContact, setSettings } from '../services/fixtures.js';
import { giveProfile, uniquePhone } from './util.js';

describe('users: profiles, lookups, search, common groups', () => {
  let t: TestServer;
  let viewer: TestUser;

  beforeAll(async () => {
    t = await startTestServer();
    viewer = await t.createUser({ displayName: 'Viewer' });
  });
  afterAll(() => t.close());

  const getUser = async (as: TestUser, id: string) => (await t.api(as).get(`/api/users/${id}`).expect(200)).body as UserPublic;
  const search = async (as: TestUser, q: string) => ((await t.api(as).get('/api/users/search').query({ q }).expect(200)).body as UserPublic[]).map((u) => u.id);

  describe('GET /users/:userId privacy', () => {
    async function subject(settings: Record<string, unknown> = {}) {
      const u = await t.createUser({ displayName: 'Subject', phone: uniquePhone() });
      const avatarUrl = await giveProfile(u.id, { about: 'hello there' });
      if (Object.keys(settings).length) await setSettings(u, settings);
      return { u, avatarUrl };
    }

    it('everyone (defaults): profile and presence visible, phone hidden unless the subject saved me', async () => {
      const { u, avatarUrl } = await subject();
      const p = await getUser(viewer, u.id);
      expect(p).toEqual({
        id: u.id,
        username: u.username,
        displayName: 'Subject',
        avatarUrl,
        about: 'hello there',
        phone: null,
        online: false,
        lastSeenAt: '2026-01-01T00:00:00.000Z',
        isContact: false,
        contactName: null,
        isBlocked: false,
        isDeleted: false,
      });
      await saveContact(u, viewer);
      expect((await getUser(viewer, u.id)).phone).toMatch(/^\+1555/);
    });

    it("'contacts' levels depend on whether the SUBJECT saved me", async () => {
      const { u, avatarUrl } = await subject({ profilePhotoVisibility: 'contacts', aboutVisibility: 'contacts', lastSeenVisibility: 'contacts', onlineVisibility: 'same_as_last_seen' });
      expect(await getUser(viewer, u.id)).toMatchObject({ avatarUrl: null, about: null, phone: null, online: null, lastSeenAt: null });
      // Me saving them changes nothing (no reciprocity) but shows my saved name.
      await saveContact(viewer, u, 'Sub');
      expect(await getUser(viewer, u.id)).toMatchObject({ avatarUrl: null, about: null, online: null, isContact: true, contactName: 'Sub' });
      await saveContact(u, viewer);
      expect(await getUser(viewer, u.id)).toMatchObject({ avatarUrl, about: 'hello there', online: false, lastSeenAt: '2026-01-01T00:00:00.000Z' });
    });

    it("onlineVisibility 'everyone' shows online even when last seen is hidden", async () => {
      const { u } = await subject({ lastSeenVisibility: 'nobody', onlineVisibility: 'everyone' });
      expect(await getUser(viewer, u.id)).toMatchObject({ online: false, lastSeenAt: null });
      const s = await t.connect(u);
      expect(await getUser(viewer, u.id)).toMatchObject({ online: true, lastSeenAt: null });
      await goOffline(u, s);
    });

    it("'nobody' hides everything even from contacts; I always see myself", async () => {
      const { u, avatarUrl } = await subject({ profilePhotoVisibility: 'nobody', aboutVisibility: 'nobody', lastSeenVisibility: 'nobody', onlineVisibility: 'same_as_last_seen' });
      await saveContact(u, viewer);
      expect(await getUser(viewer, u.id)).toMatchObject({ avatarUrl: null, about: null, online: null, lastSeenAt: null });
      expect(await getUser(u, u.id)).toMatchObject({ avatarUrl, about: 'hello there', online: false });
    });

    it('a subject who blocked me: avatar/about/phone/presence null, the block is never revealed', async () => {
      const { u } = await subject();
      await saveContact(u, viewer);
      await block(u, viewer);
      expect(await getUser(viewer, u.id)).toMatchObject({ avatarUrl: null, about: null, phone: null, online: null, lastSeenAt: null, isBlocked: false, isDeleted: false, displayName: 'Subject' });
    });

    it('a user I blocked: isBlocked true, presence hidden, profile per their settings', async () => {
      const { u, avatarUrl } = await subject();
      await block(viewer, u);
      expect(await getUser(viewer, u.id)).toMatchObject({ avatarUrl, about: 'hello there', online: null, lastSeenAt: null, isBlocked: true });
    });

    it('deleted accounts render as "Deleted account"; unknown ids 404; malformed ids 400', async () => {
      const gone = await t.createUser({ displayName: 'Gone' });
      await t.api(gone).delete('/api/me').send({ password: gone.password }).expect(204);
      expect(await getUser(viewer, gone.id)).toMatchObject({ displayName: 'Deleted account', isDeleted: true, avatarUrl: null, about: null, phone: null, online: null });
      await t.api(viewer).get(`/api/users/${crypto.randomUUID()}`).expect(404);
      await t.api(viewer).get('/api/users/xyz').expect(400);
    });
  });

  describe('lookups', () => {
    it('GET /users/by-username/:username finds active users (case-insensitive) but not deleted users or users who blocked me', async () => {
      const u = await t.createUser({ username: 'lookup_me' });
      expect((await t.api(viewer).get('/api/users/by-username/LOOKUP_ME').expect(200)).body.id).toBe(u.id);
      await t.api(viewer).get('/api/users/by-username/nobody_by_that_name').expect(404);
      const blocker = await t.createUser({ username: 'blocks_viewer' });
      await block(blocker, viewer);
      await t.api(viewer).get('/api/users/by-username/blocks_viewer').expect(404);
      const gone = await t.createUser({ username: 'about_to_go' });
      await t.api(gone).delete('/api/me').send({ password: gone.password }).expect(204);
      await t.api(viewer).get('/api/users/by-username/about_to_go').expect(404);
      const scrubbed = (await getUser(viewer, gone.id)).username;
      expect(scrubbed).toMatch(/^deleted_[0-9a-f]{12}$/);
      await t.api(viewer).get(`/api/users/by-username/${scrubbed}`).expect(404);
    });

    it('POST /users/batch: input order, unknown ids omitted, deleted users included, limits validated', async () => {
      const a = await t.createUser();
      const b = await t.createUser();
      const gone = await t.createUser();
      await t.api(gone).delete('/api/me').send({ password: gone.password }).expect(204);
      const res = await t.api(viewer).post('/api/users/batch').send({ userIds: [b.id, crypto.randomUUID(), gone.id, a.id.toUpperCase()] }).expect(200);
      const list = res.body as UserPublic[];
      expect(list.map((u) => u.id)).toEqual([b.id, gone.id, a.id]);
      expect(list[1]).toMatchObject({ isDeleted: true, displayName: 'Deleted account' });
      await t.api(viewer).post('/api/users/batch').send({ userIds: [] }).expect(400);
      await t
        .api(viewer)
        .post('/api/users/batch')
        .send({ userIds: Array.from({ length: MAX_USERS_BATCH + 1 }, () => crypto.randomUUID()) })
        .expect(400);
    });

    it('POST /users/presence: one entry per known id, per-viewer privacy, live online state', async () => {
      const online = await t.createUser();
      const hidden = await t.createUser();
      await setSettings(hidden, { lastSeenVisibility: 'nobody', onlineVisibility: 'same_as_last_seen' });
      const s = await t.connect(online);
      const res = await t.api(viewer).post('/api/users/presence').send({ userIds: [online.id, hidden.id, crypto.randomUUID()] }).expect(200);
      expect(res.body as Presence[]).toEqual([
        { userId: online.id, online: true, lastSeenAt: null },
        { userId: hidden.id, online: null, lastSeenAt: null },
      ]);
      await goOffline(online, s);
      const after = (await t.api(viewer).post('/api/users/presence').send({ userIds: [online.id] }).expect(200)).body as Presence[];
      expect(after[0]!.online).toBe(false);
      expect(after[0]!.lastSeenAt).not.toBeNull();
    });
  });

  describe('GET /users/search', () => {
    let me: TestUser;
    let target: TestUser;
    let targetPhone: string;

    beforeAll(async () => {
      me = await t.createUser({ username: 'searcher' });
      targetPhone = uniquePhone();
      target = await t.createUser({ username: 'zebra_stripes', displayName: 'Marty Zebra', phone: targetPhone });
    });

    it('matches an exact username (leading @, any case), a ≥3-char username prefix and an exact phone', async () => {
      expect(await search(me, '@Zebra_Stripes')).toEqual([target.id]);
      expect(await search(me, 'zeb')).toEqual([target.id]);
      expect(await search(me, 'ze')).toEqual([]); // prefix too short
      expect(await search(me, targetPhone)).toEqual([target.id]);
      expect(await search(me, `${targetPhone.slice(0, 5)} ${targetPhone.slice(5)}`)).toEqual([target.id]);
      expect(await search(me, targetPhone.slice(0, 8))).toEqual([]); // never substring phone matching
    });

    it('never matches display-name substrings of strangers', async () => {
      expect(await search(me, 'Marty')).toEqual([]);
      expect(await search(me, 'zebra')).toEqual([target.id]); // via username prefix only
      expect(await search(me, 'stripes')).toEqual([]);
    });

    it('matches display names (and my saved names) among contacts and active chat partners only', async () => {
      const contact = await t.createUser({ displayName: 'Quentin Contact' });
      const renamed = await t.createUser({ displayName: 'Zzz' });
      const partner = await t.createUser({ displayName: 'Quentin Partner' });
      const groupMate = await t.createUser({ displayName: 'Quentin Groupmate' });
      const former = await t.createUser({ displayName: 'Quentin Former' });
      const follower = await t.createUser({ displayName: 'Quentin Follower' });
      const communityMate = await t.createUser({ displayName: 'Quentin Community' });
      const stranger = await t.createUser({ displayName: 'Quentin Stranger' });
      await saveContact(me, contact);
      await saveContact(me, renamed, 'Quentin Nickname');
      await createDirect(me, partner);
      await createGroup(me, [groupMate]);
      const left = await createGroup(me, [former]);
      await transact((tx, fx) => upsertMembership(tx, fx, { kind: 'deactivate', chatId: left, userId: former.id, reason: 'left', systemEvent: { kind: 'member_left', actorId: former.id } }));
      const channelId = await createChannel(me);
      await transact((tx, fx) => upsertMembership(tx, fx, { kind: 'activate', chatId: channelId, userIds: [follower.id] }));
      const { announcementChatId } = await createCommunity(me);
      await transact((tx, fx) => upsertMembership(tx, fx, { kind: 'activate', chatId: announcementChatId, userIds: [communityMate.id] }));

      const found = await search(me, 'quentin');
      expect(new Set(found)).toEqual(new Set([contact.id, renamed.id, partner.id, groupMate.id]));
      expect(found).not.toContain(stranger.id);
      expect(await search(me, 'nick')).toEqual([renamed.id]);
      expect(await search(me, 'PARTNER')).toEqual([partner.id]);
    });

    it('excludes deleted users, users who blocked me and myself; includes users I blocked', async () => {
      const blocker = await t.createUser({ username: 'hidden_blocker' });
      await block(blocker, me);
      const blockedByMe = await t.createUser({ username: 'hidden_blocked' });
      await block(me, blockedByMe);
      const gone = await t.createUser({ username: 'hidden_gone' });
      await t.api(gone).delete('/api/me').send({ password: gone.password }).expect(204);
      expect(await search(me, 'hidden_')).toEqual([blockedByMe.id]);
      expect(await search(me, 'hidden_blocker')).toEqual([]);
      expect(await search(me, 'searcher')).toEqual([]);
      expect(await search(me, 'deleted_')).toEqual([]);
    });

    it('ranks exact matches first, treats LIKE wildcards literally and caps results at USER_SEARCH_LIMIT', async () => {
      for (let i = 0; i < USER_SEARCH_LIMIT + 5; i++) await t.createUser({ username: `many_x${String(i).padStart(2, '0')}` });
      const exact = await t.createUser({ username: 'many' });
      const list = await search(me, 'many');
      expect(list).toHaveLength(USER_SEARCH_LIMIT);
      expect(list[0]).toBe(exact.id);
      const wild = await t.createUser({ username: 'wild_card' });
      await t.createUser({ username: 'wildxcard' });
      expect(await search(me, 'wild_')).toEqual([wild.id]);
      expect(await search(me, 'wi%')).toEqual([]);
    });

    it('validates q', async () => {
      await t.api(me).get('/api/users/search').expect(400);
      await t.api(me).get('/api/users/search').query({ q: '@' }).expect(400);
      await t.api(me).get('/api/users/search').query({ q: 'x'.repeat(65) }).expect(400);
    });

    it('is rate-limited per user (shared with adding contacts)', async () => {
      const u = await t.createUser();
      config.rateLimit = true;
      try {
        resetUserLimits();
        for (let i = 0; i < USER_RATE_LIMITS.userSearch.limit; i++) await t.api(u).get('/api/users/search').query({ q: 'abc' }).expect(200);
        expect((await t.api(u).get('/api/users/search').query({ q: 'abc' }).expect(429)).body.error.code).toBe('rate_limited');
        await t.api(u).post('/api/contacts').send({ userId: viewer.id }).expect(429);
        await t.api(viewer).get('/api/users/search').query({ q: 'abc' }).expect(200); // per user
      } finally {
        config.rateLimit = false;
        resetUserLimits();
      }
    });
  });

  describe('GET /users/:userId/common-groups', () => {
    it('lists active regular groups we share (not channels, announcement groups, left groups)', async () => {
      const a = await t.createUser();
      const b = await t.createUser();
      const g1 = await createGroup(a, [b], { name: 'Shared 1' });
      const g2 = await createGroup(b, [a], { name: 'Shared 2' });
      const onlyA = await createGroup(a, [], { name: 'Only A' });
      const left = await createGroup(a, [b], { name: 'B left' });
      await transact((tx, fx) => upsertMembership(tx, fx, { kind: 'deactivate', chatId: left, userId: b.id, reason: 'left', systemEvent: { kind: 'member_left', actorId: b.id } }));
      const channel = await createChannel(a);
      await transact((tx, fx) => upsertMembership(tx, fx, { kind: 'activate', chatId: channel, userIds: [b.id] }));
      const { announcementChatId } = await createCommunity(a);
      await transact((tx, fx) => upsertMembership(tx, fx, { kind: 'activate', chatId: announcementChatId, userIds: [b.id] }));

      const list = (await t.api(a).get(`/api/users/${b.id}/common-groups`).expect(200)).body as ChatSummary[];
      expect(new Set(list.map((c) => c.id))).toEqual(new Set([g1, g2]));
      expect(list.map((c) => c.id)).not.toContain(onlyA);
      expect(list[0]).toMatchObject({ type: 'group', membership: 'active', isAnnouncement: false });
      expect(list[0]!.permissions).toBeDefined();
      // Symmetric, and the left group is still hidden from b's side.
      const fromB = (await t.api(b).get(`/api/users/${a.id}/common-groups`).expect(200)).body as ChatSummary[];
      expect(new Set(fromB.map((c) => c.id))).toEqual(new Set([g1, g2]));
      await t.api(a).get(`/api/users/${crypto.randomUUID()}/common-groups`).expect(404);
      expect((await t.api(a).get(`/api/users/${viewer.id}/common-groups`).expect(200)).body).toEqual([]);
      // Nothing is emitted by a read.
      const s = await t.connect(a);
      await t.api(b).get(`/api/users/${a.id}/common-groups`).expect(200);
      await expectNoEvent(s, 'chat:upsert', 100);
    });
  });
});
