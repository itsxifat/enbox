/**
 * Active Now (modules/activity, W9-E): `GET /me/friends/activity` lists the voice and Stage
 * channels my friends are in — friends only (mutual contacts, no blocks), Spaces I am a member
 * of, channels I can see (a private channel shows once an overwrite lets me in) — one card per
 * channel: friends by join time, the first 8 people there with friends first and the total,
 * the streaming flag, `since`; the most friends first. Voice states are written directly (the
 * endpoint reads them; joining through the socket is covered by spaces/voice.test.ts).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { PERM, type FriendActivity, type SpaceDetail, type SpaceInvite } from '@enbox/shared';
import { NODE_ID } from '../../src/cluster/node.js';
import { db } from '../../src/db/index.js';
import { blocks, voiceStates } from '../../src/db/schema.js';
import { ACTIVITY_PARTICIPANTS } from '../../src/modules/activity/service.js';
import { spaceRegistryIdle } from '../../src/realtime/spaceRegistry.js';
import { startTestServer, type TestServer, type TestUser } from '../helpers.js';
import { bulkUsers } from '../groups/util.js';
import { block, saveContact } from '../services/fixtures.js';

describe('Active Now', () => {
  let t: TestServer;
  let me: TestUser;
  let owner: TestUser;
  let ann: TestUser;
  let bob: TestUser;
  let cat: TestUser;
  let dan: TestUser;
  let eve: TestUser;
  let fay: TestUser;
  let gus: TestUser;
  let hal: TestUser;
  let home: SpaceDetail;
  let away: SpaceDetail;
  let lounge: { id: string };
  let staff: { id: string };
  let townHall: { id: string };
  const general = () => home.channels.find((c) => c.type === 'space_voice')!;
  const T0 = Date.parse('2026-10-23T10:00:00.000Z');
  const at = (min: number) => new Date(T0 + min * 60_000);

  const activity = async (u: TestUser = me) =>
    (await t.api(u).get('/api/me/friends/activity').expect(200)).body as FriendActivity[];

  /** `userId` is in `channelId` since minute `min` (what `voice:join` leaves in the table). */
  async function inVoice(
    userId: string,
    space: SpaceDetail,
    channelId: string,
    min: number,
    flags: { selfStream?: boolean } = {},
  ) {
    await db.insert(voiceStates).values({
      userId,
      spaceId: space.space.id,
      channelId,
      socketId: `test-${userId}`,
      nodeId: NODE_ID,
      selfStream: flags.selfStream ?? false,
      joinedAt: at(min),
      updatedAt: at(min),
    });
  }

  async function befriend(a: TestUser, b: TestUser) {
    await saveContact(a, b);
    await saveContact(b, a);
  }

  async function joinSpace(space: SpaceDetail, users: TestUser[]) {
    const invite = (
      await t.api(owner).post(`/api/spaces/${space.space.id}/invites`).send({}).expect(201)
    ).body as SpaceInvite;
    for (const u of users) await t.api(u).post(`/api/invites/${invite.code}/join`).expect(200);
  }

  async function channel(space: SpaceDetail, body: Record<string, unknown>) {
    return (
      await t.api(owner).post(`/api/spaces/${space.space.id}/channels`).send(body).expect(201)
    ).body as { id: string };
  }

  beforeAll(async () => {
    t = await startTestServer();
    [me, owner, ann, bob, cat, dan, eve, fay, gus, hal] = (await Promise.all(
      ['Me', 'Owner', 'Ann', 'Bob', 'Cat', 'Dan', 'Eve', 'Fay', 'Gus', 'Hal'].map((displayName) =>
        t.createUser({ displayName }),
      ),
    )) as [
      TestUser,
      TestUser,
      TestUser,
      TestUser,
      TestUser,
      TestUser,
      TestUser,
      TestUser,
      TestUser,
      TestUser,
    ];
    home = (await t.api(owner).post('/api/spaces').send({ name: 'Home' }).expect(201))
      .body as SpaceDetail;
    away = (await t.api(owner).post('/api/spaces').send({ name: 'Away' }).expect(201))
      .body as SpaceDetail;
    await joinSpace(home, [me, ann, bob, cat, dan, fay, gus, hal]);
    // Eve is only in a Space I am not a member of.
    await joinSpace(away, [eve]);
    lounge = await channel(home, { type: 'space_voice', name: 'Lounge' });
    staff = await channel(home, { type: 'space_voice', name: 'Staff', privateRoleIds: [] });
    townHall = await channel(home, { type: 'space_stage', name: 'Town Hall' });
    await spaceRegistryIdle();

    for (const friend of [ann, bob, eve, fay, gus, hal]) await befriend(me, friend);
    // Cat is in my contacts, but I am not in hers: not a friend.
    await saveContact(me, cat);
    await block(me, gus);
  });
  afterEach(async () => {
    await db.delete(voiceStates);
  });
  afterAll(() => t.close());

  it('is empty while no friend is in voice', async () => {
    await inVoice(dan.id, home, general().id, 0);
    expect(await activity()).toEqual([]);
  });

  it('one card per channel: friends by join time, everyone there friends first, the total, streaming, since', async () => {
    await inVoice(dan.id, home, general().id, 0);
    await inVoice(ann.id, home, general().id, 1);
    await inVoice(cat.id, home, general().id, 2, { selfStream: true });
    await inVoice(bob.id, home, general().id, 3);
    await inVoice(hal.id, home, townHall.id, 5);

    const cards = await activity();
    expect(cards).toEqual([
      {
        spaceId: home.space.id,
        spaceName: 'Home',
        spaceIconUrl: null,
        channelId: general().id,
        channelName: 'General',
        channelType: 'space_voice',
        friendIds: [ann.id, bob.id],
        participantIds: [ann.id, bob.id, dan.id, cat.id],
        participantCount: 4,
        streaming: true,
        since: at(1).toISOString(),
      },
      {
        spaceId: home.space.id,
        spaceName: 'Home',
        spaceIconUrl: null,
        channelId: townHall.id,
        channelName: 'Town Hall',
        channelType: 'space_stage',
        friendIds: [hal.id],
        participantIds: [hal.id],
        participantCount: 1,
        streaming: false,
        since: at(5).toISOString(),
      },
    ]);
    // Ann's only friend is me, and I am not in voice.
    expect(await activity(ann)).toEqual([]);
  });

  it('friends only: one-way contacts, strangers and blocked friends never make a card', async () => {
    await inVoice(cat.id, home, general().id, 0);
    await inVoice(dan.id, home, general().id, 1);
    await inVoice(gus.id, home, lounge.id, 2);
    expect(await activity()).toEqual([]);
    // A block the other way hides them too.
    await inVoice(ann.id, home, lounge.id, 3);
    await block(ann, me);
    try {
      expect(await activity()).toEqual([]);
    } finally {
      await db.delete(blocks).where(and(eq(blocks.blockerId, ann.id), eq(blocks.blockedId, me.id)));
    }
    expect((await activity()).map((c) => c.channelId)).toEqual([lounge.id]);
  });

  it('a friend I ignore makes no card of their own, but still counts as someone there', async () => {
    await inVoice(bob.id, home, general().id, 0);
    await inVoice(ann.id, home, general().id, 1);
    await inVoice(hal.id, home, lounge.id, 2);
    for (const u of [bob, hal]) await t.api(me).put(`/api/users/${u.id}/ignore`).expect(204);
    try {
      expect((await activity()).map((c) => [c.channelId, c.friendIds, c.participantIds])).toEqual([
        [general().id, [ann.id], [ann.id, bob.id]],
      ]);
    } finally {
      for (const u of [bob, hal]) await t.api(me).delete(`/api/users/${u.id}/ignore`).expect(204);
    }
    expect((await activity()).map((c) => c.channelId)).toEqual([general().id, lounge.id]);
  });

  it('only Spaces I am in and channels I can see: a private channel shows once an overwrite lets me in', async () => {
    await inVoice(eve.id, away, away.channels.find((c) => c.type === 'space_voice')!.id, 0);
    await inVoice(fay.id, home, staff.id, 1);
    expect(await activity()).toEqual([]);

    await t
      .api(owner)
      .put(`/api/spaces/${home.space.id}/channels/${staff.id}/overwrites/member/${me.id}`)
      .send({ allow: PERM.VIEW_CHANNEL, deny: 0 })
      .expect(200);
    await spaceRegistryIdle();
    const cards = await activity();
    expect(cards.map((c) => [c.channelName, c.friendIds])).toEqual([['Staff', [fay.id]]]);

    await t
      .api(owner)
      .delete(`/api/spaces/${home.space.id}/channels/${staff.id}/overwrites/member/${me.id}`)
      .expect(200);
    await spaceRegistryIdle();
    expect(await activity()).toEqual([]);
  });

  it(`the most friends first; at most ${ACTIVITY_PARTICIPANTS} people per card, friends first, with the total`, async () => {
    const crowd = await bulkUsers(ACTIVITY_PARTICIPANTS + 2);
    // Strangers fill the Lounge before my friends arrive.
    for (const [i, id] of crowd.entries()) await inVoice(id, home, lounge.id, i);
    await inVoice(hal.id, home, lounge.id, 30);
    await inVoice(fay.id, home, lounge.id, 31);
    await inVoice(ann.id, home, general().id, 20);

    const cards = await activity();
    expect(cards.map((c) => c.channelId)).toEqual([lounge.id, general().id]);
    const [crowded] = cards;
    expect(crowded!.friendIds).toEqual([hal.id, fay.id]);
    expect(crowded!.participantIds).toEqual([
      hal.id,
      fay.id,
      ...crowd.slice(0, ACTIVITY_PARTICIPANTS - 2),
    ]);
    expect(crowded!.participantCount).toBe(crowd.length + 2);
    expect(crowded!.since).toBe(at(30).toISOString());
  });

  // Last: I leave Home.
  it('nothing from a Space I left', async () => {
    await inVoice(ann.id, home, general().id, 0);
    expect(await activity()).toHaveLength(1);
    await t.api(me).post(`/api/spaces/${home.space.id}/leave`).expect(204);
    await spaceRegistryIdle();
    expect(await activity()).toEqual([]);
  });
});
