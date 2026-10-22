/**
 * Space options (Discord's server options): clone channel, mark a Space read, my notification
 * settings (incl. suppressing role mentions), verification level, system message flags,
 * channel invites, voice channel settings, and owner-only deletion.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  PERM,
  SPACE_SYSTEM_FLAGS,
  type ChatSummary,
  type Message,
  type MessagePage,
  type PushPayload,
  type Space,
  type SpaceDetail,
  type SpaceInvite,
  type SpaceRole,
} from '@enbox/shared';
import { db } from '../../src/db/index.js';
import { spaceMembers, users } from '../../src/db/schema.js';
import { pushIdle, setPushSender, type PushTarget } from '../../src/modules/push/sender.js';
import { spaceRegistryIdle } from '../../src/realtime/spaceRegistry.js';
import {
  expectNoEvent,
  startTestServer,
  waitForEvent,
  type TestServer,
  type TestUser,
} from '../helpers.js';

const HOUR_AGO = () => new Date(Date.now() - 3_600_000);

describe('space options', () => {
  let t: TestServer;
  let owner: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let detail: SpaceDetail;
  let invite: SpaceInvite;
  let pushes: { endpoint: string; payload: PushPayload }[];
  const spaceId = () => detail.space.id;
  const general = () => detail.channels.find((c) => c.name === 'general')!;

  beforeAll(async () => {
    t = await startTestServer();
    setPushSender(async (target: PushTarget, payload: PushPayload) => {
      pushes.push({ endpoint: target.endpoint, payload });
    });
    [owner, bob, carol] = [
      await t.createUser({ displayName: 'Owner' }),
      await t.createUser({ displayName: 'Bob' }),
      await t.createUser({ displayName: 'Carol' }),
    ];
    // Old accounts: the verification level tests make new ones where they need them.
    for (const u of [owner, bob, carol])
      await db.update(users).set({ createdAt: HOUR_AGO() }).where(eq(users.id, u.id));
    detail = (await t.api(owner).post('/api/spaces').send({ name: 'Options' }).expect(201))
      .body as SpaceDetail;
    invite = (await t.api(owner).post(`/api/spaces/${spaceId()}/invites`).send({}).expect(201))
      .body as SpaceInvite;
    await t.api(bob).post(`/api/invites/${invite.code}/join`).expect(200);
    await spaceRegistryIdle();
  });
  afterAll(async () => {
    setPushSender(undefined);
    await t.close();
  });
  beforeEach(() => {
    pushes = [];
  });

  async function send(user: TestUser, chatId: string, text: string) {
    return t
      .api(user)
      .post(`/api/chats/${chatId}/messages`)
      .send({ clientId: Math.random().toString(36), type: 'text', text });
  }

  async function channels(user: TestUser): Promise<ChatSummary[]> {
    return (await t.api(user).get(`/api/spaces/${spaceId()}/channels`).expect(200))
      .body as ChatSummary[];
  }

  async function mySpace(user: TestUser): Promise<Space> {
    return (await t.api(user).get(`/api/spaces/${spaceId()}/members/me`).expect(200)).body as Space;
  }

  async function subscribe(user: TestUser): Promise<string> {
    const endpoint = `https://fcm.googleapis.com/fcm/send/${user.id}`;
    await t
      .api(user)
      .post('/api/push/subscriptions')
      .send({ endpoint, keys: { p256dh: 'BPublicKey', auth: 'authSecret' } })
      .expect(204);
    return endpoint;
  }

  describe('clone channel', () => {
    it('copies type, topic, settings, category and overwrites; needs MANAGE_CHANNELS', async () => {
      const staff = (
        await t.api(owner).post(`/api/spaces/${spaceId()}/roles`).send({ name: 'Staff' }).expect(201)
      ).body as SpaceRole;
      const source = (
        await t
          .api(owner)
          .post(`/api/spaces/${spaceId()}/channels`)
          .send({
            type: 'space_text',
            name: 'rules',
            topic: 'Read me',
            categoryId: general().space!.categoryId,
            privateRoleIds: [staff.id],
          })
          .expect(201)
      ).body as ChatSummary;
      await t
        .api(owner)
        .patch(`/api/spaces/${spaceId()}/channels/${source.id}`)
        .send({ slowmodeSeconds: 30, nsfw: true })
        .expect(200);

      await t.api(bob).post(`/api/spaces/${spaceId()}/channels/${general().id}/clone`).expect(403);

      const sb = await t.connect(bob);
      const changed = waitForEvent(sb, 'space:channels-changed');
      const clone = (
        await t
          .api(owner)
          .post(`/api/spaces/${spaceId()}/channels/${source.id}/clone`)
          .send({ name: 'Rules Copy' })
          .expect(201)
      ).body as ChatSummary;
      await changed;
      expect(clone.id).not.toBe(source.id);
      expect(clone.name).toBe('rules-copy');
      expect(clone.type).toBe('space_text');
      expect(clone.space).toMatchObject({
        categoryId: source.space!.categoryId,
        topic: 'Read me',
        slowmodeSeconds: 30,
        nsfw: true,
        permissionsSynced: false,
      });
      const key = (o: { targetType: string; targetId: string; allow: number; deny: number }) =>
        `${o.targetType}:${o.targetId}:${o.allow}:${o.deny}`;
      expect(clone.space!.overwrites.map(key).sort()).toEqual(
        source.space!.overwrites.map(key).sort(),
      );
      // Private like its source: Bob (no Staff role) sees neither.
      await spaceRegistryIdle();
      expect((await channels(bob)).some((c) => c.id === clone.id)).toBe(false);
      const log = (await t.api(owner).get(`/api/spaces/${spaceId()}/audit-log`).expect(200))
        .body as { action: string; targetId: string; changes: { clonedFrom?: string } }[];
      expect(log.find((e) => e.action === 'channel.clone')).toMatchObject({
        targetId: clone.id,
        changes: { clonedFrom: source.id },
      });
      sb.disconnect();
    });

    it('voice channels keep their user limit and bitrate (validated on create and edit)', async () => {
      await t
        .api(owner)
        .post(`/api/spaces/${spaceId()}/channels`)
        .send({ type: 'space_voice', name: 'Loud', bitrate: 512_000 })
        .expect(400);
      const voice = (
        await t
          .api(owner)
          .post(`/api/spaces/${spaceId()}/channels`)
          .send({ type: 'space_voice', name: 'Lounge', userLimit: 5, bitrate: 32_000 })
          .expect(201)
      ).body as ChatSummary;
      expect(voice.space).toMatchObject({ userLimit: 5, bitrate: 32_000 });
      await t
        .api(owner)
        .patch(`/api/spaces/${spaceId()}/channels/${voice.id}`)
        .send({ bitrate: 4_000 })
        .expect(400);
      const edited = (
        await t
          .api(owner)
          .patch(`/api/spaces/${spaceId()}/channels/${voice.id}`)
          .send({ bitrate: 96_000, userLimit: null })
          .expect(200)
      ).body as ChatSummary;
      expect(edited.space).toMatchObject({ userLimit: null, bitrate: 96_000 });
      const clone = (
        await t.api(owner).post(`/api/spaces/${spaceId()}/channels/${voice.id}/clone`).expect(201)
      ).body as ChatSummary;
      expect([clone.type, clone.name, clone.space?.bitrate, clone.space?.userLimit]).toEqual([
        'space_voice',
        'Lounge',
        96_000,
        null,
      ]);
      // Text channels have no bitrate.
      const text = (
        await t
          .api(owner)
          .patch(`/api/spaces/${spaceId()}/channels/${general().id}`)
          .send({ bitrate: 64_000 })
          .expect(200)
      ).body as ChatSummary;
      expect(text.space?.bitrate).toBeNull();
    });
  });

  describe('mark Space read', () => {
    it('reads every channel I can see, with chat:read per channel and space:upsert', async () => {
      const second = (
        await t
          .api(owner)
          .post(`/api/spaces/${spaceId()}/channels`)
          .send({ type: 'space_text', name: 'random' })
          .expect(201)
      ).body as ChatSummary;
      await spaceRegistryIdle();
      for (const c of [general().id, second.id])
        expect((await send(owner, c, `unread in ${c}`)).status).toBe(201);
      const before = await channels(bob);
      expect(before.filter((c) => c.unreadCount > 0).map((c) => c.id).sort()).toEqual(
        [general().id, second.id].sort(),
      );
      expect((await mySpace(bob)).unread).toBe(true);

      const sb = await t.connect(bob);
      const reads = new Set<string>();
      const gotReads = new Promise<void>((resolve) => {
        sb.on('chat:read', (p) => {
          reads.add(p.chatId);
          if (reads.has(general().id) && reads.has(second.id)) resolve();
        });
      });
      const upsert = waitForEvent(sb, 'space:upsert', { filter: (p) => p.space.id === spaceId() });
      await t.api(bob).post(`/api/spaces/${spaceId()}/read`).expect(204);
      await gotReads;
      expect((await upsert).space.unread).toBe(false);
      const after = await channels(bob);
      expect(after.every((c) => c.unreadCount === 0 && c.lastReadSeq === c.lastSeq)).toBe(true);
      // Nothing to read: still fine.
      await t.api(bob).post(`/api/spaces/${spaceId()}/read`).expect(204);
      await t.api(carol).post(`/api/spaces/${spaceId()}/read`).expect(404);
      sb.disconnect();
    });
  });

  describe('my notification settings', () => {
    let mods: SpaceRole;

    it('stores level, mute, suppressions and hide muted channels; space:upsert → my devices', async () => {
      const sb = await t.connect(bob);
      const upsert = waitForEvent(sb, 'space:upsert', {
        filter: (p) => p.space.me.hideMutedChannels,
      });
      const until = new Date(Date.now() + 3_600_000).toISOString();
      const space = (
        await t
          .api(bob)
          .patch(`/api/spaces/${spaceId()}/members/me`)
          .send({
            notifyLevel: 'all',
            mutedUntil: until,
            suppressEveryone: true,
            suppressRoles: true,
            hideMutedChannels: true,
          })
          .expect(200)
      ).body as Space;
      expect(space.me).toMatchObject({
        notifyLevel: 'all',
        suppressEveryone: true,
        suppressRoles: true,
        hideMutedChannels: true,
      });
      expect(Date.parse(space.me.mutedUntil!)).toBe(Date.parse(until));
      expect((await upsert).space.me.suppressRoles).toBe(true);
      await t
        .api(bob)
        .patch(`/api/spaces/${spaceId()}/members/me`)
        .send({ mutedUntil: null, notifyLevel: null, suppressEveryone: false })
        .expect(200);
      sb.disconnect();
    });

    it('suppressRoles: role mentions neither count as mentions nor push; user mentions still do', async () => {
      mods = (
        await t
          .api(owner)
          .post(`/api/spaces/${spaceId()}/roles`)
          .send({ name: 'Mods', mentionable: true })
          .expect(201)
      ).body as SpaceRole;
      await t.api(owner).put(`/api/spaces/${spaceId()}/members/${bob.id}/roles/${mods.id}`).expect(200);
      await t.api(bob).post(`/api/spaces/${spaceId()}/read`).expect(204);
      const endpoint = await subscribe(bob);

      const roleMsg = (await send(owner, general().id, `hey @{role:${mods.id}}`)).body as Message;
      expect(roleMsg.mentionRoleIds).toEqual([mods.id]);
      await pushIdle();
      expect(pushes.filter((p) => p.endpoint === endpoint)).toHaveLength(0);
      let g = (await channels(bob)).find((c) => c.id === general().id)!;
      expect(g.unreadMentionCount).toBe(0);
      expect((await mySpace(bob)).unreadMentionCount).toBe(0);

      expect((await send(owner, general().id, `and you @{${bob.id}}`)).status).toBe(201);
      await pushIdle();
      expect(pushes.filter((p) => p.endpoint === endpoint)).toHaveLength(1);
      g = (await channels(bob)).find((c) => c.id === general().id)!;
      expect(g.unreadMentionCount).toBe(1);

      // Turned off again: role mentions count and push.
      await t
        .api(bob)
        .patch(`/api/spaces/${spaceId()}/members/me`)
        .send({ suppressRoles: false })
        .expect(200);
      pushes = [];
      expect((await send(owner, general().id, `again @{role:${mods.id}}`)).status).toBe(201);
      await pushIdle();
      expect(pushes.filter((p) => p.endpoint === endpoint)).toHaveLength(1);
      g = (await channels(bob)).find((c) => c.id === general().id)!;
      // Counted at read time: the earlier role mention counts again too.
      expect(g.unreadMentionCount).toBe(3);
      await t.api(bob).post(`/api/spaces/${spaceId()}/read`).expect(204);
      await t
        .api(owner)
        .delete(`/api/spaces/${spaceId()}/members/${bob.id}/roles/${mods.id}`)
        .expect(200);
    });
  });

  describe('Space settings', () => {
    it('PATCH stores the safety and system message options and broadcasts space:updated', async () => {
      await t
        .api(owner)
        .patch(`/api/spaces/${spaceId()}`)
        .send({ systemFlags: 1 << 5 })
        .expect(400);
      await t
        .api(owner)
        .patch(`/api/spaces/${spaceId()}`)
        .send({ verificationLevel: 5 })
        .expect(400);
      await t.api(bob).patch(`/api/spaces/${spaceId()}`).send({ explicitFilter: 2 }).expect(403);
      const sb = await t.connect(bob);
      const updated = waitForEvent(sb, 'space:updated', {
        filter: (p) => (p.changes as Record<string, unknown>).explicitFilter === 2,
      });
      const space = (
        await t
          .api(owner)
          .patch(`/api/spaces/${spaceId()}`)
          .send({
            explicitFilter: 2,
            systemFlags: SPACE_SYSTEM_FLAGS.SUPPRESS_SETUP_TIPS,
            afkTimeoutSec: 900,
          })
          .expect(200)
      ).body as Space;
      expect(space).toMatchObject({
        explicitFilter: 2,
        systemFlags: SPACE_SYSTEM_FLAGS.SUPPRESS_SETUP_TIPS,
        afkTimeoutSec: 900,
      });
      expect((await updated).changes).toMatchObject({
        explicitFilter: 2,
        systemFlags: SPACE_SYSTEM_FLAGS.SUPPRESS_SETUP_TIPS,
        afkTimeoutSec: 900,
      });
      sb.disconnect();
    });

    it('system flags: suppressing join notifications skips the welcome message', async () => {
      await t
        .api(owner)
        .patch(`/api/spaces/${spaceId()}`)
        .send({ systemFlags: SPACE_SYSTEM_FLAGS.SUPPRESS_JOIN_NOTIFICATIONS })
        .expect(200);
      const so = await t.connect(owner);
      const quiet = expectNoEvent(so, 'message:new', 500);
      await t.api(carol).post(`/api/invites/${invite.code}/join`).expect(200);
      await quiet;
      const page = (await t.api(owner).get(`/api/chats/${general().id}/messages`).expect(200))
        .body as MessagePage;
      const joins = page.messages.filter((m) => m.system?.kind === 'member_joined_space');
      expect(joins.map((m) => m.system && 'actorId' in m.system && m.system.actorId)).not.toContain(
        carol.id,
      );
      expect(joins.map((m) => m.system && 'actorId' in m.system && m.system.actorId)).toContain(
        bob.id,
      );
      so.disconnect();
      await t
        .api(owner)
        .patch(`/api/spaces/${spaceId()}`)
        .send({ systemFlags: 0 })
        .expect(200);
      await spaceRegistryIdle();
    });

    it('verification level: Medium (account age) and High (membership age) gate sending', async () => {
      const dave = await t.createUser({ displayName: 'Dave' }); // a brand-new account
      await t.api(dave).post(`/api/invites/${invite.code}/join`).expect(200);
      await spaceRegistryIdle();
      await t.api(owner).patch(`/api/spaces/${spaceId()}`).send({ verificationLevel: 1 }).expect(200);
      // Low (verified email) is stored but cannot be checked: sending still works.
      expect((await send(dave, general().id, 'low')).status).toBe(201);

      await t.api(owner).patch(`/api/spaces/${spaceId()}`).send({ verificationLevel: 2 }).expect(200);
      const blocked = await send(dave, general().id, 'too new');
      expect(blocked.status).toBe(403);
      expect(blocked.body.error.message).toMatch(/older than 5 minutes/);
      // The owner and members with a role are exempt.
      expect((await send(owner, general().id, 'owner')).status).toBe(201);
      const helpers = (
        await t.api(owner).post(`/api/spaces/${spaceId()}/roles`).send({ name: 'Helpers' }).expect(201)
      ).body as SpaceRole;
      await t
        .api(owner)
        .put(`/api/spaces/${spaceId()}/members/${dave.id}/roles/${helpers.id}`)
        .expect(200);
      expect((await send(dave, general().id, 'with a role')).status).toBe(201);
      await t
        .api(owner)
        .delete(`/api/spaces/${spaceId()}/members/${dave.id}/roles/${helpers.id}`)
        .expect(200);
      await db.update(users).set({ createdAt: HOUR_AGO() }).where(eq(users.id, dave.id));
      expect((await send(dave, general().id, 'old enough')).status).toBe(201);

      // High: also a member for 10 minutes.
      await t.api(owner).patch(`/api/spaces/${spaceId()}`).send({ verificationLevel: 3 }).expect(200);
      const tooSoon = await send(dave, general().id, 'just joined');
      expect(tooSoon.status).toBe(403);
      expect(tooSoon.body.error.message).toMatch(/member for 10 minutes/);
      await db
        .update(spaceMembers)
        .set({ joinedAt: HOUR_AGO() })
        .where(and(eq(spaceMembers.spaceId, spaceId()), eq(spaceMembers.userId, dave.id)));
      expect((await send(dave, general().id, 'settled in')).status).toBe(201);
      // Forwards into the channel follow the same rule.
      await db
        .update(spaceMembers)
        .set({ joinedAt: new Date() })
        .where(and(eq(spaceMembers.spaceId, spaceId()), eq(spaceMembers.userId, dave.id)));
      const msg = (await send(owner, general().id, 'forward me')).body as Message;
      await t
        .api(dave)
        .post('/api/messages/forward')
        .send({ clientId: 'fw1', messageIds: [msg.id], chatIds: [general().id] })
        .expect(403);
      await t.api(owner).patch(`/api/spaces/${spaceId()}`).send({ verificationLevel: 0 }).expect(200);
      expect((await send(dave, general().id, 'open again')).status).toBe(201);
    });
  });

  describe('channel invites', () => {
    it('MANAGE_CHANNELS in a channel lists and revokes everyone’s invites to it', async () => {
      const mine = (
        await t
          .api(owner)
          .post(`/api/spaces/${spaceId()}/invites`)
          .send({ channelId: general().id })
          .expect(201)
      ).body as SpaceInvite;
      // Bob without the bit: only his own (none).
      let list = (
        await t
          .api(bob)
          .get(`/api/spaces/${spaceId()}/invites?channelId=${general().id}`)
          .expect(200)
      ).body as SpaceInvite[];
      expect(list).toEqual([]);
      await t.api(bob).delete(`/api/spaces/${spaceId()}/invites/${mine.code}`).expect(403);
      const editors = (
        await t
          .api(owner)
          .post(`/api/spaces/${spaceId()}/roles`)
          .send({ name: 'Editors', permissions: PERM.MANAGE_CHANNELS })
          .expect(201)
      ).body as SpaceRole;
      await t
        .api(owner)
        .put(`/api/spaces/${spaceId()}/members/${bob.id}/roles/${editors.id}`)
        .expect(200);
      list = (
        await t
          .api(bob)
          .get(`/api/spaces/${spaceId()}/invites?channelId=${general().id}`)
          .expect(200)
      ).body as SpaceInvite[];
      expect(list.map((i) => i.code)).toEqual([mine.code]);
      expect(list.every((i) => i.channelId === general().id)).toBe(true);
      await t.api(bob).delete(`/api/spaces/${spaceId()}/invites/${mine.code}`).expect(204);
    });
  });

  describe('deleting a Space', () => {
    it('only the owner can delete it, even administrators cannot', async () => {
      const admins = (
        await t
          .api(owner)
          .post(`/api/spaces/${spaceId()}/roles`)
          .send({ name: 'Admins', permissions: PERM.ADMINISTRATOR })
          .expect(201)
      ).body as SpaceRole;
      await t
        .api(owner)
        .put(`/api/spaces/${spaceId()}/members/${bob.id}/roles/${admins.id}`)
        .expect(200);
      await t.api(bob).delete(`/api/spaces/${spaceId()}`).expect(403);
      await t.api(carol).delete(`/api/spaces/${spaceId()}`).expect(403);
      const sb = await t.connect(bob);
      const gone = waitForEvent(sb, 'space:removed');
      await t.api(owner).delete(`/api/spaces/${spaceId()}`).expect(204);
      expect((await gone).reason).toBe('deleted');
      await t.api(owner).get(`/api/spaces/${spaceId()}`).expect(404);
      sb.disconnect();
    });
  });
});
