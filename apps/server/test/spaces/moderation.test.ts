/**
 * Moderation (docs/design/discord-parity.md W11): the Members page search (filters, sorts,
 * paging, count), bulk actions with per-member refusals, Mod View, security actions (Pause
 * Invites, Pause DMs through the DM gate, the alerts settings), raid alerts and the join /
 * leave audit entries.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  PERM,
  RAID_JOIN_THRESHOLD,
  RAID_WINDOW_SEC,
  type BulkMembersResult,
  type ChatSummary,
  type Message,
  type MessagePage,
  type ModMemberPage,
  type ModView,
  type Space,
  type SpaceAuditEntry,
  type SpaceBan,
  type SpaceDetail,
  type SpaceInvite,
  type SpaceRole,
  type SpaceSecurity,
} from '@enbox/shared';
import { db } from '../../src/db/index.js';
import { messages, spaceMembers, users, voiceStates } from '../../src/db/schema.js';
import { spaceRegistryIdle } from '../../src/realtime/spaceRegistry.js';
import { dmGate } from '../../src/services/dmGate.js';
import { startTestServer, waitForEvent, type TestServer, type TestUser } from '../helpers.js';

const DAY = 86_400_000;

describe('moderation', () => {
  let t: TestServer;
  let owner: TestUser;
  let mod: TestUser;
  let senior: TestUser;
  let ann: TestUser;
  let ben: TestUser;
  let cat: TestUser;
  let dan: TestUser;
  let eve: TestUser;
  let detail: SpaceDetail;
  let invite: SpaceInvite;
  let seniors: SpaceRole;
  let mods: SpaceRole;
  let low: SpaceRole;
  const spaceId = () => detail.space.id;
  const general = () => detail.channels.find((c) => c.name === 'general')!;
  const voice = () => detail.channels.find((c) => c.type === 'space_voice')!;
  const base = () => `/api/spaces/${spaceId()}`;

  async function join(user: TestUser, code = invite.code) {
    await t.api(user).post(`/api/invites/${code}/join`).expect(200);
    await spaceRegistryIdle();
  }

  async function role(name: string, permissions: number): Promise<SpaceRole> {
    return (await t.api(owner).post(`${base()}/roles`).send({ name, permissions }).expect(201))
      .body as SpaceRole;
  }

  function search(user: TestUser, query: Record<string, string | number> = {}) {
    const qs = new URLSearchParams(
      Object.entries(query).map(([k, v]): [string, string] => [k, String(v)]),
    ).toString();
    return t.api(user).get(`${base()}/members/search${qs ? `?${qs}` : ''}`);
  }

  async function searchIds(query: Record<string, string | number> = {}) {
    const page = (await search(mod, query).expect(200)).body as ModMemberPage;
    return page.members.map((m) => m.userId);
  }

  async function auditLog(): Promise<SpaceAuditEntry[]> {
    return (await t.api(owner).get(`${base()}/audit-log?limit=100`).expect(200)).body;
  }

  async function send(user: TestUser, chatId: string, text: string): Promise<Message> {
    return (
      await t
        .api(user)
        .post(`/api/chats/${chatId}/messages`)
        .send({ clientId: Math.random().toString(36), type: 'text', text })
        .expect(201)
    ).body as Message;
  }

  const bulk = (user: TestUser, body: Record<string, unknown>) =>
    t.api(user).post(`${base()}/members/bulk`).send(body);

  beforeAll(async () => {
    t = await startTestServer();
    owner = await t.createUser({ displayName: 'Owner' });
    mod = await t.createUser({ displayName: 'Mod' });
    senior = await t.createUser({ displayName: 'Senior' });
    ann = await t.createUser({ displayName: 'Ann' });
    ben = await t.createUser({ displayName: 'Ben' });
    cat = await t.createUser({ displayName: 'Cat' });
    dan = await t.createUser({ displayName: 'Dan' });
    eve = await t.createUser({ displayName: 'Eve' });
    detail = (await t.api(owner).post('/api/spaces').send({ name: 'Guild' }).expect(201)).body;
    invite = (await t.api(owner).post(`${base()}/invites`).send({}).expect(201)).body;
    for (const u of [mod, senior, ann, ben, cat, dan, eve]) await join(u);
    // Positions: new roles go in at 1, so the last one created is the lowest.
    seniors = await role('Seniors', PERM.KICK_MEMBERS);
    mods = await role(
      'Mods',
      PERM.KICK_MEMBERS | PERM.BAN_MEMBERS | PERM.MODERATE_MEMBERS | PERM.MANAGE_ROLES,
    );
    low = await role('Low', 0);
    await t.api(owner).put(`${base()}/members/${mod.id}/roles/${mods.id}`).expect(200);
    await t.api(owner).put(`${base()}/members/${senior.id}/roles/${seniors.id}`).expect(200);
    // Old accounts, except Cat's (a "new account").
    for (const u of [owner, mod, senior, ann, ben, dan, eve])
      await db
        .update(users)
        .set({ createdAt: new Date(Date.now() - 400 * DAY) })
        .where(eq(users.id, u.id));
  });
  afterAll(() => t.close());

  it('joins and leaving on one’s own are audited (member.join, member.leave)', async () => {
    const leaver = await t.createUser({ displayName: 'Leaver' });
    await join(leaver);
    await t.api(leaver).post(`${base()}/leave`).expect(204);
    const mine = (await auditLog()).filter((e) => e.targetId === leaver.id);
    expect(mine.map((e) => [e.action, e.actorId, e.targetType])).toEqual([
      ['member.leave', leaver.id, 'member'],
      ['member.join', leaver.id, 'member'],
    ]);
    // The creator's own join is part of creating the Space.
    expect(
      (await auditLog()).some((e) => e.action === 'member.join' && e.targetId === owner.id),
    ).toBe(false);
  });

  it('search: moderators only; filters, sorts, paging and a count', async () => {
    await search(ann).expect(403);
    const setJoined = (u: TestUser, ago: number) =>
      db
        .update(spaceMembers)
        .set({ joinedAt: new Date(Date.now() - ago) })
        .where(and(eq(spaceMembers.spaceId, spaceId()), eq(spaceMembers.userId, u.id)));
    await setJoined(ann, 10 * DAY);
    await setJoined(ben, 3 * DAY);

    const first = (await search(mod).expect(200)).body as ModMemberPage;
    expect(first.total).toBe(8);
    expect(first.nextCursor).toBeNull();
    const times = first.members.map((m) => Date.parse(m.joinedAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times); // joined, newest first
    expect(first.members.slice(-2).map((m) => m.userId)).toEqual([ben.id, ann.id]);
    const annRow = first.members.find((m) => m.userId === ann.id)!;
    expect(annRow.user).toMatchObject({ id: ann.id, displayName: 'Ann' });
    expect(Date.parse(annRow.accountCreatedAt)).toBeLessThan(Date.now() - 300 * DAY);
    expect(first.members.find((m) => m.userId === mod.id)!.roleIds).toEqual([mods.id]);

    expect((await searchIds({ sort: 'joined_asc' })).slice(0, 2)).toEqual([ann.id, ben.id]);
    const byName = [ann, ben, cat, dan, eve, mod, owner, senior].map((u) => u.id);
    expect(await searchIds({ sort: 'name' })).toEqual(byName);
    expect(await searchIds({ q: 'be' })).toEqual([ben.id]);
    expect(await searchIds({ q: '@an' })).toEqual([ann.id]);
    expect(await searchIds({ q: dan.id })).toEqual([dan.id]);
    expect(await searchIds({ roleIds: mods.id })).toEqual([mod.id]);
    expect(await searchIds({ roleIds: `${mods.id},${low.id}` })).toEqual([]);
    const weekAgo = new Date(Date.now() - 7 * DAY).toISOString();
    expect(await searchIds({ joinedAfter: weekAgo })).not.toContain(ann.id);
    expect(await searchIds({ joinedAfter: weekAgo })).toContain(ben.id);
    expect(
      await searchIds({ joinedBefore: new Date(Date.now() - DAY).toISOString(), sort: 'name' }),
    ).toEqual([ann.id, ben.id]);
    expect(await searchIds({ accountCreatedAfter: weekAgo })).toEqual([cat.id]);

    await t
      .api(mod)
      .patch(`${base()}/members/${dan.id}`)
      .send({ timedOutUntil: new Date(Date.now() + 3600_000).toISOString() })
      .expect(200);
    expect(await searchIds({ timedOut: 'true' })).toEqual([dan.id]);
    expect(await searchIds({ timedOut: 'false' })).not.toContain(dan.id);

    // Paging by name, three at a time; the count is of every match.
    const seen: string[] = [];
    let after: string | null = null;
    do {
      const page = (
        await search(mod, { sort: 'name', limit: 3, ...(after ? { after } : {}) }).expect(200)
      ).body as ModMemberPage;
      expect(page.total).toBe(8);
      seen.push(...page.members.map((m) => m.userId));
      after = page.nextCursor;
    } while (after);
    expect(seen).toEqual(byName);
    // A cursor is tied to its sort.
    const page1 = (await search(mod, { sort: 'name', limit: 3 }).expect(200)).body;
    await search(mod, { sort: 'joined_desc', after: page1.nextCursor }).expect(400);
    await search(mod, { after: 'not-a-cursor' }).expect(400);
  });

  it('Mod View: their messages in channels I can see, the 30-day count, audit and voice', async () => {
    const staff = (
      await t
        .api(owner)
        .post(`${base()}/channels`)
        .send({ type: 'space_text', name: 'staff', privateRoleIds: [seniors.id] })
        .expect(201)
    ).body as ChatSummary;
    await spaceRegistryIdle();
    const old = await send(senior, general().id, 'an old one');
    await db
      .update(messages)
      .set({ createdAt: new Date(Date.now() - 40 * DAY) })
      .where(eq(messages.id, old.id));
    await send(senior, staff.id, 'secret staff talk');
    await send(senior, general().id, 'hello general');
    await t
      .api(owner)
      .patch(`${base()}/members/${senior.id}`)
      .send({ timedOutUntil: new Date(Date.now() + 60_000).toISOString(), reason: 'cool off' })
      .expect(200);
    await db.insert(voiceStates).values({
      userId: senior.id,
      spaceId: spaceId(),
      channelId: voice().id,
      socketId: 'sock',
      nodeId: 'node',
    });

    const view = (await t.api(mod).get(`${base()}/members/${senior.id}/mod-view`).expect(200))
      .body as ModView;
    expect(view.member).toMatchObject({ userId: senior.id, roleIds: [seniors.id] });
    expect(view.member.user.displayName).toBe('Senior');
    // Not the private channel the moderator can't see; newest first.
    expect(view.recentMessages.map((m) => m.text)).toEqual(['hello general', 'an old one']);
    expect(view.messageCount30d).toBe(1);
    expect(view.auditEntries.map((e) => e.action)).toEqual([
      'member.timeout',
      'member.roles',
      'member.join',
    ]);
    expect(view.auditEntries[0]).toMatchObject({ actorId: owner.id, reason: 'cool off' });
    expect(view.voiceChannelId).toBe(voice().id);

    const ownerView = (
      await t.api(owner).get(`${base()}/members/${senior.id}/mod-view`).expect(200)
    ).body as ModView;
    expect(ownerView.recentMessages.map((m) => m.text)).toEqual([
      'hello general',
      'secret staff talk',
      'an old one',
    ]);
    expect(ownerView.messageCount30d).toBe(2);

    await t.api(ann).get(`${base()}/members/${senior.id}/mod-view`).expect(403);
    const outsider = await t.createUser();
    await t.api(mod).get(`${base()}/members/${outsider.id}/mod-view`).expect(404);
    await db.delete(voiceStates).where(eq(voiceStates.userId, senior.id));
    await t.api(owner).patch(`${base()}/members/${senior.id}`).send({ timedOutUntil: null });
  });

  it('bulk: each member as alone, refusals with the single routes’ reasons', async () => {
    await bulk(ann, { action: 'kick', userIds: [ben.id] }).expect(403);
    await bulk(mod, { action: 'add_role', userIds: [ann.id] }).expect(400);
    await bulk(mod, { action: 'timeout', userIds: [ann.id] }).expect(400);
    await bulk(mod, { action: 'ban', userIds: [ann.id], deleteMessageSeconds: 1234 }).expect(400);
    // A role at or above mine: the whole request is refused.
    await bulk(mod, { action: 'add_role', userIds: [ann.id], roleId: seniors.id }).expect(403);

    const roles = (
      await bulk(mod, { action: 'add_role', userIds: [ann.id, ben.id], roleId: low.id }).expect(200)
    ).body as BulkMembersResult;
    expect(roles).toEqual({ ok: [ann.id, ben.id], failed: [] });
    expect((await searchIds({ roleIds: low.id, sort: 'name' })).sort()).toEqual(
      [ann.id, ben.id].sort(),
    );
    const removed = (
      await bulk(mod, { action: 'remove_role', userIds: [ben.id], roleId: low.id }).expect(200)
    ).body as BulkMembersResult;
    expect(removed.ok).toEqual([ben.id]);

    const timeout = (
      await bulk(mod, {
        action: 'timeout',
        userIds: [ann.id, senior.id, owner.id],
        durationSec: 600,
        reason: 'raid',
      }).expect(200)
    ).body as BulkMembersResult;
    expect(timeout.ok).toEqual([ann.id]);
    expect(timeout.failed).toEqual([
      { userId: senior.id, reason: 'You can only do that to members below your highest role' },
      { userId: owner.id, reason: 'You can only do that to members below your highest role' },
    ]);
    const annNow = (await t.api(mod).get(`${base()}/members/${ann.id}`).expect(200)).body;
    expect(Date.parse(annNow.timedOutUntil) - Date.now()).toBeGreaterThan(590_000);

    const kick = (
      await bulk(mod, {
        action: 'kick',
        userIds: [ben.id, senior.id, owner.id, mod.id, ben.id],
        reason: 'spam wave',
      }).expect(200)
    ).body as BulkMembersResult;
    expect(kick.ok).toEqual([ben.id]);
    expect(kick.failed.map((f) => f.userId)).toEqual([senior.id, owner.id, mod.id]);
    expect(kick.failed[0]!.reason).toBe('You can only kick members below your highest role');
    expect(kick.failed[2]!.reason).toBe('Use leave to leave a Space');
    const log = await auditLog();
    expect(log.find((e) => e.action === 'member.kick' && e.targetId === ben.id)?.reason).toBe(
      'spam wave',
    );
    // Kicks have their own entry: no member.leave.
    expect(log.some((e) => e.action === 'member.leave' && e.targetId === ben.id)).toBe(false);

    // Ban by ID: someone who isn't a member can be banned too; their messages go.
    const outsider = await t.createUser({ displayName: 'Outsider' });
    const spam = await send(cat, general().id, 'buy now');
    const ban = (
      await bulk(mod, {
        action: 'ban',
        userIds: [cat.id, outsider.id, senior.id],
        deleteMessageSeconds: 3600,
        reason: 'raid',
      }).expect(200)
    ).body as BulkMembersResult;
    expect(ban.ok).toEqual([cat.id, outsider.id]);
    expect(ban.failed).toEqual([
      { userId: senior.id, reason: 'You can only ban members below your highest role' },
    ]);
    const bans = (await t.api(owner).get(`${base()}/bans`).expect(200)).body as SpaceBan[];
    expect(bans.map((b) => b.user.id).sort()).toEqual([cat.id, outsider.id].sort());
    const page = (await t.api(owner).get(`/api/chats/${general().id}/messages`).expect(200))
      .body as MessagePage;
    expect(page.messages.find((m) => m.id === spam.id)?.deletedAt ?? 'gone').not.toBeNull();
    await t.api(outsider).post(`/api/invites/${invite.code}/join`).expect(403);
  });

  it('Pause Invites: joins refused with invites_paused until resumed; who may change what', async () => {
    const sa = await t.connect(ann);
    const evt = waitForEvent(sa, 'space:security');
    const paused = (
      await t.api(mod).patch(`${base()}/security`).send({ pauseInvitesSec: 3600 }).expect(200)
    ).body as SpaceSecurity;
    expect(Date.parse(paused.invitesPausedUntil!) - Date.now()).toBeGreaterThan(3500_000);
    expect(paused.dmsPausedUntil).toBeNull();
    expect((await evt).security.invitesPausedUntil).toBe(paused.invitesPausedUntil);
    sa.disconnect();

    const newbie = await t.createUser({ displayName: 'Newbie' });
    const preview = (await t.api(newbie).get(`/api/invites/${invite.code}`).expect(200)).body;
    expect(preview).toMatchObject({ canJoin: false, reason: 'Invites to this Space are paused' });
    const refused = await t.api(newbie).post(`/api/invites/${invite.code}/join`).expect(403);
    expect(refused.body.error).toMatchObject({
      code: 'invites_paused',
      message: 'Invites to this Space are paused',
    });

    const annSpace = ((await t.api(ann).get('/api/spaces').expect(200)).body as Space[])[0]!;
    expect(annSpace).toMatchObject({ invitesPaused: true, security: null });
    const modSpace = ((await t.api(mod).get('/api/spaces').expect(200)).body as Space[])[0]!;
    expect(modSpace.security?.invitesPausedUntil).toBe(paused.invitesPausedUntil);

    // Moderators pause; only managers choose the alerts.
    await t.api(mod).patch(`${base()}/security`).send({ raidAlerts: false }).expect(403);
    await t
      .api(mod)
      .patch(`${base()}/security`)
      .send({ safetyAlertsChannelId: general().id })
      .expect(403);
    await t.api(ann).patch(`${base()}/security`).send({ pauseInvitesSec: 3600 }).expect(403);
    await t.api(ann).get(`${base()}/security`).expect(403);
    await t
      .api(owner)
      .patch(`${base()}/security`)
      .send({ safetyAlertsChannelId: voice().id })
      .expect(404);
    const owned = (
      await t
        .api(owner)
        .patch(`${base()}/security`)
        .send({ safetyAlertsChannelId: general().id, raidAlerts: false })
        .expect(200)
    ).body as SpaceSecurity;
    expect(owned).toMatchObject({ safetyAlertsChannelId: general().id, raidAlerts: false });
    expect((await t.api(mod).get(`${base()}/security`).expect(200)).body).toEqual(owned);

    const resumed = (
      await t.api(mod).patch(`${base()}/security`).send({ pauseInvitesSec: null }).expect(200)
    ).body as SpaceSecurity;
    expect(resumed.invitesPausedUntil).toBeNull();
    await join(newbie);
    const entries = (await auditLog()).filter((e) => e.action === 'space.security');
    expect(entries.map((e) => Object.keys(e.changes ?? {}).sort())).toEqual([
      ['invitesPausedUntil'],
      ['raidAlerts', 'safetyAlertsChannelId'],
      ['invitesPausedUntil'],
    ]);
  });

  it('Pause DMs: the Space stops counting as shared for the DM gate (friends unaffected)', async () => {
    await t.api(eve).patch('/api/me/settings').send({ whoCanDm: 'spaces' }).expect(200);
    expect(await dmGate(db, dan.id, eve.id)).not.toBe('refused');
    await t.api(mod).patch(`${base()}/security`).send({ pauseDmsSec: 3600 }).expect(200);
    expect(await dmGate(db, dan.id, eve.id)).toBe('refused');
    const refused = await t.api(dan).post('/api/chats/direct').send({ userId: eve.id }).expect(403);
    expect(refused.body.error.code).toBe('dm_not_allowed');
    await t.api(mod).patch(`${base()}/security`).send({ pauseDmsSec: null }).expect(200);
    expect(await dmGate(db, dan.id, eve.id)).not.toBe('refused');
  });

  it('raid alerts: one card in the safety alerts channel at the threshold, once per window', async () => {
    const raided = (await t.api(owner).post('/api/spaces').send({ name: 'Raided' }).expect(201))
      .body as SpaceDetail;
    const rbase = `/api/spaces/${raided.space.id}`;
    const alerts = (
      await t
        .api(owner)
        .post(`${rbase}/channels`)
        .send({ type: 'space_text', name: 'mod-alerts' })
        .expect(201)
    ).body as ChatSummary;
    await t
      .api(owner)
      .patch(`${rbase}/security`)
      .send({ safetyAlertsChannelId: alerts.id })
      .expect(200);
    const code = (
      (await t.api(owner).post(`${rbase}/invites`).send({}).expect(201)).body as SpaceInvite
    ).code;
    const raidAlerts = async () =>
      (
        (await t.api(owner).get(`/api/chats/${alerts.id}/messages`).expect(200)).body as MessagePage
      ).messages.filter((m) => m.system?.kind === 'raid_alert');

    for (let i = 0; i < RAID_JOIN_THRESHOLD - 1; i++) await join(await t.createUser(), code);
    expect(await raidAlerts()).toHaveLength(0);
    await join(await t.createUser(), code);
    const [alert, ...more] = await raidAlerts();
    expect(more).toHaveLength(0);
    expect(alert!.system).toEqual({
      kind: 'raid_alert',
      joins: RAID_JOIN_THRESHOLD,
      windowSec: RAID_WINDOW_SEC,
    });
    for (let i = 0; i < 2; i++) await join(await t.createUser(), code);
    expect(await raidAlerts()).toHaveLength(1);
  });
});
