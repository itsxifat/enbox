/**
 * Helpers for the groups / communities / channels / invites tests.
 */
import { expect } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import type { ApiErrorCode, ChatSummary } from '@enbox/shared';
import { db } from '../../src/db/index.js';
import { chatMembers, communityMembers, messages } from '../../src/db/schema.js';
import { toChatSummary } from '../../src/services/summaries.js';
import type { TestServer, TestSocket, TestUser } from '../helpers.js';
import { goOffline } from '../services/fixtures.js';
import { ANIMATED_GIF, JPEG_EXIF } from '../support/images.js';

export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

/** Assert an API error response. */
export function expectError(
  res: { status: number; body: { error?: { code: string } } },
  status: number,
  code: ApiErrorCode,
): void {
  expect({ status: res.status, code: res.body.error?.code }).toEqual({ status, code });
}

/** Upload a PNG as `user` — or, `animated`, a two-frame GIF with a JPEG poster — and return the media id. */
export async function uploadImage(
  t: TestServer,
  user: TestUser,
  opts: { animated?: boolean } = {},
): Promise<string> {
  const req = t.api(user).post('/api/media').field('kind', 'image');
  const res = await (
    opts.animated
      ? req
          .attach('file', ANIMATED_GIF, { filename: 'a.gif', contentType: 'image/gif' })
          .attach('thumbnail', JPEG_EXIF, { filename: 'poster.jpg', contentType: 'image/jpeg' })
      : req.attach('file', PNG, { filename: 'a.png', contentType: 'image/png' })
  ).expect(201);
  return res.body.id as string;
}

let bulkCounter = 0;

/** Insert `n` users directly (fast; no sessions). */
export async function bulkUsers(n: number): Promise<string[]> {
  const prefix = `bulk${++bulkCounter}_${Math.random().toString(36).slice(2, 6)}_`;
  const res = await db.execute(
    sql`insert into users (username, display_name, password_hash, about)
        select ${prefix} || g, ${prefix} || g, '!', '' from generate_series(1, ${n}) g returning id`,
  );
  return (res.rows as { id: string }[]).map((r) => r.id);
}

/** Make users active members of a chat directly (capacity tests; no events). */
export async function bulkJoin(chatId: string, userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  await db.insert(chatMembers).values(userIds.map((userId) => ({ chatId, userId })));
}

/** Make users community members directly (capacity tests; no events). */
export async function bulkCommunityJoin(
  communityId: string,
  annChatId: string,
  userIds: string[],
): Promise<void> {
  if (userIds.length === 0) return;
  await db.insert(communityMembers).values(userIds.map((userId) => ({ communityId, userId })));
  await bulkJoin(annChatId, userIds);
}

export async function summary(
  userId: string | { id: string },
  chatId: string,
): Promise<ChatSummary | null> {
  return toChatSummary(db, typeof userId === 'string' ? userId : userId.id, chatId);
}

/** System event kinds of a chat, in seq order. */
export async function systemKinds(chatId: string): Promise<string[]> {
  const rows = await db
    .select({ seq: messages.seq, metadata: messages.metadata })
    .from(messages)
    .where(and(eq(messages.chatId, chatId), eq(messages.type, 'system')))
    .orderBy(messages.seq);
  return rows.map((r) => r.metadata.system!.kind);
}

/** Connect sockets for several users (returned in order); `close()` takes them offline. */
export async function connectAll(t: TestServer, ...users: TestUser[]) {
  const sockets: TestSocket[] = [];
  for (const u of users) sockets.push(await t.connect(u));
  return {
    sockets,
    async close() {
      for (let i = 0; i < users.length; i++) await goOffline(users[i]!, sockets[i]!);
    },
  };
}
