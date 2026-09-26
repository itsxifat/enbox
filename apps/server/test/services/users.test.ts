import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  DELETED_ACCOUNT_NAME,
  DEFAULT_USER_SETTINGS,
  MAX_ANIMATED_AVATAR_BYTES,
  MAX_BANNER_BYTES,
  type Presence,
  type UserPublic,
} from '@enbox/shared';
import { db } from '../../src/db/index.js';
import { blocks, contacts, media, sessions, users } from '../../src/db/schema.js';
import {
  NO_RELATIONSHIP,
  blockedEitherWay,
  blockedEitherWayIds,
  buildPresence,
  canSeePresence,
  deletedUsername,
  getUserRow,
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
import {
  requireAvatarMedia,
  requireBannerMedia,
  requireOwnedMedia,
} from '../../src/services/media.js';
import { giveAnimatedAvatar, giveBanner, insertImage } from '../accounts/util.js';
import { startTestServer, type TestServer, type TestUser } from '../helpers.js';
import {
  block,
  goOffline,
  saveContact,
  setAvailability,
  setPresenceNote,
  setSettings,
} from './fixtures.js';

const LAST_SEEN = '2026-01-01T00:00:00.000Z';

describe('services/users', () => {
  let t: TestServer;
  let viewer: TestUser;

  beforeAll(async () => {
    t = await startTestServer();
    viewer = await t.createUser({ displayName: 'Viewer' });
  });
  afterAll(() => t.close());

  /** The P1 profile fields every subject gets (visible per `aboutVisibility`). */
  const ABOUT_FIELDS = {
    pronouns: 'they/them',
    bio: 'A longer\nabout me',
    profileColor: '#112233',
    accentColor: '#aabbcc',
  };

  /** A subject with a static avatar, an animated banner, the profile fields and a last seen. */
  async function subjectWithProfile(overrides: Record<string, unknown> = {}) {
    const u = await t.createUser({
      displayName: 'Subject',
      phone: `+1555${Math.floor(1_000_000 + Math.random() * 8_999_999)}`,
    });
    const m = await insertImage(u.id);
    await db
      .update(users)
      .set({
        avatarMediaId: m.id,
        about: 'about me',
        lastSeenAt: new Date(LAST_SEEN),
        ...ABOUT_FIELDS,
      })
      .where(eq(users.id, u.id));
    const banner = await giveBanner(u.id, true);
    if (Object.keys(overrides).length) await setSettings(u, overrides);
    return { user: u, avatarUrl: `/uploads/${m.storageKey}`, ...banner };
  }

  /** The gated profile fields of `p`, for exact comparisons. */
  const gated = (p: UserPublic) => ({
    avatarUrl: p.avatarUrl,
    avatarAnimatedUrl: p.avatarAnimatedUrl,
    bannerUrl: p.bannerUrl,
    bannerAnimatedUrl: p.bannerAnimatedUrl,
    about: p.about,
    pronouns: p.pronouns,
    bio: p.bio,
    profileColor: p.profileColor,
    accentColor: p.accentColor,
    phone: p.phone,
    online: p.online,
    presenceState: p.presenceState,
    presenceNote: p.presenceNote,
    lastSeenAt: p.lastSeenAt,
  });
  const HIDDEN_PHOTO = {
    avatarUrl: null,
    avatarAnimatedUrl: null,
    bannerUrl: null,
    bannerAnimatedUrl: null,
  };
  const HIDDEN_ABOUT = {
    about: null,
    pronouns: null,
    bio: null,
    profileColor: null,
    accentColor: null,
  };
  const HIDDEN_PRESENCE = {
    online: null,
    presenceState: null,
    presenceNote: null,
    lastSeenAt: null,
  };

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
    expect(presence).toEqual({
      userId: user.id,
      online: false,
      state: 'offline',
      note: null,
      lastSeenAt: null,
    });
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
      avatarAnimatedUrl: null,
      bannerUrl: null,
      bannerAnimatedUrl: null,
      about: null,
      pronouns: null,
      bio: null,
      profileColor: null,
      accentColor: null,
      phone: null,
      online: null,
      presenceState: null,
      presenceNote: null,
      lastSeenAt: null,
      createdAt: null,
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

  it('banner, animated avatar, pronouns, bio and colours: visible by default, gated like the avatar / about', async () => {
    const { user, avatarUrl, bannerUrl, bannerAnimatedUrl } = await subjectWithProfile();
    let p = (await toUserPublic(db, viewer.id, user.id))!;
    expect(gated(p)).toEqual({
      avatarUrl,
      avatarAnimatedUrl: null,
      bannerUrl,
      bannerAnimatedUrl,
      about: 'about me',
      ...ABOUT_FIELDS,
      phone: null,
      online: false,
      presenceState: 'offline',
      presenceNote: null,
      lastSeenAt: LAST_SEEN,
    });
    expect(bannerUrl).toMatch(/\.jpg$/); // the poster
    expect(bannerAnimatedUrl).toMatch(/\.gif$/);
    const animated = await giveAnimatedAvatar(user.id);
    p = (await toUserPublic(db, viewer.id, user.id))!;
    expect(p).toMatchObject(animated);
    // Visibility levels: photo → avatar, animated avatar, banner; about → bio/pronouns/colours.
    await setSettings(user, { profilePhotoVisibility: 'contacts', aboutVisibility: 'contacts' });
    p = (await toUserPublic(db, viewer.id, user.id))!;
    expect(p).toMatchObject({ ...HIDDEN_PHOTO, ...HIDDEN_ABOUT });
    await saveContact(user, viewer);
    p = (await toUserPublic(db, viewer.id, user.id))!;
    expect(p).toMatchObject({
      ...animated,
      bannerUrl,
      bannerAnimatedUrl,
      about: 'about me',
      ...ABOUT_FIELDS,
    });
    await setSettings(user, { profilePhotoVisibility: 'everyone', aboutVisibility: 'nobody' });
    p = (await toUserPublic(db, viewer.id, user.id))!;
    expect(p).toMatchObject({ ...animated, bannerUrl, bannerAnimatedUrl, ...HIDDEN_ABOUT });
    // The self view is complete; an empty bio is null for others.
    expect((await toUserPublic(db, user.id, user.id))!).toMatchObject({
      ...animated,
      bannerUrl,
      bannerAnimatedUrl,
      about: 'about me',
      ...ABOUT_FIELDS,
    });
    await db.update(users).set({ bio: '' }).where(eq(users.id, user.id));
    await setSettings(user, { aboutVisibility: 'everyone' });
    expect((await toUserPublic(db, viewer.id, user.id))!.bio).toBeNull();
    expect((await loadUserSelf(db, user.id)).bio).toBe('');
  });

  it('a block either way and deletion null the new fields too', async () => {
    const { user } = await subjectWithProfile();
    await setPresenceNote(user, { text: 'hi' });
    const sock = await t.connect(user);
    await block(user, viewer);
    let p = (await toUserPublic(db, viewer.id, user.id))!;
    expect(gated(p)).toEqual({ ...HIDDEN_PHOTO, ...HIDDEN_ABOUT, phone: null, ...HIDDEN_PRESENCE });
    await db.delete(blocks).where(eq(blocks.blockerId, user.id));
    await block(viewer, user);
    p = (await toUserPublic(db, viewer.id, user.id))!;
    expect(p).toMatchObject({ ...HIDDEN_PRESENCE, isBlocked: true, ...ABOUT_FIELDS });
    expect(p.bannerUrl).not.toBeNull();
    await db.delete(blocks).where(eq(blocks.blockerId, viewer.id));
    p = (await toUserPublic(db, viewer.id, user.id))!;
    expect(p).toMatchObject({
      online: true,
      presenceState: 'online',
      presenceNote: { text: 'hi', emoji: null, expiresAt: null },
    });
    await goOffline(user, sock);
    await db.transaction((tx) => scrubDeletedUser(tx, user.id));
    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row).toMatchObject({
      bannerMediaId: null,
      pronouns: null,
      bio: '',
      profileColor: null,
      accentColor: null,
      availability: 'online',
      availabilityUntil: null,
      presenceNoteText: null,
      presenceNoteEmoji: null,
      presenceNoteExpiresAt: null,
    });
    p = (await toUserPublic(db, viewer.id, user.id))!;
    expect(gated(p)).toEqual({ ...HIDDEN_PHOTO, ...HIDDEN_ABOUT, phone: null, ...HIDDEN_PRESENCE });
    expect(p.createdAt).toBeNull();
  });

  it('buildPresence: invisible ≡ offline, dnd/idle (chosen), the note only while online and unexpired, an expired until = online', async () => {
    const { user } = await subjectWithProfile();
    const presence = async () => (await loadPresences(db, viewer.id, [user.id]))[0]!;
    const base: Presence = {
      userId: user.id,
      online: false,
      state: 'offline',
      note: null,
      lastSeenAt: LAST_SEEN,
    };
    await setPresenceNote(user, { text: 'note', emoji: '📝' });
    expect(await presence()).toEqual(base); // offline: no note
    const sock = await t.connect(user);
    const note = { text: 'note', emoji: '📝', expiresAt: null };
    const live = { ...base, online: true, note, lastSeenAt: null };
    expect(await presence()).toEqual({ ...live, state: 'online' });
    await setAvailability(user, 'dnd');
    expect(await presence()).toEqual({ ...live, state: 'dnd' });
    await setAvailability(user, 'idle');
    expect(await presence()).toEqual({ ...live, state: 'idle' });
    await setAvailability(user, 'dnd', { until: new Date(Date.now() - 1000) });
    expect((await presence()).state).toBe('online');
    await setAvailability(user, 'invisible');
    expect(await presence()).toEqual(base); // connected, yet byte-identical to offline
    expect((await toUserPublic(db, viewer.id, user.id))!).toMatchObject({
      online: false,
      presenceState: 'offline',
      presenceNote: null,
      lastSeenAt: LAST_SEEN,
    });
    // The raw choice and the (unexpired) note reach only the user.
    expect(await loadUserSelf(db, user.id)).toMatchObject({
      availability: 'invisible',
      availabilityUntil: null,
      presenceNote: note,
    });
    await setAvailability(user, 'online');
    await setPresenceNote(user, { text: 'old', expiresAt: new Date(Date.now() - 1000) });
    expect((await presence()).note).toBeNull();
    expect((await loadUserSelf(db, user.id)).presenceNote).toBeNull();
    // Pure form: the relationship hides everything, whatever the row says.
    const row = (await getUserRow(db, user.id))!;
    expect(
      buildPresence(viewer.id, row, { ...NO_RELATIONSHIP, subjectBlockedViewer: true }),
    ).toEqual({ userId: user.id, online: null, state: null, note: null, lastSeenAt: null });
    await goOffline(user, sock);
  });

  it('requireAvatarMedia / requireBannerMedia: animated uploads need a poster; banner types and sizes', async () => {
    const gifNoPoster = await insertImage(viewer.id, {
      mimeType: 'image/gif',
      animated: true,
      poster: false,
    });
    const gif = await insertImage(viewer.id, { mimeType: 'image/gif', animated: true });
    const webp = await insertImage(viewer.id, { mimeType: 'image/webp', animated: true });
    const staticGif = await insertImage(viewer.id, { mimeType: 'image/gif' });
    await expect(requireAvatarMedia(db, gifNoPoster.id, viewer.id)).rejects.toMatchObject({
      status: 400,
    });
    expect((await requireAvatarMedia(db, gif.id, viewer.id)).id).toBe(gif.id);
    expect((await requireAvatarMedia(db, webp.id, viewer.id)).id).toBe(webp.id);
    await expect(requireAvatarMedia(db, staticGif.id, viewer.id)).rejects.toMatchObject({
      status: 400,
    }); // a static GIF is not an avatar type…
    expect((await requireBannerMedia(db, staticGif.id, viewer.id)).id).toBe(staticGif.id); // …but a banner type
    await expect(requireBannerMedia(db, gifNoPoster.id, viewer.id)).rejects.toMatchObject({
      status: 400,
    });
    const bigBanner = await insertImage(viewer.id, { size: MAX_BANNER_BYTES + 1 });
    await expect(requireBannerMedia(db, bigBanner.id, viewer.id)).rejects.toMatchObject({
      status: 400,
    });
    const bigAnimated = await insertImage(viewer.id, {
      mimeType: 'image/gif',
      animated: true,
      size: MAX_ANIMATED_AVATAR_BYTES + 1,
    });
    await expect(requireAvatarMedia(db, bigAnimated.id, viewer.id)).rejects.toMatchObject({
      status: 400,
    });
    const other = await t.createUser();
    await expect(requireBannerMedia(db, gif.id, other.id)).rejects.toMatchObject({ status: 404 });
  });
});
