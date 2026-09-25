/**
 * Helpers for the chats/messages REST + socket tests (build on test/helpers.ts and the
 * service fixtures in test/services/fixtures.ts).
 */
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { ChatSummary, MediaKind, Message } from '@enbox/shared';
import { db } from '../../src/db/index.js';
import { chatMembers, media, statuses } from '../../src/db/schema.js';
import { transact } from '../../src/services/effects.js';
import { upsertMembership } from '../../src/services/membership.js';
import type { TestServer, TestUser } from '../helpers.js';

const MIME: Record<MediaKind, string> = {
  image: 'image/png',
  video: 'video/mp4',
  audio: 'audio/mpeg',
  voice: 'audio/ogg',
  file: 'application/pdf',
};

/** Insert a media row uploaded by `uploaderId` (no file on disk; enough for message tests). */
export async function mkMedia(
  uploaderId: string,
  kind: MediaKind = 'image',
  extra: Partial<typeof media.$inferInsert> = {},
) {
  const [row] = await db
    .insert(media)
    .values({
      uploaderId,
      kind,
      mimeType: MIME[kind],
      fileName: `${kind}.bin`,
      size: 10,
      storageKey: `test/${randomUUID()}.bin`,
      ...extra,
    })
    .returning();
  return row!;
}

/** Insert a live text status by `authorId` visible to `audience`. */
export async function mkStatus(
  authorId: string,
  audience: string[],
  opts: { expiresAt?: Date; text?: string } = {},
) {
  const [row] = await db
    .insert(statuses)
    .values({
      userId: authorId,
      type: 'text',
      text: opts.text ?? 'my status',
      backgroundColor: '#6D5DFC',
      font: 1,
      audience,
      expiresAt: opts.expiresAt ?? new Date(Date.now() + 60 * 60_000),
    })
    .returning();
  return row!;
}

let clientSeq = 0;
export const newClientId = () => `cid-${++clientSeq}-${randomUUID().slice(0, 8)}`;

/** `POST /api/chats/:chatId/messages` (default: a text message with a fresh clientId). */
export function sendReq(
  t: TestServer,
  user: TestUser,
  chatId: string,
  body: Record<string, unknown> = {},
) {
  const merged: Record<string, unknown> = { type: 'text', clientId: newClientId(), ...body };
  if (merged.type === 'text' && !('text' in merged)) merged.text = 'hello';
  return t.api(user).post(`/api/chats/${chatId}/messages`).send(merged);
}

/** Send and expect 201; returns the Message. */
export async function sendOk(
  t: TestServer,
  user: TestUser,
  chatId: string,
  body: Record<string, unknown> | string = {},
): Promise<Message> {
  const res = await sendReq(t, user, chatId, typeof body === 'string' ? { text: body } : body);
  if (res.status !== 201) throw new Error(`send failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as Message;
}

/** `POST /api/chats/direct` as `a` with `b`; returns the summary. */
export async function openDirect(t: TestServer, a: TestUser, b: TestUser): Promise<ChatSummary> {
  const res = await t.api(a).post('/api/chats/direct').send({ userId: b.id }).expect(200);
  return res.body as ChatSummary;
}

/** A direct chat where both rows are visible (one message from `a`). */
export async function activeDirect(t: TestServer, a: TestUser, b: TestUser): Promise<string> {
  const chat = await openDirect(t, a, b);
  await sendOk(t, a, chat.id, 'hi');
  return chat.id;
}

/** Add users to a group through the membership pipeline (members_added). */
export function addToGroup(chatId: string, actor: TestUser, users: TestUser[]) {
  return transact((tx, fx) =>
    upsertMembership(tx, fx, {
      kind: 'activate',
      chatId,
      userIds: users.map((u) => u.id),
      addedBy: actor.id,
      systemEvent: { kind: 'members_added', actorId: actor.id, userIds: users.map((u) => u.id) },
    }),
  );
}

/** Make `user` leave (or be removed from) a group through the membership pipeline. */
export function leaveGroup(chatId: string, user: TestUser, removedBy?: TestUser) {
  return transact((tx, fx) =>
    upsertMembership(
      tx,
      fx,
      removedBy
        ? {
            kind: 'deactivate',
            chatId,
            userId: user.id,
            reason: 'removed',
            systemEvent: { kind: 'member_removed', actorId: removedBy.id, userId: user.id },
          }
        : {
            kind: 'deactivate',
            chatId,
            userId: user.id,
            reason: 'left',
            systemEvent: { kind: 'member_left', actorId: user.id },
          },
    ),
  );
}

/** Follow a channel through the membership pipeline. */
export function follow(chatId: string, users: TestUser[]) {
  return transact((tx, fx) =>
    upsertMembership(tx, fx, { kind: 'activate', chatId, userIds: users.map((u) => u.id) }),
  );
}

export async function memberOf(chatId: string, user: TestUser) {
  const [row] = await db
    .select()
    .from(chatMembers)
    .where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, user.id)));
  return row;
}

/** Fetch the viewer's summary of a chat (expects 200). */
export async function summaryOf(
  t: TestServer,
  user: TestUser,
  chatId: string,
): Promise<ChatSummary> {
  return (await t.api(user).get(`/api/chats/${chatId}`).expect(200)).body as ChatSummary;
}

/** Fetch the viewer's latest page of a chat (expects 200). */
export async function historyOf(
  t: TestServer,
  user: TestUser,
  chatId: string,
  query = '',
): Promise<Message[]> {
  return (await t.api(user).get(`/api/chats/${chatId}/messages${query}`).expect(200)).body
    .messages as Message[];
}
