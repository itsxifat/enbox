/**
 * Full profiles (`GET /users/:userId/profile`) and private notes (`PUT /users/:userId/note`):
 * mutual Spaces and friends, block and deletion exclusion, the shared group count, my own
 * profile, and notes that only their owner ever sees.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { USER_NOTE_MAX_LENGTH, type SpaceDetail, type SpaceInvite, type UserProfile } from '@enbox/shared';
import { db } from '../../src/db/index.js';
import { spaceMembers, userNotes, users } from '../../src/db/schema.js';
import { spaceRegistryIdle } from '../../src/realtime/spaceRegistry.js';
import { startTestServer, type TestServer, type TestUser } from '../helpers.js';

describe('user profiles and notes', () => {
  let t: TestServer;

  beforeAll(async () => {
    t = await startTestServer();
  });
  afterAll(() => t.close());

  const profileOf = async (viewer: TestUser, subject: { id: string }) =>
    (await t.api(viewer).get(`/api/users/${subject.id}/profile`).expect(200)).body as UserProfile;

  async function makeSpace(owner: TestUser, name: string, members: TestUser[]): Promise<string> {
    const detail = (await t.api(owner).post('/api/spaces').send({ name }).expect(201))
      .body as SpaceDetail;
    const invite = (
      await t.api(owner).post(`/api/spaces/${detail.space.id}/invites`).send({}).expect(201)
    ).body as SpaceInvite;
    for (const m of members) await t.api(m).post(`/api/invites/${invite.code}/join`).expect(200);
    await spaceRegistryIdle();
    return detail.space.id;
  }

  const addContact = (owner: TestUser, contact: TestUser) =>
    t.api(owner).post('/api/contacts').send({ userId: contact.id }).expect(201);

  describe('GET /users/:userId/profile', () => {
    it('lists the Spaces we share, by name, with their nickname there', async () => {
      const me = await t.createUser();
      const them = await t.createUser({ displayName: 'Them' });
      const other = await t.createUser();
      const zebra = await makeSpace(me, 'Zebra club', [them]);
      const apple = await makeSpace(them, 'apple pickers', [me]);
      await makeSpace(other, 'Not shared', [them]);
      await db
        .update(spaceMembers)
        .set({ nickname: 'Z-Them' })
        .where(and(eq(spaceMembers.spaceId, zebra), eq(spaceMembers.userId, them.id)));

      const p = await profileOf(me, them);
      expect(p.user).toMatchObject({ id: them.id, displayName: 'Them' });
      expect(p.mutualSpaces).toEqual([
        { id: apple, name: 'apple pickers', iconUrl: null, nickname: null },
        { id: zebra, name: 'Zebra club', iconUrl: null, nickname: 'Z-Them' },
      ]);
      // Symmetric (their nickname is mine from their side: none).
      expect((await profileOf(them, me)).mutualSpaces.map((s) => s.id)).toEqual([apple, zebra]);
    });

    it('lists people we both saved as contacts, minus deleted accounts and blocks with me', async () => {
      const me = await t.createUser();
      const them = await t.createUser();
      const [amy, bea, cal, dee, eve] = [
        await t.createUser({ displayName: 'Amy' }),
        await t.createUser({ displayName: 'Bea' }),
        await t.createUser({ displayName: 'Cal' }),
        await t.createUser({ displayName: 'Dee' }),
        await t.createUser({ displayName: 'Eve' }),
      ];
      for (const u of [amy!, bea!, cal!, dee!, eve!]) await addContact(me, u);
      for (const u of [amy!, bea!, cal!, dee!]) await addContact(them, u);
      // Bea blocked me, I blocked Cal, Dee's account is gone; Eve is only my contact.
      await t.api(bea!).put(`/api/blocks/${me.id}`).expect(204);
      await t.api(me).put(`/api/blocks/${cal!.id}`).expect(204);
      await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, dee!.id));

      const p = await profileOf(me, them);
      expect(p.mutualFriends.map((u) => u.id)).toEqual([amy!.id]);
      // Each friend is my view of them (UserPublic).
      expect(p.mutualFriends[0]).toMatchObject({ displayName: 'Amy', isContact: true });
    });

    it('hides mutual friends while a block exists between us, either way', async () => {
      const me = await t.createUser();
      const them = await t.createUser();
      const friend = await t.createUser();
      await addContact(me, friend);
      await addContact(them, friend);
      expect((await profileOf(me, them)).mutualFriends).toHaveLength(1);

      await t.api(them).put(`/api/blocks/${me.id}`).expect(204);
      expect((await profileOf(me, them)).mutualFriends).toEqual([]);
      await t.api(them).delete(`/api/blocks/${me.id}`).expect(204);
      await t.api(me).put(`/api/blocks/${them.id}`).expect(204);
      const p = await profileOf(me, them);
      expect(p.mutualFriends).toEqual([]);
      expect(p.user.isBlocked).toBe(true);
    });

    it('counts the groups we are both in', async () => {
      const me = await t.createUser();
      const them = await t.createUser();
      expect((await profileOf(me, them)).mutualGroupCount).toBe(0);
      await t.api(me).post('/api/groups').send({ name: 'One', memberIds: [them.id] }).expect(201);
      await t.api(them).post('/api/groups').send({ name: 'Two', memberIds: [me.id] }).expect(201);
      await t.api(me).post('/api/groups').send({ name: 'Mine', memberIds: [] }).expect(201);
      expect((await profileOf(me, them)).mutualGroupCount).toBe(2);
    });

    it('my own profile has no mutuals; unknown users are 404; deleted ones have none', async () => {
      const me = await t.createUser();
      const friend = await t.createUser();
      await addContact(me, friend);
      await makeSpace(me, 'Solo', []);
      const p = await profileOf(me, me);
      expect(p).toMatchObject({ mutualSpaces: [], mutualFriends: [], mutualGroupCount: 0, note: null });
      expect(p.user.id).toBe(me.id);

      await t.api(me).get('/api/users/00000000-0000-4000-8000-000000000000/profile').expect(404);
      await t.api(me).get('/api/users/not-a-uuid/profile').expect(400);

      const gone = await t.createUser();
      await makeSpace(me, 'With gone', [gone]);
      await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, gone.id));
      const g = await profileOf(me, gone);
      expect(g.user.isDeleted).toBe(true);
      expect(g.mutualSpaces).toEqual([]);
    });
  });

  describe('PUT /users/:userId/note', () => {
    it('saves, replaces and deletes my note; it shows on their profile for me only', async () => {
      const me = await t.createUser();
      const them = await t.createUser();
      const stranger = await t.createUser();

      expect(
        (await t.api(me).put(`/api/users/${them.id}/note`).send({ note: '  Met at the climbing gym ' }).expect(200)).body,
      ).toEqual({ note: 'Met at the climbing gym' });
      expect((await profileOf(me, them)).note).toBe('Met at the climbing gym');

      await t.api(me).put(`/api/users/${them.id}/note`).send({ note: 'Owes me lunch' }).expect(200);
      expect((await profileOf(me, them)).note).toBe('Owes me lunch');

      // Private: neither the subject nor anyone else sees it (they get their own, none).
      expect((await profileOf(them, me)).note).toBeNull();
      expect((await profileOf(stranger, them)).note).toBeNull();
      expect((await profileOf(them, them)).note).toBeNull();
      // Their note about me is separate.
      await t.api(them).put(`/api/users/${me.id}/note`).send({ note: 'Lunch!' }).expect(200);
      expect((await profileOf(me, them)).note).toBe('Owes me lunch');

      expect((await t.api(me).put(`/api/users/${them.id}/note`).send({ note: '' }).expect(200)).body).toEqual({
        note: null,
      });
      expect((await profileOf(me, them)).note).toBeNull();
      const rows = await db
        .select()
        .from(userNotes)
        .where(and(eq(userNotes.ownerId, me.id), eq(userNotes.subjectId, them.id)));
      expect(rows).toHaveLength(0);
      // Deleting a note that isn't there is fine; whitespace counts as empty.
      await t.api(me).put(`/api/users/${them.id}/note`).send({ note: '   ' }).expect(200, { note: null });
    });

    it('validates the note and the user', async () => {
      const me = await t.createUser();
      const them = await t.createUser();
      await t
        .api(me)
        .put(`/api/users/${them.id}/note`)
        .send({ note: 'x'.repeat(USER_NOTE_MAX_LENGTH + 1) })
        .expect(400);
      await t.api(me).put(`/api/users/${them.id}/note`).send({}).expect(400);
      await t
        .api(me)
        .put('/api/users/00000000-0000-4000-8000-000000000000/note')
        .send({ note: 'Hi' })
        .expect(404);
      await t.api().put(`/api/users/${them.id}/note`).send({ note: 'Hi' }).expect(401);
      await t
        .api(me)
        .put(`/api/users/${them.id}/note`)
        .send({ note: 'x'.repeat(USER_NOTE_MAX_LENGTH) })
        .expect(200);
    });
  });
});
