/**
 * Communities → Spaces conversion (docs/design/spaces-at-scale.md "Communities conversion"):
 * built through the real community routes, then converted twice (idempotent).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  PERM,
  hasPerm,
  type ChatSummary,
  type Community,
  type Message,
  type Space,
  type SpaceDetail,
} from '@enbox/shared';
import { db } from '../../src/db/index.js';
import { communities, spaces } from '../../src/db/schema.js';
import { migrateCommunitiesToSpaces } from '../../src/services/spacesMigration.js';
import { startTestServer, type TestServer, type TestUser } from '../helpers.js';

describe('communities → Spaces conversion', () => {
  let t: TestServer;
  let owner: TestUser;
  let admin: TestUser;
  let member: TestUser;
  let outsider: TestUser;
  let removed: TestUser;
  let community: Community;
  let groupId: string;
  let inviteCode: string;

  beforeAll(async () => {
    t = await startTestServer();
    [owner, admin, member, outsider, removed] = [
      await t.createUser({ displayName: 'Owner' }),
      await t.createUser({ displayName: 'Admin' }),
      await t.createUser({ displayName: 'Member' }),
      await t.createUser({ displayName: 'Outsider' }),
      await t.createUser({ displayName: 'Removed' }),
    ];
    community = (
      await t.api(owner).post('/api/communities').send({ name: 'Book Club' }).expect(201)
    ).body as Community;
    await t
      .api(owner)
      .post(`/api/communities/${community.id}/members`)
      .send({ userIds: [admin.id, member.id, outsider.id, removed.id] })
      .expect(200);
    await t
      .api(owner)
      .put(`/api/communities/${community.id}/members/${admin.id}/role`)
      .send({ role: 'admin' })
      .expect(204);
    const g = (
      await t
        .api(owner)
        .post(`/api/communities/${community.id}/groups`)
        .send({ name: 'Weekly Reads', memberIds: [admin.id, member.id, removed.id] })
        .expect(201)
    ).body;
    groupId = g.chat.id;
    await t
      .api(owner)
      .post(`/api/chats/${groupId}/messages`)
      .send({ clientId: 'm1', type: 'text', text: 'before conversion' })
      .expect(201);
    await t.api(owner).delete(`/api/groups/${groupId}/members/${removed.id}`).expect(204);
    inviteCode = (
      (await t.api(owner).get(`/api/communities/${community.id}/invite`).expect(200)).body as {
        code: string;
      }
    ).code;
  });
  afterAll(() => t.close());

  it('converts once (idempotent) and deletes the community', async () => {
    expect(await migrateCommunitiesToSpaces()).toMatchObject({ communities: 1, converted: 1 });
    expect(await migrateCommunitiesToSpaces()).toMatchObject({ communities: 0, converted: 0 });
    expect(await db.select().from(communities)).toHaveLength(0);
    const [space] = await db
      .select()
      .from(spaces)
      .where(eq(spaces.legacyCommunityId, community.id));
    expect(space).toMatchObject({ name: 'Book Club', ownerId: owner.id, memberCount: 5 });
  });

  it('every community member is a Space member; admins get the Admin role', async () => {
    const mine = (await t.api(admin).get('/api/spaces').expect(200)).body as Space[];
    expect(mine).toHaveLength(1);
    const s = mine[0]!;
    expect(s.roles.map((r) => r.name)).toEqual(['@everyone', 'Admin']);
    expect(hasPerm(s.myPermissions, PERM.ADMINISTRATOR)).toBe(true);
    const plain = ((await t.api(member).get('/api/spaces').expect(200)).body as Space[])[0]!;
    expect(hasPerm(plain.myPermissions, PERM.ADMINISTRATOR)).toBe(false);
  });

  it('announcements: read-only for members, the system channel; groups become text channels', async () => {
    const detail = (await t.api(member).get('/api/spaces').expect(200)).body as Space[];
    const d = (await t.api(member).get(`/api/spaces/${detail[0]!.id}`).expect(200))
      .body as SpaceDetail;
    const byName = new Map(d.channels.map((c) => [c.name, c]));
    expect([...byName.keys()]).toEqual(['announcements', 'weekly-reads', 'General']);
    expect(byName.get('announcements')!.permissions.canSend).toBe(false);
    expect(d.space.systemChannelId).toBe(byName.get('announcements')!.id);
    expect(byName.get('weekly-reads')!.permissions.canSend).toBe(true);
    expect(byName.get('weekly-reads')!.id).toBe(groupId); // the same chat: history kept
  });

  it('history: group members keep it; community members who never joined see only new messages; removed members stay out', async () => {
    const page = (await t.api(member).get(`/api/chats/${groupId}/messages`).expect(200)).body as {
      messages: Message[];
    };
    expect(page.messages.some((m) => m.text === 'before conversion')).toBe(true);
    const fresh = (await t.api(outsider).get(`/api/chats/${groupId}/messages`).expect(200))
      .body as { messages: Message[] };
    expect(fresh.messages.some((m) => m.text === 'before conversion')).toBe(false);
    await t.api(removed).get(`/api/chats/${groupId}`).expect(404);
    const s = (await t.api(outsider).get(`/api/chats/${groupId}`).expect(200)).body as ChatSummary;
    expect(s.unreadCount).toBe(0);
  });

  it('the old community invite link now joins the Space', async () => {
    const newbie = await t.createUser({ displayName: 'Newbie' });
    const preview = (await t.api(newbie).get(`/api/invites/${inviteCode}`).expect(200)).body;
    expect(preview).toMatchObject({ kind: 'space', name: 'Book Club', canJoin: true });
    const joined = (await t.api(newbie).post(`/api/invites/${inviteCode}/join`).expect(200)).body;
    expect(joined.kind).toBe('space');
  });
});
