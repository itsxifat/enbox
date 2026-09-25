/** Helpers shared by the accounts/users/push tests. */
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { media, users } from '../../src/db/schema.js';
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

/** Give a user an avatar (a media row they uploaded) and profile data; returns the avatar URL. */
export async function giveProfile(userId: string, opts: { about?: string; lastSeenAt?: Date } = {}): Promise<string> {
  const [m] = await db
    .insert(media)
    .values({ uploaderId: userId, kind: 'image', mimeType: 'image/png', size: 10, storageKey: `2026/01/${crypto.randomUUID()}.png` })
    .returning();
  await db
    .update(users)
    .set({ avatarMediaId: m!.id, about: opts.about ?? 'about me', lastSeenAt: opts.lastSeenAt ?? new Date('2026-01-01T00:00:00Z') })
    .where(eq(users.id, userId));
  return `/uploads/${m!.storageKey}`;
}

let phoneCounter = 0;
/** A canonical phone number unique within this test file (each file has its own database). */
export function uniquePhone(): string {
  phoneCounter += 1;
  return `+1555${1_000_000 + phoneCounter}`;
}
