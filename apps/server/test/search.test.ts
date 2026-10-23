/**
 * Message search (modules/search): the Space scope (text channels and threads I can see,
 * VIEW_CHANNEL re-checked per channel), the DM / group scope (my visible window), every
 * filter, paging and the capped total.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import {
  SEARCH_PAGE_SIZE,
  SEARCH_TOTAL_CAP,
  mentionToken,
  messageSearchSchema,
  type Message,
  type MessageSearchPage,
  type SpaceDetail,
  type SpaceInvite,
  type SpaceRole,
} from '@enbox/shared';
import { db } from '../src/db/index.js';
import { chatMembers, chats, messageHidden, messages } from '../src/db/schema.js';
import { searchSpaceMessages } from '../src/modules/search/service.js';
import { spaceRegistryIdle } from '../src/realtime/spaceRegistry.js';
import { transact } from '../src/services/effects.js';
import { createMessage, type CreateMessageInput } from '../src/services/messages.js';
import { startTestServer, type TestServer, type TestUser } from './helpers.js';
import { activeDirect, addToGroup, leaveGroup, mkMedia, sendOk } from './messaging/support.js';
import { countQueries, createGroup } from './services/fixtures.js';

type Params = Record<string, string | string[] | undefined>;

const MINUTE = 60_000;
const DAY = 24 * 60;

function qs(params: Params): string {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    for (const x of v === undefined ? [] : [v].flat()) s.append(k, x);
  return s.toString();
}

const ids = (page: MessageSearchPage) => page.items.map((i) => i.message.id);

describe('message search', () => {
  let t: TestServer;
  let owner: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let invite: SpaceInvite;
  let spaceId: string;
  let general: string;
  let random: string;
  let voice: string;
  let staffRoom: string;
  let staff: SpaceRole;
  let thread: string;
  let secretThread: string;

  const age = (id: string, minutesAgo: number) =>
    db
      .update(messages)
      .set({ createdAt: new Date(Date.now() - minutesAgo * MINUTE) })
      .where(eq(messages.id, id));

  /** Send through REST, then date the message `minutesAgo` back (deterministic order). */
  async function post(
    user: TestUser,
    chatId: string,
    body: string | Record<string, unknown>,
    minutesAgo = 0,
  ): Promise<Message> {
    const m = await sendOk(t, user, chatId, body);
    await age(m.id, minutesAgo);
    return m;
  }

  /** A thread under `parentId` (inserted directly: threads have their own module). */
  async function mkThread(parentId: string, name: string): Promise<string> {
    const [row] = await db
      .insert(chats)
      .values({ type: 'space_thread', name, spaceId, parentId })
      .returning({ id: chats.id });
    return row!.id;
  }

  async function insert(input: CreateMessageInput, minutesAgo = 0) {
    const { message } = await transact((tx, fx) => createMessage(tx, fx, input));
    await age(message.id, minutesAgo);
    return { id: message.id, seq: Number(message.seq) };
  }

  const threadPost = (threadId: string, user: TestUser, text: string, minutesAgo = 0) =>
    insert({ chatId: threadId, senderId: user.id, type: 'text', text }, minutesAgo);

  async function join(user: TestUser) {
    await t.api(user).post(`/api/invites/${invite.code}/join`).expect(200);
    await spaceRegistryIdle();
  }

  const searchUrl = (params: Params, space = spaceId) =>
    `/api/spaces/${space}/messages/search?${qs(params)}`;

  async function ok(user: TestUser, params: Params): Promise<MessageSearchPage> {
    return (await t.api(user).get(searchUrl(params)).expect(200)).body as MessageSearchPage;
  }

  async function okChat(user: TestUser, chatId: string, params: Params): Promise<MessageSearchPage> {
    return (await t.api(user).get(`/api/chats/${chatId}/messages/search?${qs(params)}`).expect(200))
      .body as MessageSearchPage;
  }

  beforeAll(async () => {
    t = await startTestServer();
    [owner, bob, carol] = [
      await t.createUser({ displayName: 'Owner' }),
      await t.createUser({ displayName: 'Bob' }),
      await t.createUser({ displayName: 'Carol' }),
    ];
    const detail = (await t.api(owner).post('/api/spaces').send({ name: 'Rockets' }).expect(201))
      .body as SpaceDetail;
    spaceId = detail.space.id;
    general = detail.channels.find((c) => c.name === 'general')!.id;
    voice = detail.channels.find((c) => c.type === 'space_voice')!.id;
    invite = (await t.api(owner).post(`/api/spaces/${spaceId}/invites`).send({}).expect(201))
      .body as SpaceInvite;
    await join(bob);
    random = (
      await t
        .api(owner)
        .post(`/api/spaces/${spaceId}/channels`)
        .send({ type: 'space_text', name: 'random' })
        .expect(201)
    ).body.id;
    staff = (
      await t.api(owner).post(`/api/spaces/${spaceId}/roles`).send({ name: 'Staff' }).expect(201)
    ).body as SpaceRole;
    staffRoom = (
      await t
        .api(owner)
        .post(`/api/spaces/${spaceId}/channels`)
        .send({ type: 'space_text', name: 'staff', privateRoleIds: [staff.id] })
        .expect(201)
    ).body.id;
    thread = await mkThread(general, 'Quokka facts');
    secretThread = await mkThread(staffRoom, 'Secret plans');
    await spaceRegistryIdle();
  });
  afterAll(() => t.close());

  describe('in a Space', () => {
    it('matches every word case-insensitively in the channels and threads I can see, newest first', async () => {
      const a = await post(owner, general, 'The Quokka is happy', 4);
      const b = await post(bob, random, 'a sad quokka', 3);
      const c = await threadPost(thread, owner, 'quokka in a thread', 2);
      await post(owner, staffRoom, 'secret quokka', 1);
      await threadPost(secretThread, owner, 'secret thread quokka', 0);

      const page = await ok(bob, { q: 'QUOKKA' });
      expect(ids(page)).toEqual([c.id, b.id, a.id]);
      expect(page).toMatchObject({ total: 3, capped: false });
      expect(page.items[0]!.chat).toEqual({
        id: thread,
        type: 'space_thread',
        name: 'Quokka facts',
        avatarUrl: null,
        peer: null,
        spaceId,
        parentId: general,
        parentName: 'general',
      });
      expect(page.items[2]!.chat).toMatchObject({ id: general, type: 'space_text', name: 'general', spaceId, parentId: null });
      expect(page.items[2]!.message).toMatchObject({ text: 'The Quokka is happy', senderId: owner.id });
      expect(page.users.map((u) => u.id).sort()).toEqual([owner.id, bob.id].sort());

      expect(ids(await ok(bob, { q: 'happy   quokka' }))).toEqual([a.id]);
      expect(ids(await ok(bob, { q: 'happy sad' }))).toEqual([]);
      // The owner can see the private channel and its thread.
      expect((await ok(owner, { q: 'quokka' })).total).toBe(5);
    });

    it('escapes LIKE wildcards', async () => {
      const pct = await post(owner, random, 'tapir sale 100% off', 2);
      const under = await post(owner, random, 'tapir snake_case', 1);
      await post(owner, random, 'tapir sale 1000 off and snakeXcase', 0);
      expect(ids(await ok(bob, { q: 'tapir 100%' }))).toEqual([pct.id]);
      expect(ids(await ok(bob, { q: 'tapir e_c' }))).toEqual([under.id]);
    });

    it('re-checks VIEW_CHANNEL per channel: a private channel and its threads never leak', async () => {
      const m = await post(owner, staffRoom, 'llama staff only', 1);
      await threadPost(secretThread, owner, 'llama thread', 0);
      expect((await ok(bob, { q: 'llama' })).total).toBe(0);
      await t.api(bob).get(searchUrl({ q: 'llama', channelId: staffRoom })).expect(404);
      await t.api(bob).get(searchUrl({ q: 'llama', channelId: secretThread })).expect(404);

      await t.api(owner).put(`/api/spaces/${spaceId}/members/${bob.id}/roles/${staff.id}`).expect(200);
      expect((await ok(bob, { q: 'llama' })).total).toBe(2);
      expect(ids(await ok(bob, { q: 'llama', channelId: staffRoom }))).toEqual([m.id]);
      // Reading creates bob's row there; losing the role must still hide the channel.
      await t.api(bob).post(`/api/chats/${staffRoom}/read`).send({ seq: m.seq }).expect(204);
      await t
        .api(owner)
        .delete(`/api/spaces/${spaceId}/members/${bob.id}/roles/${staff.id}`)
        .expect(200);
      const [row] = await db
        .select()
        .from(chatMembers)
        .where(and(eq(chatMembers.chatId, staffRoom), eq(chatMembers.userId, bob.id)));
      expect(row).toBeDefined();
      expect((await ok(bob, { q: 'llama' })).total).toBe(0);
      // The legacy routes don't trust that row either: the cross-chat search skips Space
      // channels, and a starred message there is listed only while the channel is visible.
      const legacy = (await t.api(bob).get('/api/search/messages').query({ q: 'llama' }).expect(200))
        .body as { message: { id: string } }[];
      expect(legacy).toEqual([]);
      await t.api(bob).get('/api/search/messages').query({ q: 'llama', chatId: staffRoom }).expect(404);
      await t.api(owner).put(`/api/spaces/${spaceId}/members/${bob.id}/roles/${staff.id}`).expect(200);
      await t.api(bob).put(`/api/messages/${m.id}/star`).expect(204);
      const starred = async () =>
        ((await t.api(bob).get('/api/messages/starred').expect(200)).body as { message: { id: string } }[]).map(
          (r) => r.message.id,
        );
      expect(await starred()).toEqual([m.id]);
      await t.api(owner).delete(`/api/spaces/${spaceId}/members/${bob.id}/roles/${staff.id}`).expect(200);
      expect(await starred()).toEqual([]);
    });

    it('404 for non-members and channels outside the scope; 400 without anything to look for', async () => {
      await t.api(carol).get(searchUrl({ q: 'quokka' })).expect(404);
      await t.api(bob).get(searchUrl({ q: 'x' }, randomUUID())).expect(404);
      // A voice channel's text chat is searched (spaces/voiceText.test.ts).
      await t.api(bob).get(searchUrl({ q: 'x', channelId: voice })).expect(200);
      await t.api(bob).get(searchUrl({ q: 'x', channelId: randomUUID() })).expect(404);
      await t.api(bob).get(searchUrl({})).expect(400);
      await t.api(bob).get(searchUrl({ q: '   ', sort: 'oldest' })).expect(400);
      await t.api(bob).get(searchUrl({ has: 'gif' })).expect(400);
      await t.api(bob).get(searchUrl({ q: 'x', before: 'yesterday' })).expect(400);
    });

    it('filters by author, channel or thread, and mentions', async () => {
      const a = await post(owner, general, `wombat hello ${mentionToken(bob.id)}`, 3);
      const b = await post(bob, general, 'wombat from bob', 2);
      const c = await post(bob, random, 'wombat in random', 1);
      const d = await threadPost(thread, bob, 'wombat in the thread', 0);
      expect(ids(await ok(bob, { q: 'wombat', authorId: bob.id }))).toEqual([d.id, c.id, b.id]);
      expect(ids(await ok(bob, { q: 'wombat', channelId: general }))).toEqual([b.id, a.id]);
      expect(ids(await ok(bob, { q: 'wombat', channelId: thread }))).toEqual([d.id]);
      expect(ids(await ok(bob, { q: 'wombat', authorId: bob.id, channelId: random }))).toEqual([c.id]);
      const mentioned = await ok(bob, { q: 'wombat', mentions: bob.id });
      expect(ids(mentioned)).toEqual([a.id]);
      // Authors and mentioned users come with the page.
      expect(mentioned.users.map((u) => u.id).sort()).toEqual([owner.id, bob.id].sort());
      // Filters alone (no words) are a search too.
      expect(ids(await ok(bob, { authorId: bob.id, channelId: thread }))).toEqual([d.id]);
    });

    it('has: link, file, image, video, sound and poll (several: all of them)', async () => {
      const dave = await t.createUser({ displayName: 'Dave' });
      await join(dave);
      const media = async (kind: 'image' | 'video' | 'audio' | 'voice' | 'file', text?: string) => ({
        type: kind,
        mediaId: (await mkMedia(dave.id, kind)).id,
        ...(text ? { text } : {}),
      });
      const link = await post(dave, general, 'see https://example.com/p', 7);
      const image = await post(dave, general, await media('image', 'photo http://x.org'), 6);
      const file = await post(dave, general, await media('file', 'the report'), 5);
      const video = await post(dave, random, await media('video'), 4);
      const voiceNote = await post(dave, random, await media('voice'), 3);
      const audio = await post(dave, random, await media('audio', 'a song'), 2);
      const poll = await post(dave, general, { type: 'poll', poll: { question: 'Lunch?', options: ['Yes', 'No'] } }, 1);
      await post(dave, general, 'plain text, no link', 0);
      const has = async (h: string | string[]) => ids(await ok(bob, { authorId: dave.id, has: h }));
      expect(await has('link')).toEqual([image.id, link.id]);
      expect(await has('image')).toEqual([image.id]);
      expect(await has('file')).toEqual([file.id]);
      expect(await has('video')).toEqual([video.id]);
      expect(await has('sound')).toEqual([audio.id, voiceNote.id]);
      expect(await has('poll')).toEqual([poll.id]);
      expect(await has(['image', 'link'])).toEqual([image.id]);
      expect(await has(['image', 'video'])).toEqual([]);
      expect(ids(await ok(bob, { authorId: dave.id, has: 'link', q: 'photo' }))).toEqual([image.id]);
    });

    it('before / after the send time, pinned, oldest first', async () => {
      const old = await post(owner, general, 'narwhal old', 3 * DAY);
      const mid = await post(owner, general, 'narwhal mid', 2 * DAY);
      const now = await post(owner, general, 'narwhal now', 0);
      const ago = (minutes: number) => new Date(Date.now() - minutes * MINUTE).toISOString();
      expect(ids(await ok(bob, { q: 'narwhal', before: ago(DAY) }))).toEqual([mid.id, old.id]);
      expect(ids(await ok(bob, { q: 'narwhal', after: ago(2.5 * DAY) }))).toEqual([now.id, mid.id]);
      expect(ids(await ok(bob, { q: 'narwhal', after: ago(2.5 * DAY), before: ago(DAY) }))).toEqual([mid.id]);
      expect(ids(await ok(bob, { q: 'narwhal', sort: 'oldest' }))).toEqual([old.id, mid.id, now.id]);

      await t.api(owner).post(`/api/chats/${general}/pins`).send({ messageId: mid.id }).expect(200);
      expect(ids(await ok(bob, { q: 'narwhal', pinned: 'true' }))).toEqual([mid.id]);
      expect(ids(await ok(bob, { q: 'narwhal', pinned: 'false' }))).toEqual([now.id, old.id]);
      expect(ids(await ok(bob, { pinned: 'true' }))).toEqual([mid.id]);
    });

    it('never lists deleted, expired, hidden or system messages; my read row window applies', async () => {
      const early = await post(owner, random, 'okapi early', 5);
      const kept = await post(owner, random, 'okapi kept', 4);
      const gone = await post(owner, random, 'okapi deleted', 3);
      await t.api(owner).delete(`/api/messages/${gone.id}?for=everyone`).expect(204);
      const expired = await post(owner, random, 'okapi expired', 2);
      await db.update(messages).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(messages.id, expired.id));
      const hidden = await post(owner, random, 'okapi hidden for bob', 1);
      await db.insert(messageHidden).values({ userId: bob.id, messageId: hidden.id });
      await insert({
        chatId: random,
        senderId: null,
        type: 'system',
        text: 'okapi system',
        metadata: { system: { kind: 'member_joined_space', actorId: bob.id } },
      });
      expect(ids(await ok(bob, { q: 'okapi' }))).toEqual([kept.id, early.id]);
      expect(ids(await ok(owner, { q: 'okapi' }))).toEqual([hidden.id, kept.id, early.id]);

      // A converted channel: bob's row starts after `early` (he joined the old group late).
      await db
        .insert(chatMembers)
        .values({ chatId: random, userId: bob.id, joinedSeq: early.seq, lastReadSeq: early.seq, lastDeliveredSeq: early.seq })
        .onConflictDoUpdate({ target: [chatMembers.chatId, chatMembers.userId], set: { joinedSeq: early.seq } });
      expect(ids(await ok(bob, { q: 'okapi' }))).toEqual([kept.id]);
      await db
        .update(chatMembers)
        .set({ joinedSeq: 0 })
        .where(and(eq(chatMembers.chatId, random), eq(chatMembers.userId, bob.id)));
    });

    it('uses a fixed number of queries per page, however many channels, threads and authors (no N+1)', async () => {
      const run = async (word: string, n: number) => {
        for (let i = 0; i < n; i++) {
          const u = await t.createUser();
          await join(u);
          await post(u, i % 2 ? random : general, `${word} ${i} ${mentionToken(bob.id)}`, n - i);
        }
        await threadPost(thread, owner, `${word} in a thread`, 0);
        const query = messageSearchSchema.parse({ q: word });
        await searchSpaceMessages(bob.id, spaceId, query); // warm the role cache
        const { result, queries } = await countQueries(() => searchSpaceMessages(bob.id, spaceId, query));
        expect(result.items).toHaveLength(n + 1);
        return queries;
      };
      const small = await run('meerkat', 1);
      const large = await run('mongoose', 6);
      expect(large).toBe(small);
    });

    it(`pages of ${SEARCH_PAGE_SIZE} with a total; the count stops at SEARCH_TOTAL_CAP`, async () => {
      // Many rows at once: one statement allocating the seqs.
      const bulk = (n: number, word: string) =>
        db.execute(sql`
          with c as (
            update chats set last_seq = last_seq + ${n}::int where id = ${random}::uuid
            returning last_seq - ${n}::int as base
          )
          insert into messages (chat_id, seq, sender_id, type, text, created_at)
          select ${random}::uuid, c.base + g, ${owner.id}::uuid, 'text', ${word}::text || ' ' || g,
                 now() - interval '1 hour' + g * interval '1 second'
          from c, generate_series(1, ${n}::int) g`);
      await bulk(30, 'capybara');
      const p1 = await ok(bob, { q: 'capybara' });
      expect(p1).toMatchObject({ total: 30, capped: false });
      expect(p1.items).toHaveLength(SEARCH_PAGE_SIZE);
      expect(p1.items[0]!.message.text).toBe('capybara 30');
      const p2 = await ok(bob, { q: 'capybara', offset: String(SEARCH_PAGE_SIZE) });
      expect(p2).toMatchObject({ total: 30, capped: false });
      expect(p2.items.map((i) => i.message.text)).toEqual([5, 4, 3, 2, 1].map((n) => `capybara ${n}`));
      const oldest = await ok(bob, { q: 'capybara', sort: 'oldest' });
      expect(oldest.items[0]!.message.text).toBe('capybara 1');
      expect((await ok(bob, { q: 'capybara', offset: '30' })).items).toEqual([]);

      await bulk(SEARCH_TOTAL_CAP + 1, 'axolotl');
      expect(await ok(bob, { q: 'axolotl' })).toMatchObject({ total: SEARCH_TOTAL_CAP, capped: true });
      expect(await ok(bob, { q: 'axolotl 4999' })).toMatchObject({ total: 1, capped: false });
    });
  });

  describe('in a DM or group', () => {
    it('searches one direct chat I am in; outsiders and other scopes get 404', async () => {
      const d = await activeDirect(t, owner, bob);
      const m1 = await post(owner, d, 'heron by the owner', 2);
      const m2 = await post(bob, d, 'HERON by bob https://x.y', 1);
      const page = await okChat(bob, d, { q: 'heron' });
      expect(ids(page)).toEqual([m2.id, m1.id]);
      expect(page).toMatchObject({ total: 2, capped: false });
      expect(page.items[0]!.chat).toMatchObject({ id: d, type: 'direct', name: null, peer: { id: owner.id } });
      expect(page.users.map((u) => u.id).sort()).toEqual([owner.id, bob.id].sort());
      expect(ids(await okChat(bob, d, { q: 'heron', has: 'link' }))).toEqual([m2.id]);
      expect(ids(await okChat(bob, d, { q: 'heron', authorId: owner.id }))).toEqual([m1.id]);
      expect(ids(await okChat(bob, d, { q: 'heron', sort: 'oldest' }))).toEqual([m1.id, m2.id]);
      expect(ids(await okChat(bob, d, { q: 'heron', offset: '1' }))).toEqual([m1.id]);
      expect(ids(await okChat(bob, d, { q: 'heron', channelId: d }))).toEqual([m2.id, m1.id]);

      await t.api(carol).get(`/api/chats/${d}/messages/search?q=heron`).expect(404);
      await t.api(bob).get(`/api/chats/${d}/messages/search?q=heron&channelId=${general}`).expect(404);
      await t.api(bob).get(`/api/chats/${general}/messages/search?q=quokka`).expect(404);
      await t.api(bob).get(`/api/chats/${d}/messages/search`).expect(400);
    });

    it('stays inside my window: joined, left, hidden for me, disappearing and cleared', async () => {
      const g = await createGroup(owner, [bob]);
      await post(owner, g, 'ibis before carol', 6);
      await addToGroup(g, owner, [carol]);
      const during = await post(owner, g, 'ibis while carol is here', 5);
      const hidden = await post(owner, g, 'ibis deleted for carol', 4);
      await t.api(carol).delete(`/api/messages/${hidden.id}?for=me`).expect(204);
      await leaveGroup(g, carol);
      await post(owner, g, 'ibis after carol left', 3);
      // A former member keeps her window.
      expect(ids(await okChat(carol, g, { q: 'ibis' }))).toEqual([during.id]);

      const fleeting = await post(owner, g, 'ibis disappearing', 2);
      await db.update(messages).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(messages.id, fleeting.id));
      expect((await okChat(bob, g, { q: 'ibis' })).total).toBe(4);
      await t.api(bob).post(`/api/chats/${g}/clear`).expect(204);
      expect(await okChat(bob, g, { q: 'ibis' })).toMatchObject({ total: 0, items: [] });
      const newer = await post(owner, g, 'ibis after the clear', 1);
      expect(ids(await okChat(bob, g, { q: 'ibis' }))).toEqual([newer.id]);
    });
  });
});
