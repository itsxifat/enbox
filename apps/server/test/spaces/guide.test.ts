/**
 * Server Guide, Browse Channels and Channels & Roles (docs/design/discord-parity.md W12-B):
 * guide saves and their validation (public text channels, limits), to-do progress, opt-in
 * channels and my channel choices, the Space serialisation, and onboarding answers — saved on
 * the first onboarding and changed later with roles added and removed.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  GUIDE_MAX_RESOURCES,
  GUIDE_MAX_TODOS,
  type ChannelPref,
  type ChatSummary,
  type GuideProgress,
  type ServerGuide,
  type ServerGuideRequest,
  type Space,
  type SpaceDetail,
  type SpaceInvite,
  type SpaceOnboarding,
  type SpaceRole,
} from '@enbox/shared';
import { spaceRegistryIdle } from '../../src/realtime/spaceRegistry.js';
import {
  expectNoEvent,
  startTestServer,
  waitForEvent,
  type TestServer,
  type TestUser,
} from '../helpers.js';

describe('server guide, browse channels, channels & roles', () => {
  let t: TestServer;
  let owner: TestUser;
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let rockets: SpaceDetail;
  let other: SpaceDetail;
  let general: ChatSummary;
  let rules: ChatSummary;
  let staffOnly: ChatSummary;

  const sid = () => rockets.space.id;

  async function inviteJoin(user: TestUser, spaceId: string) {
    const invite = (await t.api(owner).post(`/api/spaces/${spaceId}/invites`).send({}).expect(201))
      .body as SpaceInvite;
    await t.api(user).post(`/api/invites/${invite.code}/join`).expect(200);
    await spaceRegistryIdle();
  }

  const detail = async (user: TestUser, spaceId = sid()) =>
    (await t.api(user).get(`/api/spaces/${spaceId}`).expect(200)).body as SpaceDetail;
  const channel = async (name: string, extra: Record<string, unknown> = {}) =>
    (
      await t
        .api(owner)
        .post(`/api/spaces/${sid()}/channels`)
        .send({ type: 'space_text', name, ...extra })
        .expect(201)
    ).body as ChatSummary;
  const role = async (name: string) =>
    (await t.api(owner).post(`/api/spaces/${sid()}/roles`).send({ name }).expect(201))
      .body as SpaceRole;
  const putGuide = (user: TestUser, body?: ServerGuideRequest) => {
    const req = t.api(user).put(`/api/spaces/${sid()}/guide`);
    return body === undefined ? req : req.send(body as object);
  };

  const guide = (p: Partial<ServerGuide> = {}): ServerGuide => ({
    enabled: true,
    welcome: { title: 'Welcome to the Rocket Club!', subtitle: 'Read the rules, then say hi' },
    todos: [{ channelId: rules.id, emoji: '📜', description: 'Read the rules' }],
    resources: [
      { channelId: rules.id, title: 'Rules', description: 'How we play', emoji: null },
      { channelId: general.id, title: 'Chat', description: null, emoji: '💬' },
    ],
    ...p,
  });

  beforeAll(async () => {
    t = await startTestServer();
    [owner, alice, bob, carol] = [
      await t.createUser({ displayName: 'Owner' }),
      await t.createUser({ displayName: 'Alice' }),
      await t.createUser({ displayName: 'Bob' }),
      await t.createUser({ displayName: 'Carol' }),
    ];
    rockets = (await t.api(owner).post('/api/spaces').send({ name: 'Rocket Club' }).expect(201))
      .body as SpaceDetail;
    other = (await t.api(owner).post('/api/spaces').send({ name: 'Elsewhere' }).expect(201))
      .body as SpaceDetail;
    general = rockets.channels.find((c) => c.name === 'general')!;
    rules = await channel('rules');
    const staff = await role('Staff');
    staffOnly = await channel('staff', { privateRoleIds: [staff.id] });
    await inviteJoin(alice, sid());
    await inviteJoin(bob, sid());
  });
  afterAll(() => t.close());

  // -------------------------------------------------------------------------
  // Server Guide
  // -------------------------------------------------------------------------

  it('guide: MANAGE_SPACE saves it whole; channels are public text channels, within the limits', async () => {
    await putGuide(alice, guide()).expect(403);
    await t.api(carol).put(`/api/spaces/${sid()}/guide`).send(guide()).expect(404);

    const voice = rockets.channels.find((c) => c.type === 'space_voice')!;
    const bad = async (g: ServerGuide, message?: RegExp) => {
      const res = await putGuide(owner, g).expect(400);
      if (message) expect(res.body.error.message).toMatch(message);
    };
    await bad(
      guide({ todos: [{ channelId: staffOnly.id, emoji: null, description: 'Secret' }] }),
      /not visible/,
    );
    await bad(
      guide({ todos: [{ channelId: voice.id, emoji: null, description: 'Talk' }] }),
      /text channels/,
    );
    await bad(
      guide({
        resources: [
          { channelId: other.channels[0]!.id, title: 'Away', description: null, emoji: null },
        ],
      }),
    );
    await bad(
      guide({
        todos: [
          { channelId: rules.id, emoji: null, description: 'Once' },
          { channelId: rules.id, emoji: null, description: 'Twice' },
        ],
      }),
      /own channel/,
    );
    await bad(guide({ welcome: { title: '  ', subtitle: null } }));
    await bad(
      guide({
        todos: Array.from({ length: GUIDE_MAX_TODOS + 1 }, () => ({
          channelId: rules.id,
          emoji: null,
          description: 'Too many',
        })),
      }),
    );
    await bad(
      guide({
        resources: Array.from({ length: GUIDE_MAX_RESOURCES + 1 }, () => ({
          channelId: general.id,
          title: 'Too many',
          description: null,
          emoji: null,
        })),
      }),
    );

    const sa = await t.connect(alice);
    const evt = waitForEvent(sa, 'space:guide', { filter: (p) => p.spaceId === sid() });
    const saved = (
      await putGuide(owner, {
        ...guide(),
        welcome: { title: ' Welcome to the Rocket Club! ', subtitle: '   ' },
        todos: [{ channelId: rules.id, emoji: '', description: 'Read the rules' }],
      }).expect(200)
    ).body as ServerGuide;
    expect(saved).toEqual({
      ...guide(),
      welcome: { title: 'Welcome to the Rocket Club!', subtitle: null },
      todos: [{ channelId: rules.id, emoji: null, description: 'Read the rules' }],
    });
    expect((await evt).guide).toEqual(saved);
    sa.disconnect();

    // Members read it on their Space; a channel may be a to-do and a resource.
    const full = guide({
      todos: [
        { channelId: rules.id, emoji: '📜', description: 'Read the rules' },
        { channelId: general.id, emoji: '👋', description: 'Say hi' },
      ],
    });
    await putGuide(owner, full).expect(200);
    expect((await detail(alice)).space.guide).toEqual(full);

    // No body removes it.
    expect((await putGuide(owner).expect(200)).text).toBe('null');
    expect((await detail(alice)).space.guide).toBeNull();
    await putGuide(owner, full).expect(200);
  });

  it('to-dos: visiting one ticks it once; only to-dos of an enabled guide', async () => {
    const done = (user: TestUser, channelId: string) =>
      t.api(user).post(`/api/spaces/${sid()}/guide/todos/${channelId}/done`);
    await done(alice, staffOnly.id).expect(404);
    await done(carol, rules.id).expect(404); // not a member

    const sa = await t.connect(alice);
    const upsert = waitForEvent(sa, 'space:upsert', { filter: (p) => p.space.id === sid() });
    expect(
      ((await done(alice, rules.id).expect(200)).body as GuideProgress).doneChannelIds,
    ).toEqual([rules.id]);
    expect((await upsert).space.me.guideDone).toEqual([rules.id]);
    // Again: nothing changes, no event.
    const quiet = expectNoEvent(sa, 'space:upsert');
    expect(
      ((await done(alice, rules.id).expect(200)).body as GuideProgress).doneChannelIds,
    ).toEqual([rules.id]);
    await quiet;
    sa.disconnect();
    expect((await done(alice, general.id).expect(200)).body.doneChannelIds).toEqual([
      rules.id,
      general.id,
    ]);
    expect((await detail(alice)).space.me.guideDone).toEqual([rules.id, general.id]);
    expect((await detail(bob)).space.me.guideDone).toEqual([]);

    // Switched off: nothing to tick.
    const g = (await detail(owner)).space.guide!;
    await putGuide(owner, { ...g, enabled: false }).expect(200);
    await done(bob, rules.id).expect(404);
    await putGuide(owner, g).expect(200);
  });

  it('a deleted channel leaves the guide', async () => {
    const intros = await channel('intros');
    const g = (await detail(owner)).space.guide!;
    await putGuide(owner, {
      ...g,
      todos: [...g.todos, { channelId: intros.id, emoji: null, description: 'Introduce yourself' }],
      resources: [
        ...g.resources,
        { channelId: intros.id, title: 'Intros', description: null, emoji: null },
      ],
    }).expect(200);
    const sb = await t.connect(bob);
    const evt = waitForEvent(sb, 'space:guide', { filter: (p) => p.spaceId === sid() });
    await t.api(owner).delete(`/api/spaces/${sid()}/channels/${intros.id}`).expect(204);
    expect((await evt).guide).toEqual(g);
    sb.disconnect();
    expect((await detail(bob)).space.guide).toEqual(g);
  });

  it('every guide save is audited', async () => {
    const log = (
      await t
        .api(owner)
        .get(`/api/spaces/${sid()}/audit-log`)
        .query({ action: 'space.guide' })
        .expect(200)
    ).body as { action: string; actorId: string; changes: Record<string, unknown> }[];
    expect(log.length).toBeGreaterThanOrEqual(4);
    expect(log.some((e) => e.changes.removed === true)).toBe(true);
    expect(log[0]).toMatchObject({ action: 'space.guide', actorId: owner.id });
  });

  // -------------------------------------------------------------------------
  // Browse Channels
  // -------------------------------------------------------------------------

  it('opt-in channels: set on create and in channel settings; members see the flag', async () => {
    const clubs = await channel('clubs', { optIn: true });
    expect(clubs.space?.optIn).toBe(true);
    expect(rules.space?.optIn).toBeUndefined();
    const seen = (await detail(alice)).channels.find((c) => c.id === clubs.id)!;
    expect(seen.space?.optIn).toBe(true);

    const sa = await t.connect(alice);
    const off = waitForEvent(sa, 'chat:updated', { filter: (p) => p.chatId === clubs.id });
    const edited = (
      await t
        .api(owner)
        .patch(`/api/spaces/${sid()}/channels/${clubs.id}`)
        .send({ optIn: false })
        .expect(200)
    ).body as ChatSummary;
    expect(edited.space?.optIn).toBeUndefined();
    expect((await off).changes.space?.optIn).toBeUndefined();
    const on = waitForEvent(sa, 'chat:updated', { filter: (p) => p.chatId === clubs.id });
    await t
      .api(owner)
      .patch(`/api/spaces/${sid()}/channels/${clubs.id}`)
      .send({ optIn: true })
      .expect(200);
    expect((await on).changes.space?.optIn).toBe(true);
    sa.disconnect();
    // Members can't change it; clones keep it.
    await t
      .api(alice)
      .patch(`/api/spaces/${sid()}/channels/${clubs.id}`)
      .send({ optIn: false })
      .expect(403);
    const copy = (
      await t
        .api(owner)
        .post(`/api/spaces/${sid()}/channels/${clubs.id}/clone`)
        .send({})
        .expect(201)
    ).body as ChatSummary;
    expect(copy.space?.optIn).toBe(true);
  });

  it('channel prefs: I show opt-in channels and hide others; defaults drop my rows; my devices follow', async () => {
    const d = await detail(alice);
    const clubs = d.channels.find((c) => c.name === 'clubs')!;
    const prefs = (user: TestUser, list: ChannelPref[]) =>
      t.api(user).put(`/api/spaces/${sid()}/channel-prefs`).send({ prefs: list });
    const sorted = (list: ChannelPref[]) =>
      [...list].sort((a, b) => a.channelId.localeCompare(b.channelId));
    expect(d.space.me.channelPrefs).toEqual([]);

    const sa = await t.connect(alice);
    const evt = waitForEvent(sa, 'me:channel-prefs', { filter: (p) => p.spaceId === sid() });
    const saved = (
      await prefs(alice, [
        { channelId: clubs.id, shown: true },
        { channelId: general.id, shown: false },
      ]).expect(200)
    ).body as ChannelPref[];
    const want = sorted([
      { channelId: clubs.id, shown: true },
      { channelId: general.id, shown: false },
    ]);
    expect(saved).toEqual(want);
    expect((await evt).prefs).toEqual(want);
    sa.disconnect();
    // The Space lists them in no particular order.
    expect(sorted((await detail(alice)).space.me.channelPrefs ?? [])).toEqual(want);
    expect((await detail(bob)).space.me.channelPrefs).toEqual([]);

    // Back to the defaults (the last choice of a channel in a batch wins): no rows left.
    expect(
      (
        await prefs(alice, [
          { channelId: general.id, shown: false },
          { channelId: general.id, shown: true },
          { channelId: clubs.id, shown: false },
        ]).expect(200)
      ).body,
    ).toEqual([]);

    // Only channels of this Space I can see; a batch of at least one.
    await prefs(alice, [{ channelId: staffOnly.id, shown: true }]).expect(404);
    await prefs(alice, [{ channelId: other.channels[0]!.id, shown: false }]).expect(404);
    await prefs(alice, []).expect(400);
    await prefs(carol, [{ channelId: general.id, shown: false }]).expect(404);

    // Leaving forgets them: a rejoin starts from the defaults.
    await prefs(bob, [{ channelId: clubs.id, shown: true }]).expect(200);
    await t.api(bob).post(`/api/spaces/${sid()}/leave`).expect(204);
    await spaceRegistryIdle();
    await inviteJoin(bob, sid());
    expect((await detail(bob)).space.me.channelPrefs).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Channels & Roles
  // -------------------------------------------------------------------------

  it('answers: saved by the first onboarding, then changed with roles added and removed', async () => {
    const gamer = await role('Gamer');
    const artist = await role('Artist');
    const night = await role('Night Owl');
    const mod = await role('Moderator');
    const onboarding: SpaceOnboarding = {
      enabled: true,
      prompts: [
        {
          id: 'p1',
          title: 'What brings you here?',
          singleSelect: true,
          required: true,
          options: [
            { id: 'o1', title: 'Games', description: null, emoji: '🎮', roleIds: [gamer.id] },
            { id: 'o2', title: 'Art', description: null, emoji: null, roleIds: [artist.id] },
          ],
        },
        {
          id: 'p2',
          title: 'When are you around?',
          singleSelect: false,
          required: false,
          options: [
            {
              id: 'o3',
              title: 'Nights',
              description: null,
              emoji: null,
              roleIds: [night.id, artist.id],
            },
            { id: 'o4', title: 'Weekends', description: null, emoji: null, roleIds: [mod.id] },
          ],
        },
      ],
    };
    const change = (user: TestUser, answers: Record<string, string[]>) =>
      t.api(user).put(`/api/spaces/${sid()}/onboarding/answers`).send({ answers });
    // No onboarding yet.
    await change(carol, { p1: ['o1'] }).expect(404);
    await change(alice, { p1: ['o1'] }).expect(400);
    await t.api(owner).patch(`/api/spaces/${sid()}/community`).send({ onboarding }).expect(200);

    // A new member onboards: the answers are saved with the roles.
    await inviteJoin(carol, sid());
    const first = (
      await t
        .api(carol)
        .post(`/api/spaces/${sid()}/onboarding/answers`)
        .send({ optionIds: ['o3', 'o1'] })
        .expect(200)
    ).body as Space;
    expect(first.me.onboardingAnswers).toEqual({ p1: ['o1'], p2: ['o3'] });
    expect([...first.me.roleIds].sort()).toEqual([gamer.id, night.id, artist.id].sort());
    // A moderator also gives Carol a role an option hands out (Moderator) and one no option does.
    const helper = await role('Helper');
    await t.api(owner).put(`/api/spaces/${sid()}/members/${carol.id}/roles/${mod.id}`).expect(200);
    await t
      .api(owner)
      .put(`/api/spaces/${sid()}/members/${carol.id}/roles/${helper.id}`)
      .expect(200);

    // Validation against the current questions.
    await change(carol, { p1: [] }).expect(400); // required
    await change(carol, { p1: ['o1', 'o2'] }).expect(400); // single select
    await change(carol, { p1: ['o1'], p9: ['o3'] }).expect(400); // unknown question
    await change(carol, { p1: ['o3'] }).expect(400); // another question's option

    const so = await t.connect(owner);
    const sc = await t.connect(carol);
    const updated = waitForEvent(so, 'space:member-updated', {
      filter: (p) => p.spaceId === sid() && p.member.userId === carol.id,
    });
    const upsert = waitForEvent(sc, 'space:upsert', { filter: (p) => p.space.id === sid() });
    // Games → Art, Nights dropped: Gamer and Night Owl go; Artist stays (Art hands it out too);
    // Moderator and Helper came from elsewhere (no saved answer handed them out) and stay.
    const res = (await change(carol, { p1: ['o2'], p2: [] }).expect(200)).body as {
      roleIds: string[];
    };
    const want = [artist.id, mod.id, helper.id].sort();
    expect([...res.roleIds].sort()).toEqual(want);
    expect([...(await updated).member.roleIds].sort()).toEqual(want);
    expect((await upsert).space.me.onboardingAnswers).toEqual({ p1: ['o2'] });
    so.disconnect();
    sc.disconnect();
    const mine = (await detail(carol)).space.me;
    expect([...mine.roleIds].sort()).toEqual(want);
    expect(mine.onboardingAnswers).toEqual({ p1: ['o2'] });

    // Picking Weekends hands out Moderator (held already); unpicking it later removes it, as an
    // answer of mine handed it out now.
    expect(
      [...(await change(carol, { p1: ['o2'], p2: ['o4'] }).expect(200)).body.roleIds].sort(),
    ).toEqual(want);
    expect([...(await change(carol, { p1: ['o1'] }).expect(200)).body.roleIds].sort()).toEqual(
      [gamer.id, helper.id].sort(),
    );

    // A member who never saved answers only gains roles.
    await t.api(owner).put(`/api/spaces/${sid()}/members/${bob.id}/roles/${night.id}`).expect(200);
    expect([...(await change(bob, { p1: ['o2'] }).expect(200)).body.roleIds].sort()).toEqual(
      [night.id, artist.id].sort(),
    );
    expect((await detail(bob)).space.me.onboardingAnswers).toEqual({ p1: ['o2'] });

    // Audited like other role changes.
    const log = (
      await t
        .api(owner)
        .get(`/api/spaces/${sid()}/audit-log`)
        .query({ action: 'member.roles', limit: 100 })
        .expect(200)
    ).body as {
      actorId: string;
      reason: string | null;
      changes: { roles?: { removed: string[] } };
    }[];
    expect(
      log.some(
        (e) =>
          e.actorId === carol.id &&
          e.reason === 'Channels & Roles' &&
          e.changes.roles?.removed.includes(gamer.id),
      ),
    ).toBe(true);
  });
});
