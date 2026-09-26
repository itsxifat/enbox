import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { USER_RATE_LIMITS, type Presence, type UserPublic, type UserSelf } from '@enbox/shared';
import { config } from '../../src/config.js';
import { db } from '../../src/db/index.js';
import { users } from '../../src/db/schema.js';
import { runJobsOnce } from '../../src/jobs/index.js';
import { resetUserLimits } from '../../src/lib/userLimit.js';
import { presenceIdle } from '../../src/modules/users/presence.js';
import { isOnline } from '../../src/realtime/presence.js';
import { rawAck } from '../calls/helpers.js';
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
  block,
  goOffline,
  recordEvents,
  saveContact,
  setAvailability,
  setPresenceNote,
  setSettings,
  settle,
} from '../services/fixtures.js';
import { giveProfile } from './util.js';

const LAST_SEEN = '2026-01-01T00:00:00.000Z';

describe('presence: subscribe, updates, per-viewer privacy', () => {
  let t: TestServer;

  beforeAll(async () => {
    t = await startTestServer();
  });
  afterAll(() => t.close());

  const subscribe = (s: TestSocket, userIds: string[]) =>
    emitAck<Presence[]>(s, 'presence:subscribe', { userIds });
  const updatesOf = (s: TestSocket, userId: string) =>
    waitForEvent(s, 'presence:update', { filter: (p) => p.userId === userId });

  async function subjectWithLastSeen(settings: Record<string, unknown> = {}): Promise<TestUser> {
    const u = await t.createUser();
    await giveProfile(u.id, { lastSeenAt: new Date(LAST_SEEN) });
    if (Object.keys(settings).length) await setSettings(u, settings);
    return u;
  }

  it('acks the per-viewer presence of known users (unknown ids omitted) and validates the payload', async () => {
    const viewer = await t.createUser();
    const visible = await subjectWithLastSeen();
    const hidden = await subjectWithLastSeen({
      lastSeenVisibility: 'nobody',
      onlineVisibility: 'same_as_last_seen',
    });
    const s = await t.connect(viewer);
    const ack = await subscribe(s, [visible.id, crypto.randomUUID(), hidden.id]);
    expect(ack).toEqual([
      { userId: visible.id, online: false, state: 'offline', note: null, lastSeenAt: LAST_SEEN },
      { userId: hidden.id, online: null, state: null, note: null, lastSeenAt: null },
    ]);
    await expect(emitAck(s, 'presence:subscribe', { userIds: 'nope' })).rejects.toMatchObject({
      ack: { ok: false, error: { code: 'validation_error' } },
    });
    await expect(emitAck(s, 'presence:subscribe', {})).rejects.toMatchObject({
      ack: { error: { code: 'validation_error' } },
    });
  });

  it('emits online when the first socket connects and offline (with last seen) when the last one disconnects', async () => {
    const viewer = await t.createUser();
    const subject = await subjectWithLastSeen();
    const sv = await t.connect(viewer);
    await subscribe(sv, [subject.id]);

    const online = updatesOf(sv, subject.id);
    const s1 = await t.connect(subject);
    expect(await online).toEqual({
      userId: subject.id,
      online: true,
      state: 'online',
      note: null,
      lastSeenAt: null,
    });

    const s2 = await t.connect(subject); // second device: still online, nothing to say
    await presenceIdle();
    await expectNoEvent(sv, 'presence:update');
    s2.disconnect();
    await presenceIdle();
    await expectNoEvent(sv, 'presence:update');

    const offline = updatesOf(sv, subject.id);
    const before = Date.now();
    await goOffline(subject, s1);
    const p = await offline;
    expect(p.online).toBe(false);
    expect(Date.parse(p.lastSeenAt!)).toBeGreaterThanOrEqual(before - 1000);
    // The REST view agrees.
    const [rest] = (
      await t
        .api(viewer)
        .post('/api/users/presence')
        .send({ userIds: [subject.id] })
        .expect(200)
    ).body as Presence[];
    expect(rest).toEqual(p);
  });

  it('hidden presence never produces updates on connect/disconnect (no timing side channel)', async () => {
    const viewer = await t.createUser();
    const subject = await subjectWithLastSeen({
      lastSeenVisibility: 'nobody',
      onlineVisibility: 'same_as_last_seen',
    });
    const sv = await t.connect(viewer);
    await subscribe(sv, [subject.id]);
    const s = await t.connect(subject);
    await presenceIdle();
    await expectNoEvent(sv, 'presence:update');
    await goOffline(subject, s);
    await presenceIdle();
    await expectNoEvent(sv, 'presence:update');
  });

  it("onlineVisibility 'everyone' with last seen hidden: online flips, last seen stays null", async () => {
    const viewer = await t.createUser();
    const subject = await subjectWithLastSeen({
      lastSeenVisibility: 'nobody',
      onlineVisibility: 'everyone',
    });
    const sv = await t.connect(viewer);
    expect(await subscribe(sv, [subject.id])).toEqual([
      { userId: subject.id, online: false, state: 'offline', note: null, lastSeenAt: null },
    ]);
    const on = updatesOf(sv, subject.id);
    const s = await t.connect(subject);
    expect(await on).toEqual({
      userId: subject.id,
      online: true,
      state: 'online',
      note: null,
      lastSeenAt: null,
    });
    const off = updatesOf(sv, subject.id);
    await goOffline(subject, s);
    expect(await off).toEqual({
      userId: subject.id,
      online: false,
      state: 'offline',
      note: null,
      lastSeenAt: null,
    });
  });

  it('hiding last seen via PATCH /me/settings updates subscribers immediately and stops later updates', async () => {
    const viewer = await t.createUser();
    const subject = await subjectWithLastSeen();
    const ss = await t.connect(subject);
    const sv = await t.connect(viewer);
    expect(await subscribe(sv, [subject.id])).toEqual([
      { userId: subject.id, online: true, state: 'online', note: null, lastSeenAt: null },
    ]);

    const hidden = updatesOf(sv, subject.id);
    await t
      .api(subject)
      .patch('/api/me/settings')
      .send({ lastSeenVisibility: 'nobody', onlineVisibility: 'same_as_last_seen' })
      .expect(200);
    expect(await hidden).toEqual({
      userId: subject.id,
      online: null,
      state: null,
      note: null,
      lastSeenAt: null,
    });

    await goOffline(subject, ss);
    await presenceIdle();
    await expectNoEvent(sv, 'presence:update');

    const shown = updatesOf(sv, subject.id);
    await t
      .api(subject)
      .patch('/api/me/settings')
      .send({ lastSeenVisibility: 'everyone' })
      .expect(200);
    const p = await shown;
    expect(p.online).toBe(false);
    expect(p.lastSeenAt).not.toBeNull();
    // Settings that don't affect presence re-evaluate nothing.
    await t.api(subject).patch('/api/me/settings').send({ aboutVisibility: 'nobody' }).expect(200);
    await presenceIdle();
    await expectNoEvent(sv, 'presence:update');
  });

  it("'contacts' visibility: adding/removing the viewer as a contact re-evaluates only that viewer", async () => {
    const friend = await t.createUser();
    const other = await t.createUser();
    const subject = await subjectWithLastSeen({
      lastSeenVisibility: 'contacts',
      onlineVisibility: 'same_as_last_seen',
    });
    const sf = await t.connect(friend);
    const so = await t.connect(other);
    expect(await subscribe(sf, [subject.id])).toEqual([
      { userId: subject.id, online: null, state: null, note: null, lastSeenAt: null },
    ]);
    await subscribe(so, [subject.id]);

    const shown = updatesOf(sf, subject.id);
    await t.api(subject).post('/api/contacts').send({ userId: friend.id }).expect(201);
    expect(await shown).toEqual({
      userId: subject.id,
      online: false,
      state: 'offline',
      note: null,
      lastSeenAt: LAST_SEEN,
    });
    await expectNoEvent(so, 'presence:update');

    // Online/offline now reach the contact but not the other viewer.
    const on = updatesOf(sf, subject.id);
    const ss = await t.connect(subject);
    expect(await on).toEqual({
      userId: subject.id,
      online: true,
      state: 'online',
      note: null,
      lastSeenAt: null,
    });
    await expectNoEvent(so, 'presence:update');

    const hiddenAgain = updatesOf(sf, subject.id);
    await t.api(subject).delete(`/api/contacts/${friend.id}`).expect(204);
    expect(await hiddenAgain).toEqual({
      userId: subject.id,
      online: null,
      state: null,
      note: null,
      lastSeenAt: null,
    });
    await goOffline(subject, ss);
    await presenceIdle();
    await expectNoEvent(sf, 'presence:update');
  });

  it('blocking hides presence both ways; unblocking restores it', async () => {
    const a = await t.createUser();
    const b = await t.createUser();
    const sa = await t.connect(a);
    const sb = await t.connect(b);
    expect(await subscribe(sa, [b.id])).toEqual([
      { userId: b.id, online: true, state: 'online', note: null, lastSeenAt: null },
    ]);
    expect(await subscribe(sb, [a.id])).toEqual([
      { userId: a.id, online: true, state: 'online', note: null, lastSeenAt: null },
    ]);

    const aSeesB = updatesOf(sa, b.id);
    const bSeesA = updatesOf(sb, a.id);
    await t.api(a).put(`/api/blocks/${b.id}`).expect(204);
    expect(await aSeesB).toEqual({
      userId: b.id,
      online: null,
      state: null,
      note: null,
      lastSeenAt: null,
    });
    expect(await bSeesA).toEqual({
      userId: a.id,
      online: null,
      state: null,
      note: null,
      lastSeenAt: null,
    });
    // A fresh subscription is hidden too.
    const sb2 = await t.connect(b);
    expect(await subscribe(sb2, [a.id])).toEqual([
      { userId: a.id, online: null, state: null, note: null, lastSeenAt: null },
    ]);

    const aSeesB2 = updatesOf(sa, b.id);
    const bSeesA2 = updatesOf(sb, a.id);
    await t.api(a).delete(`/api/blocks/${b.id}`).expect(204);
    expect(await aSeesB2).toEqual({
      userId: b.id,
      online: true,
      state: 'online',
      note: null,
      lastSeenAt: null,
    });
    expect(await bSeesA2).toEqual({
      userId: a.id,
      online: true,
      state: 'online',
      note: null,
      lastSeenAt: null,
    });
  });

  it('subscriptions are per socket and end with presence:unsubscribe', async () => {
    const viewer = await t.createUser();
    const subject = await subjectWithLastSeen();
    const s1 = await t.connect(viewer);
    const s2 = await t.connect(viewer);
    await subscribe(s1, [subject.id]);
    const log2 = recordEvents(s2);
    const on = updatesOf(s1, subject.id);
    const ss = await t.connect(subject);
    await on;
    await presenceIdle();
    await settle(100);
    expect(log2.of('presence:update')).toEqual([]);

    s1.emit('presence:unsubscribe', { userIds: [subject.id] });
    await settle(100);
    await goOffline(subject, ss);
    await presenceIdle();
    await expectNoEvent(s1, 'presence:update');
  });

  it('presence:subscribe is rate-limited per socket', async () => {
    const viewer = await t.createUser();
    const s = await t.connect(viewer);
    config.rateLimit = true;
    try {
      resetUserLimits();
      for (let i = 0; i < USER_RATE_LIMITS.presenceSubscribe.limit; i++)
        await subscribe(s, [viewer.id]);
      await expect(subscribe(s, [viewer.id])).rejects.toMatchObject({
        ack: { error: { code: 'rate_limited' } },
      });
      const other = await t.connect(viewer); // another socket has its own budget
      await subscribe(other, [viewer.id]);
    } finally {
      config.rateLimit = false;
      resetUserLimits();
    }
  });

  describe('availability, auto-idle and the presence note', () => {
    const online = (userId: string): Presence => ({
      userId,
      online: true,
      state: 'online',
      note: null,
      lastSeenAt: null,
    });
    const offline = (userId: string, lastSeenAt: string | null = LAST_SEEN): Presence => ({
      userId,
      online: false,
      state: 'offline',
      note: null,
      lastSeenAt,
    });
    const rowOf = async (userId: string) =>
      (await db.select().from(users).where(eq(users.id, userId)))[0]!;

    it('an invisible connected user is byte-identical to an offline one (ack, REST, UserPublic); the choice only in UserSelf', async () => {
      const viewer = await t.createUser();
      const away = await subjectWithLastSeen();
      const invisible = await subjectWithLastSeen();
      await setAvailability(invisible, 'invisible');
      const ss = await t.connect(invisible);
      expect(isOnline(invisible.id)).toBe(true); // counted server-side, offline on the wire
      const sv = await t.connect(viewer);
      const [pAway, pInvisible] = await subscribe(sv, [away.id, invisible.id]);
      expect(pInvisible).toEqual({ ...pAway!, userId: invisible.id });
      expect(pInvisible).toEqual(offline(invisible.id));
      expect(
        (
          await t
            .api(viewer)
            .post('/api/users/presence')
            .send({ userIds: [invisible.id] })
            .expect(200)
        ).body,
      ).toEqual([pInvisible]);
      expect(
        (await t.api(viewer).get(`/api/users/${invisible.id}`).expect(200)).body,
      ).toMatchObject({
        online: false,
        presenceState: 'offline',
        presenceNote: null,
        lastSeenAt: LAST_SEEN,
      });
      expect(
        ((await t.api(invisible).get('/api/me').expect(200)).body as UserSelf).availability,
      ).toBe('invisible');
      expect(
        ((await t.api(invisible).get(`/api/users/${invisible.id}`).expect(200)).body as UserPublic)
          .presenceState,
      ).toBe('offline');
      await goOffline(invisible, ss);
    });

    it('connecting, going idle and disconnecting while invisible emit nothing and leave last_seen_at frozen', async () => {
      const viewer = await t.createUser();
      const subject = await subjectWithLastSeen();
      await setAvailability(subject, 'invisible');
      const sv = await t.connect(viewer);
      expect(await subscribe(sv, [subject.id])).toEqual([offline(subject.id)]);
      const s1 = await t.connect(subject);
      const s2 = await t.connect(subject);
      s1.emit('presence:activity', { idle: true });
      s2.emit('presence:activity', { idle: true });
      await settle(150);
      await presenceIdle();
      await expectNoEvent(sv, 'presence:update');
      await goOffline(subject, s1, s2);
      await presenceIdle();
      await expectNoEvent(sv, 'presence:update');
      await settle(200); // the fire-and-forget last-seen write (skipped for invisible users) has settled
      expect((await rowOf(subject.id)).lastSeenAt?.toISOString()).toBe(LAST_SEEN);
      expect(await subscribe(sv, [subject.id])).toEqual([offline(subject.id)]);
    });

    it('switching to invisible emits one update identical to a real disconnect; switching back shows online', async () => {
      const viewer = await t.createUser();
      const subject = await subjectWithLastSeen();
      const other = await subjectWithLastSeen();
      const ss = await t.connect(subject);
      const so = await t.connect(other);
      const sv = await t.connect(viewer);
      expect(await subscribe(sv, [subject.id, other.id])).toEqual([
        online(subject.id),
        online(other.id),
      ]);

      const hidden = updatesOf(sv, subject.id);
      const before = Date.now();
      await t.api(subject).put('/api/me/presence').send({ availability: 'invisible' }).expect(200);
      const p = await hidden;
      expect(Date.parse(p.lastSeenAt!)).toBeGreaterThanOrEqual(before - 1000);
      expect(p).toEqual(offline(subject.id, p.lastSeenAt));
      expect((await rowOf(subject.id)).lastSeenAt?.toISOString()).toBe(p.lastSeenAt);
      await presenceIdle();
      await expectNoEvent(sv, 'presence:update');

      const gone = updatesOf(sv, other.id);
      await goOffline(other, so);
      const q = await gone;
      expect(Object.keys(q)).toEqual(Object.keys(p));
      expect({ ...q, userId: subject.id, lastSeenAt: p.lastSeenAt }).toEqual(p);

      const shown = updatesOf(sv, subject.id);
      await t.api(subject).put('/api/me/presence').send({ availability: 'online' }).expect(200);
      expect(await shown).toEqual(online(subject.id));
      await goOffline(subject, ss);
    });

    it('an expired invisible choice is online: a disconnect writes last_seen_at, choosing invisible again refreshes it', async () => {
      const viewer = await t.createUser();
      const subject = await subjectWithLastSeen();
      await setAvailability(subject, 'invisible', { until: new Date(Date.now() - 1000) });
      const sv = await t.connect(viewer);
      const s1 = await t.connect(subject);
      expect(await subscribe(sv, [subject.id])).toEqual([online(subject.id)]);
      // Viewers saw them online, so a disconnect is a real one: "last seen just now", not
      // the value frozen when they first went invisible (the expiry job has not run yet).
      const off = updatesOf(sv, subject.id);
      const before = Date.now();
      await goOffline(subject, s1);
      const p = await off;
      expect(p.state).toBe('offline');
      expect(Date.parse(p.lastSeenAt!)).toBeGreaterThanOrEqual(before - 1000);
      await settle(200); // the fire-and-forget last-seen write has settled
      expect((await rowOf(subject.id)).lastSeenAt?.toISOString()).toBe(p.lastSeenAt);

      // Choosing invisible again while the expired choice still sits on the row is a fresh
      // switch: it writes last_seen_at = now() like the first one did.
      const back = updatesOf(sv, subject.id);
      const s2 = await t.connect(subject);
      expect(await back).toEqual(online(subject.id));
      const hidden = updatesOf(sv, subject.id);
      const again = Date.now();
      await t.api(subject).put('/api/me/presence').send({ availability: 'invisible' }).expect(200);
      const q = await hidden;
      expect(q).toEqual(offline(subject.id, q.lastSeenAt));
      expect(Date.parse(q.lastSeenAt!)).toBeGreaterThanOrEqual(again - 1000);
      expect((await rowOf(subject.id)).lastSeenAt?.toISOString()).toBe(q.lastSeenAt);
      await goOffline(subject, s2);
    });

    it('going invisible while offline keeps the real last seen', async () => {
      const viewer = await t.createUser();
      const subject = await subjectWithLastSeen();
      const sv = await t.connect(viewer);
      expect(await subscribe(sv, [subject.id])).toEqual([offline(subject.id)]);
      await t.api(subject).put('/api/me/presence').send({ availability: 'invisible' }).expect(200);
      await presenceIdle();
      await expectNoEvent(sv, 'presence:update');
      expect((await rowOf(subject.id)).lastSeenAt?.toISOString()).toBe(LAST_SEEN);
    });

    it('auto-idle: idle only while every counted socket is idle; a fresh device is active', async () => {
      const viewer = await t.createUser();
      const subject = await subjectWithLastSeen();
      const s1 = await t.connect(subject);
      const s2 = await t.connect(subject);
      const sv = await t.connect(viewer);
      expect(await subscribe(sv, [subject.id])).toEqual([online(subject.id)]);

      s1.emit('presence:activity', { idle: true }); // one of two devices: still active
      await settle(150);
      await presenceIdle();
      await expectNoEvent(sv, 'presence:update');
      const idle = updatesOf(sv, subject.id);
      s2.emit('presence:activity', { idle: true });
      expect(await idle).toEqual({ ...online(subject.id), state: 'idle' });

      s2.disconnect(); // the remaining device is idle: nothing changes
      await settle(150);
      await presenceIdle();
      await expectNoEvent(sv, 'presence:update');

      const active = updatesOf(sv, subject.id);
      const s3 = await t.connect(subject); // a fresh device is active
      expect(await active).toEqual(online(subject.id));
      const idleAgain = updatesOf(sv, subject.id);
      s3.emit('presence:activity', { idle: true });
      expect((await idleAgain).state).toBe('idle');
      const back = updatesOf(sv, subject.id);
      s1.emit('presence:activity', { idle: false });
      expect((await back).state).toBe('online');
      const lastActiveGone = updatesOf(sv, subject.id);
      s1.disconnect(); // the only active device leaves: idle
      expect((await lastActiveGone).state).toBe('idle');
      const off = updatesOf(sv, subject.id); // offline beats idle
      await goOffline(subject, s3);
      expect((await off).state).toBe('offline');
    });

    it('chosen idle and dnd are shown; an expired availability_until reads as online; hidden viewers see nothing', async () => {
      const viewer = await t.createUser();
      const stranger = await t.createUser();
      const subject = await subjectWithLastSeen({
        lastSeenVisibility: 'contacts',
        onlineVisibility: 'same_as_last_seen',
      });
      await saveContact(subject, viewer);
      const ss = await t.connect(subject);
      const sv = await t.connect(viewer);
      const so = await t.connect(stranger);
      expect(await subscribe(sv, [subject.id])).toEqual([online(subject.id)]);
      expect(await subscribe(so, [subject.id])).toEqual([
        { userId: subject.id, online: null, state: null, note: null, lastSeenAt: null },
      ]);
      for (const state of ['idle', 'dnd'] as const) {
        const next = updatesOf(sv, subject.id);
        await t.api(subject).put('/api/me/presence').send({ availability: state }).expect(200);
        expect(await next).toEqual({ ...online(subject.id), state });
      }
      await presenceIdle();
      await expectNoEvent(so, 'presence:update');
      // An expired `until` already reads as online (the job catches up later).
      await setAvailability(subject, 'dnd', { until: new Date(Date.now() - 1000) });
      expect(
        (
          await t
            .api(viewer)
            .post('/api/users/presence')
            .send({ userIds: [subject.id] })
            .expect(200)
        ).body,
      ).toEqual([online(subject.id)]);
      await goOffline(subject, ss);
    });

    it('availability_until expiry: the job resets the choice, re-emits presence:update and me:updated', async () => {
      const viewer = await t.createUser();
      const subject = await subjectWithLastSeen();
      const ss = await t.connect(subject);
      const sv = await t.connect(viewer);
      await subscribe(sv, [subject.id]);
      const dnd = updatesOf(sv, subject.id);
      await t
        .api(subject)
        .put('/api/me/presence')
        .send({ availability: 'dnd', until: new Date(Date.now() + 3_600_000).toISOString() })
        .expect(200);
      expect((await dnd).state).toBe('dnd');
      await setAvailability(subject, 'dnd', { until: new Date(Date.now() - 1000) }); // time passes
      const backOnline = updatesOf(sv, subject.id);
      const meUpdated = waitForEvent(ss, 'me:updated');
      await runJobsOnce();
      expect(await backOnline).toEqual(online(subject.id));
      expect((await meUpdated).user).toMatchObject({
        availability: 'online',
        availabilityUntil: null,
      });
      expect(await rowOf(subject.id)).toMatchObject({
        availability: 'online',
        availabilityUntil: null,
      });
      await goOffline(subject, ss);
    });

    it('the presence note travels on presence:update while visible; hidden by block, visibility, going offline and expiry (the job clears it)', async () => {
      const viewer = await t.createUser();
      const blocked = await t.createUser();
      const stranger = await t.createUser();
      const subject = await subjectWithLastSeen({
        lastSeenVisibility: 'contacts',
        onlineVisibility: 'same_as_last_seen',
      });
      await saveContact(subject, viewer);
      await saveContact(subject, blocked);
      await block(subject, blocked);
      const ss = await t.connect(subject);
      const [sv, sb, so] = await Promise.all([viewer, blocked, stranger].map((u) => t.connect(u)));
      expect(await subscribe(sv!, [subject.id])).toEqual([online(subject.id)]);
      await subscribe(sb!, [subject.id]);
      await subscribe(so!, [subject.id]);

      const note = { text: 'Focus time', emoji: '🎯', expiresAt: null };
      const shown = updatesOf(sv!, subject.id);
      await t
        .api(subject)
        .put('/api/me/presence-note')
        .send({ text: 'Focus time', emoji: '🎯' })
        .expect(200);
      expect(await shown).toEqual({ ...online(subject.id), note });
      await presenceIdle();
      await expectNoEvent(sb!, 'presence:update');
      await expectNoEvent(so!, 'presence:update');
      expect((await t.api(viewer).get(`/api/users/${subject.id}`).expect(200)).body).toMatchObject({
        presenceState: 'online',
        presenceNote: note,
      });
      expect((await t.api(blocked).get(`/api/users/${subject.id}`).expect(200)).body).toMatchObject(
        { presenceState: null, presenceNote: null },
      );
      // Offline: no note (state offline).
      const off = updatesOf(sv!, subject.id);
      await goOffline(subject, ss);
      const p = await off;
      expect(p).toEqual(offline(subject.id, p.lastSeenAt));
      // Back online with the note; then it expires: hidden at once, cleared by the job (me:updated).
      const ss2 = await t.connect(subject);
      const on = updatesOf(sv!, subject.id);
      expect(await on).toEqual({ ...online(subject.id), note });
      await setPresenceNote(subject, {
        text: 'Focus time',
        emoji: '🎯',
        expiresAt: new Date(Date.now() - 1000),
      });
      expect(
        (
          await t
            .api(viewer)
            .post('/api/users/presence')
            .send({ userIds: [subject.id] })
            .expect(200)
        ).body,
      ).toEqual([online(subject.id)]);
      const cleared = updatesOf(sv!, subject.id);
      const meUpdated = waitForEvent(ss2, 'me:updated');
      await runJobsOnce();
      expect(await cleared).toEqual(online(subject.id));
      expect((await meUpdated).user.presenceNote).toBeNull();
      expect(await rowOf(subject.id)).toMatchObject({
        presenceNoteText: null,
        presenceNoteEmoji: null,
        presenceNoteExpiresAt: null,
      });
      await goOffline(subject, ss2);
    });

    it('presence:activity validates its payload and is rate-limited per socket', async () => {
      const u = await t.createUser();
      const s = await t.connect(u);
      expect(await rawAck(s, 'presence:activity', { idle: 'yes' })).toMatchObject({
        ok: false,
        error: { code: 'validation_error' },
      });
      config.rateLimit = true;
      try {
        resetUserLimits();
        for (let i = 0; i < USER_RATE_LIMITS.presenceActivity.limit; i++)
          expect((await rawAck(s, 'presence:activity', { idle: i % 2 === 0 })).ok).toBe(true);
        expect(await rawAck(s, 'presence:activity', { idle: true })).toMatchObject({
          ok: false,
          error: { code: 'rate_limited' },
        });
        s.emit('presence:activity', { idle: true }); // without an ack: dropped silently
        await settle(100);
        expect(s.connected).toBe(true);
        const other = await t.connect(u); // another socket has its own budget
        expect((await rawAck(other, 'presence:activity', { idle: true })).ok).toBe(true);
      } finally {
        config.rateLimit = false;
        resetUserLimits();
      }
    });
  });
});
