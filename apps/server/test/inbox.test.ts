/**
 * The Inbox's Mentions (GET /api/me/mentions): direct, @everyone and role mentions in Space
 * channels and threads, group mentions, the suppress flags and filters, VIEW_CHANNEL
 * re-checks, the visibility rules, keyset paging and a fixed number of queries per page.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  EVERYONE_TOKEN,
  mentionToken,
  roleMentionToken,
  type ChatSummary,
  type InboxMentionsPage,
  type Message,
  type SpaceDetail,
  type SpaceInvite,
  type SpaceRole,
} from '@enbox/shared';
import { db } from '../src/db/index.js';
import { chats, messages } from '../src/db/schema.js';
import { listMentions } from '../src/modules/inbox/service.js';
import { spaceRegistryIdle } from '../src/realtime/spaceRegistry.js';
import { sleep, startTestServer, type TestServer, type TestUser } from './helpers.js';
import { countQueries, createGroup, send } from './services/fixtures.js';

describe('inbox mentions', () => {
  let t: TestServer;
  let owner: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let rockets: SpaceDetail;
  const general = () => rockets.channels.find((c) => c.name === 'general')!;

  beforeAll(async () => {
    t = await startTestServer();
    [owner, bob, carol] = [
      await t.createUser({ displayName: 'Owner' }),
      await t.createUser({ displayName: 'Bob' }),
      await t.createUser({ displayName: 'Carol' }),
    ];
    rockets = await createSpace(owner, 'Rockets', [bob, carol]);
  });
  afterAll(() => t.close());

  async function createSpace(by: TestUser, name: string, members: TestUser[]): Promise<SpaceDetail> {
    const detail = (await t.api(by).post('/api/spaces').send({ name }).expect(201)).body as SpaceDetail;
    const invite = (
      await t.api(by).post(`/api/spaces/${detail.space.id}/invites`).send({}).expect(201)
    ).body as SpaceInvite;
    for (const m of members) await t.api(m).post(`/api/invites/${invite.code}/join`).expect(200);
    await spaceRegistryIdle();
    return detail;
  }

  async function say(user: TestUser, chatId: string, text: string): Promise<Message> {
    const res = await t
      .api(user)
      .post(`/api/chats/${chatId}/messages`)
      .send({ clientId: Math.random().toString(36).slice(2), type: 'text', text })
      .expect(201);
    await sleep(3); // distinct created_at (ms precision): the expected order is the send order
    return res.body as Message;
  }

  async function mentions(
    user: TestUser,
    query: Record<string, string | number | boolean> = {},
  ): Promise<InboxMentionsPage> {
    const res = await t.api(user).get('/api/me/mentions').query(query).expect(200);
    return res.body as InboxMentionsPage;
  }

  const texts = (page: InboxMentionsPage) => page.items.map((i) => i.message.text);

  async function createRole(spaceId: string, name: string, extra: Record<string, unknown> = {}) {
    return (
      await t.api(owner).post(`/api/spaces/${spaceId}/roles`).send({ name, ...extra }).expect(201)
    ).body as SpaceRole;
  }

  async function grant(spaceId: string, user: TestUser, roleId: string) {
    await t.api(owner).put(`/api/spaces/${spaceId}/members/${user.id}/roles/${roleId}`).expect(200);
    await spaceRegistryIdle();
  }

  async function revoke(spaceId: string, user: TestUser, roleId: string) {
    await t.api(owner).delete(`/api/spaces/${spaceId}/members/${user.id}/roles/${roleId}`).expect(200);
    await spaceRegistryIdle();
  }

  it('lists direct mentions in Space channels, newest first, with the channel and the Space', async () => {
    await say(owner, general().id, `hi ${mentionToken(bob.id)}`);
    await say(carol, general().id, `yo ${mentionToken(bob.id)} and ${mentionToken(owner.id)}`);
    const page = await mentions(bob);
    expect(texts(page)).toEqual([
      `yo ${mentionToken(bob.id)} and ${mentionToken(owner.id)}`,
      `hi ${mentionToken(bob.id)}`,
    ]);
    expect(page.items[0]!.chat).toEqual({
      id: general().id,
      type: 'space_text',
      name: 'general',
      spaceId: rockets.space.id,
      spaceName: 'Rockets',
      spaceIconUrl: null,
      parentName: null,
    });
    expect(page.items[0]!.message.senderId).toBe(carol.id);
    expect(page.users.map((u) => u.id)).toEqual(expect.arrayContaining([owner.id, carol.id, bob.id]));
    expect(page.nextCursor).toBeNull();
    // My own messages never count: Carol's list does not have her message.
    expect(texts(await mentions(carol))).toEqual([]);
    expect(texts(await mentions(owner))).toEqual([
      `yo ${mentionToken(bob.id)} and ${mentionToken(owner.id)}`,
    ]);
    // Not signed in: 401.
    await t.api().get('/api/me/mentions').expect(401);
  });

  it('@everyone and role mentions count unless filtered out or suppressed in that Space', async () => {
    const pilots = await createRole(rockets.space.id, 'Pilots', { mentionable: true });
    await grant(rockets.space.id, bob, pilots.id);
    const loud = await say(owner, general().id, `all hands ${EVERYONE_TOKEN}`);
    expect(loud.mentionEveryone).toBe(true);
    const crew = await say(owner, general().id, `crew ${roleMentionToken(pilots.id)}`);
    expect(crew.mentionRoleIds).toEqual([pilots.id]);

    const allHands = `all hands ${EVERYONE_TOKEN}`;
    const crewText = `crew ${roleMentionToken(pilots.id)}`;
    expect(texts(await mentions(bob)).slice(0, 2)).toEqual([crewText, allHands]);
    // Carol has no Pilots role: only the @everyone.
    expect(texts(await mentions(carol))).toEqual([allHands]);
    // The sender's own pings are not in their inbox.
    expect(texts(await mentions(owner))).not.toContain(allHands);
    // Filters.
    expect(texts(await mentions(bob, { everyone: false }))).not.toContain(allHands);
    expect(texts(await mentions(bob, { everyone: false }))).toContain(crewText);
    expect(texts(await mentions(bob, { roles: false }))).not.toContain(crewText);
    expect(texts(await mentions(bob, { roles: false }))).toContain(allHands);
    expect(texts(await mentions(bob, { everyone: false, roles: false }))).toEqual([
      `yo ${mentionToken(bob.id)} and ${mentionToken(owner.id)}`,
      `hi ${mentionToken(bob.id)}`,
    ]);

    // Suppressed in the Space: gone even when asked for; direct mentions stay.
    const me = `/api/spaces/${rockets.space.id}/members/me`;
    await t.api(bob).patch(me).send({ suppressEveryone: true }).expect(200);
    let list = texts(await mentions(bob));
    expect(list).not.toContain(allHands);
    expect(list).toContain(crewText);
    await t.api(bob).patch(me).send({ suppressEveryone: false, suppressRoles: true }).expect(200);
    list = texts(await mentions(bob));
    expect(list).toContain(allHands);
    expect(list).not.toContain(crewText);
    expect(list).toContain(`hi ${mentionToken(bob.id)}`);
    await t.api(bob).patch(me).send({ suppressRoles: false }).expect(200);
    // Losing the role loses its mentions (computed at read time).
    await revoke(rockets.space.id, bob, pilots.id);
    expect(texts(await mentions(bob))).not.toContain(crewText);
    await grant(rockets.space.id, bob, pilots.id);
    expect(texts(await mentions(bob))).toContain(crewText);
  });

  let staffRoom: ChatSummary;
  let staff: SpaceRole;

  it('private channels are re-checked: without VIEW_CHANNEL their mentions never show', async () => {
    staff = await createRole(rockets.space.id, 'Staff');
    staffRoom = (
      await t
        .api(owner)
        .post(`/api/spaces/${rockets.space.id}/channels`)
        .send({ type: 'space_text', name: 'staff-room', privateRoleIds: [staff.id] })
        .expect(201)
    ).body as ChatSummary;
    await grant(rockets.space.id, bob, staff.id);
    await say(owner, staffRoom.id, `secret ${mentionToken(bob.id)}`);
    await say(owner, staffRoom.id, `staff meeting ${EVERYONE_TOKEN}`);

    const bobs = texts(await mentions(bob));
    expect(bobs.slice(0, 2)).toEqual([`staff meeting ${EVERYONE_TOKEN}`, `secret ${mentionToken(bob.id)}`]);
    // Carol cannot see the channel: its @everyone is not hers.
    expect(texts(await mentions(carol))).not.toContain(`staff meeting ${EVERYONE_TOKEN}`);

    await revoke(rockets.space.id, bob, staff.id);
    const after = await mentions(bob);
    expect(texts(after)).not.toContain(`secret ${mentionToken(bob.id)}`);
    expect(texts(after)).not.toContain(`staff meeting ${EVERYONE_TOKEN}`);
    expect(after.items.some((i) => i.chat.id === staffRoom.id)).toBe(false);
  });

  it('threads show with their parent channel and take its permissions', async () => {
    const [open] = await db
      .insert(chats)
      .values({ type: 'space_thread', name: 'launch plan', spaceId: rockets.space.id, parentId: general().id })
      .returning();
    const [hidden] = await db
      .insert(chats)
      .values({ type: 'space_thread', name: 'payroll', spaceId: rockets.space.id, parentId: staffRoom.id })
      .returning();
    await send(owner, open!.id, `thread ping ${mentionToken(bob.id)}`);
    await send(owner, hidden!.id, `payroll ping ${mentionToken(bob.id)}`);

    const page = await mentions(bob);
    const item = page.items.find((i) => i.chat.id === open!.id)!;
    expect(item.message.text).toBe(`thread ping ${mentionToken(bob.id)}`);
    expect(item.chat).toMatchObject({ type: 'space_thread', name: 'launch plan', parentName: 'general', spaceName: 'Rockets' });
    // Bob lost Staff: the thread of the private channel stays hidden.
    expect(page.items.some((i) => i.chat.id === hidden!.id)).toBe(false);
    await grant(rockets.space.id, bob, staff.id);
    const withStaff = await mentions(bob);
    expect(withStaff.items.find((i) => i.chat.id === hidden!.id)?.chat.parentName).toBe('staff-room');
    await revoke(rockets.space.id, bob, staff.id);
  });

  it('group chats: active members inside their window; spaceId keeps one Space', async () => {
    const groupId = await createGroup(owner, [bob, carol], { name: 'Hikers' });
    await say(owner, groupId, `trail ${mentionToken(bob.id)}`);
    const page = await mentions(bob);
    expect(page.items[0]!.message.text).toBe(`trail ${mentionToken(bob.id)}`);
    expect(page.items[0]!.chat).toEqual({
      id: groupId,
      type: 'group',
      name: 'Hikers',
      spaceId: null,
      spaceName: null,
      spaceIconUrl: null,
      parentName: null,
    });
    // One Space only: no groups, no other Space.
    const other = await createSpace(owner, 'Elsewhere', [bob]);
    const elsewhere = other.channels.find((c) => c.type === 'space_text')!;
    await say(owner, elsewhere.id, `over here ${mentionToken(bob.id)}`);
    const scoped = await mentions(bob, { spaceId: rockets.space.id });
    expect(scoped.items.length).toBeGreaterThan(0);
    expect(scoped.items.every((i) => i.chat.spaceId === rockets.space.id)).toBe(true);
    expect(texts(await mentions(bob, { spaceId: other.space.id }))).toEqual([
      `over here ${mentionToken(bob.id)}`,
    ]);

    // Clearing the group hides what came before; leaving it hides everything.
    await t.api(bob).post(`/api/chats/${groupId}/clear`).expect(204);
    expect(texts(await mentions(bob))).not.toContain(`trail ${mentionToken(bob.id)}`);
    await say(owner, groupId, `again ${mentionToken(bob.id)}`);
    expect(texts(await mentions(bob))[0]).toBe(`again ${mentionToken(bob.id)}`);
    await t.api(bob).post(`/api/groups/${groupId}/leave`).expect(204);
    expect((await mentions(bob)).items.some((i) => i.chat.id === groupId)).toBe(false);
    // Carol is still a member and was not mentioned: nothing of it in her inbox either.
    expect((await mentions(carol)).items.some((i) => i.chat.id === groupId)).toBe(false);
  });

  it('leaves out deleted, expired, old and hidden-for-me messages', async () => {
    const tag = (n: number) => `case${n} ${mentionToken(carol.id)}`;
    const m1 = await say(owner, general().id, tag(1));
    const m2 = await say(owner, general().id, tag(2));
    const m3 = await say(owner, general().id, tag(3));
    await say(owner, general().id, tag(4));
    await t.api(owner).delete(`/api/messages/${m1.id}`).query({ for: 'everyone' }).expect(204);
    await db.update(messages).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(messages.id, m2.id));
    await db
      .update(messages)
      .set({ createdAt: new Date(Date.now() - 31 * 86_400_000) })
      .where(eq(messages.id, m3.id));
    const list = texts(await mentions(carol)).filter((x) => x?.startsWith('case'));
    expect(list).toEqual([tag(4)]);
  });

  it('pages with a keyset cursor; a malformed cursor is a 400', async () => {
    const paging = await createSpace(owner, 'Paging', [bob]);
    const ch = paging.channels.find((c) => c.type === 'space_text')!;
    const sent: string[] = [];
    for (let i = 1; i <= 5; i++) sent.push((await say(owner, ch.id, `page ${i} ${mentionToken(bob.id)}`)).text!);
    const seen: string[] = [];
    let before: string | null = null;
    let pages = 0;
    do {
      const page: InboxMentionsPage = await mentions(bob, {
        spaceId: paging.space.id,
        limit: 2,
        ...(before ? { before } : {}),
      });
      expect(page.items.length).toBeLessThanOrEqual(2);
      seen.push(...texts(page).map((x) => x!));
      before = page.nextCursor;
      pages++;
    } while (before && pages < 10);
    expect(seen).toEqual([...sent].reverse());
    expect(pages).toBe(3);

    await t.api(bob).get('/api/me/mentions').query({ before: 'nonsense' }).expect(400);
    await t.api(bob).get('/api/me/mentions').query({ before: `${new Date().toISOString()}|x` }).expect(400);
    await t.api(bob).get('/api/me/mentions').query({ limit: 500 }).expect(400);
  });

  it('a fixed number of queries per page, however many Spaces and chats it spans', async () => {
    const dave = await t.createUser({ displayName: 'Dave' });
    const spacesOf = [
      await createSpace(owner, 'One', [dave]),
      await createSpace(owner, 'Two', [dave]),
      await createSpace(owner, 'Three', [dave]),
    ];
    const text = (s: SpaceDetail) => s.channels.find((c) => c.type === 'space_text')!.id;
    const query = { limit: 10, everyone: true, roles: true };
    for (let i = 0; i < 3; i++) await say(owner, text(spacesOf[0]!), `one ${i} ${mentionToken(dave.id)}`);
    const single = await countQueries(() => listMentions(dave.id, query));
    expect(single.result.items).toHaveLength(3);
    for (const s of spacesOf.slice(1))
      for (let i = 0; i < 3; i++) await say(owner, text(s), `${s.space.name} ${i} ${mentionToken(dave.id)}`);
    const spread = await countQueries(() => listMentions(dave.id, query));
    expect(spread.result.items).toHaveLength(9);
    expect(new Set(spread.result.items.map((i) => i.chat.spaceId)).size).toBe(3);
    expect(spread.queries).toBe(single.queries);
  });
});
