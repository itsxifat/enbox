/**
 * Account deletion hooks of this slice (registered by the communities and channels modules
 * through services/hooks.ts; DELETE /me itself belongs to the accounts module, which calls
 * `runAccountDeletionHooks` inside its transaction).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { ChatSummary, Community } from '@enbox/shared';
import { db } from '../../src/db/index.js';
import { chatMembers, chats, communities, communityMembers } from '../../src/db/schema.js';
import { transact } from '../../src/services/effects.js';
import { runAccountDeletionHooks } from '../../src/services/hooks.js';
import { upsertMembership } from '../../src/services/membership.js';
import { startTestServer, type TestServer, type TestUser } from '../helpers.js';
import { createGroup, memberRow, recordEvents, settle } from '../services/fixtures.js';
import { connectAll, summary, systemKinds } from './util.js';

describe('account deletion: communities and channels', () => {
  let t: TestServer;

  beforeAll(async () => {
    t = await startTestServer();
  });
  afterAll(() => t.close());

  const makeUsers = (n: number) => Promise.all(Array.from({ length: n }, () => t.createUser()));
  const api = (u: TestUser) => t.api(u);
  const deleteAccount = (u: TestUser) => transact((tx, fx) => runAccountDeletionHooks(tx, fx, u.id));

  async function communityWith(owner: TestUser, groupIds: string[], members: TestUser[], admins: TestUser[] = []): Promise<Community> {
    const c = (await api(owner).post('/api/communities').send({ name: 'C', groupIds }).expect(201)).body as Community;
    if (members.length) await api(owner).post(`/api/communities/${c.id}/members`).send({ userIds: members.map((m) => m.id) }).expect(200);
    for (const a of admins) await api(owner).put(`/api/communities/${c.id}/members/${a.id}/role`).send({ role: 'admin' }).expect(204);
    return c;
  }

  it('community owner: leaves every linked group, the oldest admin becomes owner (mirrored into the announcement group)', async () => {
    const [owner, admin, member] = await makeUsers(3);
    const g = await createGroup(owner!, [member!]);
    const c = await communityWith(owner!, [g], [admin!], [admin!]);
    const conns = await connectAll(t, admin!, member!);
    const [aRec, mRec] = conns.sockets.map((s) => recordEvents(s));
    await deleteAccount(owner!);
    await settle();
    expect(await db.select().from(communityMembers).where(and(eq(communityMembers.communityId, c.id), eq(communityMembers.userId, owner!.id)))).toEqual([]);
    const [newOwner] = await db.select().from(communityMembers).where(and(eq(communityMembers.communityId, c.id), eq(communityMembers.role, 'owner')));
    expect(newOwner!.userId).toBe(admin!.id);
    expect((await memberRow(c.announcementChatId, admin!)).role).toBe('owner');
    expect(await memberRow(c.announcementChatId, owner!)).toMatchObject({ hidden: true, leftReason: 'left', role: 'member' });
    expect((await systemKinds(g)).slice(-2)).toEqual(['member_left', 'owner_changed']);
    expect((await summary(member!, g))!.myRole).toBe('owner'); // group succession
    expect(aRec!.of('community:upsert').at(-1)!.community.myRole).toBe('owner');
    expect(aRec!.of('chat:upsert').some((p) => p.chat.id === c.announcementChatId && p.chat.myRole === 'owner')).toBe(true);
    expect(mRec!.of('message:new').map((p) => p.message.system?.kind)).toEqual(['member_left', 'owner_changed']);
    await conns.close();
  });

  it('sole member: the community is deactivated and its groups unlinked', async () => {
    const [owner] = await makeUsers(1);
    const g = await createGroup(owner!, []);
    const c = await communityWith(owner!, [g], []);
    await deleteAccount(owner!);
    expect(await db.select().from(communities).where(eq(communities.id, c.id))).toEqual([]);
    expect(await db.select().from(chats).where(eq(chats.id, c.announcementChatId))).toEqual([]);
    const [group] = await db.select().from(chats).where(eq(chats.id, g));
    expect(group!.communityId).toBeNull();
  });

  it('tolerates groups already left by the accounts pipeline', async () => {
    const [owner, member] = await makeUsers(2);
    const g = await createGroup(owner!, [member!]);
    const c = await communityWith(owner!, [g], []);
    // Accounts module left the regular group (and even the announcement group) first.
    await transact((tx, fx) => upsertMembership(tx, fx, { kind: 'deactivate', chatId: g, userId: member!.id, reason: 'left', systemEvent: { kind: 'member_left', actorId: member!.id } }));
    await transact((tx, fx) => upsertMembership(tx, fx, { kind: 'deactivate', chatId: c.announcementChatId, userId: member!.id, reason: 'left' }));
    await deleteAccount(member!);
    expect(await db.select().from(communityMembers).where(and(eq(communityMembers.communityId, c.id), eq(communityMembers.userId, member!.id)))).toEqual([]);
    expect(await memberRow(c.announcementChatId, member!)).toMatchObject({ hidden: true });
    expect((await systemKinds(g)).filter((k) => k === 'member_left')).toHaveLength(1);
  });

  it('channels: follower rows deleted; owned channels pass to the oldest admin or are deleted', async () => {
    const [owner, admin, follower] = await makeUsers(3);
    const withAdmin = (await api(owner!).post('/api/channels').send({ name: 'Keeps going' }).expect(201)).body as ChatSummary;
    const noAdmin = (await api(owner!).post('/api/channels').send({ name: 'Ends' }).expect(201)).body as ChatSummary;
    const theirs = (await api(admin!).post('/api/channels').send({ name: 'Someone else' }).expect(201)).body as ChatSummary;
    for (const ch of [withAdmin, noAdmin]) {
      await api(admin!).put(`/api/channels/${ch.id}/follow`).expect(200);
      await api(follower!).put(`/api/channels/${ch.id}/follow`).expect(200);
    }
    await api(owner!).put(`/api/channels/${theirs.id}/follow`).expect(200);
    await api(owner!).put(`/api/channels/${withAdmin.id}/admins/${admin!.id}`).expect(204);

    const conns = await connectAll(t, admin!, follower!);
    const [aRec, fRec] = conns.sockets.map((s) => recordEvents(s));
    await deleteAccount(owner!);
    await settle();
    expect((await memberRow(withAdmin.id, admin!)).role).toBe('owner');
    expect(aRec!.of('chat:upsert').some((p) => p.chat.id === withAdmin.id && p.chat.myRole === 'owner')).toBe(true);
    expect(await db.select().from(chats).where(eq(chats.id, noAdmin.id))).toEqual([]);
    expect(fRec!.of('chat:removed')).toEqual([{ chatId: noAdmin.id }]);
    expect(fRec!.of('chat:updated')).toEqual(expect.arrayContaining([{ chatId: withAdmin.id, changes: { memberCount: 2 } }]));
    const rows = await db.select().from(chatMembers).where(eq(chatMembers.userId, owner!.id));
    expect(rows.filter((r) => [withAdmin.id, noAdmin.id, theirs.id].includes(r.chatId))).toEqual([]);
    expect((await summary(admin!, theirs.id))!.memberCount).toBe(1);
    await conns.close();
  });
});
