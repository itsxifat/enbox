/**
 * Space insights (docs/design/discord-parity.md W12-F): messages counted in memory and
 * flushed (per Space, per channel, active members), joins and leaves in the membership
 * transaction, voice minutes sampled by the leader, the range read with zeros filled, top
 * channels limited to what the viewer can see, permissions and the CSV export.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  PERM,
  type ChatSummary,
  type InsightsDay,
  type SpaceDetail,
  type SpaceInsights,
  type SpaceInvite,
  type SpaceRole,
} from '@enbox/shared';
import { db } from '../../src/db/index.js';
import {
  spaceActiveDaily,
  spaceChannelStatsDaily,
  spaceStatsDaily,
  voiceStates,
} from '../../src/db/schema.js';
import {
  countMessage,
  flushInsightCounters,
  resetInsightCounters,
  sampleVoiceMinutes,
  utcDay,
} from '../../src/modules/insights/counters.js';
import { rangeDays } from '../../src/modules/insights/service.js';
import { spaceRegistryIdle } from '../../src/realtime/spaceRegistry.js';
import { startTestServer, type TestServer, type TestUser } from '../helpers.js';

describe('space insights', () => {
  let t: TestServer;
  let owner: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let dave: TestUser;
  let eve: TestUser;
  let outsider: TestUser;
  let detail: SpaceDetail;
  let invite: SpaceInvite;
  let random: ChatSummary;
  const today = utcDay();
  const general = () => detail.channels.find((c) => c.name === 'general')!;
  const voice = () => detail.channels.find((c) => c.type === 'space_voice')!;
  const spaceId = () => detail.space.id;

  beforeAll(async () => {
    t = await startTestServer();
    resetInsightCounters();
    [owner, bob, carol, dave, eve, outsider] = [
      await t.createUser({ displayName: 'Owner' }),
      await t.createUser({ displayName: 'Bob' }),
      await t.createUser({ displayName: 'Carol' }),
      await t.createUser({ displayName: 'Dave' }),
      await t.createUser({ displayName: 'Eve' }),
      await t.createUser({ displayName: 'Outsider' }),
    ];
    detail = (await t.api(owner).post('/api/spaces').send({ name: 'Stats' }).expect(201))
      .body as SpaceDetail;
    invite = (await t.api(owner).post(`/api/spaces/${spaceId()}/invites`).send({}).expect(201))
      .body as SpaceInvite;
  });
  afterAll(() => t.close());

  const send = (user: TestUser, chatId: string, text: string) =>
    t
      .api(user)
      .post(`/api/chats/${chatId}/messages`)
      .send({ clientId: Math.random().toString(36), type: 'text', text })
      .expect(201);

  async function join(user: TestUser) {
    await t.api(user).post(`/api/invites/${invite.code}/join`).expect(200);
    await spaceRegistryIdle();
  }

  async function insights(user: TestUser, days = 7, id = spaceId()): Promise<SpaceInsights> {
    return (await t.api(user).get(`/api/spaces/${id}/insights`).query({ days }).expect(200))
      .body as SpaceInsights;
  }

  const on = (i: SpaceInsights, day = today): InsightsDay => i.days.find((d) => d.day === day)!;

  async function grant(user: TestUser, name: string, permissions: number) {
    const role = (
      await t
        .api(owner)
        .post(`/api/spaces/${spaceId()}/roles`)
        .send({ name, permissions })
        .expect(201)
    ).body as SpaceRole;
    await t
      .api(owner)
      .put(`/api/spaces/${spaceId()}/members/${user.id}/roles/${role.id}`)
      .expect(200);
    return role;
  }

  it('counts the creator’s join on the day the Space is created; counting starts that day', async () => {
    const i = await insights(owner);
    expect(i).toMatchObject({ spaceId: spaceId(), memberCount: 1, topChannels: [] });
    expect(i.since).toBe(`${today}T00:00:00.000Z`);
    expect(on(i)).toEqual({
      day: today,
      messages: 0,
      joins: 1,
      leaves: 0,
      activeMembers: 0,
      voiceMinutes: 0,
    });
  });

  it('counts members’ messages per Space and channel, and who was active, once flushed', async () => {
    await join(bob); // its join notice (a system message) never counts
    random = (
      await t
        .api(owner)
        .post(`/api/spaces/${spaceId()}/channels`)
        .send({ type: 'space_text', name: 'random' })
        .expect(201)
    ).body as ChatSummary;
    await send(owner, general().id, 'one');
    await send(owner, general().id, 'two');
    await send(bob, general().id, 'three');
    await send(owner, random.id, 'four');
    // In memory until the flush.
    expect(on(await insights(owner)).messages).toBe(0);
    await flushInsightCounters();
    const i = await insights(owner);
    expect(on(i)).toMatchObject({ messages: 4, activeMembers: 2, joins: 2 });
    expect(i.topChannels).toEqual([
      { channelId: general().id, name: 'general', messages: 3 },
      { channelId: random.id, name: 'random', messages: 1 },
    ]);
    // Flushes add up; nothing pending flushes nothing.
    await send(bob, random.id, 'five');
    await flushInsightCounters();
    await flushInsightCounters();
    const again = await insights(owner);
    expect(on(again)).toMatchObject({ messages: 5, activeMembers: 2 });
    expect(again.topChannels.map((c) => [c.name, c.messages])).toEqual([
      ['general', 3],
      ['random', 2],
    ]);
    const rows = await db
      .select()
      .from(spaceActiveDaily)
      .where(eq(spaceActiveDaily.spaceId, spaceId()));
    expect(rows.map((r) => r.userId).sort()).toEqual([owner.id, bob.id].sort());
  });

  it('a thread’s messages count for its parent channel', async () => {
    const thread = (
      await t.api(bob).post(`/api/chats/${random.id}/threads`).send({ name: 'Plans' }).expect(201)
    ).body as ChatSummary;
    await spaceRegistryIdle();
    await send(bob, thread.id, 'in the thread');
    await flushInsightCounters();
    const i = await insights(owner);
    expect(on(i).messages).toBe(6);
    expect(i.topChannels.map((c) => [c.name, c.messages])).toEqual([
      ['general', 3],
      ['random', 3],
    ]);
    expect(
      await db
        .select()
        .from(spaceChannelStatsDaily)
        .where(eq(spaceChannelStatsDaily.channelId, thread.id)),
    ).toEqual([]);
  });

  it('only members’ messages in Space channels count (not system, call or webhook posts, nor DMs)', async () => {
    const before = on(await insights(owner)).messages;
    const at = new Date();
    const chat = { id: general().id, spaceId: spaceId(), parentId: null };
    countMessage({ senderId: null, type: 'text', createdAt: at }, chat); // webhook post
    countMessage({ senderId: null, type: 'system', createdAt: at }, chat);
    countMessage({ senderId: owner.id, type: 'call', createdAt: at }, chat);
    countMessage({ senderId: owner.id, type: 'text', createdAt: at }, { ...chat, spaceId: null });
    await flushInsightCounters();
    expect(on(await insights(owner)).messages).toBe(before);
  });

  it('joins and leaves: invite joins, leaving and kicks, in the membership transaction', async () => {
    await join(carol);
    await join(dave);
    let i = await insights(owner);
    expect(on(i)).toMatchObject({ joins: 4, leaves: 0 });
    expect(i.memberCount).toBe(4);
    await t.api(carol).post(`/api/spaces/${spaceId()}/leave`).expect(204);
    await t.api(owner).delete(`/api/spaces/${spaceId()}/members/${dave.id}`).expect(204);
    i = await insights(owner);
    expect(on(i)).toMatchObject({ joins: 4, leaves: 2 });
    expect(i.memberCount).toBe(2);
    // Joining again counts again.
    await join(carol);
    expect(on(await insights(owner))).toMatchObject({ joins: 5, leaves: 2 });
  });

  it('voice: every sample adds a minute per voice state and makes those users active', async () => {
    await join(eve);
    await db.insert(voiceStates).values(
      [owner, eve].map((u) => ({
        userId: u.id,
        spaceId: spaceId(),
        channelId: voice().id,
        socketId: `sock-${u.id}`,
        nodeId: 'test-node',
      })),
    );
    expect(await sampleVoiceMinutes()).toBe(2);
    expect(await sampleVoiceMinutes()).toBe(2);
    const i = await insights(owner);
    // Owner and Bob sent messages; Eve was only in voice.
    expect(on(i)).toMatchObject({ voiceMinutes: 4, activeMembers: 3 });
    await db.delete(voiceStates).where(eq(voiceStates.spaceId, spaceId()));
    expect(await sampleVoiceMinutes()).toBe(0);
    expect(on(await insights(owner)).voiceMinutes).toBe(4);
  });

  it('ranges: one entry per day, oldest first, zeros filled; older rows only in longer ranges', async () => {
    const [ago10, ago3] = [rangeDays(11, today)[0]!, rangeDays(4, today)[0]!];
    await db.insert(spaceStatsDaily).values([
      { spaceId: spaceId(), day: ago3, messages: 7, joins: 1, leaves: 1, voiceMinutes: 30 },
      { spaceId: spaceId(), day: ago10, messages: 9 },
    ]);
    await db.insert(spaceActiveDaily).values({ spaceId: spaceId(), day: ago3, userId: bob.id });

    const week = await insights(owner, 7);
    expect(week.days).toHaveLength(7);
    expect(week.days.map((d) => d.day)).toEqual(rangeDays(7, today));
    expect(week.days[6]!.day).toBe(today);
    expect(on(week, ago3)).toEqual({
      day: ago3,
      messages: 7,
      joins: 1,
      leaves: 1,
      activeMembers: 1,
      voiceMinutes: 30,
    });
    expect(week.days.filter((d) => d.day !== ago3 && d.day !== today)).toEqual(
      week.days
        .filter((d) => d.day !== ago3 && d.day !== today)
        .map((d) => ({
          day: d.day,
          messages: 0,
          joins: 0,
          leaves: 0,
          activeMembers: 0,
          voiceMinutes: 0,
        })),
    );
    expect(week.days.some((d) => d.day === ago10)).toBe(false);
    // Counting "started" with the oldest row.
    expect(week.since).toBe(`${ago10}T00:00:00.000Z`);

    const month = await insights(owner, 30);
    expect(month.days).toHaveLength(30);
    expect(on(month, ago10).messages).toBe(9);
    expect((await insights(owner, 90)).days).toHaveLength(90);
    // 30 is the default; other ranges are rejected.
    const def = (await t.api(owner).get(`/api/spaces/${spaceId()}/insights`).expect(200))
      .body as SpaceInsights;
    expect(def.days).toHaveLength(30);
    await t.api(owner).get(`/api/spaces/${spaceId()}/insights`).query({ days: 14 }).expect(400);
  });

  it('top channels leave out the channels the viewer cannot see', async () => {
    const staff = (
      await t
        .api(owner)
        .post(`/api/spaces/${spaceId()}/channels`)
        .send({ type: 'space_text', name: 'staff', privateRoleIds: [] })
        .expect(201)
    ).body as ChatSummary;
    for (const text of ['a', 'b', 'c', 'd']) await send(owner, staff.id, text);
    await flushInsightCounters();
    // The owner sees everything; Bob (View Audit Log only) can't see #staff.
    expect((await insights(owner)).topChannels.map((c) => c.name)).toEqual([
      'staff',
      'general',
      'random',
    ]);
    await grant(bob, 'Auditors', PERM.VIEW_AUDIT_LOG);
    const seen = await insights(bob);
    expect(seen.topChannels.map((c) => c.name)).toEqual(['general', 'random']);
    // Totals still count every channel.
    expect(on(seen).messages).toBe(on(await insights(owner)).messages);
  });

  it('needs Manage Space or View Audit Log; non-members get 404', async () => {
    await t.api(carol).get(`/api/spaces/${spaceId()}/insights`).expect(403);
    await t.api(carol).get(`/api/spaces/${spaceId()}/insights.csv`).expect(403);
    await t.api(outsider).get(`/api/spaces/${spaceId()}/insights`).expect(404);
    await t.api(outsider).get(`/api/spaces/${spaceId()}/insights.csv`).expect(404);
    await grant(carol, 'Managers', PERM.MANAGE_SPACE);
    await insights(carol);
    await insights(bob); // View Audit Log
  });

  it('CSV: a header and one row per day, oldest first, as an attachment', async () => {
    const res = await t
      .api(owner)
      .get(`/api/spaces/${spaceId()}/insights.csv`)
      .query({ days: 7 })
      .expect(200);
    expect(res.headers['content-type']).toMatch(/^text\/csv/);
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="insights-${today}-7d.csv"`,
    );
    const lines = res.text.trim().split('\n');
    expect(lines[0]).toBe('day,messages,joins,leaves,active_members,voice_minutes');
    expect(lines).toHaveLength(8);
    const json = await insights(owner, 7);
    expect(lines.slice(1)).toEqual(
      json.days.map((d) =>
        [d.day, d.messages, d.joins, d.leaves, d.activeMembers, d.voiceMinutes].join(','),
      ),
    );
    await t.api(owner).get(`/api/spaces/${spaceId()}/insights.csv`).query({ days: 5 }).expect(400);
  });

  it('a flush drops the counts of Spaces and channels deleted meanwhile and keeps the rest', async () => {
    const other = (await t.api(eve).post('/api/spaces').send({ name: 'Short-lived' }).expect(201))
      .body as SpaceDetail;
    const gone = (
      await t
        .api(owner)
        .post(`/api/spaces/${spaceId()}/channels`)
        .send({ type: 'space_text', name: 'gone' })
        .expect(201)
    ).body as ChatSummary;
    const otherGeneral = other.channels.find((c) => c.name === 'general')!;
    const before = on(await insights(owner)).messages;
    await send(eve, otherGeneral.id, 'soon gone');
    await send(owner, gone.id, 'soon gone too');
    await send(owner, general().id, 'stays');
    await t.api(eve).delete(`/api/spaces/${other.space.id}`).expect(204);
    await t.api(owner).delete(`/api/spaces/${spaceId()}/channels/${gone.id}`).expect(204);
    await flushInsightCounters();
    const i = await insights(owner);
    // The Space-wide count keeps the deleted channel's message; its channel row is gone.
    expect(on(i).messages).toBe(before + 2);
    expect(i.topChannels.some((c) => c.channelId === gone.id)).toBe(false);
    expect(
      await db.select().from(spaceStatsDaily).where(eq(spaceStatsDaily.spaceId, other.space.id)),
    ).toEqual([]);
    expect(
      await db
        .select()
        .from(spaceChannelStatsDaily)
        .where(
          and(eq(spaceChannelStatsDaily.channelId, gone.id), eq(spaceChannelStatsDaily.day, today)),
        ),
    ).toEqual([]);
  });
});
