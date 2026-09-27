/** Helpers shared by the accounts/users/push tests. */
import { and, eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { chatMembers, media, users, type MediaRow } from '../../src/db/schema.js';
import { createSession } from '../../src/services/sessions.js';
import type { TestSocket, TestUser } from '../helpers.js';

/** Another signed-in device of the same user (a new session with its own token). */
export async function newDevice(user: TestUser, deviceName = 'Second device'): Promise<TestUser> {
  const { token, session } = await createSession({ userId: user.id, deviceName });
  return { ...user, token, sessionId: session.id };
}

/** Resolves with the disconnect reason once the server drops the socket. */
export function waitDisconnect(socket: TestSocket, timeoutMs = 3000): Promise<string> {
  if (socket.disconnected) return Promise.resolve('already disconnected');
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('socket was not disconnected')), timeoutMs);
    socket.once('disconnect', (reason) => {
      clearTimeout(timer);
      resolve(String(reason));
    });
  });
}

/**
 * Insert an image media row uploaded by `userId` (as `POST /api/media` would store it). An
 * animated one gets its static poster (`thumbnail_key`) unless `poster: false`.
 */
export async function insertImage(
  userId: string,
  opts: { mimeType?: string; animated?: boolean; poster?: boolean; size?: number } = {},
): Promise<MediaRow> {
  const mimeType = opts.mimeType ?? 'image/png';
  const key = `2026/01/${crypto.randomUUID()}`;
  const [m] = await db
    .insert(media)
    .values({
      uploaderId: userId,
      kind: 'image',
      mimeType,
      size: opts.size ?? 10,
      storageKey: `${key}.${mimeType.split('/')[1]}`,
      animated: opts.animated ?? false,
      thumbnailKey: opts.animated && opts.poster !== false ? `${key}.jpg` : null,
    })
    .returning();
  return m!;
}

/** Give a member a private chat theme and a (static) wallpaper upload in `chatId`; returns the media id. */
export async function giveWallpaper(userId: string, chatId: string): Promise<string> {
  const m = await insertImage(userId, { mimeType: 'image/jpeg' });
  await db
    .update(chatMembers)
    .set({
      theme: {
        preset: 'ocean',
        bubbleStyle: null,
        accent: null,
        dim: 0,
        blur: 0,
        messageAnimation: null,
        wallpaper: { kind: 'media' },
      },
      wallpaperMediaId: m.id,
    })
    .where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, userId)));
  return m.id;
}

/**
 * Give a user a (static) avatar and profile data — about, last seen, and optionally the P1
 * profile fields; returns the avatar URL.
 */
export async function giveProfile(
  userId: string,
  opts: {
    about?: string;
    lastSeenAt?: Date;
    pronouns?: string;
    bio?: string;
    profileColor?: string;
    accentColor?: string;
  } = {},
): Promise<string> {
  const m = await insertImage(userId);
  await db
    .update(users)
    .set({
      avatarMediaId: m.id,
      about: opts.about ?? 'about me',
      lastSeenAt: opts.lastSeenAt ?? new Date('2026-01-01T00:00:00Z'),
      ...(opts.pronouns !== undefined ? { pronouns: opts.pronouns } : {}),
      ...(opts.bio !== undefined ? { bio: opts.bio } : {}),
      ...(opts.profileColor !== undefined ? { profileColor: opts.profileColor } : {}),
      ...(opts.accentColor !== undefined ? { accentColor: opts.accentColor } : {}),
    })
    .where(eq(users.id, userId));
  return `/uploads/${m.storageKey}`;
}

/** Give a user a banner (static, or animated with a poster); returns its wire URLs. */
export async function giveBanner(
  userId: string,
  animated = false,
): Promise<{ bannerUrl: string; bannerAnimatedUrl: string | null }> {
  const m = await insertImage(userId, {
    mimeType: animated ? 'image/gif' : 'image/jpeg',
    animated,
  });
  await db.update(users).set({ bannerMediaId: m.id }).where(eq(users.id, userId));
  return {
    bannerUrl: `/uploads/${animated ? m.thumbnailKey : m.storageKey}`,
    bannerAnimatedUrl: animated ? `/uploads/${m.storageKey}` : null,
  };
}

/** Replace a user's avatar with an animated one (poster included); returns its wire URLs. */
export async function giveAnimatedAvatar(
  userId: string,
): Promise<{ avatarUrl: string; avatarAnimatedUrl: string }> {
  const m = await insertImage(userId, { mimeType: 'image/gif', animated: true });
  await db.update(users).set({ avatarMediaId: m.id }).where(eq(users.id, userId));
  return { avatarUrl: `/uploads/${m.thumbnailKey}`, avatarAnimatedUrl: `/uploads/${m.storageKey}` };
}

let phoneCounter = 0;
/** A canonical phone number unique within this test file (each file has its own database). */
export function uniquePhone(): string {
  phoneCounter += 1;
  return `+1555${1_000_000 + phoneCounter}`;
}
