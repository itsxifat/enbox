import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import type { Message } from '@enbox/shared';
import { db } from '../../src/db/index.js';
import {
  chatPins,
  media,
  messageReactions,
  messages,
  starredMessages,
} from '../../src/db/schema.js';
import { runDisappearingPurge } from '../../src/jobs/disappearingPurge.js';
import { runMediaGc } from '../../src/jobs/mediaGc.js';
import { startTestServer, type TestServer, type TestUser } from '../helpers.js';
import { createGroup, recordEvents, settle } from '../services/fixtures.js';
import { historyOf, mkMedia, sendOk } from './support.js';

const expire = (ids: string[]) =>
  db
    .update(messages)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where(inArray(messages.id, ids));

describe('disappearing-messages purge job', () => {
  let t: TestServer;
  let alice: TestUser;
  let bob: TestUser;

  beforeAll(async () => {
    t = await startTestServer();
    alice = await t.createUser({ displayName: 'Alice' });
    bob = await t.createUser({ displayName: 'Bob' });
  });
  afterAll(() => t.close());

  it('hard-deletes expired messages (cascades), emits message:removed per chat and chat:pins when a pin went away', async () => {
    const g1 = await createGroup(alice, [bob], { disappearingSeconds: 86_400 });
    const g2 = await createGroup(alice, [bob], { disappearingSeconds: 86_400 });
    const file = await mkMedia(alice.id, 'image', {
      createdAt: new Date(Date.now() - 2 * 86_400_000),
    });
    const a = await sendOk(t, alice, g1, { type: 'image', mediaId: file.id, text: 'photo' });
    const b = await sendOk(t, bob, g1, 'text');
    const keep = await sendOk(t, bob, g1, 'not yet');
    const reply = await sendOk(t, alice, g1, { text: 'quoting', replyToId: b.id });
    const c = await sendOk(t, alice, g2, 'other chat');
    await t.api(bob).put(`/api/messages/${a.id}/reaction`).send({ emoji: '👍' }).expect(200);
    await t.api(bob).put(`/api/messages/${b.id}/star`).expect(204);
    await t.api(alice).post(`/api/chats/${g1}/pins`).send({ messageId: a.id }).expect(200);
    await t.api(alice).post(`/api/chats/${g1}/pins`).send({ messageId: keep.id }).expect(200);
    await expire([a.id, b.id, c.id]);

    const bs = await t.connect(bob);
    const log = recordEvents(bs);
    // Expired messages are already invisible before the purge runs.
    expect((await historyOf(t, bob, g1)).map((m) => m.id)).not.toContain(a.id);

    const purged = await runDisappearingPurge();
    expect(purged).toBe(3);
    await settle();
    const removed = log.of('message:removed');
    expect(removed).toHaveLength(2);
    expect(removed.find((r) => r.chatId === g1)!.messageIds.sort()).toEqual([a.id, b.id].sort());
    expect(removed.find((r) => r.chatId === g2)!.messageIds).toEqual([c.id]);
    expect(log.of('chat:pins')).toEqual([{ chatId: g1, messageIds: [keep.id] }]);
    const names = log.names().filter((n) => n === 'message:removed' || n === 'chat:pins');
    expect(names.indexOf('message:removed')).toBeLessThan(names.indexOf('chat:pins'));

    expect(
      await db
        .select()
        .from(messages)
        .where(inArray(messages.id, [a.id, b.id, c.id])),
    ).toEqual([]);
    expect(
      await db.select().from(messageReactions).where(eq(messageReactions.messageId, a.id)),
    ).toEqual([]);
    expect(
      await db.select().from(starredMessages).where(eq(starredMessages.messageId, b.id)),
    ).toEqual([]);
    expect(
      (await db.select().from(chatPins).where(eq(chatPins.chatId, g1))).map((p) => p.messageId),
    ).toEqual([keep.id]);
    // Replies to a purged message lose their quote.
    const history = await historyOf(t, bob, g1);
    expect(history.find((m: Message) => m.id === reply.id)!.replyTo).toBeNull();
    expect(history.map((m) => m.id)).toContain(keep.id);

    // The media is no longer referenced → collected by the media GC.
    expect(await runMediaGc({ ttlMs: 60_000 })).toBeGreaterThanOrEqual(1);
    expect(await db.select().from(media).where(eq(media.id, file.id))).toEqual([]);

    // Nothing left to do; idempotent.
    expect(await runDisappearingPurge()).toBe(0);
    bs.disconnect();
  });

  it('loops over full batches', async () => {
    const g = await createGroup(alice, [bob]);
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) ids.push((await sendOk(t, alice, g, `m${i}`)).id);
    await expire(ids);
    const bs = await t.connect(bob);
    const log = recordEvents(bs);
    expect(await runDisappearingPurge({ batchSize: 3 })).toBe(7);
    await settle();
    expect(
      log
        .of('message:removed')
        .flatMap((r) => r.messageIds)
        .sort(),
    ).toEqual([...ids].sort());
    expect(log.of('message:removed')).toHaveLength(3);
    bs.disconnect();
  });

  it('keeps messages that have not expired or never expire', async () => {
    const g = await createGroup(alice, [bob], { disappearingSeconds: 86_400 });
    const m = await sendOk(t, alice, g, 'tomorrow');
    const before = await db.select().from(messages).where(eq(messages.chatId, g));
    expect(await runDisappearingPurge()).toBe(0);
    expect(await db.select().from(messages).where(eq(messages.chatId, g))).toHaveLength(
      before.length,
    );
    expect((await historyOf(t, bob, g)).map((x) => x.id)).toContain(m.id);
  });
});
