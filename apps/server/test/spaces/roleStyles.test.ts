/**
 * Role name styles and icons: solid / gradient (needs both colours) / holographic (needs none,
 * keeps any colours as the fallback), an emoji or an uploaded still image as the icon (my own
 * upload; the image wins on the client), @everyone takes neither, and every change reaches the
 * members through `space:updated { roles }` and the Space payloads.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PERM,
  type Space,
  type SpaceDetail,
  type SpaceInvite,
  type SpaceRole,
} from '@enbox/shared';
import { db } from '../../src/db/index.js';
import { media } from '../../src/db/schema.js';
import { spaceRegistryIdle } from '../../src/realtime/spaceRegistry.js';
import { startTestServer, waitForEvent, type TestServer, type TestUser } from '../helpers.js';
import { insertImage } from '../accounts/util.js';

describe('role styles and icons', () => {
  let t: TestServer;
  let owner: TestUser;
  let bob: TestUser;
  let detail: SpaceDetail;
  const spaceId = () => detail.space.id;
  const base = () => `/api/spaces/${spaceId()}`;
  const everyone = () => detail.space.roles.find((r) => r.isDefault)!;

  beforeAll(async () => {
    t = await startTestServer();
    [owner, bob] = [
      await t.createUser({ displayName: 'Owner' }),
      await t.createUser({ displayName: 'Bob' }),
    ];
    detail = (await t.api(owner).post('/api/spaces').send({ name: 'Styles' }).expect(201))
      .body as SpaceDetail;
    const invite = (await t.api(owner).post(`${base()}/invites`).send({}).expect(201))
      .body as SpaceInvite;
    await t.api(bob).post(`/api/invites/${invite.code}/join`).expect(200);
    await spaceRegistryIdle();
  });
  afterAll(() => t.close());

  const create = (user: TestUser, body: Record<string, unknown>) =>
    t.api(user).post(`${base()}/roles`).send(body);
  const update = (user: TestUser, roleId: string, body: Record<string, unknown>) =>
    t.api(user).patch(`${base()}/roles/${roleId}`).send(body);

  it('roles default to solid with no icon', async () => {
    const r = (await create(owner, { name: 'Plain', color: '#3498db' }).expect(201)).body as SpaceRole;
    expect(r).toMatchObject({
      colorStyle: 'solid',
      colorSecondary: null,
      iconUrl: null,
      iconEmoji: null,
    });
    expect(everyone()).toMatchObject({ colorStyle: 'solid', iconUrl: null, iconEmoji: null });
  });

  it('a gradient needs both colours; holographic needs none', async () => {
    await create(owner, { name: 'Half', color: '#ff0000', colorStyle: 'gradient' }).expect(400);
    await create(owner, { name: 'Half', colorSecondary: '#00ff00', colorStyle: 'gradient' }).expect(400);
    await create(owner, { name: 'Bad', colorStyle: 'rainbow' }).expect(400);
    const g = (
      await create(owner, {
        name: 'Sunset',
        color: '#FF7700',
        colorSecondary: '#AA00FF',
        colorStyle: 'gradient',
      }).expect(201)
    ).body as SpaceRole;
    expect(g).toMatchObject({ color: '#ff7700', colorSecondary: '#aa00ff', colorStyle: 'gradient' });
    const h = (await create(owner, { name: 'Shiny', colorStyle: 'holographic' }).expect(201))
      .body as SpaceRole;
    expect(h).toMatchObject({ colorStyle: 'holographic', color: null, colorSecondary: null });
  });

  it('updates switch styles, checked against the role as it will be stored', async () => {
    const r = (await create(owner, { name: 'Shift', color: '#123456' }).expect(201)).body as SpaceRole;
    // Gradient without a second colour (stored or sent) → 400; nothing changes.
    await update(owner, r.id, { colorStyle: 'gradient' }).expect(400);
    let got = (await update(owner, r.id, { colorStyle: 'gradient', colorSecondary: '#654321' }).expect(200))
      .body as SpaceRole;
    expect(got).toMatchObject({ colorStyle: 'gradient', color: '#123456', colorSecondary: '#654321' });
    // Removing a colour of a gradient → 400.
    await update(owner, r.id, { colorSecondary: null }).expect(400);
    await update(owner, r.id, { color: null }).expect(400);
    // Holographic keeps the colours (fallback); back to solid keeps the second one stored.
    got = (await update(owner, r.id, { colorStyle: 'holographic' }).expect(200)).body as SpaceRole;
    expect(got).toMatchObject({ colorStyle: 'holographic', color: '#123456', colorSecondary: '#654321' });
    got = (await update(owner, r.id, { colorStyle: 'solid' }).expect(200)).body as SpaceRole;
    expect(got).toMatchObject({ colorStyle: 'solid', colorSecondary: '#654321' });
    got = (await update(owner, r.id, { colorSecondary: null }).expect(200)).body as SpaceRole;
    expect(got.colorSecondary).toBeNull();
  });

  it('emoji icons: one emoji, null (or empty) clears', async () => {
    const r = (await create(owner, { name: 'Star', iconEmoji: '⭐' }).expect(201)).body as SpaceRole;
    expect(r.iconEmoji).toBe('⭐');
    await create(owner, { name: 'Text', iconEmoji: 'abc' }).expect(400);
    await update(owner, r.id, { iconEmoji: '⭐⭐' }).expect(400);
    // Sequences count as one: ZWJ family, flag, keycap.
    for (const e of ['👩‍💻', '🇧🇩', '1️⃣']) {
      const got = (await update(owner, r.id, { iconEmoji: e }).expect(200)).body as SpaceRole;
      expect(got.iconEmoji).toBe(e);
    }
    let got = (await update(owner, r.id, { iconEmoji: '' }).expect(200)).body as SpaceRole;
    expect(got.iconEmoji).toBeNull();
    await update(owner, r.id, { iconEmoji: '🔥' }).expect(200);
    got = (await update(owner, r.id, { iconEmoji: null }).expect(200)).body as SpaceRole;
    expect(got.iconEmoji).toBeNull();
  });

  it('image icons: my own still image; others’, animated or non-images refused', async () => {
    const mine = await insertImage(owner.id, { mimeType: 'image/png' });
    const r = (await create(owner, { name: 'Icon', iconMediaId: mine.id, iconEmoji: '🔥' }).expect(201))
      .body as SpaceRole;
    expect(r).toMatchObject({ iconUrl: `/uploads/${mine.storageKey}`, iconEmoji: '🔥' });

    const bobs = await insertImage(bob.id);
    await update(owner, r.id, { iconMediaId: bobs.id }).expect(404);
    const animated = await insertImage(owner.id, { mimeType: 'image/gif', animated: true });
    await update(owner, r.id, { iconMediaId: animated.id }).expect(400);
    const [doc] = await db
      .insert(media)
      .values({
        uploaderId: owner.id,
        kind: 'file',
        mimeType: 'application/pdf',
        size: 10,
        storageKey: `2026/01/${crypto.randomUUID()}.pdf`,
      })
      .returning();
    await update(owner, r.id, { iconMediaId: doc!.id }).expect(400);
    await create(owner, { name: 'Theirs', iconMediaId: bobs.id }).expect(404);

    const cleared = (await update(owner, r.id, { iconMediaId: null }).expect(200)).body as SpaceRole;
    expect(cleared).toMatchObject({ iconUrl: null, iconEmoji: '🔥' });
  });

  it('@everyone takes no style or icon', async () => {
    for (const body of [
      { colorStyle: 'gradient' },
      { colorSecondary: '#111111' },
      { iconEmoji: '⭐' },
      { iconMediaId: null },
    ])
      await update(owner, everyone().id, body).expect(400);
  });

  it('changes reach members via space:updated and the Space payloads', async () => {
    const icon = await insertImage(owner.id, { mimeType: 'image/webp' });
    const r = (await create(owner, { name: 'Live', color: '#00aa00' }).expect(201)).body as SpaceRole;
    await spaceRegistryIdle();
    const sb = await t.connect(bob);
    const updated = waitForEvent(sb, 'space:updated', {
      filter: (p) =>
        !!p.changes.roles?.some((x) => x.id === r.id && x.colorStyle === 'gradient' && !!x.iconUrl),
    });
    await update(owner, r.id, {
      colorStyle: 'gradient',
      colorSecondary: '#0000aa',
      iconMediaId: icon.id,
    }).expect(200);
    const live = (await updated).changes.roles!.find((x) => x.id === r.id)!;
    expect(live).toMatchObject({
      colorStyle: 'gradient',
      color: '#00aa00',
      colorSecondary: '#0000aa',
      iconUrl: `/uploads/${icon.storageKey}`,
    });
    // GET /spaces (my list), GET /spaces/:id and GET /roles serialize the same.
    const list = (await t.api(bob).get('/api/spaces').expect(200)).body as Space[];
    expect(list.find((s) => s.id === spaceId())!.roles.find((x) => x.id === r.id)).toMatchObject(live);
    const d = (await t.api(bob).get(base()).expect(200)).body as SpaceDetail;
    expect(d.space.roles.find((x) => x.id === r.id)).toMatchObject(live);
    const roles = (await t.api(bob).get(`${base()}/roles`).expect(200)).body as SpaceRole[];
    expect(roles.find((x) => x.id === r.id)).toMatchObject(live);
    sb.disconnect();
  });

  it('only MANAGE_ROLES below my highest role can style a role', async () => {
    const target = (await create(owner, { name: 'Target' }).expect(201)).body as SpaceRole;
    await update(bob, target.id, { colorStyle: 'holographic' }).expect(403);
    const managers = (
      await create(owner, { name: 'Managers', permissions: PERM.MANAGE_ROLES }).expect(201)
    ).body as SpaceRole;
    await t.api(owner).put(`${base()}/members/${bob.id}/roles/${managers.id}`).expect(200);
    // Managers is the newest role (position 1): Target sits above it.
    await update(bob, target.id, { colorStyle: 'holographic' }).expect(403);
    const below = (await create(owner, { name: 'Below' }).expect(201)).body as SpaceRole;
    const got = (await update(bob, below.id, { colorStyle: 'holographic', iconEmoji: '🛡️' }).expect(200))
      .body as SpaceRole;
    expect(got).toMatchObject({ colorStyle: 'holographic', iconEmoji: '🛡️' });
  });

  it('reordering keeps the styles and broadcasts the new order', async () => {
    const roles = (await t.api(owner).get(`${base()}/roles`).expect(200)).body as SpaceRole[];
    const others = roles.filter((r) => !r.isDefault).sort((a, b) => b.position - a.position);
    const reversed = [...others].reverse().map((r) => r.id);
    const sb = await t.connect(bob);
    const updated = waitForEvent(sb, 'space:updated', {
      filter: (p) => !!p.changes.roles && p.changes.roles.some((x) => x.id === reversed[0] && x.position === reversed.length),
    });
    const after = (
      await t.api(owner).patch(`${base()}/roles/positions`).send({ roleIds: reversed }).expect(200)
    ).body as SpaceRole[];
    await updated;
    const byId = new Map(after.map((r) => [r.id, r]));
    for (const r of others)
      expect(byId.get(r.id)).toMatchObject({
        colorStyle: r.colorStyle,
        colorSecondary: r.colorSecondary,
        iconUrl: r.iconUrl,
        iconEmoji: r.iconEmoji,
      });
    expect(reversed.map((id) => byId.get(id)!.position)).toEqual(
      reversed.map((_, i) => reversed.length - i),
    );
    sb.disconnect();
  });
});
