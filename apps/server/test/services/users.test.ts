import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { DELETED_ACCOUNT_NAME, DEFAULT_USER_SETTINGS } from '@enbox/shared';
import { db } from '../../src/db/index.js';
import { blocks, contacts, media, sessions, users } from '../../src/db/schema.js';
import {
  blockedEitherWay,
  blockedEitherWayIds,
  canSeePresence,
  deletedUsername,
  isBlocked,
  isContactOf,
  loadPresences,
  loadRelationship,
  loadUserSelf,
  scrubDeletedUser,
  toUserPublic,
  toUserPublicMap,
  toUserPublics,
} from '../../src/services/users.js';
import { requireAvatarMedia, requireOwnedMedia } from '../../src/services/media.js';
import { startTestServer, type TestServer, type TestUser } from '../helpers.js';
import { block, goOffline, saveContact, setSettings } from './fixtures.js';

describe('services/users', () => {
  let t: TestServer;
  let viewer: TestUser;

  beforeAll(async () => {
    t = await startTestServer();
    viewer = await t.createUser({ displayName: 'Viewer' });
  });
  afterAll(() => t.close());

  async function subjectWithProfile(overrides: Record<string, unknown> = {}) {
    const u = await t.createUser({
      displayName: 'Subject',
      phone: `+1555${Math.floor(1_000_000 + Math.random() * 8_999_999)}`,
    });
    const [m] = await db
      .insert(media)
      .values({
        uploaderId: u.id,
        kind: 'image',
        mimeType: 'image/png',
        size: 10,
        storageKey: `2026/01/${crypto.randomUUID()}.png`,
      })
      .returning();
    await db
      .update(users)
      .set({
        avatarMediaId: m!.id,
        about: 'about me',
        lastSeenAt: new Date('2026-01-01T00:00:00Z'),
      })
      .where(eq(users.id, u.id));
    if (Object.keys(overrides).length) await setSettings(u, overrides);
    return { user: u, avatarUrl: `/uploads/${m!.storageKey}` };
  }

  it('shows everything allowed by default settings except the phone (only if the subject saved me)', async () => {
    const { user, avatarUrl } = await subjectWithProfile();
    let p = (await toUserPublic(db, viewer.id, user.id))!;
    expect(p).toMatchObject({
      id: user.id,
      displayName: 'Subject',
      avatarUrl,
      about: 'about me',
      phone: null,
      online: false,
      isContact: false,
      contactName: null,
      isBlocked: false,
      isDeleted: false,
    });
    expect(p.lastSeenAt).toBe('2026-01-01T00:00:00.000Z');
    await saveContact(user, viewer);
    await saveContact(viewer, user, 'My buddy');
    p = (await toUserPublic(db, viewer.id, user.id))!;
    expect(p.phone).not.toBeNull();
    expect(p).toMatchObject({ isContact: true, contactName: 'My buddy' });
  });

  it("applies 'contacts' / 'nobody' levels from the SUBJECT's point of view", async () => {
    const { user, avatarUrl } = await subjectWithProfile({
      profilePhotoVisibility: 'contacts',
      aboutVisibility: 'nobody',
      lastSeenVisibility: 'contacts',
      onlineVisibility: 'same_as_last_seen',
    });
    let p = (await toUserPublic(db, viewer.id, user.id))!;
    expect(p).toMatchObject({ avatarUrl: null, about: null, online: null, lastSeenAt: null });
    await saveContact(viewer, user); // I saved them: irrelevant
    p = (await toUserPublic(db, viewer.id, user.id))!;
    expect(p.avatarUrl).toBeNull();
    await saveContact(user, viewer); // they saved me
    p = (await toUserPublic(db, viewer.id, user.id))!;
    expect(p).toMatchObject({
      avatarUrl,
      about: null,
      online: false,
      lastSeenAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it("onlineVisibility 'everyone' shows online even when last seen is hidden", async () => {
    const { user } = await subjectWithProfile({ lastSeenVisibility: 'nobody' });
    const sock = await t.connect(user);
    let p = (await toUserPublic(db, viewer.id, user.id))!;
    expect(p.online).toBe(true);
    expect(p.lastSeenAt).toBeNull();
    await goOffline(user, sock);
    p = (await toUserPublic(db, viewer.id, user.id))!;
    expect(p.online).toBe(false);
    expect(p.lastSeenAt).toBeNull();
    const [presence] = await loadPresences(db, viewer.id, [user.id]);
    expect(presence).toEqual({ userId: user.id, online: false, lastSeenAt: null });
  });

  it('subject blocked viewer → avatar/about/phone/presence null, block never revealed', async () => {
    const { user } = await subjectWithProfile();
    await saveContact(user, viewer);
    await block(user, viewer);
    const p = (await toUserPublic(db, viewer.id, user.id))!;
    expect(p).toMatchObject({
      avatarUrl: null,
      about: null,
      phone: null,
      online: null,
      lastSeenAt: null,
      isBlocked: false,
    });
    expect(p.displayName).toBe('Subject');
  });

  it('viewer blocked subject → presence hidden, profile per settings, isBlocked true', async () => {
    const { user, avatarUrl } = await subjectWithProfile();
    await block(viewer, user);
    const p = (await toUserPublic(db, viewer.id, user.id))!;
    expect(p).toMatchObject({
      avatarUrl,
      about: 'about me',
      online: null,
      lastSeenAt: null,
      isBlocked: true,
    });
    expect(
      canSeePresence(
        viewer.id,
        { id: user.id, settings: {}, deletedAt: null },
        await loadRelationship(db, viewer.id, user.id),
      ),
    ).toEqual({ canSeeOnline: false, canSeeLastSeen: false });
  });

  it('deleted accounts render as "Deleted account" with everything null; self view is complete', async () => {
    const { user } = await subjectWithProfile({
      aboutVisibility: 'nobody',
      profilePhotoVisibility: 'nobody',
      lastSeenVisibility: 'nobody',
    });
    const self = (await toUserPublic(db, user.id, user.id))!;
    expect(self.about).toBe('about me');
    expect(self.avatarUrl).not.toBeNull();
    expect(self.phone).not.toBeNull();
    expect(self.lastSeenAt).toBe('2026-01-01T00:00:00.000Z');

    await saveContact(viewer, user, 'Old friend');
    const { sessionIds } = await db.transaction((tx) => scrubDeletedUser(tx, user.id));
    expect(sessionIds).toHaveLength(1);
    expect(await db.select().from(sessions).where(eq(sessions.userId, user.id))).toHaveLength(0);
    expect(await db.select().from(contacts).where(eq(contacts.contactId, user.id))).toHaveLength(0);
    const p = (await toUserPublic(db, viewer.id, user.id))!;
    expect(p).toEqual({
      id: user.id,
      username: deletedUsername(user.id),
      displayName: DELETED_ACCOUNT_NAME,
      avatarUrl: null,
      about: null,
      phone: null,
      online: null,
      lastSeenAt: null,
      isContact: false,
      contactName: null,
      isBlocked: false,
      isDeleted: true,
    });
    expect(deletedUsername(user.id)).toMatch(/^deleted_[0-9a-f]{12}$/);
  });

  it('batch helpers: order preserved, unknown omitted; relationship helpers', async () => {
    const a = await t.createUser();
    const b = await t.createUser();
    const unknown = crypto.randomUUID();
    expect((await toUserPublics(db, viewer.id, [b.id, unknown, a.id])).map((u) => u.id)).toEqual([
      b.id,
      a.id,
    ]);
    expect([...(await toUserPublicMap(db, viewer.id, [a.id])).keys()]).toEqual([a.id]);
    await block(a, viewer);
    expect(await isBlocked(db, a.id, viewer.id)).toBe(true);
    expect(await isBlocked(db, viewer.id, a.id)).toBe(false);
    expect(await blockedEitherWay(db, viewer.id, a.id)).toBe(true);
    expect([...(await blockedEitherWayIds(db, viewer.id, [a.id, b.id]))]).toEqual([a.id]);
    await saveContact(b, viewer);
    expect(await isContactOf(db, b.id, viewer.id)).toBe(true);
    expect(await isContactOf(db, viewer.id, b.id)).toBe(false);
    const rel = await loadRelationship(db, viewer.id, b.id);
    expect(rel).toMatchObject({ subjectSavedViewer: true, viewerSavedSubject: false });
    await db.delete(blocks).where(eq(blocks.blockerId, a.id));
  });

  it('toUserSelf returns complete settings', async () => {
    await setSettings(viewer, { readReceipts: false });
    const self = await loadUserSelf(db, viewer.id);
    expect(self.settings).toEqual({ ...DEFAULT_USER_SETTINGS, readReceipts: false });
    expect(self).toMatchObject({ id: viewer.id, displayName: 'Viewer', avatarUrl: null });
  });

  it('requireOwnedMedia: 404 unless mine; 400 on kind/type/size mismatch', async () => {
    const other = await t.createUser();
    const [mine] = await db
      .insert(media)
      .values({
        uploaderId: viewer.id,
        kind: 'image',
        mimeType: 'image/gif',
        size: 10,
        storageKey: `k/${crypto.randomUUID()}.gif`,
      })
      .returning();
    const [theirs] = await db
      .insert(media)
      .values({
        uploaderId: other.id,
        kind: 'image',
        mimeType: 'image/png',
        size: 10,
        storageKey: `k/${crypto.randomUUID()}.png`,
      })
      .returning();
    expect((await requireOwnedMedia(db, mine!.id, viewer.id, { kinds: ['image'] })).id).toBe(
      mine!.id,
    );
    await expect(requireOwnedMedia(db, theirs!.id, viewer.id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      requireOwnedMedia(db, mine!.id, viewer.id, { kinds: ['video'] }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(requireAvatarMedia(db, mine!.id, viewer.id)).rejects.toMatchObject({
      status: 400,
    }); // GIF is not an avatar type
  });
});
