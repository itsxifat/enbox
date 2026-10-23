/**
 * Forum channels (Discord model): creating a forum (MANAGE_CHANNELS, default options), its
 * tags and options (PATCH), posts (thread + first message in one transaction, events in
 * order, idempotent), tags on posts (unknown, required, moderated), the post list (sort, tag
 * filter, title search, keyset paging, archived, first-message preview), a private forum,
 * the refused direct send, slowmode per post, and tag edits on posts by their author.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import {
  AUTOMOD_BLOCKED_CODE,
  DEFAULT_FORUM_SETTINGS,
  MAX_FORUM_TAGS,
  type ChatSummary,
  type ForumPostsPage,
  type ForumTag,
  type Message,
  type MessagePage,
  type SpaceDetail,
  type SpaceInvite,
  type SpaceRole,
} from '@enbox/shared';
import { db } from '../../src/db/index.js';
import { chats } from '../../src/db/schema.js';
import { spaceRegistryIdle } from '../../src/realtime/spaceRegistry.js';
import { autoModIdle } from '../../src/services/automod.js';
import { resetThreadFanout } from '../../src/services/threads.js';
import { insertImage } from '../accounts/util.js';
import {
  expectNoEvent,
  startTestServer,
  waitForEvent,
  type TestServer,
  type TestUser,
} from '../helpers.js';

const TAGS: ForumTag[] = [
  { id: 'bug', name: 'Bug', emoji: '🐛', moderated: false },
  { id: 'idea', name: 'Idea', emoji: null, moderated: false },
  { id: 'solved', name: 'Solved', emoji: '✅', moderated: true },
];

describe('forums', () => {
  let t: TestServer;
  let owner: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let detail: SpaceDetail;
  let forum: ChatSummary;
  const general = () => detail.channels.find((c) => c.name === 'general')!;
  const channelsUrl = () => `/api/spaces/${detail.space.id}/channels`;

  beforeAll(async () => {
    t = await startTestServer();
    [owner, bob, carol] = [
      await t.createUser({ displayName: 'Owner' }),
      await t.createUser({ displayName: 'Bob' }),
      await t.createUser({ displayName: 'Carol' }),
    ];
    detail = (await t.api(owner).post('/api/spaces').send({ name: 'Forums' }).expect(201))
      .body as SpaceDetail;
    const invite = (
      await t.api(owner).post(`/api/spaces/${detail.space.id}/invites`).send({}).expect(201)
    ).body as SpaceInvite;
    for (const u of [bob, carol])
      await t.api(u).post(`/api/invites/${invite.code}/join`).expect(200);
    await spaceRegistryIdle();
  });
  afterAll(() => t.close());
  beforeEach(() => resetThreadFanout());

  async function createForum(body: object = {}): Promise<ChatSummary> {
    const res = await t
      .api(owner)
      .post(channelsUrl())
      .send({ type: 'space_forum', name: 'Forum', ...body })
      .expect(201);
    await spaceRegistryIdle();
    return res.body as ChatSummary;
  }

  async function patchForum(chatId: string, body: object, status = 200) {
    const res = await t.api(owner).patch(`${channelsUrl()}/${chatId}`).send(body).expect(status);
    return res.body as ChatSummary;
  }

  let n = 0;
  async function post(
    user: TestUser,
    forumId: string,
    body: { name?: string; text?: string; appliedTags?: string[]; mediaId?: string; clientId?: string },
    status = 201,
  ) {
    const res = await t
      .api(user)
      .post(`/api/chats/${forumId}/posts`)
      .send({ name: `Post ${++n}`, text: 'hello', clientId: `c${n}-${Math.random()}`, ...body })
      .expect(status);
    await spaceRegistryIdle();
    return res.body as ChatSummary;
  }

  const list = async (user: TestUser, forumId: string, query: Record<string, string | number> = {}) =>
    (await t.api(user).get(`/api/chats/${forumId}/posts`).query(query).expect(200))
      .body as ForumPostsPage;

  const summary = async (user: TestUser, chatId: string) =>
    (await t.api(user).get(`/api/chats/${chatId}`).expect(200)).body as ChatSummary;

  const send = (user: TestUser, chatId: string, text: string) =>
    t
      .api(user)
      .post(`/api/chats/${chatId}/messages`)
      .send({ clientId: Math.random().toString(36), type: 'text', text });

  it('creates a forum (MANAGE_CHANNELS): named like a text channel, default options, no tags', async () => {
    await t.api(bob).post(channelsUrl()).send({ type: 'space_forum', name: 'Nope' }).expect(403);
    forum = await createForum({ name: 'Help Desk' });
    expect(forum).toMatchObject({
      type: 'space_forum',
      name: 'help-desk',
      space: { spaceId: detail.space.id, forum: { tags: [], settings: DEFAULT_FORUM_SETTINGS } },
    });
    // Members see it in the channel list and by id; a forum takes no messages of its own.
    const channels = (await t.api(bob).get(channelsUrl()).expect(200)).body as ChatSummary[];
    expect(channels.find((c) => c.id === forum.id)?.space?.forum?.settings).toEqual(
      DEFAULT_FORUM_SETTINGS,
    );
    const mine = await summary(bob, forum.id);
    expect(mine.type).toBe('space_forum');
    expect(mine.permissions.canSend).toBe(false);
    // Text channels carry no forum info.
    expect(general().space?.forum).toBeUndefined();
  });

  it('edits tags and options (forums only): ids kept, options merged, emoji checked, chat:updated', async () => {
    const sb = await t.connect(bob);
    const updated = waitForEvent(sb, 'chat:updated', {
      filter: (p) => p.chatId === forum.id && !!p.changes.space?.forum?.tags.length,
    });
    const res = await patchForum(forum.id, {
      forumTags: TAGS,
      forumSettings: { defaultReaction: '👍', guidelines: '**Be kind.** Search first.' },
    });
    expect(res.space?.forum).toEqual({
      tags: TAGS,
      settings: {
        ...DEFAULT_FORUM_SETTINGS,
        defaultReaction: '👍',
        guidelines: '**Be kind.** Search first.',
      },
    });
    expect((await updated).changes.space?.forum?.tags.map((x) => x.id)).toEqual([
      'bug',
      'idea',
      'solved',
    ]);
    // Merged: one option at a time; empty text means none.
    const again = await patchForum(forum.id, { forumSettings: { layout: 'gallery', guidelines: '  ' } });
    expect(again.space?.forum?.settings).toMatchObject({
      layout: 'gallery',
      defaultReaction: '👍',
      guidelines: null,
    });
    await patchForum(forum.id, { forumSettings: { layout: 'list' } });

    await patchForum(forum.id, { forumTags: [TAGS[0], TAGS[0]] }, 400);
    await patchForum(forum.id, { forumTags: [{ ...TAGS[1], emoji: 'not an emoji' }] }, 400);
    await patchForum(forum.id, { forumSettings: { defaultReaction: 'nope' } }, 400);
    const many = Array.from({ length: MAX_FORUM_TAGS + 1 }, (_, i) => ({
      id: `t${i}`,
      name: `Tag ${i}`,
      emoji: null,
      moderated: false,
    }));
    await patchForum(forum.id, { forumTags: many }, 400);
    await t
      .api(bob)
      .patch(`${channelsUrl()}/${forum.id}`)
      .send({ forumTags: [] })
      .expect(403);
    // Other channels ignore forum fields.
    const text = await patchForum(general().id, { forumTags: TAGS, topic: 'General talk' });
    expect(text.space?.forum).toBeUndefined();
    expect((await summary(owner, forum.id)).space?.forum?.tags).toEqual(TAGS);
    sb.disconnect();
  });

  let crash: ChatSummary;

  it('creates a post: the thread and its first message at once, thread:upsert before message:new', async () => {
    const sc = await t.connect(carol);
    const order: string[] = [];
    sc.on('thread:upsert', (p) => {
      if (p.thread.thread?.parentId === forum.id) order.push(`upsert:${p.thread.id}`);
    });
    sc.on('message:new', (p) => order.push(`message:${p.message.chatId}`));
    const upsert = waitForEvent(sc, 'thread:upsert', {
      filter: (p) => p.thread.thread?.parentId === forum.id,
    });
    const first = waitForEvent(sc, 'message:new', {
      filter: (p) => p.message.text === 'It crashes when I open it.',
    });
    crash = await post(bob, forum.id, {
      name: 'App crashes on start',
      text: 'It crashes when I open it.',
      appliedTags: ['bug'],
      clientId: 'crash-1',
    });
    expect(crash).toMatchObject({
      type: 'space_thread',
      name: 'App crashes on start',
      space: { spaceId: detail.space.id },
      thread: {
        parentId: forum.id,
        starterMessageId: null,
        ownerId: bob.id,
        archived: false,
        locked: false,
        messageCount: 0,
        appliedTags: ['bug'],
      },
      lastMessage: { text: 'It crashes when I open it.', senderId: bob.id },
    });
    expect(crash.permissions.canSend).toBe(true);
    const evt = await upsert;
    expect(evt.thread).toMatchObject({ id: crash.id, thread: { appliedTags: ['bug'], messageCount: 0 } });
    expect((await first).message.chatId).toBe(crash.id);
    expect(order.slice(0, 2)).toEqual([`upsert:${crash.id}`, `message:${crash.id}`]);

    // The post's first message lives in the thread; replies count, the post itself does not.
    const page = (await t.api(carol).get(`/api/chats/${crash.id}/messages`).expect(200))
      .body as MessagePage;
    expect(page.messages.map((m) => m.text)).toEqual(['It crashes when I open it.']);
    expect((await send(carol, crash.id, 'Same here')).status).toBe(201);
    expect((await summary(carol, crash.id)).thread?.messageCount).toBe(1);
    sc.disconnect();
  });

  it('a retry with the same clientId returns the same post (200), nothing new', async () => {
    const res = await t
      .api(bob)
      .post(`/api/chats/${forum.id}/posts`)
      .send({ name: 'App crashes on start', text: 'It crashes when I open it.', appliedTags: ['bug'], clientId: 'crash-1' })
      .expect(200);
    expect((res.body as ChatSummary).id).toBe(crash.id);
    const all = await list(bob, forum.id);
    expect(all.posts.filter((p) => p.thread.name === 'App crashes on start')).toHaveLength(1);
  });

  it('posts with and without tags; unknown tags refused, duplicates dropped; an empty post refused', async () => {
    const plain = await post(carol, forum.id, { name: 'Just saying hi' });
    expect(plain.thread?.appliedTags).toEqual([]);
    await post(carol, forum.id, { appliedTags: ['nope'] }, 400);
    // Stored in the forum's tag order, once.
    const two = await post(carol, forum.id, { appliedTags: ['idea', 'bug', 'idea'] });
    expect(two.thread?.appliedTags).toEqual(['bug', 'idea']);
    await post(carol, forum.id, { text: '   ' }, 400);
    await post(carol, forum.id, { name: '' }, 400);
    await post(carol, general().id, {}, 400);
  });

  it('requireTag: a post needs a tag', async () => {
    await patchForum(forum.id, { forumSettings: { requireTag: true } });
    await post(carol, forum.id, { appliedTags: [] }, 400);
    expect((await post(carol, forum.id, { appliedTags: ['idea'] })).thread?.appliedTags).toEqual([
      'idea',
    ]);
    await patchForum(forum.id, { forumSettings: { requireTag: false } });
  });

  it('a moderated tag needs MANAGE_MESSAGES', async () => {
    await post(carol, forum.id, { appliedTags: ['solved'] }, 403);
    const mod = await post(owner, forum.id, { appliedTags: ['bug', 'solved'] });
    expect(mod.thread?.appliedTags).toEqual(['bug', 'solved']);
  });

  it('a forum takes no messages of its own, nor plain threads', async () => {
    const res = await send(bob, forum.id, 'straight into the forum');
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('Forum channels only hold posts');
    await t.api(bob).post(`/api/chats/${forum.id}/threads`).send({ name: 'x' }).expect(400);
    await t.api(bob).get(`/api/chats/${general().id}/posts`).expect(400);
  });

  it('a post with an image: its first message carries the media (ATTACH_FILES)', async () => {
    const img = await insertImage(carol.id);
    const pic = await post(carol, forum.id, { name: 'Screenshot', text: '', mediaId: img.id });
    expect(pic.lastMessage).toMatchObject({ type: 'image', text: null });
    const page = await list(carol, forum.id, { q: 'screenshot' });
    expect(page.posts[0]?.firstMessage).toMatchObject({ type: 'image', media: { kind: 'image' } });
    // Someone else's upload is not mine to post.
    await post(bob, forum.id, { mediaId: img.id }, 404);
  });

  it('lists posts: by activity or creation, tag filter, title search, keyset paging, first messages', async () => {
    const shop = await createForum({ name: 'Showcase', forumTags: TAGS });
    expect(shop.space?.forum?.tags).toEqual(TAGS);
    const a = await post(bob, shop.id, { name: 'Alpha build', text: 'First @{' + carol.id + '}', appliedTags: ['bug'] });
    const b = await post(carol, shop.id, { name: 'Beta notes', text: 'Second', appliedTags: ['idea'] });
    const c = await post(owner, shop.id, { name: '100% done', text: 'Third', appliedTags: ['bug', 'idea'] });
    // Deterministic clocks: created a < b < c; last activity b < c < a (a got a reply).
    const at = (min: number) => sql`now() - ${`${min} minutes`}::interval`;
    await db.update(chats).set({ createdAt: at(30), lastMessageAt: at(1) }).where(eq(chats.id, a.id));
    await db.update(chats).set({ createdAt: at(20), lastMessageAt: at(20) }).where(eq(chats.id, b.id));
    await db.update(chats).set({ createdAt: at(10), lastMessageAt: at(10) }).where(eq(chats.id, c.id));

    const byActivity = await list(carol, shop.id);
    expect(byActivity.posts.map((p) => p.thread.id)).toEqual([a.id, c.id, b.id]);
    expect(byActivity.nextCursor).toBeNull();
    const firstA = byActivity.posts[0]!.firstMessage as Message;
    expect(firstA).toMatchObject({ chatId: a.id, seq: 1, text: `First @{${carol.id}}`, senderId: bob.id });
    expect(firstA.mentions).toEqual([carol.id]);
    expect(byActivity.users.map((u) => u.id).sort()).toEqual([owner.id, bob.id, carol.id].sort());
    const byCreation = await list(carol, shop.id, { sort: 'created' });
    expect(byCreation.posts.map((p) => p.thread.id)).toEqual([c.id, b.id, a.id]);

    expect((await list(carol, shop.id, { tag: 'bug' })).posts.map((p) => p.thread.id)).toEqual([a.id, c.id]);
    expect((await list(carol, shop.id, { tag: 'solved' })).posts).toEqual([]);
    expect((await list(carol, shop.id, { q: 'BETA' })).posts.map((p) => p.thread.id)).toEqual([b.id]);
    // `%` and `_` are taken literally.
    expect((await list(carol, shop.id, { q: '%' })).posts.map((p) => p.thread.id)).toEqual([c.id]);
    expect((await list(carol, shop.id, { q: '_' })).posts).toEqual([]);

    const p1 = await list(carol, shop.id, { limit: 2 });
    expect(p1.posts.map((p) => p.thread.id)).toEqual([a.id, c.id]);
    expect(p1.nextCursor).not.toBeNull();
    const p2 = await list(carol, shop.id, { limit: 2, before: p1.nextCursor! });
    expect(p2.posts.map((p) => p.thread.id)).toEqual([b.id]);
    expect(p2.nextCursor).toBeNull();
    const q1 = await list(carol, shop.id, { limit: 1, sort: 'created' });
    const q2 = await list(carol, shop.id, { limit: 1, sort: 'created', before: q1.nextCursor! });
    expect([...q1.posts, ...q2.posts].map((p) => p.thread.id)).toEqual([c.id, b.id]);
    await t.api(carol).get(`/api/chats/${shop.id}/posts?before=garbage`).expect(400);

    // The forum's default sort applies when none is asked for.
    await patchForum(shop.id, { forumSettings: { defaultSort: 'created' } });
    expect((await list(carol, shop.id)).posts.map((p) => p.thread.id)).toEqual([c.id, b.id, a.id]);

    // Archived posts are listed apart.
    await t.api(owner).patch(`/api/threads/${b.id}`).send({ archived: true }).expect(200);
    expect((await list(carol, shop.id)).posts.map((p) => p.thread.id)).toEqual([c.id, a.id]);
    expect((await list(carol, shop.id, { archived: 'true' })).posts.map((p) => p.thread.id)).toEqual([b.id]);
  });

  it('a private forum and its posts are hidden from members who cannot see it (REST and socket)', async () => {
    const staff = (
      await t.api(owner).post(`/api/spaces/${detail.space.id}/roles`).send({ name: 'Staff' }).expect(201)
    ).body as SpaceRole;
    const secret = await createForum({ name: 'Staff Room', privateRoleIds: [staff.id] });
    await t.api(owner).put(`/api/spaces/${detail.space.id}/members/${bob.id}/roles/${staff.id}`).expect(200);
    await spaceRegistryIdle();
    const sb = await t.connect(bob);
    const sc = await t.connect(carol);
    const toBob = waitForEvent(sb, 'thread:upsert', { filter: (p) => p.thread.thread?.parentId === secret.id });
    const notCarol = expectNoEvent(sc, 'thread:upsert', 400);
    const hidden = await post(owner, secret.id, { name: 'Rota', text: 'staff only' });
    await toBob;
    await notCarol;

    expect((await list(bob, secret.id)).posts.map((p) => p.thread.id)).toEqual([hidden.id]);
    await t.api(carol).get(`/api/chats/${secret.id}/posts`).expect(404);
    await t.api(carol).get(`/api/chats/${secret.id}`).expect(404);
    await t.api(carol).get(`/api/chats/${hidden.id}`).expect(404);
    await post(carol, secret.id, {}, 404);
    const carolChannels = (await t.api(carol).get(channelsUrl()).expect(200)).body as ChatSummary[];
    expect(carolChannels.some((c) => c.id === secret.id || c.id === hidden.id)).toBe(false);

    const bobGets = waitForEvent(sb, 'message:new', { filter: (p) => p.message.chatId === hidden.id });
    const carolQuiet = expectNoEvent(sc, 'message:new', 400);
    expect((await send(owner, hidden.id, 'reply')).status).toBe(201);
    await bobGets;
    await carolQuiet;
    sb.disconnect();
    sc.disconnect();
  });

  it('appliedTags: the author and moderators edit them, others cannot; moderated tags stay with moderators', async () => {
    const sc = await t.connect(carol);
    const upsert = waitForEvent(sc, 'thread:upsert', {
      filter: (p) => p.thread.id === crash.id && p.thread.thread?.appliedTags?.join() === 'idea',
    });
    const mine = (
      await t.api(bob).patch(`/api/threads/${crash.id}`).send({ appliedTags: ['idea'] }).expect(200)
    ).body as ChatSummary;
    expect(mine.thread?.appliedTags).toEqual(['idea']);
    await upsert;
    await t.api(carol).patch(`/api/threads/${crash.id}`).send({ appliedTags: ['bug'] }).expect(403);
    await t.api(bob).patch(`/api/threads/${crash.id}`).send({ appliedTags: ['idea', 'solved'] }).expect(403);
    await t.api(bob).patch(`/api/threads/${crash.id}`).send({ appliedTags: ['nope'] }).expect(400);
    const marked = (
      await t.api(owner).patch(`/api/threads/${crash.id}`).send({ appliedTags: ['solved', 'idea'] }).expect(200)
    ).body as ChatSummary;
    expect(marked.thread?.appliedTags).toEqual(['idea', 'solved']);
    // The author may not take a moderated tag off, but may change the others around it.
    await t.api(bob).patch(`/api/threads/${crash.id}`).send({ appliedTags: ['idea'] }).expect(403);
    const kept = (
      await t.api(bob).patch(`/api/threads/${crash.id}`).send({ appliedTags: ['bug', 'solved'] }).expect(200)
    ).body as ChatSummary;
    expect(kept.thread?.appliedTags).toEqual(['bug', 'solved']);
    // Plain threads have no tags.
    const plain = (await t.api(bob).post(`/api/chats/${general().id}/threads`).send({ name: 'Plain' }).expect(201))
      .body as ChatSummary;
    await t.api(bob).patch(`/api/threads/${plain.id}`).send({ appliedTags: ['bug'] }).expect(400);
    sc.disconnect();
  });

  it('a tag removed from the forum comes off its posts', async () => {
    await patchForum(forum.id, { forumTags: TAGS.filter((x) => x.id !== 'bug') });
    expect((await summary(bob, crash.id)).thread?.appliedTags).toEqual(['solved']);
    expect((await list(bob, forum.id, { tag: 'bug' })).posts).toEqual([]);
  });

  it('AutoMod reads a post’s title and text; a blocked post leaves nothing behind', async () => {
    await t
      .api(owner)
      .post(`/api/spaces/${detail.space.id}/automod/rules`)
      .send({
        name: 'No spoilers',
        triggerType: 'keyword',
        triggerMetadata: { keywords: ['spoiler'] },
        actions: [{ type: 'block' }],
      })
      .expect(201);
    const before = (await list(owner, forum.id)).posts.length;
    const inText = await t
      .api(carol)
      .post(`/api/chats/${forum.id}/posts`)
      .send({ name: 'The ending', text: 'big spoiler ahead', clientId: 'am-1' })
      .expect(403);
    expect(inText.body.error.code).toBe(AUTOMOD_BLOCKED_CODE);
    await t
      .api(carol)
      .post(`/api/chats/${forum.id}/posts`)
      .send({ name: 'Spoiler inside', text: 'hi', clientId: 'am-2' })
      .expect(403);
    await autoModIdle();
    expect((await list(owner, forum.id)).posts).toHaveLength(before);
    await post(carol, forum.id, { name: 'Clean', text: 'all good' });
  });

  it('slowmode: one post per interval (moderators exempt); replies in a post are not slowed', async () => {
    const slow = await createForum({ name: 'Slow', slowmodeSeconds: 30 });
    expect(slow.space?.slowmodeSeconds).toBe(30);
    const first = await post(carol, slow.id, { name: 'One' });
    await post(carol, slow.id, { name: 'Two' }, 429);
    await post(owner, slow.id, { name: 'Mods' });
    await post(owner, slow.id, { name: 'Mods again' });
    expect((await send(carol, first.id, 'a reply')).status).toBe(201);
    expect((await send(carol, first.id, 'another reply')).status).toBe(201);
  });

  it('Space search finds post messages, across the Space and with in: the forum', async () => {
    const searchable = await createForum({ name: 'Searchable' });
    const p = await post(carol, searchable.id, { name: 'Recipes', text: 'the secret ingredient is cardamom' });
    await send(bob, p.id, 'cardamom works in coffee too');
    const search = async (query: Record<string, string>) =>
      (await t.api(bob).get(`/api/spaces/${detail.space.id}/messages/search`).query(query).expect(200))
        .body as { total: number; items: { chat: { id: string; parentName: string | null } }[] };
    const all = await search({ q: 'cardamom' });
    expect(all.total).toBe(2);
    expect(all.items.every((r) => r.chat.id === p.id && r.chat.parentName === 'searchable')).toBe(true);
    expect((await search({ q: 'cardamom', channelId: searchable.id })).total).toBe(2);
  });
});
