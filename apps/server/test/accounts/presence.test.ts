import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { USER_RATE_LIMITS, type Presence } from '@enbox/shared';
import { config } from '../../src/config.js';
import { resetUserLimits } from '../../src/lib/userLimit.js';
import { presenceIdle } from '../../src/modules/users/presence.js';
import { emitAck, expectNoEvent, startTestServer, waitForEvent, type TestServer, type TestSocket, type TestUser } from '../helpers.js';
import { goOffline, recordEvents, setSettings, settle } from '../services/fixtures.js';
import { giveProfile } from './util.js';

const LAST_SEEN = '2026-01-01T00:00:00.000Z';

describe('presence: subscribe, updates, per-viewer privacy', () => {
  let t: TestServer;

  beforeAll(async () => {
    t = await startTestServer();
  });
  afterAll(() => t.close());

  const subscribe = (s: TestSocket, userIds: string[]) => emitAck<Presence[]>(s, 'presence:subscribe', { userIds });
  const updatesOf = (s: TestSocket, userId: string) => waitForEvent(s, 'presence:update', { filter: (p) => p.userId === userId });

  async function subjectWithLastSeen(settings: Record<string, unknown> = {}): Promise<TestUser> {
    const u = await t.createUser();
    await giveProfile(u.id, { lastSeenAt: new Date(LAST_SEEN) });
    if (Object.keys(settings).length) await setSettings(u, settings);
    return u;
  }

  it('acks the per-viewer presence of known users (unknown ids omitted) and validates the payload', async () => {
    const viewer = await t.createUser();
    const visible = await subjectWithLastSeen();
    const hidden = await subjectWithLastSeen({ lastSeenVisibility: 'nobody', onlineVisibility: 'same_as_last_seen' });
    const s = await t.connect(viewer);
    const ack = await subscribe(s, [visible.id, crypto.randomUUID(), hidden.id]);
    expect(ack).toEqual([
      { userId: visible.id, online: false, lastSeenAt: LAST_SEEN },
      { userId: hidden.id, online: null, lastSeenAt: null },
    ]);
    await expect(emitAck(s, 'presence:subscribe', { userIds: 'nope' })).rejects.toMatchObject({ ack: { ok: false, error: { code: 'validation_error' } } });
    await expect(emitAck(s, 'presence:subscribe', {})).rejects.toMatchObject({ ack: { error: { code: 'validation_error' } } });
  });

  it('emits online when the first socket connects and offline (with last seen) when the last one disconnects', async () => {
    const viewer = await t.createUser();
    const subject = await subjectWithLastSeen();
    const sv = await t.connect(viewer);
    await subscribe(sv, [subject.id]);

    const online = updatesOf(sv, subject.id);
    const s1 = await t.connect(subject);
    expect(await online).toEqual({ userId: subject.id, online: true, lastSeenAt: null });

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
    const [rest] = (await t.api(viewer).post('/api/users/presence').send({ userIds: [subject.id] }).expect(200)).body as Presence[];
    expect(rest).toEqual(p);
  });

  it('hidden presence never produces updates on connect/disconnect (no timing side channel)', async () => {
    const viewer = await t.createUser();
    const subject = await subjectWithLastSeen({ lastSeenVisibility: 'nobody', onlineVisibility: 'same_as_last_seen' });
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
    const subject = await subjectWithLastSeen({ lastSeenVisibility: 'nobody', onlineVisibility: 'everyone' });
    const sv = await t.connect(viewer);
    expect(await subscribe(sv, [subject.id])).toEqual([{ userId: subject.id, online: false, lastSeenAt: null }]);
    const on = updatesOf(sv, subject.id);
    const s = await t.connect(subject);
    expect(await on).toEqual({ userId: subject.id, online: true, lastSeenAt: null });
    const off = updatesOf(sv, subject.id);
    await goOffline(subject, s);
    expect(await off).toEqual({ userId: subject.id, online: false, lastSeenAt: null });
  });

  it('hiding last seen via PATCH /me/settings updates subscribers immediately and stops later updates', async () => {
    const viewer = await t.createUser();
    const subject = await subjectWithLastSeen();
    const ss = await t.connect(subject);
    const sv = await t.connect(viewer);
    expect(await subscribe(sv, [subject.id])).toEqual([{ userId: subject.id, online: true, lastSeenAt: null }]);

    const hidden = updatesOf(sv, subject.id);
    await t.api(subject).patch('/api/me/settings').send({ lastSeenVisibility: 'nobody', onlineVisibility: 'same_as_last_seen' }).expect(200);
    expect(await hidden).toEqual({ userId: subject.id, online: null, lastSeenAt: null });

    await goOffline(subject, ss);
    await presenceIdle();
    await expectNoEvent(sv, 'presence:update');

    const shown = updatesOf(sv, subject.id);
    await t.api(subject).patch('/api/me/settings').send({ lastSeenVisibility: 'everyone' }).expect(200);
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
    const subject = await subjectWithLastSeen({ lastSeenVisibility: 'contacts', onlineVisibility: 'same_as_last_seen' });
    const sf = await t.connect(friend);
    const so = await t.connect(other);
    expect(await subscribe(sf, [subject.id])).toEqual([{ userId: subject.id, online: null, lastSeenAt: null }]);
    await subscribe(so, [subject.id]);

    const shown = updatesOf(sf, subject.id);
    await t.api(subject).post('/api/contacts').send({ userId: friend.id }).expect(201);
    expect(await shown).toEqual({ userId: subject.id, online: false, lastSeenAt: LAST_SEEN });
    await expectNoEvent(so, 'presence:update');

    // Online/offline now reach the contact but not the other viewer.
    const on = updatesOf(sf, subject.id);
    const ss = await t.connect(subject);
    expect(await on).toEqual({ userId: subject.id, online: true, lastSeenAt: null });
    await expectNoEvent(so, 'presence:update');

    const hiddenAgain = updatesOf(sf, subject.id);
    await t.api(subject).delete(`/api/contacts/${friend.id}`).expect(204);
    expect(await hiddenAgain).toEqual({ userId: subject.id, online: null, lastSeenAt: null });
    await goOffline(subject, ss);
    await presenceIdle();
    await expectNoEvent(sf, 'presence:update');
  });

  it('blocking hides presence both ways; unblocking restores it', async () => {
    const a = await t.createUser();
    const b = await t.createUser();
    const sa = await t.connect(a);
    const sb = await t.connect(b);
    expect(await subscribe(sa, [b.id])).toEqual([{ userId: b.id, online: true, lastSeenAt: null }]);
    expect(await subscribe(sb, [a.id])).toEqual([{ userId: a.id, online: true, lastSeenAt: null }]);

    const aSeesB = updatesOf(sa, b.id);
    const bSeesA = updatesOf(sb, a.id);
    await t.api(a).put(`/api/blocks/${b.id}`).expect(204);
    expect(await aSeesB).toEqual({ userId: b.id, online: null, lastSeenAt: null });
    expect(await bSeesA).toEqual({ userId: a.id, online: null, lastSeenAt: null });
    // A fresh subscription is hidden too.
    const sb2 = await t.connect(b);
    expect(await subscribe(sb2, [a.id])).toEqual([{ userId: a.id, online: null, lastSeenAt: null }]);

    const aSeesB2 = updatesOf(sa, b.id);
    const bSeesA2 = updatesOf(sb, a.id);
    await t.api(a).delete(`/api/blocks/${b.id}`).expect(204);
    expect(await aSeesB2).toEqual({ userId: b.id, online: true, lastSeenAt: null });
    expect(await bSeesA2).toEqual({ userId: a.id, online: true, lastSeenAt: null });
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
      for (let i = 0; i < USER_RATE_LIMITS.presenceSubscribe.limit; i++) await subscribe(s, [viewer.id]);
      await expect(subscribe(s, [viewer.id])).rejects.toMatchObject({ ack: { error: { code: 'rate_limited' } } });
      const other = await t.connect(viewer); // another socket has its own budget
      await subscribe(other, [viewer.id]);
    } finally {
      config.rateLimit = false;
      resetUserLimits();
    }
  });
});
