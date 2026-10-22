/**
 * Per-Space profiles (`PATCH /spaces/:id/members/me`): every override sets and clears (null =
 * the main profile), images must be my own uploads of the right kind, other members see the
 * overrides in the member list, `members/batch`, `members/:userId` and `space:member-updated`,
 * and leaving the Space leaves nothing behind.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Space, SpaceDetail, SpaceInvite, SpaceMember, SpaceMemberPage } from '@enbox/shared';
import { spaceRegistryIdle } from '../../src/realtime/spaceRegistry.js';
import { startTestServer, waitForEvent, type TestServer, type TestUser } from '../helpers.js';
import { insertImage } from '../accounts/util.js';

const PROFILE_NULLS = {
  avatarUrl: null,
  avatarAnimatedUrl: null,
  bannerUrl: null,
  bannerAnimatedUrl: null,
  bio: null,
  pronouns: null,
  profileColor: null,
  accentColor: null,
  avatarDecoration: null,
  profileEffect: null,
  nameplate: null,
};

describe('per-Space profiles', () => {
  let t: TestServer;
  let owner: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let detail: SpaceDetail;
  let invite: SpaceInvite;
  const spaceId = () => detail.space.id;
  const base = () => `/api/spaces/${spaceId()}`;

  beforeAll(async () => {
    t = await startTestServer();
    [owner, bob, carol] = [
      await t.createUser({ displayName: 'Owner' }),
      await t.createUser({ displayName: 'Bob' }),
      await t.createUser({ displayName: 'Carol' }),
    ];
    detail = (await t.api(owner).post('/api/spaces').send({ name: 'Profiles' }).expect(201))
      .body as SpaceDetail;
    invite = (await t.api(owner).post(`${base()}/invites`).send({}).expect(201))
      .body as SpaceInvite;
    await t.api(bob).post(`/api/invites/${invite.code}/join`).expect(200);
    await spaceRegistryIdle();
  });
  afterAll(() => t.close());

  const patchMe = (user: TestUser, body: Record<string, unknown>) =>
    t.api(user).patch(`${base()}/members/me`).send(body);

  async function memberAs(viewer: TestUser, userId: string): Promise<SpaceMember> {
    return (await t.api(viewer).get(`${base()}/members/${userId}`).expect(200)).body as SpaceMember;
  }

  it('a new member has no overrides anywhere', async () => {
    const space = (await t.api(bob).get(`${base()}/members/me`).expect(200)).body as Space;
    expect(space.me).toMatchObject(PROFILE_NULLS);
    expect(await memberAs(owner, bob.id)).toMatchObject(PROFILE_NULLS);
  });

  it('sets every field; the others see it in the list, batch, by id and live', async () => {
    const avatar = await insertImage(bob.id, { mimeType: 'image/gif', animated: true });
    const banner = await insertImage(bob.id, { mimeType: 'image/jpeg' });
    const so = await t.connect(owner);
    const updated = waitForEvent(so, 'space:member-updated', {
      filter: (p) => p.member.userId === bob.id && p.member.bio === 'Here for the raids',
    });
    const sb = await t.connect(bob);
    const upsert = waitForEvent(sb, 'space:upsert', {
      filter: (p) => p.space.id === spaceId() && p.space.me.bio === 'Here for the raids',
    });
    const space = (
      await patchMe(bob, {
        nickname: 'Raid Bob',
        avatarMediaId: avatar.id,
        bannerMediaId: banner.id,
        bio: 'Here for the raids',
        pronouns: 'he/him',
        profileColor: '#AA00FF',
        accentColor: '#112233',
        avatarDecoration: 'halo',
        profileEffect: 'snowfall',
        nameplate: 'galaxy',
      }).expect(200)
    ).body as Space;
    const expected = {
      avatarUrl: `/uploads/${avatar.thumbnailKey}`,
      avatarAnimatedUrl: `/uploads/${avatar.storageKey}`,
      bannerUrl: `/uploads/${banner.storageKey}`,
      bannerAnimatedUrl: null,
      bio: 'Here for the raids',
      pronouns: 'he/him',
      profileColor: '#aa00ff',
      accentColor: '#112233',
      avatarDecoration: 'halo',
      profileEffect: 'snowfall',
      nameplate: 'galaxy',
    };
    expect(space.me).toMatchObject({ nickname: 'Raid Bob', ...expected });
    expect((await upsert).space.me).toMatchObject(expected);
    expect((await updated).member).toMatchObject({ nickname: 'Raid Bob', ...expected });

    expect(await memberAs(owner, bob.id)).toMatchObject(expected);
    const page = (await t.api(owner).get(`${base()}/members`).expect(200)).body as SpaceMemberPage;
    expect(page.members.find((m) => m.userId === bob.id)).toMatchObject(expected);
    // The owner has no overrides: the list mixes both.
    expect(page.members.find((m) => m.userId === owner.id)).toMatchObject(PROFILE_NULLS);
    const batch = (
      await t
        .api(owner)
        .post(`${base()}/members/batch`)
        .send({ userIds: [bob.id, owner.id] })
        .expect(200)
    ).body as SpaceMember[];
    expect(batch.find((m) => m.userId === bob.id)).toMatchObject(expected);
    // The main profile is untouched.
    const user = (await t.api(owner).get(`/api/users/${bob.id}`).expect(200)).body as {
      bio: string | null;
      avatarUrl: string | null;
    };
    expect(user.bio).toBeNull();
    expect(user.avatarUrl).toBeNull();
    so.disconnect();
    sb.disconnect();
  });

  it('a partial update leaves the other overrides alone', async () => {
    const space = (await patchMe(bob, { pronouns: 'they/them' }).expect(200)).body as Space;
    expect(space.me).toMatchObject({ pronouns: 'they/them', bio: 'Here for the raids', nameplate: 'galaxy' });
    expect(space.me.avatarUrl).toMatch(/^\/uploads\//);
  });

  it('null clears each field back to the main profile', async () => {
    const so = await t.connect(owner);
    const updated = waitForEvent(so, 'space:member-updated', {
      filter: (p) => p.member.userId === bob.id && p.member.bio === null,
    });
    const space = (
      await patchMe(bob, {
        avatarMediaId: null,
        bannerMediaId: null,
        bio: null,
        pronouns: null,
        profileColor: null,
        accentColor: null,
        avatarDecoration: null,
        profileEffect: null,
        nameplate: null,
      }).expect(200)
    ).body as Space;
    expect(space.me).toMatchObject(PROFILE_NULLS);
    expect(space.me.nickname).toBe('Raid Bob');
    expect((await updated).member).toMatchObject(PROFILE_NULLS);
    expect(await memberAs(owner, bob.id)).toMatchObject(PROFILE_NULLS);
    so.disconnect();
  });

  it('images must be my own uploads of the right kind', async () => {
    const owners = await insertImage(owner.id);
    // Someone else's upload is "not found" among mine (never reveals other users' uploads).
    await patchMe(bob, { avatarMediaId: owners.id }).expect(404);
    await patchMe(bob, { bannerMediaId: owners.id }).expect(404);
    // An animated avatar needs its still poster; a still GIF is not an avatar type.
    const noPoster = await insertImage(bob.id, { mimeType: 'image/gif', animated: true, poster: false });
    await patchMe(bob, { avatarMediaId: noPoster.id }).expect(400);
    await patchMe(bob, { bannerMediaId: noPoster.id }).expect(400);
    const stillGif = await insertImage(bob.id, { mimeType: 'image/gif' });
    await patchMe(bob, { avatarMediaId: stillGif.id }).expect(400);
    await patchMe(bob, { bannerMediaId: stillGif.id }).expect(200);
    // Nothing was stored by the failed attempts (the transaction rolled back).
    const me = (await memberAs(owner, bob.id)) as SpaceMember;
    expect(me.avatarUrl).toBeNull();
    expect(me.bannerUrl).toBe(`/uploads/${stillGif.storageKey}`);
    await patchMe(bob, { bannerMediaId: null }).expect(200);
  });

  it('rejects unknown cosmetics, bad colours and over-long text', async () => {
    await patchMe(bob, { avatarDecoration: 'not-a-decoration' }).expect(400);
    await patchMe(bob, { profileEffect: 'nope' }).expect(400);
    await patchMe(bob, { nameplate: 'nope' }).expect(400);
    await patchMe(bob, { profileColor: 'red' }).expect(400);
    await patchMe(bob, { bio: 'x'.repeat(10_000) }).expect(400);
    await patchMe(bob, { avatarMediaId: 'not-a-uuid' }).expect(400);
  });

  it('non-members cannot set a profile there', async () => {
    await patchMe(carol, { bio: 'sneaky' }).expect(404);
  });

  it('leaving the Space removes the overrides with the membership', async () => {
    await patchMe(bob, { bio: 'Temporary', nameplate: 'ocean' }).expect(200);
    await t.api(bob).post(`${base()}/leave`).expect(204);
    await spaceRegistryIdle();
    await t.api(owner).get(`${base()}/members/${bob.id}`).expect(404);
    await t.api(bob).post(`/api/invites/${invite.code}/join`).expect(200);
    await spaceRegistryIdle();
    const space = (await t.api(bob).get(`${base()}/members/me`).expect(200)).body as Space;
    expect(space.me).toMatchObject({ ...PROFILE_NULLS, nickname: null });
    expect(await memberAs(owner, bob.id)).toMatchObject(PROFILE_NULLS);
  });
});
