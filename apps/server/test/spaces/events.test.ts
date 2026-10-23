/**
 * Scheduled events (modules/events): create with MANAGE_CHANNELS (the creator starts
 * interested), validation of times, places and covers, the cap, the list with my
 * `interested`, the idempotent Interested toggle and its count, edits by the creator or
 * MANAGE_SPACE, start / end / cancel, delete, the leader job (external events start and end
 * on time, voice events close late or are canceled when nobody started them) with its
 * reminders and push, fan-out to members only, leaving the Space, a deleted voice channel.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  MAX_SPACE_EVENTS,
  PERM,
  type ChatSummary,
  type PushPayload,
  type SpaceAuditEntry,
  type SpaceDetail,
  type SpaceEvent,
  type SpaceInvite,
  type SpaceRole,
  type UserPublic,
} from '@enbox/shared';
import { db } from '../../src/db/index.js';
import { spaceEvents } from '../../src/db/schema.js';
import { runEventsJob } from '../../src/modules/events/service.js';
import { pushIdle, setPushSender, type PushTarget } from '../../src/modules/push/sender.js';
import { spaceRegistryIdle } from '../../src/realtime/spaceRegistry.js';
import { insertImage } from '../accounts/util.js';
import {
  expectNoEvent,
  startTestServer,
  waitForEvent,
  type TestServer,
  type TestUser,
} from '../helpers.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const at = (ms: number) => new Date(Date.now() + ms).toISOString();

describe('scheduled events', () => {
  let t: TestServer;
  let owner: TestUser;
  let bob: TestUser;
  let dave: TestUser;
  let carol: TestUser;
  let detail: SpaceDetail;
  let pushes: { endpoint: string; payload: PushPayload }[];
  const spaceId = () => detail.space.id;
  const base = () => `/api/spaces/${spaceId()}/events`;
  const voice = () => detail.channels.find((c) => c.type === 'space_voice')!;
  const general = () => detail.channels.find((c) => c.name === 'general')!;

  const create = (user: TestUser, body: Record<string, unknown>) =>
    t.api(user).post(base()).send(body);
  const voiceEvent = (name: string, startMs = HOUR, extra: Record<string, unknown> = {}) => ({
    name,
    entityType: 'voice',
    channelId: voice().id,
    startAt: at(startMs),
    ...extra,
  });
  const externalEvent = (name: string, startMs = HOUR, endMs = 3 * HOUR) => ({
    name,
    entityType: 'external',
    location: 'The park',
    startAt: at(startMs),
    endAt: at(endMs),
  });
  async function make(user: TestUser, body: Record<string, unknown>): Promise<SpaceEvent> {
    return (await create(user, body).expect(201)).body as SpaceEvent;
  }
  const list = async (user: TestUser) =>
    (await t.api(user).get(base()).expect(200)).body as SpaceEvent[];
  const patch = (user: TestUser, id: string, body: Record<string, unknown>) =>
    t.api(user).patch(`${base()}/${id}`).send(body);
  const statusOf = async (id: string) =>
    (await db.select({ s: spaceEvents.status }).from(spaceEvents).where(eq(spaceEvents.id, id)))[0]
      ?.s;

  beforeAll(async () => {
    t = await startTestServer();
    setPushSender(async (target: PushTarget, payload: PushPayload) => {
      pushes.push({ endpoint: target.endpoint, payload });
    });
    [owner, bob, dave, carol] = [
      await t.createUser({ displayName: 'Owner' }),
      await t.createUser({ displayName: 'Bob' }),
      await t.createUser({ displayName: 'Dave' }),
      await t.createUser({ displayName: 'Carol' }),
    ];
    detail = (await t.api(owner).post('/api/spaces').send({ name: 'Events Lab' }).expect(201))
      .body as SpaceDetail;
    const invite = (
      await t.api(owner).post(`/api/spaces/${spaceId()}/invites`).send({}).expect(201)
    ).body as SpaceInvite;
    for (const u of [bob, dave])
      await t.api(u).post(`/api/invites/${invite.code}/join`).expect(200);
    await spaceRegistryIdle();
  });
  afterAll(async () => {
    setPushSender(undefined);
    await t.close();
  });
  beforeEach(() => {
    pushes = [];
  });

  it('MANAGE_CHANNELS creates (the creator starts interested); others get 403, non-members 404', async () => {
    await create(bob, voiceEvent('Movie night')).expect(403);
    await create(carol, voiceEvent('Movie night')).expect(404);
    const ev = await make(owner, voiceEvent('Movie night', HOUR, { description: 'Bring snacks' }));
    expect(ev).toEqual({
      id: expect.any(String),
      spaceId: spaceId(),
      channelId: voice().id,
      creatorId: owner.id,
      name: 'Movie night',
      description: 'Bring snacks',
      entityType: 'voice',
      location: null,
      startAt: expect.any(String),
      endAt: null,
      status: 'scheduled',
      imageUrl: null,
      interestedCount: 1,
      interested: true,
    });
    // A role with MANAGE_CHANNELS lets Bob create events too.
    const role = (
      await t
        .api(owner)
        .post(`/api/spaces/${spaceId()}/roles`)
        .send({ name: 'Planner', permissions: PERM.MANAGE_CHANNELS })
        .expect(201)
    ).body as SpaceRole;
    await t
      .api(owner)
      .put(`/api/spaces/${spaceId()}/members/${bob.id}/roles/${role.id}`)
      .expect(200);
    const mine = await make(bob, externalEvent('Picnic'));
    expect(mine).toMatchObject({
      creatorId: bob.id,
      entityType: 'external',
      location: 'The park',
      channelId: null,
    });
    const audit = (await t.api(owner).get(`/api/spaces/${spaceId()}/audit-log`).expect(200))
      .body as SpaceAuditEntry[];
    expect(audit.filter((e) => e.action === 'event.create').map((e) => e.targetId)).toEqual([
      mine.id,
      ev.id,
    ]);
  });

  it('validation: times, places, covers', async () => {
    const field = async (body: Record<string, unknown>, path: string) => {
      const res = await create(owner, body).expect(400);
      expect(res.body.error.code).toBe('validation_error');
      expect(res.body.error.message).toMatch(new RegExp(`^${path}`));
    };
    // The start: in the future, at most a year ahead.
    await field(voiceEvent('Past', -MIN), 'startAt');
    await field(voiceEvent('Far', 370 * 24 * HOUR), 'startAt');
    await field({ ...voiceEvent('Bad'), startAt: 'tomorrow' }, 'startAt');
    // Somewhere else: a location and an end after the start, no channel.
    await field({ ...externalEvent('Nowhere'), location: '  ' }, 'location');
    await field({ ...externalEvent('Endless'), endAt: null }, 'endAt');
    await field(externalEvent('Backwards', 2 * HOUR, HOUR), 'endAt');
    await field({ ...externalEvent('Both'), channelId: voice().id }, 'channelId');
    // Voice: a voice channel of the Space I can see.
    await field({ ...voiceEvent('No channel'), channelId: null }, 'channelId');
    await field({ ...voiceEvent('Text'), channelId: general().id }, 'channelId');
    await field(
      { ...voiceEvent('Ghost'), channelId: '00000000-0000-4000-8000-000000000000' },
      'channelId',
    );
    await field({ ...voiceEvent('Both'), location: 'Here' }, 'location');
    await field({ ...voiceEvent('Short end'), endAt: at(30 * MIN) }, 'endAt');
    const secret = (
      await t
        .api(owner)
        .post(`/api/spaces/${spaceId()}/channels`)
        .send({ type: 'space_voice', name: 'Staff Room', privateRoleIds: [] })
        .expect(201)
    ).body as ChatSummary;
    await spaceRegistryIdle();
    const hidden = await create(bob, { ...voiceEvent('Hidden'), channelId: secret.id }).expect(400);
    expect(hidden.body.error.message).toMatch(/^channelId/);
    // The owner sees it.
    const staff = await make(owner, { ...voiceEvent('Staff meeting'), channelId: secret.id });
    await t.api(owner).delete(`${base()}/${staff.id}`).expect(204);
    // Names (zod).
    await create(owner, { ...voiceEvent(''), name: '   ' }).expect(400);
    await create(owner, voiceEvent('x'.repeat(101))).expect(400);
    // The cover: my own banner-sized image.
    const theirs = await insertImage(bob.id);
    await create(owner, { ...voiceEvent('Stolen'), imageMediaId: theirs.id }).expect(404);
    const mine = await insertImage(owner.id);
    const withCover = await make(owner, { ...voiceEvent('Cover'), imageMediaId: mine.id });
    expect(withCover.imageUrl).toBe(`/uploads/${mine.storageKey}`);
    await t.api(owner).delete(`${base()}/${withCover.id}`).expect(204);
  });

  it('the cap: MAX_SPACE_EVENTS scheduled or active per Space (409 limit_reached)', async () => {
    const open = (await list(owner)).length;
    const fillers = await db
      .insert(spaceEvents)
      .values(
        Array.from({ length: MAX_SPACE_EVENTS - open }, (_, i) => ({
          spaceId: spaceId(),
          name: `filler ${i}`,
          entityType: 'voice' as const,
          channelId: voice().id,
          startAt: new Date(Date.now() + 1000 * HOUR),
        })),
      )
      .returning({ id: spaceEvents.id });
    const full = await create(owner, voiceEvent('One more')).expect(409);
    expect(full.body.error.code).toBe('limit_reached');
    // Finished events do not count.
    await db
      .update(spaceEvents)
      .set({ status: 'canceled' })
      .where(eq(spaceEvents.id, fillers[0]!.id));
    const last = await make(owner, voiceEvent('Last one'));
    for (const f of fillers) await db.delete(spaceEvents).where(eq(spaceEvents.id, f.id));
    await t.api(owner).delete(`${base()}/${last.id}`).expect(204);
  });

  it('lists the scheduled and active events by start time with my own `interested`; 404 for non-members', async () => {
    const later = await make(owner, voiceEvent('Later', 5 * HOUR));
    const soon = await make(owner, voiceEvent('Soon', 10 * MIN));
    const bobs = await list(bob);
    const names = bobs.map((e) => e.name);
    expect(names.indexOf('Soon')).toBeLessThan(names.indexOf('Movie night'));
    expect(names.indexOf('Movie night')).toBeLessThan(names.indexOf('Later'));
    expect(bobs.find((e) => e.id === soon.id)).toMatchObject({
      interested: false,
      interestedCount: 1,
    });
    expect(bobs.find((e) => e.name === 'Picnic')).toMatchObject({ interested: true });
    expect((await list(owner)).find((e) => e.id === later.id)!.interested).toBe(true);
    await t.api(carol).get(base()).expect(404);
    await t.api(owner).delete(`${base()}/${later.id}`).expect(204);
    await t.api(owner).delete(`${base()}/${soon.id}`).expect(204);
  });

  it('Interested: idempotent toggles keep the count; the room hears the count viewer-neutral', async () => {
    const ev = await make(owner, voiceEvent('Game night'));
    const so = await t.connect(owner);
    const bump = waitForEvent(so, 'space:event', { filter: (p) => p.event.id === ev.id });
    const on = (await t.api(dave).put(`${base()}/${ev.id}/interested`).expect(200))
      .body as SpaceEvent;
    expect(on).toMatchObject({ id: ev.id, interested: true, interestedCount: 2 });
    expect((await bump).event).toMatchObject({ interestedCount: 2, interested: false });
    // Again: nothing changes, nothing is sent.
    const quiet = expectNoEvent(so, 'space:event');
    expect((await t.api(dave).put(`${base()}/${ev.id}/interested`).expect(200)).body).toMatchObject(
      {
        interested: true,
        interestedCount: 2,
      },
    );
    await quiet;
    // Who: members, earliest first, paged.
    const who = (await t.api(bob).get(`${base()}/${ev.id}/interested`).expect(200))
      .body as UserPublic[];
    expect(who.map((u) => u.id)).toEqual([owner.id, dave.id]);
    const page = (
      await t.api(bob).get(`${base()}/${ev.id}/interested?limit=1&after=${owner.id}`).expect(200)
    ).body as UserPublic[];
    expect(page.map((u) => u.id)).toEqual([dave.id]);
    await t.api(carol).get(`${base()}/${ev.id}/interested`).expect(404);
    // Off, twice.
    const off = (await t.api(dave).delete(`${base()}/${ev.id}/interested`).expect(200))
      .body as SpaceEvent;
    expect(off).toMatchObject({ interested: false, interestedCount: 1 });
    expect(
      (await t.api(dave).delete(`${base()}/${ev.id}/interested`).expect(200)).body,
    ).toMatchObject({
      interestedCount: 1,
    });
    // Concurrent toggles from many members count exactly.
    await Promise.all(
      [bob, dave].map((u) => t.api(u).put(`${base()}/${ev.id}/interested`).expect(200)),
    );
    expect((await list(owner)).find((e) => e.id === ev.id)!.interestedCount).toBe(3);
    await t.api(carol).put(`${base()}/${ev.id}/interested`).expect(404);
    await t.api(owner).put(`${base()}/00000000-0000-4000-8000-000000000000/interested`).expect(404);
    so.disconnect();
  });

  it('the creator or MANAGE_SPACE edits; other members cannot', async () => {
    const [movie] = (await list(owner)).filter((e) => e.name === 'Movie night');
    const picnic = (await list(owner)).find((e) => e.name === 'Picnic')!;
    // Bob plans events (MANAGE_CHANNELS) but cannot edit the owner's.
    await patch(bob, movie!.id, { name: 'Bob night' }).expect(403);
    await t.api(bob).delete(`${base()}/${movie!.id}`).expect(403);
    await patch(dave, picnic.id, { name: 'Dave picnic' }).expect(403);
    await patch(carol, picnic.id, { name: 'Carol picnic' }).expect(404);
    // His own: yes.
    const sb = await t.connect(bob);
    const heard = waitForEvent(sb, 'space:event', {
      filter: (p) => p.event.id === picnic.id && p.event.name === 'Big picnic',
    });
    const renamed = (
      await patch(bob, picnic.id, { name: 'Big picnic', description: 'Blankets' }).expect(200)
    ).body as SpaceEvent;
    expect(renamed).toMatchObject({
      name: 'Big picnic',
      description: 'Blankets',
      interested: true,
    });
    expect((await heard).event.interested).toBe(false);
    // The owner (MANAGE_SPACE) edits anyone's: to voice, the location goes.
    const moved = (
      await patch(owner, picnic.id, { entityType: 'voice', channelId: voice().id }).expect(200)
    ).body as SpaceEvent;
    expect(moved).toMatchObject({
      entityType: 'voice',
      channelId: voice().id,
      location: null,
      interested: false,
    });
    // And back somewhere else: the channel goes, a location and an end are needed.
    await patch(owner, picnic.id, { entityType: 'external' }).expect(400);
    const beach = waitForEvent(sb, 'space:event', {
      filter: (p) => p.event.id === picnic.id && p.event.location === 'Beach',
    });
    const back = (
      await patch(owner, picnic.id, {
        entityType: 'external',
        location: 'Beach',
        endAt: at(4 * HOUR),
      }).expect(200)
    ).body as SpaceEvent;
    expect(back).toMatchObject({ entityType: 'external', channelId: null, location: 'Beach' });
    await beach;
    // A moved start obeys the window; an unchanged one is not checked again.
    await patch(owner, picnic.id, { startAt: at(-MIN) }).expect(400);
    await patch(owner, picnic.id, { endAt: at(30 * MIN) }).expect(400);
    // Nothing changed: no event.
    const quiet = expectNoEvent(sb, 'space:event');
    await patch(owner, picnic.id, { name: 'Big picnic' }).expect(200);
    await quiet;
    const audit = (
      await t.api(owner).get(`/api/spaces/${spaceId()}/audit-log?action=event.update`).expect(200)
    ).body as SpaceAuditEntry[];
    expect(audit[0]).toMatchObject({ actorId: owner.id, targetId: picnic.id });
    expect(audit[0]!.changes).toMatchObject({
      entityType: ['voice', 'external'],
      location: [null, 'Beach'],
    });
    sb.disconnect();
  });

  it('status: start from 15 minutes before, end a live event, cancel a scheduled one', async () => {
    const ev = await make(owner, voiceEvent('Standup', HOUR));
    await t.api(dave).put(`${base()}/${ev.id}/interested`).expect(200);
    const early = await patch(owner, ev.id, { status: 'active' }).expect(400);
    expect(early.body.error.message).toMatch(/^status/);
    await patch(owner, ev.id, { status: 'completed' }).expect(409);
    await patch(owner, ev.id, { startAt: at(10 * MIN) }).expect(200);
    const sd = await t.connect(dave);
    const sc = await t.connect(bob);
    const so = await t.connect(owner);
    const reminder = waitForEvent(sd, 'space:event-started', {
      filter: (p) => p.event.id === ev.id,
    });
    // Only the interested hear the reminder, and not the organizer who started it.
    const quiet = Promise.all([
      expectNoEvent(sc, 'space:event-started', 600),
      expectNoEvent(so, 'space:event-started', 600),
    ]);
    const live = (await patch(owner, ev.id, { status: 'active' }).expect(200)).body as SpaceEvent;
    expect(live).toMatchObject({ status: 'active', interested: true });
    expect((await reminder).event).toMatchObject({ id: ev.id, status: 'active', interested: true });
    await quiet;
    so.disconnect();
    // Starting again is a no-op; a live event keeps its start and cannot be canceled.
    await patch(owner, ev.id, { status: 'active' }).expect(200);
    await patch(owner, ev.id, { startAt: at(20 * MIN) }).expect(400);
    await patch(owner, ev.id, { status: 'canceled' }).expect(409);
    // Still editable while live.
    await patch(owner, ev.id, { name: 'Standup (live)' }).expect(200);
    const ended = (await patch(owner, ev.id, { status: 'completed' }).expect(200))
      .body as SpaceEvent;
    expect(ended.status).toBe('completed');
    expect((await list(owner)).some((e) => e.id === ev.id)).toBe(false);
    await patch(owner, ev.id, { name: 'Again' }).expect(409);
    await t.api(dave).put(`${base()}/${ev.id}/interested`).expect(409);
    // Cancel a scheduled one.
    const other = await make(owner, voiceEvent('Retro'));
    const canceled = (await patch(owner, other.id, { status: 'canceled' }).expect(200))
      .body as SpaceEvent;
    expect(canceled.status).toBe('canceled');
    expect((await list(owner)).some((e) => e.id === other.id)).toBe(false);
    sd.disconnect();
    sc.disconnect();
  });

  it('delete: space:event-deleted to the Space room, gone from the list', async () => {
    const ev = await make(owner, voiceEvent('Doomed'));
    const sb = await t.connect(bob);
    const gone = waitForEvent(sb, 'space:event-deleted', { filter: (p) => p.eventId === ev.id });
    await t.api(owner).delete(`${base()}/${ev.id}`).expect(204);
    expect(await gone).toEqual({ spaceId: spaceId(), eventId: ev.id });
    expect((await list(bob)).some((e) => e.id === ev.id)).toBe(false);
    await t.api(owner).delete(`${base()}/${ev.id}`).expect(404);
    sb.disconnect();
  });

  it('a deleted voice channel closes its events', async () => {
    const room = (
      await t
        .api(owner)
        .post(`/api/spaces/${spaceId()}/channels`)
        .send({ type: 'space_voice', name: 'Pop-up' })
        .expect(201)
    ).body as ChatSummary;
    await spaceRegistryIdle();
    const ev = await make(owner, { ...voiceEvent('Pop-up show'), channelId: room.id });
    const sb = await t.connect(bob);
    const closed = waitForEvent(sb, 'space:event', { filter: (p) => p.event.id === ev.id });
    await t.api(owner).delete(`/api/spaces/${spaceId()}/channels/${room.id}`).expect(204);
    expect((await closed).event).toMatchObject({ status: 'canceled', channelId: null });
    sb.disconnect();
  });

  it('a deleted account takes its interest back', async () => {
    const erin = await t.createUser({ displayName: 'Erin' });
    const invite = (
      await t.api(owner).post(`/api/spaces/${spaceId()}/invites`).send({}).expect(201)
    ).body as SpaceInvite;
    await t.api(erin).post(`/api/invites/${invite.code}/join`).expect(200);
    await spaceRegistryIdle();
    const ev = await make(owner, voiceEvent('Farewell'));
    await t.api(erin).put(`${base()}/${ev.id}/interested`).expect(200);
    const sb = await t.connect(bob);
    const back = waitForEvent(sb, 'space:event', {
      filter: (p) => p.event.id === ev.id && p.event.interestedCount === 1,
    });
    await t.api(erin).delete('/api/me').send({ password: erin.password }).expect(204);
    await back;
    expect((await list(owner)).find((e) => e.id === ev.id)!.interestedCount).toBe(1);
    sb.disconnect();
  });

  it('events reach members only; leaving the Space hides them', async () => {
    const sc = await t.connect(carol);
    const sd = await t.connect(dave);
    const seen = waitForEvent(sd, 'space:event', {
      filter: (p) => p.event.name === 'Members only',
    });
    const silent = expectNoEvent(sc, 'space:event');
    await make(owner, voiceEvent('Members only'));
    await seen;
    await silent;
    await t.api(dave).post(`/api/spaces/${spaceId()}/leave`).expect(204);
    await spaceRegistryIdle();
    await t.api(dave).get(base()).expect(404);
    const after = expectNoEvent(sd, 'space:event');
    await make(owner, voiceEvent('After Dave left'));
    await after;
    sc.disconnect();
    sd.disconnect();
  });

  it('a voice event in a channel I cannot see is not listed for me; leaving takes my interest back', async () => {
    const hidden = (
      await t
        .api(owner)
        .post(`/api/spaces/${spaceId()}/channels`)
        .send({ type: 'space_voice', name: 'Staff Voice', privateRoleIds: [] })
        .expect(201)
    ).body as { id: string };
    await spaceRegistryIdle();
    const secret = await make(owner, voiceEvent('Staff sync', HOUR, { channelId: hidden.id }));
    expect((await list(owner)).map((e) => e.id)).toContain(secret.id);
    expect((await list(bob)).map((e) => e.id)).not.toContain(secret.id);

    const erin = await t.createUser({ displayName: 'Erin' });
    const invite = (
      await t.api(owner).post(`/api/spaces/${spaceId()}/invites`).send({}).expect(201)
    ).body as SpaceInvite;
    await t.api(erin).post(`/api/invites/${invite.code}/join`).expect(200);
    await spaceRegistryIdle();
    const open = await make(owner, voiceEvent('Open hangout'));
    await t.api(erin).put(`${base()}/${open.id}/interested`).expect(200);
    expect((await list(owner)).find((e) => e.id === open.id)?.interestedCount).toBe(2);
    await t.api(erin).post(`/api/spaces/${spaceId()}/leave`).expect(204);
    expect((await list(owner)).find((e) => e.id === open.id)?.interestedCount).toBe(1);
  });

  it('the job: external events start and end on time; voice events close late or are canceled', async () => {
    const endpoint = `https://fcm.googleapis.com/fcm/send/${bob.id}`;
    await t
      .api(bob)
      .post('/api/push/subscriptions')
      .send({ endpoint, keys: { p256dh: 'BPublicKey', auth: 'authSecret' } })
      .expect(204);
    const fair = await make(owner, externalEvent('Street fair', HOUR, 3 * HOUR));
    await t.api(bob).put(`${base()}/${fair.id}/interested`).expect(200);
    const unstarted = await make(owner, voiceEvent('Forgotten', HOUR));
    const talk = await make(owner, voiceEvent('Talk', 10 * MIN, { endAt: at(HOUR) }));
    await patch(owner, talk.id, { status: 'active' }).expect(200);
    const open = await make(owner, voiceEvent('Open end', 10 * MIN));
    await patch(owner, open.id, { status: 'active' }).expect(200);

    // Before anything is due: nothing moves.
    await runEventsJob({ now: new Date(Date.now() + 30 * MIN) });
    expect(await statusOf(fair.id)).toBe('scheduled');

    // The fair's start time: it starts, the interested hear about it (socket and push).
    const sb = await t.connect(bob);
    const reminder = waitForEvent(sb, 'space:event-started', {
      filter: (p) => p.event.id === fair.id,
    });
    const first = await runEventsJob({ now: new Date(Date.now() + HOUR + MIN) });
    expect(first.started).toBeGreaterThanOrEqual(1);
    expect((await reminder).event).toMatchObject({ status: 'active', interested: true });
    expect(await statusOf(fair.id)).toBe('active');
    // Voice events wait for an organizer; the live talk is within its grace hour.
    expect(await statusOf(unstarted.id)).toBe('scheduled');
    expect(await statusOf(talk.id)).toBe('active');
    await pushIdle();
    expect(pushes).toContainEqual({
      endpoint,
      payload: expect.objectContaining({
        type: 'message',
        title: 'Event starting: Street fair',
        body: 'Events Lab',
        tag: `event:${fair.id}`,
        url: `/spaces/${spaceId()}?event=${fair.id}`,
      }),
    });

    // Two hours past the talk's end and the forgotten event's start.
    await runEventsJob({ now: new Date(Date.now() + 3 * HOUR + 5 * MIN) });
    expect(await statusOf(fair.id)).toBe('completed');
    expect(await statusOf(talk.id)).toBe('completed');
    expect(await statusOf(unstarted.id)).toBe('canceled');
    // A live voice event without an end time stays open for a day.
    expect(await statusOf(open.id)).toBe('active');
    await runEventsJob({ now: new Date(Date.now() + 25 * HOUR) });
    expect(await statusOf(open.id)).toBe('completed');
    // An external event whose end passed before it was started goes straight to completed.
    const missed = await make(owner, externalEvent('Missed', HOUR, 2 * HOUR));
    const quiet = expectNoEvent(sb, 'space:event-started');
    await runEventsJob({ now: new Date(Date.now() + 3 * HOUR) });
    await quiet;
    expect(await statusOf(missed.id)).toBe('completed');
    expect((await list(owner)).map((e) => e.id)).not.toContain(fair.id);
    sb.disconnect();
  });
});
