/**
 * Server tags (docs/design/discord-parity.md W3-D): setting a Space's tag (MANAGE_SPACE, its
 * validation, the audit entry and `space:updated`), wearing one (members of a Space with a tag
 * only, `user:changed`), the tag on everyone's `UserPublic` (not for viewers the wearer
 * blocked), and what takes it off: leaving, kicks, bans, the Space removing its tag or being
 * deleted.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  PERM,
  type SpaceAuditEntry,
  type SpaceDetail,
  type SpaceInvite,
  type SpaceRole,
  type SpaceTag,
  type SpaceTagRequest,
  type UserProfile,
  type UserPublic,
} from '@enbox/shared';
import { db } from '../../src/db/index.js';
import { users } from '../../src/db/schema.js';
import { spaceRegistryIdle } from '../../src/realtime/spaceRegistry.js';
import {
  expectNoEvent,
  startTestServer,
  waitForEvent,
  type TestServer,
  type TestSocket,
  type TestUser,
} from '../helpers.js';

describe('server tags', () => {
  let t: TestServer;
  let owner: TestUser;
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let dave: TestUser;
  let erin: TestUser;
  let club: SpaceDetail;
  let quiet: SpaceDetail;
  let invite: SpaceInvite;
  let sOwner: TestSocket;
  let sAlice: TestSocket;
  let sBob: TestSocket;
  let sBob2: TestSocket;

  const clubId = () => club.space.id;
  const RKT: SpaceTag = { tag: 'RKT', badge: 'rocket', color: '#ff8800' };

  async function inviteJoin(user: TestUser, spaceId: string) {
    const code = (
      (await t.api(owner).post(`/api/spaces/${spaceId}/invites`).send({}).expect(201))
        .body as SpaceInvite
    ).code;
    await t.api(user).post(`/api/invites/${code}/join`).expect(200);
    await spaceRegistryIdle();
  }

  const putTag = (user: TestUser, body: SpaceTagRequest | object, spaceId = clubId()) =>
    t.api(user).put(`/api/spaces/${spaceId}/tag`).send(body);
  const wear = (user: TestUser, spaceId: string | null) =>
    t.api(user).put('/api/me/space-tag').send({ spaceId });
  /** `subject` as `viewer` sees them (POST /users/batch). */
  const seen = async (viewer: TestUser, subject: TestUser): Promise<UserPublic> => {
    const list = (
      await t
        .api(viewer)
        .post('/api/users/batch')
        .send({ userIds: [subject.id] })
        .expect(200)
    ).body as UserPublic[];
    return list[0]!;
  };
  const tagSpaceIdOf = async (user: TestUser) =>
    (await db.select({ id: users.tagSpaceId }).from(users).where(eq(users.id, user.id)))[0]?.id;
  const isTagUpdate = (p: { spaceId: string; changes: object }) =>
    p.spaceId === clubId() && 'tag' in p.changes;

  beforeAll(async () => {
    t = await startTestServer();
    [owner, alice, bob, carol, dave, erin] = [
      await t.createUser({ displayName: 'Owner' }),
      await t.createUser({ displayName: 'Alice' }),
      await t.createUser({ displayName: 'Bob' }),
      await t.createUser({ displayName: 'Carol' }),
      await t.createUser({ displayName: 'Dave' }),
      await t.createUser({ displayName: 'Erin' }),
    ];
    club = (await t.api(owner).post('/api/spaces').send({ name: 'Rocket Club' }).expect(201))
      .body as SpaceDetail;
    quiet = (await t.api(owner).post('/api/spaces').send({ name: 'Quiet Corner' }).expect(201))
      .body as SpaceDetail;
    invite = (await t.api(owner).post(`/api/spaces/${clubId()}/invites`).send({}).expect(201))
      .body as SpaceInvite;
    for (const u of [alice, bob, dave, erin]) {
      await t.api(u).post(`/api/invites/${invite.code}/join`).expect(200);
      await spaceRegistryIdle();
    }
    await inviteJoin(alice, quiet.space.id);
    sOwner = await t.connect(owner);
    sAlice = await t.connect(alice);
    sBob = await t.connect(bob);
    sBob2 = await t.connect(bob);
  });
  afterAll(() => t.close());

  it('setting it: MANAGE_SPACE only, validated and normalised, audited, space:updated → members', async () => {
    await putTag(bob, RKT).expect(403);
    await putTag(carol, RKT).expect(404);

    for (const bad of [
      { ...RKT, tag: 'R' },
      { ...RKT, tag: 'ROCKT' },
      { ...RKT, tag: 'R K' },
      { ...RKT, tag: '!!' },
      { ...RKT, tag: '🚀🚀' },
      { ...RKT, badge: 'unicorn' },
      { ...RKT, color: 'orange' },
      { ...RKT, color: '#ff880' },
      { tag: 'RKT', badge: 'rocket' },
    ])
      await putTag(owner, bad).expect(400);
    expect((await t.api(bob).get(`/api/spaces/${clubId()}`).expect(200)).body.space.tag).toBeNull();

    const update = waitForEvent(sBob, 'space:updated', { filter: isTagUpdate });
    const res = await putTag(owner, { tag: ' RKT ', badge: 'rocket', color: '#FF8800' }).expect(
      200,
    );
    expect(res.body).toEqual(RKT);
    expect((await update).changes).toEqual({ tag: RKT });
    expect((await t.api(bob).get(`/api/spaces/${clubId()}`).expect(200)).body.space.tag).toEqual(
      RKT,
    );
    expect(
      (await t.api(bob).get('/api/spaces').expect(200)).body.find(
        (s: { id: string }) => s.id === clubId(),
      ).tag,
    ).toEqual(RKT);

    // The same tag again changes nothing.
    const quietly = expectNoEvent(sBob, 'space:updated');
    expect((await putTag(owner, RKT).expect(200)).body).toEqual(RKT);
    await quietly;

    // Any script; a role with MANAGE_SPACE may edit it too.
    const managers = (
      await t
        .api(owner)
        .post(`/api/spaces/${clubId()}/roles`)
        .send({ name: 'Managers', permissions: PERM.MANAGE_SPACE })
        .expect(201)
    ).body as SpaceRole;
    await t
      .api(owner)
      .put(`/api/spaces/${clubId()}/members/${alice.id}/roles/${managers.id}`)
      .expect(200);
    expect((await putTag(alice, { ...RKT, tag: 'Ωμ' }).expect(200)).body.tag).toBe('Ωμ');
    expect((await putTag(alice, { ...RKT, tag: '火箭' }).expect(200)).body.tag).toBe('火箭');
    await putTag(alice, RKT).expect(200);

    const log = (await t.api(owner).get(`/api/spaces/${clubId()}/audit-log?limit=100`).expect(200))
      .body as SpaceAuditEntry[];
    const tagEntries = log.filter((e) => e.action === 'space.tag');
    expect(tagEntries).toHaveLength(4);
    expect(tagEntries.at(-1)).toMatchObject({
      actorId: owner.id,
      targetType: 'space',
      changes: RKT,
    });
  });

  it('wearing it: a member of a Space that has a tag; user:changed → my devices and co-members', async () => {
    await wear(carol, clubId()).expect(404);
    await wear(alice, quiet.space.id).expect(409);
    await t.api(bob).put('/api/me/space-tag').send({}).expect(400);
    await wear(bob, 'not-a-space').expect(400);
    await wear(bob, '00000000-0000-4000-8000-000000000000').expect(404);

    const mine = waitForEvent(sBob2, 'user:changed', { filter: (p) => p.userId === bob.id });
    const theirs = waitForEvent(sAlice, 'user:changed', { filter: (p) => p.userId === bob.id });
    const res = await wear(bob, clubId()).expect(200);
    expect((res.body as UserPublic).id).toBe(bob.id);
    expect((res.body as UserPublic).spaceTag).toEqual({ ...RKT, spaceId: clubId() });
    await mine;
    await theirs;
    expect(await tagSpaceIdOf(bob)).toBe(clubId());

    // Wearing the same tag again emits nothing.
    const quietly = expectNoEvent(sAlice, 'user:changed');
    await wear(bob, clubId()).expect(200);
    await quietly;
  });

  it('everyone sees it on UserPublic (batch, by id, full profile) except people the wearer blocked', async () => {
    const tag = { ...RKT, spaceId: clubId() };
    expect((await seen(carol, bob)).spaceTag).toEqual(tag);
    expect((await t.api(carol).get(`/api/users/${bob.id}`).expect(200)).body.spaceTag).toEqual(tag);
    const profile = (await t.api(carol).get(`/api/users/${bob.id}/profile`).expect(200))
      .body as UserProfile;
    expect(profile.user.spaceTag).toEqual(tag);
    expect((await seen(alice, alice)).spaceTag).toBeNull();

    // The wearer blocked the viewer: hidden (Bob still sees his own).
    await t.api(bob).put(`/api/blocks/${carol.id}`).expect(204);
    expect((await seen(carol, bob)).spaceTag).toBeNull();
    expect((await seen(bob, bob)).spaceTag).toEqual(tag);
    await t.api(bob).delete(`/api/blocks/${carol.id}`).expect(204);
    // The viewer blocked the wearer: still shown, like the other cosmetics.
    await t.api(carol).put(`/api/blocks/${bob.id}`).expect(204);
    expect((await seen(carol, bob)).spaceTag).toEqual(tag);
    await t.api(carol).delete(`/api/blocks/${bob.id}`).expect(204);
  });

  it('switching to another Space and to none', async () => {
    await t
      .api(owner)
      .put(`/api/spaces/${quiet.space.id}/tag`)
      .send({ tag: 'QC', badge: 'moon', color: '#336699' })
      .expect(200);
    await wear(alice, clubId()).expect(200);
    const res = await wear(alice, quiet.space.id).expect(200);
    expect((res.body as UserPublic).spaceTag).toEqual({
      tag: 'QC',
      badge: 'moon',
      color: '#336699',
      spaceId: quiet.space.id,
    });
    expect((await seen(carol, alice)).spaceTag?.spaceId).toBe(quiet.space.id);
    expect((await wear(alice, null).expect(200)).body.spaceTag).toBeNull();
    expect(await tagSpaceIdOf(alice)).toBeNull();
    await wear(alice, null).expect(200);
  });

  it('removing the tag hides it on every wearer; setting one again brings it back', async () => {
    const removed = waitForEvent(sBob, 'space:updated', { filter: isTagUpdate });
    await t.api(bob).delete(`/api/spaces/${clubId()}/tag`).expect(403);
    await t.api(owner).delete(`/api/spaces/${clubId()}/tag`).expect(204);
    expect((await removed).changes).toEqual({ tag: null });
    expect((await t.api(bob).get(`/api/spaces/${clubId()}`).expect(200)).body.space.tag).toBeNull();
    expect((await seen(carol, bob)).spaceTag).toBeNull();
    // No per-wearer writes: Bob still points at the Space.
    expect(await tagSpaceIdOf(bob)).toBe(clubId());
    await wear(dave, clubId()).expect(409);

    const quietly = expectNoEvent(sOwner, 'space:updated');
    await t.api(owner).delete(`/api/spaces/${clubId()}/tag`).expect(204);
    await quietly;

    await putTag(owner, { tag: 'RKT2', badge: 'star', color: '#00aa55' }).expect(200);
    expect((await seen(carol, bob)).spaceTag).toEqual({
      tag: 'RKT2',
      badge: 'star',
      color: '#00aa55',
      spaceId: clubId(),
    });
    const log = (await t.api(owner).get(`/api/spaces/${clubId()}/audit-log?limit=100`).expect(200))
      .body as SpaceAuditEntry[];
    expect(log.some((e) => e.action === 'space.tag' && e.changes?.removed === true)).toBe(true);
  });

  it('leaving the Space takes it off, with user:changed to my devices and the Space I left', async () => {
    const mine = waitForEvent(sBob2, 'user:changed', { filter: (p) => p.userId === bob.id });
    const theirs = waitForEvent(sAlice, 'user:changed', { filter: (p) => p.userId === bob.id });
    await t.api(bob).post(`/api/spaces/${clubId()}/leave`).expect(204);
    await mine;
    await theirs;
    expect(await tagSpaceIdOf(bob)).toBeNull();
    expect((await seen(carol, bob)).spaceTag).toBeNull();
    await wear(bob, clubId()).expect(404);
  });

  it('kicks and bans take it off; leaving another Space keeps it', async () => {
    await wear(dave, clubId()).expect(200);
    await wear(erin, clubId()).expect(200);
    await wear(alice, clubId()).expect(200);

    await t.api(owner).delete(`/api/spaces/${clubId()}/members/${dave.id}`).expect(204);
    expect(await tagSpaceIdOf(dave)).toBeNull();
    await t.api(owner).put(`/api/spaces/${clubId()}/bans/${erin.id}`).send({}).expect(204);
    expect(await tagSpaceIdOf(erin)).toBeNull();
    expect((await seen(carol, erin)).spaceTag).toBeNull();

    await t.api(alice).post(`/api/spaces/${quiet.space.id}/leave`).expect(204);
    expect((await seen(carol, alice)).spaceTag?.spaceId).toBe(clubId());
  });

  it('deleting the Space takes its tag off its wearers', async () => {
    await inviteJoin(alice, quiet.space.id);
    await wear(alice, quiet.space.id).expect(200);
    await t.api(owner).delete(`/api/spaces/${quiet.space.id}`).expect(204);
    expect(await tagSpaceIdOf(alice)).toBeNull();
    expect((await seen(carol, alice)).spaceTag).toBeNull();
  });
});
