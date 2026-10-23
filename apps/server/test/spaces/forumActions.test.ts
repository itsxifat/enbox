/**
 * Forum post actions and media channels: following (creating a post or a thread, or replying
 * in one, follows it; PUT / DELETE follow; the followed list per Space; `thread:follow` to my
 * devices; `ThreadInfo.following` per viewer), pinning (moderators, one per forum, first in the
 * list, both posts announced, audited, never auto-archived), closing and reopening (the author
 * unless locked), deleting one's own post, media channels (a grid by default, a picture or a
 * video in every post) and posts with several files and alt text.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { inArray, sql } from 'drizzle-orm';
import type {
  ChatSummary,
  FollowedThreads,
  ForumPostsPage,
  Message,
  SpaceAuditEntry,
  SpaceDetail,
  SpaceInvite,
  SpaceRole,
} from '@enbox/shared';
import { db } from '../../src/db/index.js';
import { chats } from '../../src/db/schema.js';
import { archiveIdleThreads } from '../../src/modules/threads/service.js';
import { spaceRegistryIdle } from '../../src/realtime/spaceRegistry.js';
import { resetThreadFanout } from '../../src/services/threads.js';
import {
  expectNoEvent,
  startTestServer,
  waitForEvent,
  type TestServer,
  type TestUser,
} from '../helpers.js';
import { mkMedia } from '../messaging/support.js';

describe('forum post actions', () => {
  let t: TestServer;
  let owner: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let detail: SpaceDetail;
  let forum: ChatSummary;
  const general = () => detail.channels.find((c) => c.name === 'general')!;
  const spaceUrl = () => `/api/spaces/${detail.space.id}`;

  beforeAll(async () => {
    t = await startTestServer();
    [owner, bob, carol] = [
      await t.createUser({ displayName: 'Owner' }),
      await t.createUser({ displayName: 'Bob' }),
      await t.createUser({ displayName: 'Carol' }),
    ];
    detail = (await t.api(owner).post('/api/spaces').send({ name: 'Posts' }).expect(201))
      .body as SpaceDetail;
    const invite = (await t.api(owner).post(`${spaceUrl()}/invites`).send({}).expect(201))
      .body as SpaceInvite;
    for (const u of [bob, carol])
      await t.api(u).post(`/api/invites/${invite.code}/join`).expect(200);
    await spaceRegistryIdle();
    forum = await createForum({ name: 'Help' });
  });
  afterAll(() => t.close());
  beforeEach(() => resetThreadFanout());

  async function createForum(body: object = {}): Promise<ChatSummary> {
    const res = await t
      .api(owner)
      .post(`${spaceUrl()}/channels`)
      .send({ type: 'space_forum', name: 'Forum', ...body })
      .expect(201);
    await spaceRegistryIdle();
    return res.body as ChatSummary;
  }

  let n = 0;
  async function post(
    user: TestUser,
    forumId: string,
    body: {
      name?: string;
      text?: string;
      appliedTags?: string[];
      mediaId?: string;
      extraMediaIds?: string[];
      descriptions?: (string | null)[];
    } = {},
    status = 201,
  ) {
    const res = await t
      .api(user)
      .post(`/api/chats/${forumId}/posts`)
      .send({ name: `Post ${++n}`, text: 'hello', clientId: `fa-${n}-${randomUUID()}`, ...body })
      .expect(status);
    await spaceRegistryIdle();
    return res.body as ChatSummary;
  }

  const patch = async (user: TestUser, threadId: string, body: object, status = 200) =>
    (await t.api(user).patch(`/api/threads/${threadId}`).send(body).expect(status))
      .body as ChatSummary;

  const summary = async (user: TestUser, chatId: string) =>
    (await t.api(user).get(`/api/chats/${chatId}`).expect(200)).body as ChatSummary;

  const list = async (
    user: TestUser,
    forumId: string,
    query: Record<string, string | number> = {},
  ) =>
    (await t.api(user).get(`/api/chats/${forumId}/posts`).query(query).expect(200))
      .body as ForumPostsPage;

  const ids = (page: ForumPostsPage) => page.posts.map((p) => p.thread.id);

  const followed = async (user: TestUser) =>
    (
      (await t.api(user).get(`${spaceUrl()}/followed-threads`).expect(200)).body as FollowedThreads
    ).threads.map((x) => x.id);

  const send = (user: TestUser, chatId: string, text: string) =>
    t
      .api(user)
      .post(`/api/chats/${chatId}/messages`)
      .send({ clientId: randomUUID(), type: 'text', text });

  const auditOf = async (action: string) =>
    (await t.api(owner).get(`${spaceUrl()}/audit-log`).query({ action }).expect(200))
      .body as SpaceAuditEntry[];

  describe('following', () => {
    it('creating a post follows it: mine says so (not others’), it is listed, my devices hear it', async () => {
      const sb = await t.connect(bob);
      const sc = await t.connect(carol);
      const event = waitForEvent(sb, 'thread:follow');
      const upsert = waitForEvent(sc, 'thread:upsert', {
        filter: (p) => p.thread.thread?.parentId === forum.id,
      });
      const quiet = expectNoEvent(sc, 'thread:follow', 400);
      const p = await post(bob, forum.id, { name: 'Crash on start' });
      expect(p.thread).toMatchObject({ following: true, pinned: false });
      expect(await event).toEqual({
        threadId: p.id,
        parentId: forum.id,
        spaceId: detail.space.id,
        following: true,
      });
      // The room's summary is viewer-neutral.
      expect((await upsert).thread.thread).not.toHaveProperty('following');
      await quiet;
      expect((await summary(carol, p.id)).thread).toMatchObject({
        following: false,
        pinned: false,
      });
      expect(
        (await list(carol, forum.id)).posts.find((x) => x.thread.id === p.id)?.thread.thread,
      ).toMatchObject({ following: false });
      expect(await followed(bob)).toContain(p.id);
      expect(await followed(carol)).not.toContain(p.id);
      sb.disconnect();
      sc.disconnect();
    });

    it('follow and unfollow: idempotent, each change reaches my devices, threads only', async () => {
      const p = await post(bob, forum.id, { name: 'Feature idea' });
      const sc = await t.connect(carol);
      const on = waitForEvent(sc, 'thread:follow', { filter: (e) => e.threadId === p.id });
      const res = (await t.api(carol).put(`/api/threads/${p.id}/follow`).expect(200))
        .body as ChatSummary;
      expect(res).toMatchObject({ id: p.id, type: 'space_thread', thread: { following: true } });
      expect(await on).toMatchObject({ following: true, parentId: forum.id });
      expect(await followed(carol)).toContain(p.id);

      // Again: nothing changes, nothing is sent.
      const quiet = expectNoEvent(sc, 'thread:follow', 300);
      await t.api(carol).put(`/api/threads/${p.id}/follow`).expect(200);
      await quiet;

      const off = waitForEvent(sc, 'thread:follow', { filter: (e) => e.threadId === p.id });
      await t.api(carol).delete(`/api/threads/${p.id}/follow`).expect(204);
      expect(await off).toMatchObject({ following: false, spaceId: detail.space.id });
      expect((await summary(carol, p.id)).thread?.following).toBe(false);
      expect(await followed(carol)).not.toContain(p.id);
      const quiet2 = expectNoEvent(sc, 'thread:follow', 300);
      await t.api(carol).delete(`/api/threads/${p.id}/follow`).expect(204);
      await quiet2;

      // Channels are not followed this way; unknown ids are not found.
      await t.api(carol).put(`/api/threads/${general().id}/follow`).expect(404);
      await t.api(carol).put(`/api/threads/${forum.id}/follow`).expect(404);
      await t.api(carol).put(`/api/threads/${randomUUID()}/follow`).expect(404);
      sc.disconnect();
    });

    it('replying in a post or a thread follows it; so does starting a thread', async () => {
      const p = await post(bob, forum.id, { name: 'Question' });
      expect((await summary(carol, p.id)).thread?.following).toBe(false);
      const sc = await t.connect(carol);
      const event = waitForEvent(sc, 'thread:follow', { filter: (e) => e.threadId === p.id });
      expect((await send(carol, p.id, 'Me too')).status).toBe(201);
      expect(await event).toMatchObject({ following: true });
      expect((await summary(carol, p.id)).thread?.following).toBe(true);
      // Unfollowed: the next reply follows it again.
      await t.api(carol).delete(`/api/threads/${p.id}/follow`).expect(204);
      const again = waitForEvent(sc, 'thread:follow', {
        filter: (e) => e.threadId === p.id && e.following,
      });
      expect((await send(carol, p.id, 'Still here')).status).toBe(201);
      await again;
      expect((await summary(carol, p.id)).thread?.following).toBe(true);
      // A message in a channel follows nothing.
      const quiet = expectNoEvent(sc, 'thread:follow', 300);
      expect((await send(carol, general().id, 'hi all')).status).toBe(201);
      await quiet;

      const thread = (
        await t
          .api(carol)
          .post(`/api/chats/${general().id}/threads`)
          .send({ name: 'Side talk' })
          .expect(201)
      ).body as ChatSummary;
      expect(thread.thread?.following).toBe(true);
      expect(await followed(carol)).toContain(thread.id);
      // Its summary in the Space's channel list carries it too.
      const channels = (await t.api(carol).get(`${spaceUrl()}/channels`).expect(200))
        .body as ChatSummary[];
      expect(channels.find((c) => c.id === thread.id)?.thread?.following).toBe(true);
      sc.disconnect();
    });

    it('the followed list: open ones first, then by last activity; only what I can still see; members only', async () => {
      const a = await post(carol, forum.id, { name: 'List A' });
      const b = await post(carol, forum.id, { name: 'List B' });
      const c = await post(carol, forum.id, { name: 'List C' });
      const at = (min: number) => sql`now() - ${`${min} minutes`}::interval`;
      await db
        .update(chats)
        .set({ lastMessageAt: at(30) })
        .where(inArray(chats.id, [a.id]));
      await db
        .update(chats)
        .set({ lastMessageAt: at(10) })
        .where(inArray(chats.id, [b.id]));
      await patch(carol, c.id, { archived: true });
      const mine = (await followed(carol)).filter((id) => [a.id, b.id, c.id].includes(id));
      expect(mine).toEqual([b.id, a.id, c.id]);

      // A post in a forum I can no longer see drops out (and cannot be followed again).
      const staff = (
        await t.api(owner).post(`${spaceUrl()}/roles`).send({ name: 'Staff' }).expect(201)
      ).body as SpaceRole;
      const secret = await createForum({ name: 'Staff Room', privateRoleIds: [staff.id] });
      await t.api(owner).put(`${spaceUrl()}/members/${carol.id}/roles/${staff.id}`).expect(200);
      await spaceRegistryIdle();
      const hidden = await post(carol, secret.id, { name: 'Rota' });
      expect(await followed(carol)).toContain(hidden.id);
      await t.api(owner).delete(`${spaceUrl()}/members/${carol.id}/roles/${staff.id}`).expect(200);
      await spaceRegistryIdle();
      expect(await followed(carol)).not.toContain(hidden.id);
      await t.api(carol).put(`/api/threads/${hidden.id}/follow`).expect(404);
      // Unfollowing still works.
      await t.api(carol).delete(`/api/threads/${hidden.id}/follow`).expect(204);

      const stranger = await t.createUser();
      await t.api(stranger).get(`${spaceUrl()}/followed-threads`).expect(404);
      await t.api(stranger).put(`/api/threads/${a.id}/follow`).expect(404);
    });
  });

  describe('pin, close, delete', () => {
    it('pin: moderators only, forum posts only; one per forum, leading the list; both posts announced; audited', async () => {
      const pins = await createForum({ name: 'Pins' });
      const a = await post(bob, pins.id, { name: 'Rules' });
      const b = await post(bob, pins.id, { name: 'FAQ' });
      const c = await post(carol, pins.id, { name: 'Hello there' });
      // Activity: c, then b, then a.
      const at = (min: number) => sql`now() - ${`${min} minutes`}::interval`;
      await db
        .update(chats)
        .set({ lastMessageAt: at(30) })
        .where(inArray(chats.id, [a.id]));
      await db
        .update(chats)
        .set({ lastMessageAt: at(20) })
        .where(inArray(chats.id, [b.id]));
      await db
        .update(chats)
        .set({ lastMessageAt: at(10) })
        .where(inArray(chats.id, [c.id]));

      await patch(bob, a.id, { pinned: true }, 403);
      expect((await patch(owner, a.id, { pinned: true })).thread?.pinned).toBe(true);
      expect(ids(await list(carol, pins.id))).toEqual([a.id, c.id, b.id]);

      // Pinning another one unpins the first; the room hears both.
      const sc = await t.connect(carol);
      const aOff = waitForEvent(sc, 'thread:upsert', {
        filter: (p) => p.thread.id === a.id && p.thread.thread?.pinned === false,
      });
      const bOn = waitForEvent(sc, 'thread:upsert', {
        filter: (p) => p.thread.id === b.id && p.thread.thread?.pinned === true,
      });
      expect((await patch(owner, b.id, { pinned: true })).thread?.pinned).toBe(true);
      await Promise.all([aOff, bOn]);
      expect((await summary(carol, a.id)).thread?.pinned).toBe(false);
      const page = await list(carol, pins.id);
      expect(ids(page)).toEqual([b.id, c.id, a.id]);
      expect(page.posts.map((p) => p.thread.thread?.following)).toEqual([false, true, false]);

      // The first page leads with it (one more than the limit); later pages never repeat it.
      const p1 = await list(carol, pins.id, { limit: 1 });
      expect(ids(p1)).toEqual([b.id, c.id]);
      const p2 = await list(carol, pins.id, { limit: 1, before: p1.nextCursor! });
      expect(ids(p2)).toEqual([a.id]);
      expect(p2.nextCursor).toBeNull();
      // A filter it fails leaves it out; the creation order puts it first too.
      expect(ids(await list(carol, pins.id, { q: 'hello' }))).toEqual([c.id]);
      expect(ids(await list(carol, pins.id, { sort: 'created' }))[0]).toBe(b.id);

      expect((await patch(owner, b.id, { pinned: false })).thread?.pinned).toBe(false);
      expect(ids(await list(carol, pins.id))).toEqual([c.id, b.id, a.id]);
      // Plain threads have no pin.
      const plain = (
        await t
          .api(owner)
          .post(`/api/chats/${general().id}/threads`)
          .send({ name: 'Plain' })
          .expect(201)
      ).body as ChatSummary;
      await patch(owner, plain.id, { pinned: true }, 400);

      const pinned = (await auditOf('thread.pin')).map((e) => e.targetId);
      expect(pinned).toEqual(expect.arrayContaining([a.id, b.id]));
      const unpinned = (await auditOf('thread.unpin')).map((e) => e.targetId);
      expect(unpinned).toEqual(expect.arrayContaining([a.id, b.id]));
      sc.disconnect();
    });

    it('the auto-archive job leaves the pinned post open', async () => {
      const f = await createForum({ name: 'Quiet' });
      const kept = await post(owner, f.id, { name: 'Read me first' });
      const idle = await post(owner, f.id, { name: 'Old news' });
      await patch(owner, kept.id, { pinned: true });
      const old = sql`now() - interval '10 days'`;
      await db
        .update(chats)
        .set({ lastMessageAt: old, updatedAt: old })
        .where(inArray(chats.id, [kept.id, idle.id]));
      expect(await archiveIdleThreads()).toBeGreaterThanOrEqual(1);
      expect((await summary(owner, kept.id)).thread).toMatchObject({
        pinned: true,
        archived: false,
      });
      expect((await summary(owner, idle.id)).thread?.archived).toBe(true);
    });

    it('close and reopen: the author while it is unlocked, moderators always, nobody else', async () => {
      const p = await post(bob, forum.id, { name: 'Closable' });
      expect((await patch(bob, p.id, { archived: true })).thread?.archived).toBe(true);
      expect((await patch(bob, p.id, { archived: false })).thread?.archived).toBe(false);
      await patch(carol, p.id, { archived: true }, 403);
      await patch(owner, p.id, { locked: true });
      await patch(bob, p.id, { archived: true }, 403);
      expect((await patch(owner, p.id, { archived: true })).thread).toMatchObject({
        archived: true,
        locked: true,
      });
      await patch(bob, p.id, { archived: false }, 403);
      // Locked and closed: only a moderator's reply reopens it.
      expect((await send(bob, p.id, 'reopen?')).status).toBe(403);
      expect((await send(owner, p.id, 'Reopened')).status).toBe(201);
      expect((await summary(bob, p.id)).thread?.archived).toBe(false);
    });

    it('delete: the author deletes their own unlocked post; others and plain threads stay with moderators', async () => {
      const p = await post(bob, forum.id, { name: 'Oops' });
      await t.api(carol).delete(`/api/threads/${p.id}`).expect(403);
      await patch(owner, p.id, { locked: true });
      await t.api(bob).delete(`/api/threads/${p.id}`).expect(403);
      await patch(owner, p.id, { locked: false });
      const sc = await t.connect(carol);
      const gone = waitForEvent(sc, 'thread:deleted', { filter: (e) => e.threadId === p.id });
      await t.api(bob).delete(`/api/threads/${p.id}`).expect(204);
      expect(await gone).toEqual({ threadId: p.id, parentId: forum.id });
      await t.api(bob).get(`/api/chats/${p.id}`).expect(404);
      expect(await followed(bob)).not.toContain(p.id);
      expect(
        (await auditOf('thread.delete')).some((e) => e.targetId === p.id && e.actorId === bob.id),
      ).toBe(true);

      const plain = (
        await t
          .api(bob)
          .post(`/api/chats/${general().id}/threads`)
          .send({ name: 'Mine' })
          .expect(201)
      ).body as ChatSummary;
      await t.api(bob).delete(`/api/threads/${plain.id}`).expect(403);
      sc.disconnect();
    });
  });

  describe('media channels and files', () => {
    it('a media channel: a grid by default, and every post leads with a picture or a video', async () => {
      const photos = await createForum({ name: 'Photos', forumSettings: { media: true } });
      expect(photos.space?.forum?.settings).toMatchObject({
        media: true,
        layout: 'gallery',
        hideDownloads: false,
      });
      const clips = await createForum({
        name: 'Clips',
        forumSettings: { media: true, layout: 'list', hideDownloads: true },
      });
      expect(clips.space?.forum?.settings).toMatchObject({
        media: true,
        layout: 'list',
        hideDownloads: true,
      });
      expect(forum.space?.forum?.settings).toMatchObject({ media: false, layout: 'list' });
      // Options merge: hiding downloads later keeps the channel a media one.
      const patched = (
        await t
          .api(owner)
          .patch(`${spaceUrl()}/channels/${photos.id}`)
          .send({ forumSettings: { hideDownloads: true } })
          .expect(200)
      ).body as ChatSummary;
      expect(patched.space?.forum?.settings).toMatchObject({ media: true, hideDownloads: true });

      const words = await t
        .api(bob)
        .post(`/api/chats/${photos.id}/posts`)
        .send({ name: 'Words', text: 'no picture', clientId: 'media-1' })
        .expect(400);
      expect(words.body.error.code).toBe('validation_error');
      await post(bob, photos.id, { mediaId: (await mkMedia(bob.id, 'file')).id }, 400);
      await post(bob, photos.id, { mediaId: (await mkMedia(bob.id, 'audio')).id }, 400);

      const img = await mkMedia(bob.id, 'image');
      const pic = await post(bob, photos.id, { name: 'Sunset', text: '', mediaId: img.id });
      expect(pic.lastMessage).toMatchObject({ type: 'image', text: null, media: { id: img.id } });
      const clip = await mkMedia(bob.id, 'video');
      expect((await post(bob, photos.id, { mediaId: clip.id })).lastMessage?.type).toBe('video');
      expect((await list(carol, photos.id)).posts).toHaveLength(2);
    });

    it('a post with several files and alt text: its first message carries them all, in order', async () => {
      const [img, clip, doc] = [
        await mkMedia(carol.id, 'image'),
        await mkMedia(carol.id, 'video'),
        await mkMedia(carol.id, 'file'),
      ];
      const p = await post(carol, forum.id, {
        name: 'Album',
        text: 'Our trip',
        mediaId: img.id,
        extraMediaIds: [clip.id, doc.id],
        descriptions: ['  A beach at dawn  ', null, ''],
      });
      expect(p.lastMessage).toMatchObject({
        type: 'image',
        text: 'Our trip',
        media: { id: img.id },
      });
      const files = (m: Message | null | undefined) =>
        m?.attachments?.map((a) => [a.id, a.kind, a.description]);
      const expected = [
        [img.id, 'image', 'A beach at dawn'],
        [clip.id, 'video', null],
        [doc.id, 'file', null],
      ];
      expect(files(p.lastMessage)).toEqual(expected);
      const page = await list(bob, forum.id, { q: 'album' });
      expect(files(page.posts[0]!.firstMessage)).toEqual(expected);

      // A media send's rules: distinct files of mine, the first in mediaId, 10 at most, one
      // description per file.
      const fresh = () => mkMedia(carol.id, 'image');
      const one = await fresh();
      await post(carol, forum.id, { mediaId: one.id, extraMediaIds: [one.id] }, 400);
      await post(carol, forum.id, { extraMediaIds: [(await fresh()).id] }, 400);
      const bobs = await mkMedia(bob.id, 'image');
      await post(carol, forum.id, { mediaId: (await fresh()).id, extraMediaIds: [bobs.id] }, 404);
      const ten = await Promise.all(Array.from({ length: 10 }, fresh));
      const lead = await fresh();
      await post(carol, forum.id, { mediaId: lead.id, extraMediaIds: ten.map((m) => m.id) }, 400);
      await post(carol, forum.id, { mediaId: lead.id, descriptions: [null, 'one too many'] }, 400);
    });
  });
});
