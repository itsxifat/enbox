/**
 * Community (docs/design/discord-parity.md W12): Space discovery (listing, filters, search,
 * joined flag, joining), the community settings (listing requirements, vanity codes, welcome
 * screen channels, onboarding roles), onboarding answers and the vanity invite join.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PERM,
  type ChatSummary,
  type DiscoveryPage,
  type InvitePreview,
  type Space,
  type SpaceCommunity,
  type SpaceDetail,
  type SpaceInvite,
  type SpaceOnboarding,
  type SpaceRole,
} from '@enbox/shared';
import { db } from '../../src/db/index.js';
import { spaceInvites } from '../../src/db/schema.js';
import { spaceRegistryIdle } from '../../src/realtime/spaceRegistry.js';
import { startTestServer, waitForEvent, type TestServer, type TestUser } from '../helpers.js';

describe('community', () => {
  let t: TestServer;
  let owner: TestUser;
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let dave: TestUser;
  let erin: TestUser;
  let rockets: SpaceDetail;
  let pixels: SpaceDetail;
  let hidden: SpaceDetail;

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
    const create = async (name: string, description?: string) =>
      (await t.api(owner).post('/api/spaces').send({ name, description }).expect(201)).body as SpaceDetail;
    rockets = await create('Rocket Club', 'We build model rockets');
    pixels = await create('Pixel Painters', 'Digital art together');
    hidden = await create('Hidden Den', 'Nobody finds this');
  });
  afterAll(() => t.close());

  const community = (user: TestUser, spaceId: string) => t.api(user).patch(`/api/spaces/${spaceId}/community`);
  const discover = async (user: TestUser, query: Record<string, string> = {}) =>
    (await t.api(user).get('/api/discover/spaces').query(query).expect(200)).body as DiscoveryPage;
  const names = (page: DiscoveryPage) => page.spaces.map((s) => s.name);

  async function inviteJoin(user: TestUser, spaceId: string) {
    const invite = (await t.api(owner).post(`/api/spaces/${spaceId}/invites`).send({}).expect(201))
      .body as SpaceInvite;
    await t.api(user).post(`/api/invites/${invite.code}/join`).expect(200);
    await spaceRegistryIdle();
  }

  async function mySpace(user: TestUser, spaceId: string): Promise<Space> {
    return (await t.api(user).get(`/api/spaces/${spaceId}`).expect(200)).body.space as Space;
  }

  it('listing needs a description and a category; members read the settings, MANAGE_SPACE edits', async () => {
    // No category yet.
    const noCategory = await community(owner, rockets.space.id).send({ isDiscoverable: true }).expect(400);
    expect(noCategory.body.error.message).toMatch(/category/i);
    // No description.
    const bare = (await t.api(owner).post('/api/spaces').send({ name: 'Bare' }).expect(201))
      .body as SpaceDetail;
    const noDescription = await community(owner, bare.space.id)
      .send({ isDiscoverable: true, discoveryCategory: 'gaming' })
      .expect(400);
    expect(noDescription.body.error.message).toMatch(/description/i);

    await inviteJoin(bob, rockets.space.id);
    const sb = await t.connect(bob);
    const updated = waitForEvent(sb, 'space:updated', {
      filter: (p) => p.spaceId === rockets.space.id && p.changes.isDiscoverable === true,
    });
    const saved = (
      await community(owner, rockets.space.id)
        .send({
          isDiscoverable: true,
          discoveryCategory: 'science',
          discoveryTags: ['Rockets', 'diy', 'rockets'],
        })
        .expect(200)
    ).body as SpaceCommunity;
    expect(saved).toMatchObject({
      isDiscoverable: true,
      discoveryCategory: 'science',
      discoveryTags: ['rockets', 'diy'],
    });
    await updated;
    sb.disconnect();

    // Members read; they cannot edit.
    const read = (await t.api(bob).get(`/api/spaces/${rockets.space.id}/community`).expect(200))
      .body as SpaceCommunity;
    expect(read).toMatchObject({ isDiscoverable: true, discoveryCategory: 'science', vanityCode: null });
    await community(bob, rockets.space.id).send({ discoveryTags: ['mine'] }).expect(403);
    await t.api(carol).get(`/api/spaces/${rockets.space.id}/community`).expect(404);

    await community(owner, pixels.space.id)
      .send({ isDiscoverable: true, discoveryCategory: 'art', discoveryTags: ['pixel'] })
      .expect(200);
    // A listed Space keeps its category.
    await community(owner, pixels.space.id).send({ discoveryCategory: null }).expect(400);
  });

  it('discovery lists the biggest first, filters by category and search, and flags joined Spaces', async () => {
    const all = await discover(carol);
    expect(names(all)).toEqual(['Rocket Club', 'Pixel Painters']);
    expect(all.total).toBe(2);
    expect(all.spaces.every((s) => !s.joined)).toBe(true);
    expect(all.spaces[0]).toMatchObject({
      id: rockets.space.id,
      description: 'We build model rockets',
      memberCount: 2,
      category: 'science',
      tags: ['rockets', 'diy'],
      iconUrl: null,
      bannerUrl: null,
    });
    expect((await discover(bob)).spaces.map((s) => [s.name, s.joined])).toEqual([
      ['Rocket Club', true],
      ['Pixel Painters', false],
    ]);
    expect(names(await discover(carol, { category: 'art' }))).toEqual(['Pixel Painters']);
    expect(names(await discover(carol, { category: 'gaming' }))).toEqual([]);
    expect(names(await discover(carol, { q: 'rocket' }))).toEqual(['Rocket Club']); // name
    expect(names(await discover(carol, { q: 'DIGITAL' }))).toEqual(['Pixel Painters']); // description
    expect(names(await discover(carol, { q: 'diy' }))).toEqual(['Rocket Club']); // tag
    expect(names(await discover(carol, { q: '%' }))).toEqual([]); // wildcards are literal
    expect(names(await discover(carol, { q: '', category: '' }))).toHaveLength(2); // blank = absent
    const page2 = await discover(carol, { offset: '1' });
    expect([names(page2), page2.total]).toEqual([['Pixel Painters'], 2]);
    await t.api(carol).get('/api/discover/spaces').query({ category: 'cooking' }).expect(400);
    await t.api().get('/api/discover/spaces').expect(401);
  });

  it('joins a listed Space from discovery like an invite; 404 when it is not listed', async () => {
    const so = await t.connect(owner);
    const joinedEvt = waitForEvent(so, 'message:new', {
      filter: (p) => p.message.system?.kind === 'member_joined_space' && p.message.system.actorId === carol.id,
    });
    const res = await t.api(carol).post(`/api/discover/spaces/${pixels.space.id}/join`).expect(200);
    const detail = res.body as SpaceDetail;
    expect(detail.space).toMatchObject({ id: pixels.space.id, memberCount: 2 });
    expect(detail.channels.map((c: ChatSummary) => c.name)).toContain('general');
    await joinedEvt;
    so.disconnect();
    await spaceRegistryIdle();
    expect((await discover(carol, { category: 'art' })).spaces[0]?.joined).toBe(true);
    await t.api(carol).post(`/api/discover/spaces/${pixels.space.id}/join`).expect(409);
    // Not discoverable, or no such Space.
    await t.api(carol).post(`/api/discover/spaces/${hidden.space.id}/join`).expect(404);
    await t.api(carol).post('/api/discover/spaces/00000000-0000-4000-8000-000000000000/join').expect(404);
    // Bans hold.
    await t.api(owner).put(`/api/spaces/${rockets.space.id}/bans/${dave.id}`).send({}).expect(204);
    await t.api(dave).post(`/api/discover/spaces/${rockets.space.id}/join`).expect(403);
    await t.api(owner).delete(`/api/spaces/${rockets.space.id}/bans/${dave.id}`).expect(204);
  });

  it('vanity codes are unique across invite codes and join like an invite', async () => {
    const set = (await community(owner, rockets.space.id).send({ vanityCode: 'Rocket-Club' }).expect(200))
      .body as SpaceCommunity;
    expect(set.vanityCode).toBe('rocket-club');
    expect((await mySpace(owner, rockets.space.id)).vanityCode).toBe('rocket-club');
    // Another Space's vanity, or any invite code, is taken.
    const taken = await community(owner, pixels.space.id).send({ vanityCode: 'rocket-club' }).expect(409);
    expect(taken.body.error.code).toBe('conflict');
    await db.insert(spaceInvites).values({ code: 'party-time', spaceId: hidden.space.id });
    await community(owner, pixels.space.id).send({ vanityCode: 'party-time' }).expect(409);
    await community(owner, pixels.space.id).send({ vanityCode: 'no' }).expect(400);
    await community(owner, pixels.space.id).send({ vanityCode: 'has space' }).expect(400);
    // Setting your own code again is a no-op.
    await community(owner, rockets.space.id).send({ vanityCode: 'rocket-club' }).expect(200);

    // The vanity code works as an invite (any case).
    const preview = (await t.api(dave).get('/api/invites/Rocket-Club').expect(200)).body as InvitePreview;
    expect(preview).toMatchObject({ kind: 'space', id: rockets.space.id, canJoin: true });
    const joined = await t.api(dave).post('/api/invites/rocket-club/join').expect(200);
    expect(joined.body).toMatchObject({
      kind: 'space',
      id: rockets.space.id,
      channelId: rockets.channels.find((c) => c.name === 'general')!.id,
    });
    await t.api(dave).post('/api/invites/rocket-club/join').expect(409);
    await t.api(dave).get('/api/invites/nobody-here').expect(404);
    await t.api(dave).get('/api/invites/x').expect(400);
    // Cleared: the code is free again.
    await community(owner, rockets.space.id).send({ vanityCode: null }).expect(200);
    await t.api(dave).get('/api/invites/rocket-club').expect(404);
  });

  it('welcome screen: recommended channels must be text channels new members can see', async () => {
    const general = rockets.channels.find((c) => c.name === 'general')!;
    const voice = rockets.channels.find((c) => c.type === 'space_voice')!;
    const staff = (await t.api(owner).post(`/api/spaces/${rockets.space.id}/roles`).send({ name: 'Staff' }).expect(201))
      .body as SpaceRole;
    const secret = (
      await t
        .api(owner)
        .post(`/api/spaces/${rockets.space.id}/channels`)
        .send({ type: 'space_text', name: 'staff', privateRoleIds: [staff.id] })
        .expect(201)
    ).body as ChatSummary;
    const screen = (channels: { channelId: string; description: string; emoji: string | null }[]) => ({
      welcomeScreen: { enabled: true, description: 'Hi there', channels },
    });
    await community(owner, rockets.space.id)
      .send(screen([{ channelId: voice.id, description: 'Talk', emoji: null }]))
      .expect(400);
    const priv = await community(owner, rockets.space.id)
      .send(screen([{ channelId: secret.id, description: 'Secrets', emoji: null }]))
      .expect(400);
    expect(priv.body.error.message).toMatch(/not visible/);
    await community(owner, rockets.space.id)
      .send(screen([{ channelId: pixels.channels[0]!.id, description: 'Elsewhere', emoji: null }]))
      .expect(400);
    await community(owner, rockets.space.id)
      .send(
        screen([
          { channelId: general.id, description: 'Say hi', emoji: null },
          { channelId: general.id, description: 'Again', emoji: null },
        ]),
      )
      .expect(400);
    const ok = (
      await community(owner, rockets.space.id)
        .send(screen([{ channelId: general.id, description: 'Say hi', emoji: '' }]))
        .expect(200)
    ).body as SpaceCommunity;
    expect(ok.welcomeScreen).toEqual({
      enabled: true,
      description: 'Hi there',
      channels: [{ channelId: general.id, description: 'Say hi', emoji: null }],
    });
    expect((await t.api(bob).get(`/api/spaces/${rockets.space.id}/community`).expect(200)).body.welcomeScreen)
      .toEqual(ok.welcomeScreen);

    // A deleted channel leaves the welcome screen.
    const intros = (
      await t.api(owner).post(`/api/spaces/${rockets.space.id}/channels`).send({ type: 'space_text', name: 'intros' }).expect(201)
    ).body as ChatSummary;
    await community(owner, rockets.space.id)
      .send(
        screen([
          { channelId: general.id, description: 'Say hi', emoji: null },
          { channelId: intros.id, description: 'Introduce yourself', emoji: '👋' },
        ]),
      )
      .expect(200);
    await t.api(owner).delete(`/api/spaces/${rockets.space.id}/channels/${intros.id}`).expect(204);
    const after = (await t.api(bob).get(`/api/spaces/${rockets.space.id}/community`).expect(200)).body as SpaceCommunity;
    expect(after.welcomeScreen?.channels.map((c) => c.channelId)).toEqual([general.id]);
  });

  it('onboarding: roles below my highest role; answers add roles, set onboardedAt and enforce required prompts', async () => {
    const id = rockets.space.id;
    const role = async (name: string, permissions = 0) =>
      (await t.api(owner).post(`/api/spaces/${id}/roles`).send({ name, permissions }).expect(201))
        .body as SpaceRole;
    // New roles go to the bottom: Artist < Gamer < Mods < High.
    const high = await role('High');
    const mods = await role('Mods', PERM.MANAGE_SPACE | PERM.MANAGE_ROLES);
    const gamer = await role('Gamer');
    const artist = await role('Artist');
    const managers = await role('Managers', PERM.MANAGE_SPACE);
    const gamersOnly = (
      await t
        .api(owner)
        .post(`/api/spaces/${id}/channels`)
        .send({ type: 'space_text', name: 'gamers', privateRoleIds: [gamer.id] })
        .expect(201)
    ).body as ChatSummary;
    const otherRole = (await t.api(owner).post(`/api/spaces/${pixels.space.id}/roles`).send({ name: 'Elsewhere' }).expect(201))
      .body as SpaceRole;
    const everyone = rockets.space.roles.find((r) => r.isDefault)!;

    const onboarding = (roleFor: { o1: string[]; o4: string[] }, enabled = true): SpaceOnboarding => ({
      enabled,
      prompts: [
        {
          id: 'p1',
          title: 'What brings you here?',
          singleSelect: true,
          required: true,
          options: [
            { id: 'o1', title: 'Games', description: 'Play with us', emoji: '🎮', roleIds: roleFor.o1 },
            { id: 'o2', title: 'Art', description: null, emoji: null, roleIds: [artist.id] },
          ],
        },
        {
          id: 'p2',
          title: 'Anything else?',
          singleSelect: false,
          required: false,
          options: [
            { id: 'o3', title: 'Just looking', description: null, emoji: null, roleIds: [] },
            { id: 'o4', title: 'Drawing', description: '', emoji: '', roleIds: roleFor.o4 },
          ],
        },
      ],
    });
    // Bad roles: unknown, @everyone, another Space's.
    for (const bad of ['00000000-0000-4000-8000-000000000000', everyone.id, otherRole.id])
      await community(owner, id).send({ onboarding: onboarding({ o1: [bad], o4: [] }) }).expect(400);
    // Hierarchy: Alice (Mods) can hand out roles below Mods only; Managers lack Manage Roles.
    await inviteJoin(alice, id);
    await t.api(owner).put(`/api/spaces/${id}/members/${alice.id}/roles/${mods.id}`).expect(200);
    const above = await community(alice, id).send({ onboarding: onboarding({ o1: [high.id], o4: [] }) }).expect(400);
    expect(above.body.error.message).toMatch(/below your highest role/);
    await community(alice, id).send({ onboarding: onboarding({ o1: [mods.id], o4: [] }) }).expect(400);
    await t.api(owner).put(`/api/spaces/${id}/members/${bob.id}/roles/${managers.id}`).expect(200);
    await community(bob, id).send({ onboarding: onboarding({ o1: [gamer.id], o4: [] }) }).expect(403);
    // Duplicate option ids; switched on without questions.
    const dup = onboarding({ o1: [], o4: [] });
    dup.prompts[1]!.options[0]!.id = 'o1';
    await community(owner, id).send({ onboarding: dup }).expect(400);
    await community(owner, id).send({ onboarding: { enabled: true, prompts: [] } }).expect(400);

    // Switching it on: the members already here count as onboarded (the owner had no mark yet).
    expect((await mySpace(owner, id)).me.onboardedAt).toBeNull();
    const saved = (
      await community(alice, id).send({ onboarding: onboarding({ o1: [gamer.id], o4: [artist.id, artist.id] }) }).expect(200)
    ).body as SpaceCommunity;
    expect(saved.onboarding?.prompts[1]?.options[1]).toEqual({
      id: 'o4',
      title: 'Drawing',
      description: null,
      emoji: null,
      roleIds: [artist.id],
    });
    expect((await mySpace(owner, id)).me.onboardedAt).toEqual(expect.any(String));
    expect((await mySpace(bob, id)).me.onboardedAt).toEqual(expect.any(String)); // marked at join

    // A new member joins with onboarding to do.
    await inviteJoin(erin, id);
    expect((await mySpace(erin, id)).me.onboardedAt).toBeNull();
    await t.api(erin).get(`/api/chats/${gamersOnly.id}`).expect(404);
    const answers = (optionIds: string[]) => t.api(erin).post(`/api/spaces/${id}/onboarding/answers`).send({ optionIds });
    const required = await answers(['o3']).expect(400);
    expect(required.body.error.message).toMatch(/What brings you here/);
    await answers(['o1', 'o2']).expect(400); // single select
    await answers(['o1', 'nope']).expect(400); // unknown option
    expect((await mySpace(erin, id)).me).toMatchObject({ onboardedAt: null, roleIds: [] });

    const so = await t.connect(owner);
    const se = await t.connect(erin);
    const memberUpdated = waitForEvent(so, 'space:member-updated', {
      filter: (p) => p.spaceId === id && p.member.userId === erin.id,
    });
    const upsert = waitForEvent(se, 'space:upsert', { filter: (p) => p.space.id === id });
    const done = (await answers(['o1', 'o4']).expect(200)).body as Space;
    expect(done.me.onboardedAt).toEqual(expect.any(String));
    expect([...done.me.roleIds].sort()).toEqual([gamer.id, artist.id].sort());
    expect([...(await memberUpdated).member.roleIds].sort()).toEqual([gamer.id, artist.id].sort());
    expect((await upsert).space.me.onboardedAt).toEqual(done.me.onboardedAt);
    so.disconnect();
    se.disconnect();
    await spaceRegistryIdle();
    // The perm version moved: the Gamer channel opens.
    await t.api(erin).get(`/api/chats/${gamersOnly.id}`).expect(200);

    // Answering again only adds (Discord never removes roles here); onboardedAt stays.
    const again = (await answers(['o2']).expect(200)).body as Space;
    expect([...again.me.roleIds].sort()).toEqual([gamer.id, artist.id].sort());
    expect(again.me.onboardedAt).toBe(done.me.onboardedAt);

    // Turned off: answers are refused; new members count as onboarded when they join.
    await community(owner, id).send({ onboarding: null }).expect(200);
    await answers(['o1']).expect(400);
    await inviteJoin(carol, id);
    expect((await mySpace(carol, id)).me.onboardedAt).toEqual(expect.any(String));
  });

  it('every change is audited', async () => {
    const log = (
      await t.api(owner).get(`/api/spaces/${rockets.space.id}/audit-log`).query({ limit: 100 }).expect(200)
    ).body as {
      action: string;
      actorId: string;
      reason: string | null;
    }[];
    const actions = log.map((e) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining(['space.discovery.update', 'space.welcome_screen.update', 'space.onboarding.update']),
    );
    expect(log.find((e) => e.action === 'member.roles' && e.actorId === erin.id)?.reason).toBe('Onboarding');
  });
});
