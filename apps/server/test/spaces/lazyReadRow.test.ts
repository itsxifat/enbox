/**
 * Space channels create a member's read row lazily (first read or send). Interacting with a
 * message before that (pin, react, star, forward) must work for anyone who can see the
 * channel, and stay a 404 for whoever can't.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { SpaceDetail, SpaceInvite } from '@enbox/shared';
import { db } from '../../src/db/index.js';
import { chatMembers } from '../../src/db/schema.js';
import { spaceRegistryIdle } from '../../src/realtime/spaceRegistry.js';
import { startTestServer, type TestServer, type TestUser } from '../helpers.js';

describe('messages of a Space channel before my read row exists', () => {
  let t: TestServer;
  let owner: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let detail: SpaceDetail;
  const general = () => detail.channels.find((c) => c.type === 'space_text')!.id;
  const rowOf = async (chatId: string, userId: string) =>
    (
      await db
        .select()
        .from(chatMembers)
        .where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, userId)))
    )[0];

  beforeAll(async () => {
    t = await startTestServer();
    [owner, bob, carol] = [await t.createUser(), await t.createUser(), await t.createUser()];
    detail = (await t.api(owner).post('/api/spaces').send({ name: 'Lazy' }).expect(201)).body as SpaceDetail;
    const invite = (await t.api(owner).post(`/api/spaces/${detail.space.id}/invites`).send({}).expect(201))
      .body as SpaceInvite;
    await t.api(bob).post(`/api/invites/${invite.code}/join`).expect(200);
    await spaceRegistryIdle();
  });
  afterAll(() => t.close());

  const sendAs = async (user: TestUser, chatId: string, text: string) =>
    (
      await t
        .api(user)
        .post(`/api/chats/${chatId}/messages`)
        .send({ clientId: Math.random().toString(36), type: 'text', text })
        .expect(201)
    ).body as { id: string };

  it('pin, react and star work for a member who never opened the channel', async () => {
    const m = await sendAs(bob, general(), 'pin me before reading');
    // The owner has no read row in #general yet.
    const owned = await rowOf(general(), owner.id);
    if (owned) await db.delete(chatMembers).where(and(eq(chatMembers.chatId, general()), eq(chatMembers.userId, owner.id)));
    await t.api(owner).post(`/api/chats/${general()}/pins`).send({ messageId: m.id }).expect(200);
    expect(await rowOf(general(), owner.id)).toBeDefined();

    const n = await sendAs(owner, general(), 'react before reading');
    await db.delete(chatMembers).where(and(eq(chatMembers.chatId, general()), eq(chatMembers.userId, bob.id)));
    await t.api(bob).put(`/api/messages/${n.id}/reactions/${encodeURIComponent('👍')}/@me`).expect(204);
    await db.delete(chatMembers).where(and(eq(chatMembers.chatId, general()), eq(chatMembers.userId, bob.id)));
    await t.api(bob).put(`/api/messages/${n.id}/star`).expect(204);
  });

  it('someone who cannot see the channel still gets 404, and no row is made', async () => {
    const hidden = (
      await t
        .api(owner)
        .post(`/api/spaces/${detail.space.id}/channels`)
        .send({ type: 'space_text', name: 'staff', privateRoleIds: [] })
        .expect(201)
    ).body as { id: string };
    await spaceRegistryIdle();
    const m = await sendAs(owner, hidden.id, 'staff only');
    await t.api(bob).put(`/api/messages/${m.id}/reactions/${encodeURIComponent('👍')}/@me`).expect(404);
    await t.api(bob).put(`/api/messages/${m.id}/star`).expect(404);
    expect(await rowOf(hidden.id, bob.id)).toBeUndefined();
    // And a non-member of the Space.
    await t.api(carol).put(`/api/messages/${m.id}/star`).expect(404);
  });
});
