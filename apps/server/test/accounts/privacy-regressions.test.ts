/**
 * Privacy regressions: community members stay invisible to each other (announcement member
 * lists are admin-only), and a block stays invisible to the blocked party in every lookup.
 * Regression tests for AUTHZ-2 and P8.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestServer, type TestServer, type TestUser } from '../helpers.js';
import { block, recordEvents, settle } from '../services/fixtures.js';

describe('privacy regressions', () => {
  let t: TestServer;

  beforeAll(async () => {
    t = await startTestServer();
  });
  afterAll(() => t.close());

  async function community(owner: TestUser, members: TestUser[]) {
    const c = (await t.api(owner).post('/api/communities').send({ name: 'Comm' }).expect(201)).body as { id: string; announcementChatId: string };
    if (members.length) await t.api(owner).post(`/api/communities/${c.id}/members`).send({ userIds: members.map((m) => m.id) }).expect(200);
    return c;
  }

  describe('user:changed never goes to a whole announcement group for a plain member', () => {
    it('PATCH /me and PATCH /me/settings of a plain member reach no other plain member', async () => {
      const [owner, x, y] = [await t.createUser(), await t.createUser(), await t.createUser()];
      await community(owner, [x, y]);
      const sy = await t.connect(y);
      const so = await t.connect(owner);
      const [ry, ro] = [recordEvents(sy), recordEvents(so)];
      await t.api(x).patch('/api/me').send({ displayName: 'X renamed' }).expect(200);
      await t.api(x).patch('/api/me/settings').send({ profilePhotoVisibility: 'nobody' }).expect(200);
      await settle(300);
      expect(ry.of('user:changed').map((p) => p.userId)).not.toContain(x.id);
      // Not even the admins learn it through the room (they may list members on demand).
      expect(ro.of('user:changed').map((p) => p.userId)).not.toContain(x.id);
      sy.disconnect();
      so.disconnect();
    });

    it("an admin's profile change still reaches the community (their name is on the announcements)", async () => {
      const [owner, y] = [await t.createUser(), await t.createUser()];
      await community(owner, [y]);
      const sy = await t.connect(y);
      const ry = recordEvents(sy);
      await t.api(owner).patch('/api/me').send({ displayName: 'Owner renamed' }).expect(200);
      await settle(300);
      expect(ry.of('user:changed').map((p) => p.userId)).toContain(owner.id);
      sy.disconnect();
    });

    it('members sharing a regular (linked) group still hear about each other', async () => {
      const [owner, x, y] = [await t.createUser(), await t.createUser(), await t.createUser()];
      const c = await community(owner, []);
      await t.api(owner).post(`/api/communities/${c.id}/groups`).send({ name: 'Linked', memberIds: [x.id, y.id] }).expect(201);
      const sy = await t.connect(y);
      const ry = recordEvents(sy);
      await t.api(x).patch('/api/me').send({ displayName: 'X again' }).expect(200);
      await settle(300);
      expect(ry.of('user:changed').map((p) => p.userId)).toContain(x.id);
      sy.disconnect();
    });
  });

  describe('POST /contacts and blockers', () => {
    it('a blocked user cannot resolve the blocker by username or phone (404, like by-username and search)', async () => {
      const blocker = await t.createUser({ phone: '+14155550142' });
      const blocked = await t.createUser();
      await block(blocker, blocked);
      await t.api(blocked).get(`/api/users/by-username/${blocker.username}`).expect(404);
      expect((await t.api(blocked).get(`/api/users/search?q=${blocker.username}`).expect(200)).body).toEqual([]);
      const byUsername = await t.api(blocked).post('/api/contacts').send({ username: blocker.username });
      expect({ status: byUsername.status, code: byUsername.body.error?.code }).toEqual({ status: 404, code: 'not_found' });
      const byPhone = await t.api(blocked).post('/api/contacts').send({ phone: '+14155550142' });
      expect({ status: byPhone.status, code: byPhone.body.error?.code }).toEqual({ status: 404, code: 'not_found' });
    });

    it('the blocker can still save the blocked user, and lookups by others are unaffected', async () => {
      const blocker = await t.createUser({ phone: '+14155550143' });
      const blocked = await t.createUser();
      const other = await t.createUser();
      await block(blocker, blocked);
      await t.api(blocker).post('/api/contacts').send({ username: blocked.username }).expect(201);
      await t.api(other).post('/api/contacts').send({ phone: '+14155550143' }).expect(201);
    });
  });
});
