/**
 * Space templates: Spaces built from a starter (roles, categories, channels, overwrites and
 * the system channel of its snapshot), unknown templates, a template of a Space (MANAGE_SPACE,
 * one per Space, any signed-in user reads it by code) and the round trip — a new Space from
 * the code has the same roles, channels and overwrites — then isDirty, sync, edit and delete.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_EVERYONE_PERMISSIONS,
  PERM,
  STARTER_TEMPLATE_IDS,
  starterTemplate,
  type ChatSummary,
  type Space,
  type SpaceCategory,
  type SpaceDetail,
  type SpaceInvite,
  type SpaceRole,
  type SpaceTemplate,
} from '@enbox/shared';
import { db } from '../../src/db/index.js';
import { buildSnapshot, sameSnapshot } from '../../src/modules/templates/service.js';
import { spaceRegistryIdle } from '../../src/realtime/spaceRegistry.js';
import { startTestServer, type TestServer, type TestUser } from '../helpers.js';

describe('space templates', () => {
  let t: TestServer;
  let owner: TestUser;
  let bob: TestUser;
  let outsider: TestUser;

  beforeAll(async () => {
    t = await startTestServer();
    [owner, bob, outsider] = [
      await t.createUser({ displayName: 'Owner' }),
      await t.createUser({ displayName: 'Bob' }),
      await t.createUser({ displayName: 'Outsider' }),
    ];
  });
  afterAll(() => t.close());

  const createSpace = async (user: TestUser, body: object, status = 201) =>
    (await t.api(user).post('/api/spaces').send(body).expect(status)).body as SpaceDetail;

  /** Channel layout as [category, type, name, isNews] in sidebar order (text before voice). */
  const layout = (d: SpaceDetail) => {
    const cats = new Map(d.space.categories.map((c) => [c.id, c]));
    const key = (c: ChatSummary) => [
      c.space!.categoryId ? cats.get(c.space!.categoryId)!.position : -1,
      c.type === 'space_voice' || c.type === 'space_stage' ? 1 : 0,
      c.space!.position,
    ];
    return [...d.channels]
      .sort((x, y) => {
        const [kx, ky] = [key(x), key(y)];
        return kx[0]! - ky[0]! || kx[1]! - ky[1]! || kx[2]! - ky[2]!;
      })
      .map((c) => [
        c.space!.categoryId ? cats.get(c.space!.categoryId)!.name : null,
        c.type,
        c.name,
        !!c.space!.isNews,
      ]);
  };

  it('builds a Space from a starter: its categories, channels, overwrites and system channel', async () => {
    const d = await createSpace(owner, { name: 'Chess Club', template: 'school-club' });
    const starter = starterTemplate('school-club')!.snapshot;
    expect(d.space.categories.map((c) => c.name)).toEqual([
      'Information',
      'Text Channels',
      'Voice Channels',
    ]);
    expect(layout(d)).toEqual(
      starter.channels.map((c) => [
        starter.categories[c.category!]!.name,
        c.type,
        c.name,
        c.isNews,
      ]),
    );
    const everyone = d.space.roles.find((r) => r.isDefault)!;
    expect(everyone.permissions).toBe(DEFAULT_EVERYONE_PERMISSIONS);
    const announcements = d.channels.find((c) => c.name === 'announcements')!;
    expect(announcements.space?.isNews).toBe(true);
    expect(announcements.space?.overwrites).toEqual([
      { targetType: 'role', targetId: everyone.id, allow: 0, deny: PERM.SEND_MESSAGES },
    ]);
    expect(announcements.space?.permissionsSynced).toBe(false);
    expect(d.channels.find((c) => c.name === 'general')!.space?.permissionsSynced).toBe(true);
    expect(d.space.systemChannelId).toBe(d.channels.find((c) => c.name === 'general')!.id);
    // Every starter builds.
    for (const id of STARTER_TEMPLATE_IDS) {
      const s = await createSpace(bob, { name: `Starter ${id}`, template: id });
      expect(s.channels.length).toBe(starterTemplate(id)!.snapshot.channels.length);
      await t.api(bob).delete(`/api/spaces/${s.space.id}`).expect(204);
    }
  });

  it('an unknown template is a 404 and creates nothing', async () => {
    const before = ((await t.api(outsider).get('/api/spaces').expect(200)).body as Space[]).length;
    await createSpace(outsider, { name: 'Nope', template: 'no-such-code' }, 404);
    expect(((await t.api(outsider).get('/api/spaces').expect(200)).body as Space[]).length).toBe(
      before,
    );
  });

  let source: SpaceDetail;
  let mod: SpaceRole;
  let template: SpaceTemplate;
  const url = () => `/api/spaces/${source.space.id}/templates`;

  it('makes a template of a Space (MANAGE_SPACE, one per Space); anyone signed in reads it', async () => {
    source = await createSpace(owner, { name: 'Guild' });
    const sid = source.space.id;
    const api = t.api(owner);
    mod = (
      await api
        .post(`/api/spaces/${sid}/roles`)
        .send({
          name: 'Mod',
          color: '#ff8800',
          hoist: true,
          permissions: PERM.MANAGE_MESSAGES | PERM.KICK_MEMBERS,
        })
        .expect(201)
    ).body as SpaceRole;
    await api
      .post(`/api/spaces/${sid}/roles`)
      .send({ name: 'Member', mentionable: true })
      .expect(201);
    const everyone = source.space.roles.find((r) => r.isDefault)!;
    await api
      .patch(`/api/spaces/${sid}/roles/${everyone.id}`)
      .send({ permissions: DEFAULT_EVERYONE_PERMISSIONS & ~PERM.CREATE_INVITE })
      .expect(200);
    const staff = (
      await api
        .post(`/api/spaces/${sid}/categories`)
        .send({ name: 'Staff', privateRoleIds: [mod.id] })
        .expect(201)
    ).body as SpaceCategory;
    const ch = async (body: object) =>
      (await api.post(`/api/spaces/${sid}/channels`).send(body).expect(201)).body as ChatSummary;
    await ch({ type: 'space_text', name: 'mod-chat', categoryId: staff.id });
    const news = await ch({ type: 'space_text', name: 'news', isNews: true, topic: 'What is new' });
    await api
      .patch(`/api/spaces/${sid}/channels/${news.id}`)
      .send({ slowmodeSeconds: 30, nsfw: true })
      .expect(200);
    await api
      .put(`/api/spaces/${sid}/channels/${news.id}/overwrites/role/${everyone.id}`)
      .send({ allow: 0, deny: PERM.SEND_MESSAGES })
      .expect(200);
    await api
      .put(`/api/spaces/${sid}/channels/${news.id}/overwrites/role/${mod.id}`)
      .send({ allow: PERM.SEND_MESSAGES, deny: 0 })
      .expect(200);
    const afk = await ch({ type: 'space_voice', name: 'AFK', userLimit: 5 });
    await ch({ type: 'space_stage', name: 'Town Hall', topic: 'Monthly' });
    await ch({ type: 'space_forum', name: 'Help' });
    await api.patch(`/api/spaces/${sid}`).send({ afkChannelId: afk.id }).expect(200);
    const invite = (await api.post(`/api/spaces/${sid}/invites`).send({}).expect(201))
      .body as SpaceInvite;
    await t.api(bob).post(`/api/invites/${invite.code}/join`).expect(200);
    await spaceRegistryIdle();
    source = (await api.get(`/api/spaces/${sid}`).expect(200)).body as SpaceDetail;

    await t.api(bob).post(url()).send({ name: 'Guild kit' }).expect(403);
    await t.api(outsider).post(url()).send({ name: 'Guild kit' }).expect(404);
    template = (
      await api
        .post(url())
        .send({ name: 'Guild kit', description: 'Roles and channels' })
        .expect(201)
    ).body as SpaceTemplate;
    expect(template).toMatchObject({
      name: 'Guild kit',
      description: 'Roles and channels',
      sourceSpaceId: sid,
      creatorId: owner.id,
      usageCount: 0,
      isDirty: false,
    });
    expect(template.code).toMatch(/^[A-Za-z0-9]{12}$/);
    const snap = template.snapshot;
    expect(snap.roles.map((r) => [r.name, r.isDefault])).toEqual([
      ['@everyone', true],
      ['Member', false],
      ['Mod', false],
    ]);
    expect(snap.roles[0]!.permissions).toBe(DEFAULT_EVERYONE_PERMISSIONS & ~PERM.CREATE_INVITE);
    expect(snap.roles[2]).toMatchObject({ color: '#ff8800', hoist: true });
    // The private category keeps its role overwrites; the creator's member overwrite is dropped.
    const staffSnap = snap.categories.find((c) => c.name === 'Staff')!;
    expect(staffSnap.overwrites).toEqual([
      { role: 0, allow: 0, deny: PERM.VIEW_CHANNEL },
      { role: 2, allow: PERM.VIEW_CHANNEL, deny: 0 },
    ]);
    expect(snap.channels.find((c) => c.name === 'news')).toMatchObject({
      type: 'space_text',
      isNews: true,
      topic: 'What is new',
      slowmodeSeconds: 30,
      nsfw: true,
      category: null,
      overwrites: [
        { role: 0, allow: 0, deny: PERM.SEND_MESSAGES },
        { role: 2, allow: PERM.SEND_MESSAGES, deny: 0 },
      ],
    });
    expect(snap.channels[snap.afkChannel!]).toMatchObject({
      type: 'space_voice',
      name: 'AFK',
      userLimit: 5,
    });
    expect(snap.channels[snap.systemChannel!]).toMatchObject({
      type: 'space_text',
      name: 'general',
    });
    expect(JSON.stringify(snap)).not.toContain(owner.id);

    await api.post(url()).send({ name: 'Second' }).expect(409);
    expect(((await api.get(url()).expect(200)).body as SpaceTemplate[]).map((x) => x.code)).toEqual(
      [template.code],
    );
    await t.api(bob).get(url()).expect(403);
    const read = (await t.api(outsider).get(`/api/templates/${template.code}`).expect(200))
      .body as SpaceTemplate;
    expect(read).toMatchObject({ code: template.code, name: 'Guild kit', isDirty: false });
    await t.api(outsider).get('/api/templates/nonexistent1').expect(404);
    await t.api().get(`/api/templates/${template.code}`).expect(401);
  });

  it('a Space built from the code has the same roles, channels and overwrites', async () => {
    const copy = await createSpace(outsider, { name: 'My Guild', template: template.code });
    expect(copy.space.ownerId).toBe(outsider.id);
    expect(copy.space.memberCount).toBe(1);
    expect(sameSnapshot(await buildSnapshot(db, copy.space.id), template.snapshot)).toBe(true);
    expect(copy.space.roles.map((r) => r.name)).toEqual(['@everyone', 'Member', 'Mod']);
    expect(layout(copy)).toEqual(layout(source));
    const newMod = copy.space.roles.find((r) => r.name === 'Mod')!;
    const newEveryone = copy.space.roles.find((r) => r.isDefault)!;
    expect(newEveryone.permissions).toBe(DEFAULT_EVERYONE_PERMISSIONS & ~PERM.CREATE_INVITE);
    const news = copy.channels.find((c) => c.name === 'news')!;
    expect(news.space).toMatchObject({
      isNews: true,
      topic: 'What is new',
      slowmodeSeconds: 30,
      nsfw: true,
    });
    expect(news.space?.overwrites).toEqual(
      expect.arrayContaining([
        { targetType: 'role', targetId: newEveryone.id, allow: 0, deny: PERM.SEND_MESSAGES },
        { targetType: 'role', targetId: newMod.id, allow: PERM.SEND_MESSAGES, deny: 0 },
      ]),
    );
    // The private category hides its channel from the new owner's members too (no member overwrite).
    const staff = copy.space.categories.find((c) => c.name === 'Staff')!;
    expect(staff.overwrites.some((o) => o.targetType === 'member')).toBe(false);
    expect(copy.channels.find((c) => c.name === 'mod-chat')?.space?.permissionsSynced).toBe(true);
    expect(copy.space.afkChannelId).toBe(copy.channels.find((c) => c.name === 'AFK')!.id);
    expect(copy.space.systemChannelId).toBe(copy.channels.find((c) => c.name === 'general')!.id);
    // No members, messages or invites travel.
    expect(
      (await t.api(outsider).get(`/api/spaces/${copy.space.id}/invites`).expect(200)).body,
    ).toEqual([]);
    const read = (await t.api(owner).get(`/api/templates/${template.code}`).expect(200))
      .body as SpaceTemplate;
    expect(read.usageCount).toBe(1);
  });

  it('isDirty after a structure change (not after member roles); sync, edit and delete', async () => {
    const sid = source.space.id;
    const api = t.api(owner);
    await api.put(`/api/spaces/${sid}/members/${bob.id}/roles/${mod.id}`).expect(200);
    const list = async () => ((await api.get(url()).expect(200)).body as SpaceTemplate[])[0]!;
    expect((await list()).isDirty).toBe(false);
    const general = source.channels.find((c) => c.name === 'general')!;
    await api
      .patch(`/api/spaces/${sid}/channels/${general.id}`)
      .send({ name: 'lobby' })
      .expect(200);
    expect((await list()).isDirty).toBe(true);
    expect(
      (
        (await t.api(outsider).get(`/api/templates/${template.code}`).expect(200))
          .body as SpaceTemplate
      ).isDirty,
    ).toBe(true);

    await t.api(bob).put(`${url()}/${template.code}`).expect(403);
    const synced = (await api.put(`${url()}/${template.code}`).expect(200)).body as SpaceTemplate;
    expect(synced.isDirty).toBe(false);
    expect(synced.snapshot.channels.some((c) => c.name === 'lobby')).toBe(true);
    expect(Date.parse(synced.updatedAt)).toBeGreaterThanOrEqual(Date.parse(template.updatedAt));
    expect((await list()).isDirty).toBe(false);

    const edited = (
      await api
        .patch(`${url()}/${template.code}`)
        .send({ name: 'Guild kit v2', description: '' })
        .expect(200)
    ).body as SpaceTemplate;
    expect(edited).toMatchObject({ name: 'Guild kit v2', description: null, isDirty: false });
    // Another Space's route never reaches it.
    const other = await createSpace(owner, { name: 'Other' });
    await api
      .patch(`/api/spaces/${other.space.id}/templates/${template.code}`)
      .send({ name: 'x' })
      .expect(404);

    await t.api(bob).delete(`${url()}/${template.code}`).expect(403);
    await api.delete(`${url()}/${template.code}`).expect(204);
    await t.api(outsider).get(`/api/templates/${template.code}`).expect(404);
    await createSpace(outsider, { name: 'Late', template: template.code }, 404);
    expect((await api.get(url()).expect(200)).body).toEqual([]);
    // Free again: a new template of the same Space.
    await api.post(url()).send({ name: 'Fresh' }).expect(201);
  });
});
