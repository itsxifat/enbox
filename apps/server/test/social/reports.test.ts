/**
 * Reports (W7-F): reporting messages, users and Spaces with an evidence snapshot that survives
 * edits and deletes, visibility 404s, validation, the hourly limit and "also block"; the
 * Space moderators' list (permissions, status filter, keyset paging, private channels left
 * out, reporters never shown) and status changes with their audit entries.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  PERM,
  type ChatSummary,
  type Message,
  type SpaceAuditEntry,
  type SpaceDetail,
  type SpaceInvite,
  type SpaceReport,
  type SpaceReportPage,
  type SpaceRole,
} from '@enbox/shared';
import { config } from '../../src/config.js';
import { db } from '../../src/db/index.js';
import { blocks, media as mediaTable, reports } from '../../src/db/schema.js';
import { runMediaGc } from '../../src/jobs/mediaGc.js';
import { resetUserLimits } from '../../src/lib/userLimit.js';
import { listReports } from '../../src/modules/reports/service.js';
import { spaceRegistryIdle } from '../../src/realtime/spaceRegistry.js';
import { startTestServer, waitForEvent, type TestServer, type TestUser } from '../helpers.js';
import { mkMedia } from '../messaging/support.js';
import { createDirect, createGroup, saveContact, send } from '../services/fixtures.js';

describe('reports', () => {
  let t: TestServer;

  beforeAll(async () => {
    t = await startTestServer();
  });
  afterAll(() => t.close());

  const report = (user: TestUser, body: Record<string, unknown>) =>
    t.api(user).post('/api/reports').send(body);

  async function rowOf(id: string) {
    const [row] = await db.select().from(reports).where(eq(reports.id, id));
    return row!;
  }

  /** Two friends with a DM. */
  async function friendsWithDm(aName = 'Ann', bName = 'Ben') {
    const a = await t.createUser({ displayName: aName });
    const b = await t.createUser({ displayName: bName });
    await saveContact(a, b);
    await saveContact(b, a);
    return { a, b, chat: await createDirect(a, b) };
  }

  describe('creating', () => {
    it('a message: evidence (text, files, author, chat, time) that survives edits and deletes', async () => {
      const { a, b, chat } = await friendsWithDm('Reporter', 'Author');
      const media = await mkMedia(b.id, 'image');
      const { message } = await send(b, chat, {
        type: 'image',
        text: 'look at this',
        mediaId: media.id,
      });
      const res = await report(a, {
        targetType: 'message',
        targetId: message.id,
        category: 'harassment',
        details: '  keeps sending these  ',
      }).expect(201);
      const id = res.body.id as string;
      const row = await rowOf(id);
      expect(row).toMatchObject({
        reporterId: a.id,
        targetType: 'message',
        targetId: message.id,
        spaceId: null,
        category: 'harassment',
        details: 'keeps sending these',
        status: 'open',
      });
      expect(row.evidence).toEqual({
        message: {
          id: message.id,
          chatId: chat,
          senderId: b.id,
          text: 'look at this',
          mediaUrls: [expect.stringMatching(/^\/uploads\/test\/.+\.bin$/)],
          createdAt: message.createdAt.toISOString(),
        },
        user: { id: b.id, username: b.username, displayName: 'Author' },
      });
      // The author edits, then deletes it: the snapshot stays.
      await t.api(b).patch(`/api/messages/${message.id}`).send({ text: 'nothing to see' });
      await t.api(b).delete(`/api/messages/${message.id}?for=everyone`).expect(204);
      expect((await rowOf(id)).evidence).toEqual(row.evidence);
      // …and so does the file: media GC keeps what reports reference.
      expect(row.mediaIds).toEqual([media.id]);
      await runMediaGc({ ttlMs: 0 });
      expect(
        await db.select({ id: mediaTable.id }).from(mediaTable).where(eq(mediaTable.id, media.id)),
      ).toEqual([{ id: media.id }]);
    });

    it('a user and a Space I belong to; 404 for anything I cannot see', async () => {
      const me = await t.createUser();
      const other = await t.createUser({ displayName: 'Other' });
      const r1 = await report(me, {
        targetType: 'user',
        targetId: other.id,
        category: 'spam',
      }).expect(201);
      expect((await rowOf(r1.body.id)).evidence).toEqual({
        user: { id: other.id, username: other.username, displayName: 'Other' },
      });
      await report(me, { targetType: 'user', targetId: me.id, category: 'spam' }).expect(400);
      await report(me, {
        targetType: 'user',
        targetId: crypto.randomUUID(),
        category: 'spam',
      }).expect(404);
      const gone = await t.createUser();
      await t.api(gone).delete('/api/me').send({ password: gone.password }).expect(204);
      await report(me, { targetType: 'user', targetId: gone.id, category: 'spam' }).expect(404);

      const detail = (await t.api(other).post('/api/spaces').send({ name: 'Shady' }).expect(201))
        .body as SpaceDetail;
      await report(me, {
        targetType: 'space',
        targetId: detail.space.id,
        category: 'illegal',
      }).expect(404);
      const invite = (
        await t.api(other).post(`/api/spaces/${detail.space.id}/invites`).send({}).expect(201)
      ).body as SpaceInvite;
      await t.api(me).post(`/api/invites/${invite.code}/join`).expect(200);
      await spaceRegistryIdle();
      const r2 = await report(me, {
        targetType: 'space',
        targetId: detail.space.id,
        category: 'illegal',
      }).expect(201);
      const row = await rowOf(r2.body.id);
      expect(row.spaceId).toBe(detail.space.id);
      expect(row.evidence).toEqual({ space: { id: detail.space.id, name: 'Shady' } });

      // Messages in a chat I'm not in, unknown ids.
      const { b, chat } = await friendsWithDm();
      const { message } = await send(b, chat, 'private');
      await report(me, { targetType: 'message', targetId: message.id, category: 'spam' }).expect(
        404,
      );
      await report(me, {
        targetType: 'message',
        targetId: crypto.randomUUID(),
        category: 'spam',
      }).expect(404);
    });

    it('refuses my own and system messages, unknown categories and long details', async () => {
      const { a, b } = await friendsWithDm();
      const group = await createGroup(a, [b], { name: 'G' });
      const { message: mine } = await send(a, group, 'mine');
      await report(a, { targetType: 'message', targetId: mine.id, category: 'spam' }).expect(400);
      const history = (await t.api(b).get(`/api/chats/${group}/messages`).expect(200)).body as {
        messages: Message[];
      };
      const system = history.messages.find((m) => m.type === 'system')!;
      await report(b, { targetType: 'message', targetId: system.id, category: 'spam' }).expect(400);
      await report(b, { targetType: 'message', targetId: mine.id, category: 'rude' }).expect(400);
      await report(b, {
        targetType: 'message',
        targetId: mine.id,
        category: 'other',
        details: 'x'.repeat(1001),
      }).expect(400);
      await report(b, { targetType: 'thing', targetId: mine.id, category: 'other' }).expect(400);
      await report(b, { targetType: 'message', targetId: mine.id, category: 'other' }).expect(201);
    });

    it('allows 10 reports an hour per user', async () => {
      const me = await t.createUser();
      const other = await t.createUser();
      resetUserLimits();
      config.rateLimit = true;
      try {
        for (let i = 0; i < 10; i++)
          await report(me, { targetType: 'user', targetId: other.id, category: 'spam' }).expect(
            201,
          );
        const res = await report(me, {
          targetType: 'user',
          targetId: other.id,
          category: 'spam',
        }).expect(429);
        expect(res.body.error.code).toBe('rate_limited');
      } finally {
        config.rateLimit = false;
        resetUserLimits();
      }
    });

    it('alsoBlock blocks the reported user, or the author of the reported message', async () => {
      const { a, b, chat } = await friendsWithDm();
      const sa = await t.connect(a);
      const { message } = await send(b, chat, 'rude');
      const changed = waitForEvent(sa, 'blocks:changed');
      await report(a, {
        targetType: 'message',
        targetId: message.id,
        category: 'harassment',
        alsoBlock: true,
      }).expect(201);
      await changed;
      const blocked = await db
        .select()
        .from(blocks)
        .where(and(eq(blocks.blockerId, a.id), eq(blocks.blockedId, b.id)));
      expect(blocked).toHaveLength(1);
      const peer = ((await t.api(a).get(`/api/chats/${chat}`).expect(200)).body as ChatSummary)
        .peer;
      expect(peer?.isBlocked).toBe(true);
      // Again (already blocked), and for a user report.
      await report(a, {
        targetType: 'message',
        targetId: message.id,
        category: 'spam',
        alsoBlock: true,
      }).expect(201);
      const c = await t.createUser();
      await report(a, {
        targetType: 'user',
        targetId: c.id,
        category: 'spam',
        alsoBlock: true,
      }).expect(201);
      expect(
        await db
          .select()
          .from(blocks)
          .where(and(eq(blocks.blockerId, a.id), eq(blocks.blockedId, c.id))),
      ).toHaveLength(1);
      // Without it nobody is blocked.
      const d = await t.createUser();
      await report(a, { targetType: 'user', targetId: d.id, category: 'spam' }).expect(201);
      expect(await db.select().from(blocks).where(eq(blocks.blockedId, d.id))).toEqual([]);
    });
  });

  describe('Space moderators', () => {
    let owner: TestUser;
    let reporter: TestUser;
    let author: TestUser;
    let mod: TestUser;
    let member: TestUser;
    let detail: SpaceDetail;
    let staffRoom: ChatSummary;
    const spaceId = () => detail.space.id;
    const general = () => detail.channels.find((c) => c.name === 'general')!;
    const page = (user: TestUser, query: Record<string, string | number> = {}) =>
      t.api(user).get(`/api/spaces/${spaceId()}/reports`).query(query);
    const post = async (user: TestUser, chatId: string, text: string) =>
      (
        await t
          .api(user)
          .post(`/api/chats/${chatId}/messages`)
          .send({ clientId: crypto.randomUUID(), type: 'text', text })
          .expect(201)
      ).body as Message;

    beforeAll(async () => {
      [owner, reporter, author, mod, member] = [
        await t.createUser({ displayName: 'Owner' }),
        await t.createUser({ displayName: 'Reporter' }),
        await t.createUser({ displayName: 'Author' }),
        await t.createUser({ displayName: 'Mod' }),
        await t.createUser({ displayName: 'Member' }),
      ];
      detail = (await t.api(owner).post('/api/spaces').send({ name: 'Moderated' }).expect(201))
        .body as SpaceDetail;
      const invite = (
        await t.api(owner).post(`/api/spaces/${spaceId()}/invites`).send({}).expect(201)
      ).body as SpaceInvite;
      for (const u of [reporter, author, mod, member])
        await t.api(u).post(`/api/invites/${invite.code}/join`).expect(200);
      await spaceRegistryIdle();
      const mods = (
        await t
          .api(owner)
          .post(`/api/spaces/${spaceId()}/roles`)
          .send({ name: 'Mods', permissions: PERM.KICK_MEMBERS })
          .expect(201)
      ).body as SpaceRole;
      await t
        .api(owner)
        .put(`/api/spaces/${spaceId()}/members/${mod.id}/roles/${mods.id}`)
        .expect(200);
      const staff = (
        await t
          .api(owner)
          .post(`/api/spaces/${spaceId()}/roles`)
          .send({ name: 'Staff' })
          .expect(201)
      ).body as SpaceRole;
      for (const u of [reporter, author])
        await t
          .api(owner)
          .put(`/api/spaces/${spaceId()}/members/${u.id}/roles/${staff.id}`)
          .expect(200);
      staffRoom = (
        await t
          .api(owner)
          .post(`/api/spaces/${spaceId()}/channels`)
          .send({ type: 'space_text', name: 'staff-room', privateRoleIds: [staff.id] })
          .expect(201)
      ).body as ChatSummary;
    });

    it('a Space channel message reaches the moderators with the Space in its evidence, never the reporter', async () => {
      const m = await post(author, general().id, `spam spam @{${member.id}}`);
      const id = (
        await report(reporter, { targetType: 'message', targetId: m.id, category: 'spam' }).expect(
          201,
        )
      ).body.id as string;
      const row = await rowOf(id);
      expect(row.spaceId).toBe(spaceId());
      expect(row.evidence.space).toEqual({ id: spaceId(), name: 'Moderated' });
      expect(row.evidence.user?.id).toBe(author.id);

      const res = await page(mod).expect(200);
      const list = (res.body as SpaceReportPage).reports;
      const mine = list.find((r) => r.id === id)!;
      expect(mine).toMatchObject({
        spaceId: spaceId(),
        targetType: 'message',
        targetId: m.id,
        category: 'spam',
        status: 'open',
        resolvedAt: null,
        resolvedBy: null,
      });
      expect(mine.evidence.message?.text).toBe(`spam spam @{${member.id}}`);
      expect(JSON.stringify(res.body)).not.toContain(reporter.id);
      expect(Object.keys(mine).sort()).toEqual(
        [
          'category',
          'createdAt',
          'details',
          'evidence',
          'id',
          'resolvedAt',
          'resolvedBy',
          'spaceId',
          'status',
          'targetId',
          'targetType',
        ].sort(),
      );
    });

    it('a channel the moderator cannot see stays out of their list (admins see it)', async () => {
      const secret = await post(author, staffRoom.id, 'staff only');
      const id = (
        await report(reporter, {
          targetType: 'message',
          targetId: secret.id,
          category: 'other',
        }).expect(201)
      ).body.id as string;
      const modIds = ((await page(mod).expect(200)).body as SpaceReportPage).reports.map(
        (r) => r.id,
      );
      expect(modIds).not.toContain(id);
      await t
        .api(mod)
        .patch(`/api/spaces/${spaceId()}/reports/${id}`)
        .send({ status: 'resolved' })
        .expect(404);
      const ownerIds = ((await page(owner).expect(200)).body as SpaceReportPage).reports.map(
        (r) => r.id,
      );
      expect(ownerIds).toContain(id);
      // Nor can someone outside the channel report it.
      await report(member, {
        targetType: 'message',
        targetId: secret.id,
        category: 'other',
      }).expect(404);
    });

    it('needs a moderator bit (403), membership (404)', async () => {
      await page(member).expect(403);
      await page(await t.createUser()).expect(404);
      await page(owner, { limit: 0 }).expect(400);
      await page(owner, { status: 'closed' }).expect(400);
      await page(owner, { before: 'garbage' }).expect(400);
    });

    it('filters by status and pages newest first', async () => {
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        const m = await post(author, general().id, `msg ${i}`);
        ids.push(
          (
            await report(reporter, {
              targetType: 'message',
              targetId: m.id,
              category: 'spam',
            }).expect(201)
          ).body.id as string,
        );
      }
      const first = (await page(owner, { status: 'open', limit: 2 }).expect(200))
        .body as SpaceReportPage;
      expect(first.reports.map((r) => r.id)).toEqual([ids[2], ids[1]]);
      expect(first.nextCursor).toEqual(expect.any(String));
      const second = (
        await page(owner, { status: 'open', limit: 2, before: first.nextCursor! }).expect(200)
      ).body as SpaceReportPage;
      expect(second.reports[0]!.id).toBe(ids[0]);
      const all = await listReports(db, { status: 'open', limit: 500 });
      expect(all.rows.map((r) => r.id)).toEqual(expect.arrayContaining(ids));
    });

    it('PATCH resolves, dismisses and reopens, with an audit entry each; others are refused', async () => {
      const m = await post(author, general().id, 'to be handled');
      const id = (
        await report(reporter, { targetType: 'message', targetId: m.id, category: 'hate' }).expect(
          201,
        )
      ).body.id as string;
      const patch = (user: TestUser, status: string, reportId = id) =>
        t.api(user).patch(`/api/spaces/${spaceId()}/reports/${reportId}`).send({ status });

      await patch(member, 'resolved').expect(403);
      await patch(mod, 'archived').expect(400);
      await patch(mod, 'resolved', crypto.randomUUID()).expect(404);
      const resolved = (await patch(mod, 'resolved').expect(200)).body as SpaceReport;
      expect(resolved).toMatchObject({ id, status: 'resolved', resolvedBy: mod.id });
      expect(resolved.resolvedAt).toEqual(expect.any(String));
      // Unchanged: no new audit entry.
      await patch(mod, 'resolved').expect(200);

      const open = ((await page(mod, { status: 'open' }).expect(200)).body as SpaceReportPage)
        .reports;
      expect(open.map((r) => r.id)).not.toContain(id);
      const done = ((await page(mod, { status: 'resolved' }).expect(200)).body as SpaceReportPage)
        .reports;
      expect(done.map((r) => r.id)).toContain(id);

      const reopened = (await patch(owner, 'open').expect(200)).body as SpaceReport;
      expect(reopened).toMatchObject({ status: 'open', resolvedAt: null, resolvedBy: null });
      await patch(owner, 'dismissed').expect(200);

      const audit = (
        await t
          .api(owner)
          .get(`/api/spaces/${spaceId()}/audit-log`)
          .query({ limit: 50 })
          .expect(200)
      ).body as SpaceAuditEntry[];
      const mine = audit.filter((e) => e.targetId === id);
      expect(mine.map((e) => [e.action, e.actorId])).toEqual([
        ['report.dismiss', owner.id],
        ['report.reopen', owner.id],
        ['report.resolve', mod.id],
      ]);
      expect(mine[2]!.changes).toMatchObject({ status: ['open', 'resolved'] });

      // A report of another Space (or none) is not found through this one.
      const { a, b, chat } = await friendsWithDm();
      const { message } = await send(b, chat, 'dm');
      const dmReport = (
        await report(a, { targetType: 'message', targetId: message.id, category: 'spam' }).expect(
          201,
        )
      ).body.id as string;
      await patch(owner, 'resolved', dmReport).expect(404);
    });
  });
});
