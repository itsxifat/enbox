import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { mentionToken, type Message } from '@enbox/shared';
import { db } from '../../src/db/index.js';
import {
  chatMembers,
  chatPins,
  chats,
  media,
  messageHidden,
  messageReactions,
  messages,
  pollVotes,
  starredMessages,
  statuses,
} from '../../src/db/schema.js';
import { transact } from '../../src/services/effects.js';
import { domainEvents } from '../../src/services/events.js';
import {
  buildContactCard,
  buildPollDefinition,
  createMessage,
  deleteForEveryoneTx,
  deleteForMeTx,
  loadMessagePage,
  loadVisibleMessage,
  previewText,
  resolveReplyTarget,
  toMessages,
} from '../../src/services/messages.js';
import { upsertMembership } from '../../src/services/membership.js';
import {
  startTestServer,
  waitForEvent,
  expectNoEvent,
  type TestServer,
  type TestUser,
} from '../helpers.js';
import {
  block,
  createChannel,
  createDirect,
  createGroup,
  memberRow,
  recordEvents,
  send,
  settle,
} from './fixtures.js';

describe('services/messages', () => {
  let t: TestServer;
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;

  beforeAll(async () => {
    t = await startTestServer();
    alice = await t.createUser({ displayName: 'Alice' });
    bob = await t.createUser({ displayName: 'Bob' });
    carol = await t.createUser({ displayName: 'Carol' });
  });
  afterAll(() => t.close());

  describe('createMessage', () => {
    it('allocates gapless, unique seqs under 20 concurrent sends', async () => {
      const chatId = await createGroup(alice, [bob, carol]);
      const [before] = await db.select().from(chats).where(eq(chats.id, chatId));
      const senders = [alice, bob, carol];
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, i) => send(senders[i % 3]!, chatId, `m${i}`)),
      );
      const seqs = results.map((r) => Number(r.message.seq)).sort((a, b) => a - b);
      const start = Number(before!.lastSeq);
      expect(seqs).toEqual(Array.from({ length: 20 }, (_, i) => start + 1 + i));
      const [after] = await db.select().from(chats).where(eq(chats.id, chatId));
      expect(Number(after!.lastSeq)).toBe(start + 20);
      expect(after!.lastMessageAt).not.toBeNull();
      const rows = await db.select().from(messages).where(eq(messages.chatId, chatId));
      expect(new Set(rows.map((r) => r.seq)).size).toBe(rows.length);
    });

    it('is idempotent per (chat, sender, clientId): no seq burned, no events', async () => {
      const chatId = await createGroup(alice, [bob]);
      const bobSock = await t.connect(bob);
      const first = await send(alice, chatId, { clientId: 'same-id', text: 'once' });
      expect(first.created).toBe(true);
      await waitForEvent(bobSock, 'message:new', {
        filter: (p) => p.message.id === first.message.id,
      });
      const [c1] = await db.select().from(chats).where(eq(chats.id, chatId));
      const retry = await send(alice, chatId, { clientId: 'same-id', text: 'twice' });
      expect(retry.created).toBe(false);
      expect(retry.message.id).toBe(first.message.id);
      expect(retry.message.text).toBe('once');
      const [c2] = await db.select().from(chats).where(eq(chats.id, chatId));
      expect(c2!.lastSeq).toBe(c1!.lastSeq);
      await expectNoEvent(bobSock, 'message:new');
      // Another sender may reuse the same clientId.
      const other = await send(bob, chatId, { clientId: 'same-id', text: 'bob' });
      expect(other.created).toBe(true);
      bobSock.disconnect();
    });

    it('sets expires_at from the chat timer, never for system/call messages', async () => {
      const chatId = await createGroup(alice, [bob], { disappearingSeconds: 86_400 });
      const { message } = await send(alice, chatId, 'vanishing');
      expect(message.expiresAt).not.toBeNull();
      expect(message.expiresAt!.getTime() - message.createdAt.getTime()).toBe(86_400_000);
      const sys = await db
        .select()
        .from(messages)
        .where(and(eq(messages.chatId, chatId), eq(messages.type, 'system')));
      expect(sys.length).toBeGreaterThan(0);
      expect(sys.every((m) => m.expiresAt === null)).toBe(true);
      const call = await send(alice, chatId, {
        type: 'call',
        text: null,
        clientId: null,
        metadata: {
          call: {
            callId: crypto.randomUUID(),
            callType: 'audio',
            isGroup: true,
            initiatorId: alice.id,
            status: 'ringing',
            durationSec: null,
          },
        },
      });
      expect(call.message.expiresAt).toBeNull();
    });

    it('derives mentions from tokens: active members only, sender excluded, deduped', async () => {
      const outsider = await t.createUser();
      const chatId = await createGroup(alice, [bob, carol]);
      const text = `hi ${mentionToken(bob.id)} ${mentionToken(outsider.id)} ${mentionToken(alice.id)} ${mentionToken(bob.id)} ${mentionToken(carol.id)}`;
      const { message } = await send(alice, chatId, text);
      expect(message.mentions).toEqual([bob.id, carol.id]);
      expect(message.text).toBe(text); // tokens of non-members stay as text
    });

    it('advances the sender watermarks, clears marked_unread and emits chat:read to the sender', async () => {
      const chatId = await createGroup(alice, [bob]);
      await db
        .update(chatMembers)
        .set({ markedUnread: true })
        .where(eq(chatMembers.chatId, chatId));
      const aliceSock = await t.connect(alice);
      const readEvt = waitForEvent(aliceSock, 'chat:read', { filter: (p) => p.chatId === chatId });
      const { message } = await send(alice, chatId, 'x');
      const evt = await readEvt;
      expect(evt).toMatchObject({
        chatId,
        lastReadSeq: Number(message.seq),
        unreadCount: 0,
        markedUnread: false,
      });
      const row = await memberRow(chatId, alice);
      expect(Number(row.lastReadSeq)).toBe(Number(message.seq));
      expect(Number(row.lastDeliveredSeq)).toBe(Number(message.seq));
      expect(row.markedUnread).toBe(false);
      aliceSock.disconnect();
    });

    it('first message of a direct chat unhides the peer: JOIN (chat:upsert) before message:new', async () => {
      const dave = await t.createUser();
      const chatId = await createDirect(alice, dave);
      expect((await memberRow(chatId, dave)).hidden).toBe(true);
      const daveSock = await t.connect(dave);
      const rec = recordEvents(daveSock);
      const { message } = await send(alice, chatId, 'hi dave');
      await settle();
      const names = rec.names().filter((n) => n === 'chat:upsert' || n === 'message:new');
      expect(names).toEqual(['chat:upsert', 'message:new']);
      const upsert = rec.of('chat:upsert')[0]!;
      expect(upsert.chat.id).toBe(chatId);
      expect(upsert.chat.lastMessage?.id).toBe(message.id);
      expect(upsert.chat.unreadCount).toBe(1);
      expect((await memberRow(chatId, dave)).hidden).toBe(false);
      daveSock.disconnect();
    });

    it('withholds messages from a recipient who blocked the sender (hidden row, no event, stays hidden, single tick)', async () => {
      const eve = await t.createUser();
      const chatId = await createDirect(alice, eve);
      await block(eve, alice);
      const eveSock = await t.connect(eve);
      const created: string[] = [];
      const off = domainEvents.on(
        'message.created',
        (e) => void created.push(...e.withheldUserIds),
      );
      const { message } = await send(alice, chatId, 'you blocked me');
      off();
      await expectNoEvent(eveSock, 'message:new');
      await expectNoEvent(eveSock, 'chat:upsert', 50);
      expect(created).toEqual([eve.id]);
      const hidden = await db
        .select()
        .from(messageHidden)
        .where(eq(messageHidden.messageId, message.id));
      expect(hidden.map((h) => h.userId)).toEqual([eve.id]);
      const row = await memberRow(chatId, eve);
      expect(row.hidden).toBe(true);
      expect(Number(row.lastDeliveredSeq)).toBe(0); // online, but withheld: never delivered
      await expect(loadVisibleMessage(db, eve.id, message.id)).rejects.toMatchObject({
        status: 404,
      });
      eveSock.disconnect();
    });

    it('emits message.created with recipients (sender and withheld excluded; channels: none)', async () => {
      const chatId = await createGroup(alice, [bob, carol]);
      const events: { recipients: string[]; chatType: string }[] = [];
      const off = domainEvents.on(
        'message.created',
        (e) => void events.push({ recipients: e.recipientIds, chatType: e.chat.type }),
      );
      await send(alice, chatId, 'x');
      const channelId = await createChannel(alice);
      await send(alice, channelId, 'post');
      off();
      expect(events[0]!.recipients.sort()).toEqual([bob.id, carol.id].sort());
      expect(events.at(-1)).toEqual({ recipients: [], chatType: 'channel' });
    });

    it('does not emit anything when the transaction rolls back', async () => {
      const chatId = await createGroup(alice, [bob]);
      const bobSock = await t.connect(bob);
      await expect(
        transact(async (tx, fx) => {
          await createMessage(tx, fx, {
            chatId,
            senderId: alice.id,
            type: 'text',
            text: 'never',
            clientId: 'rb',
          });
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      await expectNoEvent(bobSock, 'message:new');
      const rows = await db
        .select()
        .from(messages)
        .where(and(eq(messages.chatId, chatId), eq(messages.clientId, 'rb')));
      expect(rows).toHaveLength(0);
      bobSock.disconnect();
    });
  });

  describe('toMessages', () => {
    it('serializes viewer-neutral vs viewer-specific fields', async () => {
      const chatId = await createGroup(alice, [bob]);
      const { message } = await send(alice, chatId, 'react to me');
      await db.insert(messageReactions).values([
        {
          messageId: message.id,
          userId: bob.id,
          emoji: '👍',
          createdAt: new Date(Date.now() - 2000),
        },
        {
          messageId: message.id,
          userId: alice.id,
          emoji: '👍',
          createdAt: new Date(Date.now() - 1000),
        },
      ]);
      await db.insert(starredMessages).values({ userId: bob.id, messageId: message.id });
      const [neutral] = await toMessages(db, null, [message]);
      expect(neutral).not.toHaveProperty('starred');
      expect(neutral).not.toHaveProperty('myReaction');
      expect(neutral!.reactions).toEqual([{ emoji: '👍', count: 2, userIds: [bob.id, alice.id] }]);
      expect(neutral!.senderId).toBe(alice.id);
      const [forBob] = await toMessages(db, bob.id, [message]);
      expect(forBob!.starred).toBe(true);
      expect(forBob!.myReaction).toBe('👍');
      const [forCarol] = await toMessages(db, carol.id, [message]);
      expect(forCarol!.starred).toBe(false);
      expect(forCarol!.myReaction).toBeNull();
    });

    it('keeps channel posts anonymous: senderId null, reaction userIds and poll voterIds []', async () => {
      const channelId = await createChannel(alice);
      await transact((tx, fx) =>
        upsertMembership(tx, fx, {
          kind: 'activate',
          chatId: channelId,
          userIds: [bob.id, carol.id],
        }),
      );
      const poll = buildPollDefinition({ question: 'Q?', options: ['a', 'b'] });
      const { message } = await send(alice, channelId, {
        type: 'poll',
        text: null,
        metadata: { poll },
      });
      await db.insert(pollVotes).values([
        { messageId: message.id, userId: bob.id, optionId: poll.options[0]!.id },
        { messageId: message.id, userId: carol.id, optionId: poll.options[0]!.id },
      ]);
      await db
        .insert(messageReactions)
        .values({ messageId: message.id, userId: bob.id, emoji: '❤️' });
      const [m] = await toMessages(db, bob.id, [message]);
      expect(m!.senderId).toBeNull();
      expect(m!.reactions).toEqual([{ emoji: '❤️', count: 1, userIds: [] }]);
      expect(m!.poll!.options[0]).toMatchObject({ voteCount: 2, voterIds: [] });
      expect(m!.poll!.options[1]).toMatchObject({ voteCount: 0, voterIds: [] });
      expect(m!.poll!.totalVoters).toBe(2);
      expect(m!.poll!.myOptionIds).toEqual([poll.options[0]!.id]);
      expect(m!.myReaction).toBe('❤️');

      // Same data in a group: voters are listed.
      const groupId = await createGroup(alice, [bob]);
      const g = await send(alice, groupId, { type: 'poll', text: null, metadata: { poll } });
      await db
        .insert(pollVotes)
        .values({ messageId: g.message.id, userId: bob.id, optionId: poll.options[1]!.id });
      const [gm] = await toMessages(db, null, [g.message]);
      expect(gm!.senderId).toBe(alice.id);
      expect(gm!.poll!.options[1]!.voterIds).toEqual([bob.id]);
      expect(gm!.poll).not.toHaveProperty('myOptionIds');
    });

    it('computes replyTo at read time (chatId+seq, truncation, deleted, expired, purged)', async () => {
      const chatId = await createGroup(alice, [bob]);
      const long = `${'x'.repeat(190)} ${mentionToken(bob.id)} tail`;
      const target = await send(bob, chatId, long);
      const reply = await send(alice, chatId, { text: 'answer', replyToId: target.message.id });
      let [m] = await toMessages(db, null, [reply.message]);
      expect(m!.replyTo).toMatchObject({
        id: target.message.id,
        chatId,
        seq: Number(target.message.seq),
        senderId: bob.id,
        type: 'text',
        deleted: false,
      });
      expect(m!.replyTo!.text!.endsWith('…')).toBe(true);
      expect(m!.replyTo!.text).not.toContain('@{'); // the token is not split
      expect(previewText('short')).toBe('short');

      await transact((tx, fx) => deleteForEveryoneTx(tx, fx, target.message.id));
      [m] = await toMessages(db, null, [reply.message]);
      expect(m!.replyTo).toMatchObject({
        id: target.message.id,
        deleted: true,
        text: null,
        media: null,
      });

      const t2 = await send(bob, chatId, 'expiring');
      const r2 = await send(alice, chatId, { text: 'reply', replyToId: t2.message.id });
      await db
        .update(messages)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(messages.id, t2.message.id));
      [m] = await toMessages(db, null, [r2.message]);
      expect(m!.replyTo).toBeNull();
      await db.delete(messages).where(eq(messages.id, t2.message.id)); // purged → FK sets null
      const [reloaded] = await db.select().from(messages).where(eq(messages.id, r2.message.id));
      [m] = await toMessages(db, null, [reloaded!]);
      expect(m!.replyTo).toBeNull();
    });

    it('resolves status replies at read time (available: false once the status is gone)', async () => {
      const chatId = await createDirect(alice, bob);
      const [status] = await db
        .insert(statuses)
        .values({
          userId: bob.id,
          type: 'text',
          text: 'my status',
          backgroundColor: '#6D5DFC',
          font: 1,
          audience: [alice.id],
          expiresAt: new Date(Date.now() + 60_000),
        })
        .returning();
      const { message } = await send(alice, chatId, {
        text: 'nice',
        metadata: { statusReply: { statusId: status!.id, authorId: bob.id, type: 'text' } },
      });
      let [m] = await toMessages(db, null, [message]);
      expect(m!.statusReply).toEqual({
        statusId: status!.id,
        authorId: bob.id,
        type: 'text',
        available: true,
        text: 'my status',
        backgroundColor: '#6D5DFC',
        font: 1,
        mediaUrl: null,
      });
      await db.delete(statuses).where(eq(statuses.id, status!.id));
      [m] = await toMessages(db, null, [message]);
      expect(m!.statusReply).toMatchObject({
        available: false,
        text: null,
        backgroundColor: null,
        font: null,
        mediaUrl: null,
      });
    });

    it('serializes media, location, contact and system payloads; tombstones deleted messages', async () => {
      const chatId = await createGroup(alice, [bob]);
      const [file] = await db
        .insert(media)
        .values({
          uploaderId: alice.id,
          kind: 'image',
          mimeType: 'image/png',
          fileName: 'a.png',
          size: 10,
          storageKey: '2026/01/x.png',
          thumbnailKey: '2026/01/y.jpg',
          width: 5,
          height: 6,
        })
        .returning();
      const img = await send(alice, chatId, { type: 'image', text: 'caption', mediaId: file!.id });
      const loc = await send(alice, chatId, {
        type: 'location',
        text: null,
        metadata: { location: { latitude: 1, longitude: 2, name: 'Here', address: null } },
      });
      const card = await buildContactCard(db, alice.id, { userId: bob.id });
      expect(card).toEqual({ userId: bob.id, name: 'Bob', username: bob.username, phone: null });
      await expect(
        buildContactCard(db, alice.id, { userId: crypto.randomUUID() }),
      ).rejects.toMatchObject({ status: 400 });
      const contact = await send(alice, chatId, {
        type: 'contact',
        text: null,
        metadata: { contact: card },
      });
      const [mi, ml, mc] = await toMessages(db, null, [img.message, loc.message, contact.message]);
      expect(mi!.media).toMatchObject({
        id: file!.id,
        url: '/uploads/2026/01/x.png',
        thumbnailUrl: '/uploads/2026/01/y.jpg',
        mimeType: 'image/png',
        width: 5,
        height: 6,
      });
      expect(mi!.text).toBe('caption');
      expect(ml!.location).toEqual({ latitude: 1, longitude: 2, name: 'Here', address: null });
      expect(mc!.contact).toEqual(card);
      const sys = await db
        .select()
        .from(messages)
        .where(and(eq(messages.chatId, chatId), eq(messages.type, 'system')));
      const [ms] = await toMessages(db, null, [sys[0]!]);
      expect(ms!.system).toMatchObject({ kind: 'group_created', actorId: alice.id });
      expect(ms!.senderId).toBeNull();

      await transact((tx, fx) => deleteForEveryoneTx(tx, fx, img.message.id));
      const [row] = await db.select().from(messages).where(eq(messages.id, img.message.id));
      const [dm] = await toMessages(db, null, [row!]);
      expect(dm).toMatchObject({
        type: 'image',
        text: null,
        media: null,
        reactions: [],
        mentions: [],
      });
      expect(dm!.deletedAt).not.toBeNull();
    });
  });

  describe('visibility-checked lookups and replies', () => {
    it('loadVisibleMessage: 404 outside the window / other chat; lock option works', async () => {
      const chatId = await createGroup(alice, [bob]);
      const early = await send(alice, chatId, 'before carol');
      await transact((tx, fx) =>
        upsertMembership(tx, fx, {
          kind: 'activate',
          chatId,
          userIds: [carol.id],
          addedBy: alice.id,
          systemEvent: { kind: 'members_added', actorId: alice.id, userIds: [carol.id] },
        }),
      );
      const late = await send(alice, chatId, 'after carol');
      await expect(loadVisibleMessage(db, carol.id, early.message.id)).rejects.toMatchObject({
        status: 404,
      });
      const v = await loadVisibleMessage(db, carol.id, late.message.id, { chatId });
      expect(v.message.id).toBe(late.message.id);
      expect(v.chat.id).toBe(chatId);
      await expect(
        loadVisibleMessage(db, carol.id, late.message.id, { chatId: crypto.randomUUID() }),
      ).rejects.toMatchObject({ status: 404 });
      const locked = await db.transaction((tx) =>
        loadVisibleMessage(tx, bob.id, late.message.id, { lock: true }),
      );
      expect(locked.message.id).toBe(late.message.id);
    });

    it('resolveReplyTarget: same chat, reply privately, and rejections', async () => {
      const groupId = await createGroup(alice, [bob]);
      const bobInGroup = await send(bob, groupId, 'group msg by bob');
      const aliceInGroup = await send(alice, groupId, 'group msg by alice');
      const directId = await createDirect(alice, bob);
      const [direct] = await db.select().from(chats).where(eq(chats.id, directId));
      const [group] = await db.select().from(chats).where(eq(chats.id, groupId));
      expect((await resolveReplyTarget(db, alice.id, group!, aliceInGroup.message.id)).id).toBe(
        aliceInGroup.message.id,
      );
      // Reply privately: bob's group message quoted in the direct chat with bob.
      expect((await resolveReplyTarget(db, alice.id, direct!, bobInGroup.message.id)).id).toBe(
        bobInGroup.message.id,
      );
      // Not the peer's message → 404.
      await expect(
        resolveReplyTarget(db, alice.id, direct!, aliceInGroup.message.id),
      ).rejects.toMatchObject({ status: 404 });
      const [sys] = await db
        .select()
        .from(messages)
        .where(and(eq(messages.chatId, groupId), eq(messages.type, 'system')));
      await expect(resolveReplyTarget(db, alice.id, group!, sys!.id)).rejects.toMatchObject({
        status: 400,
      });
    });
  });

  describe('loadMessagePage', () => {
    let chatId: string;
    let seqs: number[];
    beforeAll(async () => {
      chatId = await createGroup(alice, [bob]);
      seqs = [];
      for (let i = 0; i < 10; i++)
        seqs.push(Number((await send(i % 2 ? bob : alice, chatId, `p${i}`)).message.seq));
    });

    const texts = (ms: Message[]) => ms.map((m) => m.text);

    it('latest page + before/after/around cursors with hasMore flags', async () => {
      const latest = await loadMessagePage(db, alice.id, chatId, { limit: 4 });
      expect(texts(latest.messages)).toEqual(['p6', 'p7', 'p8', 'p9']);
      expect(latest).toMatchObject({ hasMoreBefore: true, hasMoreAfter: false });
      expect(latest.users.map((u) => u.id).sort()).toEqual([alice.id, bob.id].sort());
      expect(latest.messages[0]!.starred).toBe(false);

      const before = await loadMessagePage(db, alice.id, chatId, { before: seqs[6]!, limit: 4 });
      expect(texts(before.messages)).toEqual(['p2', 'p3', 'p4', 'p5']);
      expect(before).toMatchObject({ hasMoreBefore: true, hasMoreAfter: true });

      const after = await loadMessagePage(db, alice.id, chatId, { after: seqs[6]!, limit: 10 });
      expect(texts(after.messages)).toEqual(['p7', 'p8', 'p9']);
      expect(after).toMatchObject({ hasMoreBefore: true, hasMoreAfter: false });

      const around = await loadMessagePage(db, alice.id, chatId, { around: seqs[5]!, limit: 4 });
      expect(texts(around.messages)).toEqual(['p4', 'p5', 'p6', 'p7']);
      expect(around).toMatchObject({ hasMoreBefore: true, hasMoreAfter: true });

      const all = await loadMessagePage(db, alice.id, chatId, { limit: 200 });
      expect(all.hasMoreBefore).toBe(false);
      expect(all.messages[0]!.type).toBe('system'); // group_created is visible to initial members
    });

    it('hides deleted-for-me messages and 404s for non-members', async () => {
      const { message } = await send(alice, chatId, 'hide me');
      const vis = await loadVisibleMessage(db, bob.id, message.id);
      const bobSock = await t.connect(bob);
      const removed = waitForEvent(bobSock, 'message:removed');
      await transact((tx, fx) => deleteForMeTx(tx, fx, bob.id, vis.message));
      expect(await removed).toEqual({ chatId, messageIds: [message.id] });
      const page = await loadMessagePage(db, bob.id, chatId, { limit: 3 });
      expect(page.messages.map((m) => m.id)).not.toContain(message.id);
      const alicePage = await loadMessagePage(db, alice.id, chatId, { limit: 1 });
      expect(alicePage.messages[0]!.id).toBe(message.id);
      await expect(loadMessagePage(db, carol.id, chatId, { limit: 5 })).rejects.toMatchObject({
        status: 404,
      });
      bobSock.disconnect();
    });
  });

  describe('updates and deletes fan-out', () => {
    it('message:updated skips members for whom the message is invisible; delete-for-everyone clears pins', async () => {
      const chatId = await createGroup(alice, [bob]);
      const old = await send(alice, chatId, 'old message');
      await db.insert(chatPins).values({ chatId, messageId: old.message.id, pinnedBy: alice.id });
      await db.insert(starredMessages).values({ userId: bob.id, messageId: old.message.id });
      await transact((tx, fx) =>
        upsertMembership(tx, fx, {
          kind: 'activate',
          chatId,
          userIds: [carol.id],
          addedBy: alice.id,
          systemEvent: { kind: 'members_added', actorId: alice.id, userIds: [carol.id] },
        }),
      );
      const bobSock = await t.connect(bob);
      const carolSock = await t.connect(carol);
      const bobUpdated = waitForEvent(bobSock, 'message:updated');
      const bobPins = waitForEvent(bobSock, 'chat:pins');
      await transact((tx, fx) => deleteForEveryoneTx(tx, fx, old.message.id));
      const upd = await bobUpdated;
      expect(upd.message).toMatchObject({ id: old.message.id, text: null });
      expect(upd.message.deletedAt).not.toBeNull();
      expect(await bobPins).toEqual({ chatId, messageIds: [] });
      await expectNoEvent(carolSock, 'message:updated');
      expect(await db.select().from(chatPins).where(eq(chatPins.chatId, chatId))).toHaveLength(0);
      expect(
        await db
          .select()
          .from(starredMessages)
          .where(eq(starredMessages.messageId, old.message.id)),
      ).toHaveLength(0);
      bobSock.disconnect();
      carolSock.disconnect();
    });

    it('rejects deleting system messages for everyone', async () => {
      const chatId = await createGroup(alice, [bob]);
      const [sys] = await db
        .select()
        .from(messages)
        .where(and(eq(messages.chatId, chatId), eq(messages.type, 'system')));
      await expect(
        transact((tx, fx) => deleteForEveryoneTx(tx, fx, sys!.id)),
      ).rejects.toMatchObject({ status: 400 });
    });
  });
});
