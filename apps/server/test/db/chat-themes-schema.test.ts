/**
 * 0002_chat_themes: the shared theme on `chats`, the private theme/wallpaper columns on
 * `chat_members`, the wallpaper FK and its partial index (docs/design/ux-programme.md
 * "Data model → 0002_chat_themes"). The fresh PGlite behind startTestServer() applied every
 * migration in apps/server/drizzle, so this also proves the migration chain is consistent.
 * The membership cases pin the documented lifecycle: a rejoin keeps the prefs, an unfollow
 * deletes the row (and the follower's theme/wallpaper with it).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import type { ChatTheme, SharedChatTheme } from '@enbox/shared';
import { db } from '../../src/db/index.js';
import { chatMembers, chats, media } from '../../src/db/schema.js';
import { transact } from '../../src/services/effects.js';
import { upsertMembership } from '../../src/services/membership.js';
import { rawRows } from '../../src/services/sql.js';
import { startTestServer, type TestServer, type TestUser } from '../helpers.js';
import { createChannel, createGroup, memberRow } from '../services/fixtures.js';

const privateTheme: ChatTheme = {
  preset: 'ocean',
  bubbleStyle: 'rounded',
  accent: '#1a2b3c',
  wallpaper: { kind: 'media' },
  dim: 40,
  blur: 8,
  messageAnimation: 'pop',
};
const sharedTheme: SharedChatTheme = {
  preset: 'forest',
  bubbleStyle: null,
  accent: null,
  wallpaper: { kind: 'preset', id: 'aurora' },
  dim: 0,
  blur: 0,
  messageAnimation: 'fade',
};

describe('db/0002_chat_themes', () => {
  let t: TestServer;
  let alice: TestUser;
  let bob: TestUser;

  beforeAll(async () => {
    t = await startTestServer();
    alice = await t.createUser();
    bob = await t.createUser();
  });
  afterAll(() => t.close());

  const chatRow = async (chatId: string) =>
    (await db.select().from(chats).where(eq(chats.id, chatId)))[0]!;
  const memberWhere = (chatId: string, userId: string) =>
    and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, userId));
  const insertMedia = async () =>
    (
      await db
        .insert(media)
        .values({
          uploaderId: bob.id,
          kind: 'image',
          mimeType: 'image/webp',
          size: 1,
          storageKey: `test/${crypto.randomUUID()}.webp`,
        })
        .returning()
    )[0]!;

  it('defaults the new columns to null', async () => {
    const chatId = await createGroup(alice, [bob]);
    expect((await chatRow(chatId)).theme).toBeNull();
    expect(await memberRow(chatId, bob)).toMatchObject({ theme: null, wallpaperMediaId: null });
  });

  it('round-trips the shared and private themes through jsonb', async () => {
    const chatId = await createGroup(alice, [bob]);
    await db.update(chats).set({ theme: sharedTheme }).where(eq(chats.id, chatId));
    expect((await chatRow(chatId)).theme).toEqual(sharedTheme);
    await db.update(chatMembers).set({ theme: privateTheme }).where(memberWhere(chatId, bob.id));
    expect((await memberRow(chatId, bob)).theme).toEqual(privateTheme);
    // Bob's override is his own row: Alice's stays untouched.
    expect((await memberRow(chatId, alice)).theme).toBeNull();
    await db.update(chats).set({ theme: null }).where(eq(chats.id, chatId));
    await db.update(chatMembers).set({ theme: null }).where(memberWhere(chatId, bob.id));
    expect((await chatRow(chatId)).theme).toBeNull();
    expect((await memberRow(chatId, bob)).theme).toBeNull();
  });

  it('links the wallpaper (relation + SET NULL on media delete)', async () => {
    const chatId = await createGroup(alice, [bob]);
    const m = await insertMedia();
    await db.update(chatMembers).set({ wallpaperMediaId: m.id }).where(memberWhere(chatId, bob.id));
    const withWallpaper = await db.query.chatMembers.findFirst({
      where: memberWhere(chatId, bob.id),
      with: { wallpaper: true },
    });
    expect(withWallpaper?.wallpaper?.id).toBe(m.id);
    await db.delete(media).where(eq(media.id, m.id));
    expect((await memberRow(chatId, bob)).wallpaperMediaId).toBeNull();
  });

  it('creates the partial index for the wallpaper', async () => {
    const rows = await rawRows<{ indexname: string; indexdef: string }>(
      db,
      sql`select indexname, indexdef from pg_indexes
          where tablename = 'chat_members' and indexname = 'chat_members_wallpaper_idx'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.indexdef).toMatch(
      /\(wallpaper_media_id\) WHERE \(wallpaper_media_id IS NOT NULL\)$/,
    );
  });

  it('keeps the theme and wallpaper across a leave + rejoin', async () => {
    const chatId = await createGroup(alice, [bob]);
    const m = await insertMedia();
    await db
      .update(chatMembers)
      .set({ theme: privateTheme, wallpaperMediaId: m.id })
      .where(memberWhere(chatId, bob.id));
    await transact((tx, fx) =>
      upsertMembership(tx, fx, {
        kind: 'deactivate',
        chatId,
        userId: bob.id,
        reason: 'left',
        systemEvent: { kind: 'member_left', actorId: bob.id },
      }),
    );
    expect(await memberRow(chatId, bob)).toMatchObject({
      leftReason: 'left',
      theme: privateTheme,
      wallpaperMediaId: m.id,
    });
    await transact((tx, fx) =>
      upsertMembership(tx, fx, {
        kind: 'activate',
        chatId,
        userIds: [bob.id],
        addedBy: alice.id,
        systemEvent: { kind: 'members_added', actorId: alice.id, userIds: [bob.id] },
      }),
    );
    expect(await memberRow(chatId, bob)).toMatchObject({
      leftAt: null,
      theme: privateTheme,
      wallpaperMediaId: m.id,
    });
  });

  it('loses a channel follower’s theme and wallpaper with the row on unfollow', async () => {
    const channelId = await createChannel(alice);
    const m = await insertMedia();
    await transact((tx, fx) =>
      upsertMembership(tx, fx, { kind: 'activate', chatId: channelId, userIds: [bob.id] }),
    );
    await db
      .update(chatMembers)
      .set({ theme: privateTheme, wallpaperMediaId: m.id })
      .where(memberWhere(channelId, bob.id));
    await transact((tx, fx) =>
      upsertMembership(tx, fx, { kind: 'unfollow', chatId: channelId, userId: bob.id }),
    );
    expect(await db.select().from(chatMembers).where(memberWhere(channelId, bob.id))).toHaveLength(
      0,
    );
    // Following again starts from a clean row.
    await transact((tx, fx) =>
      upsertMembership(tx, fx, { kind: 'activate', chatId: channelId, userIds: [bob.id] }),
    );
    expect(await memberRow(channelId, bob)).toMatchObject({ theme: null, wallpaperMediaId: null });
  });
});
