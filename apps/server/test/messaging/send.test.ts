import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  USER_RATE_LIMITS,
  mentionToken,
  type ChatSummary,
  type Message,
  type MessagePage,
} from '@enbox/shared';
import { config } from '../../src/config.js';
import { db } from '../../src/db/index.js';
import { chats, messageHidden, messages, statuses, users } from '../../src/db/schema.js';
import { resetUserLimits } from '../../src/lib/userLimit.js';
import { startTestServer, type TestServer, type TestUser } from '../helpers.js';
import {
  block,
  createChannel,
  createCommunity,
  createGroup,
  recordEvents,
  saveContact,
  setSettings,
  settle,
} from '../services/fixtures.js';
import {
  activeDirect,
  addToGroup,
  follow,
  historyOf,
  leaveGroup,
  memberOf,
  mkMedia,
  mkStatus,
  openDirect,
  sendOk,
  sendReq,
  summaryOf,
} from './support.js';

describe('POST /chats/:chatId/messages (send)', () => {
  let t: TestServer;
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let dave: TestUser;

  beforeAll(async () => {
    t = await startTestServer();
    alice = await t.createUser({ displayName: 'Alice' });
    bob = await t.createUser({ displayName: 'Bob' });
    carol = await t.createUser({ displayName: 'Carol' });
    dave = await t.createUser({ displayName: 'Dave' });
  });
  afterAll(() => t.close());

  describe('basics & idempotency', () => {
    it('201 with the viewer-specific Message; events: message:new → room, chat:read → sender devices, chat:watermarks → sender', async () => {
      const g = await createGroup(alice, [bob]);
      const a1 = await t.connect(alice);
      const a2 = await t.connect(alice);
      const b1 = await t.connect(bob);
      const la1 = recordEvents(a1);
      const la2 = recordEvents(a2);
      const lb = recordEvents(b1);
      const res = await sendReq(t, alice, g, { text: 'hello group', clientId: 'first-1' }).expect(
        201,
      );
      const m = res.body as Message;
      expect(m).toMatchObject({
        chatId: g,
        senderId: alice.id,
        clientId: 'first-1',
        type: 'text',
        text: 'hello group',
        media: null,
        replyTo: null,
        forwardCount: 0,
        mentions: [],
        reactions: [],
        editedAt: null,
        deletedAt: null,
        expiresAt: null,
        starred: false,
        myReaction: null,
      });
      await settle();
      for (const log of [la1, la2]) {
        expect(log.of('message:new').map((p) => p.message.id)).toEqual([m.id]);
        expect(log.of('chat:read')).toEqual([
          {
            chatId: g,
            lastReadSeq: m.seq,
            unreadCount: 0,
            unreadMentionCount: 0,
            markedUnread: false,
          },
        ]);
        // bob is online → delivered advanced in the send transaction → alice's ticks changed
        expect(log.of('chat:watermarks').at(-1)).toMatchObject({
          chatId: g,
          deliveredWatermark: m.seq,
        });
      }
      const bobNew = lb.of('message:new');
      expect(bobNew).toHaveLength(1);
      expect(bobNew[0]!.message).not.toHaveProperty('starred');
      expect(bobNew[0]!.message).not.toHaveProperty('myReaction');
      expect(lb.of('chat:read')).toEqual([]);
      expect(la1.names().indexOf('message:new')).toBeLessThan(la1.names().indexOf('chat:read'));
      for (const s of [a1, a2, b1]) s.disconnect();
    });

    it('idempotent retry (same clientId): 200 with the original message, no seq burned, no events', async () => {
      const g = await createGroup(alice, [bob]);
      const first = await sendReq(t, alice, g, { text: 'once', clientId: 'retry-me' }).expect(201);
      const [c1] = await db.select().from(chats).where(eq(chats.id, g));
      const b = await t.connect(bob);
      const a = await t.connect(alice);
      const lb = recordEvents(b);
      const la = recordEvents(a);
      const retry = await sendReq(t, alice, g, { text: 'twice', clientId: 'retry-me' }).expect(200);
      expect(retry.body.id).toBe(first.body.id);
      expect(retry.body.text).toBe('once');
      await settle();
      expect(lb.log).toEqual([]);
      expect(la.log).toEqual([]);
      const [c2] = await db.select().from(chats).where(eq(chats.id, g));
      expect(c2!.lastSeq).toBe(c1!.lastSeq);
      // Another sender may use the same clientId.
      await sendReq(t, bob, g, { text: 'bob', clientId: 'retry-me' }).expect(201);
      a.disconnect();
      b.disconnect();
    });

    it('concurrent duplicates of one clientId create a single message (one 201, the rest 200)', async () => {
      const g = await createGroup(alice, [bob]);
      const results = await Promise.all(
        [1, 2, 3].map(() => sendReq(t, alice, g, { text: 'dup', clientId: 'concurrent' })),
      );
      expect(results.map((r) => r.status).sort()).toEqual([200, 200, 201]);
      expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
      const rows = await db.select().from(messages).where(eq(messages.chatId, g));
      expect(rows.filter((r) => r.clientId === 'concurrent')).toHaveLength(1);
    });

    it('validates bodies strictly', async () => {
      const g = await createGroup(alice, [bob]);
      await sendReq(t, alice, g, { text: '   ' }).expect(400);
      await sendReq(t, alice, g, { type: 'text', text: 'x', mediaId: crypto.randomUUID() }).expect(
        400,
      );
      await sendReq(t, alice, g, { type: 'sticker' }).expect(400);
      await sendReq(t, alice, g, { clientId: '' }).expect(400);
      await sendReq(t, alice, g, {
        replyToId: crypto.randomUUID(),
        statusReplyToId: crypto.randomUUID(),
      }).expect(400);
      await sendReq(t, alice, g, {
        type: 'poll',
        poll: { question: 'q', options: ['a', 'A'] },
      }).expect(400);
      await sendReq(t, alice, g, {
        type: 'location',
        location: { latitude: 91, longitude: 0 },
      }).expect(400);
      await t
        .api(alice)
        .post('/api/chats/nope/messages')
        .send({ type: 'text', text: 'x', clientId: 'c' })
        .expect(400);
      const unknown = await sendReq(t, alice, crypto.randomUUID()).expect(404);
      expect(unknown.body.error.code).toBe('not_found');
    });

    it('per-user send rate limit → 429 rate_limited', async () => {
      const g = await createGroup(dave, []);
      config.rateLimit = true;
      resetUserLimits();
      try {
        for (let i = 0; i < USER_RATE_LIMITS.sendMessage.limit; i++)
          await sendReq(t, dave, g, { text: `m${i}` }).expect(201);
        const res = await sendReq(t, dave, g, { text: 'one too many' }).expect(429);
        expect(res.body.error.code).toBe('rate_limited');
        // Forwards count per copy.
        resetUserLimits();
        const src = (await historyOf(t, dave, g)).at(-1)!;
        const fwd = await t
          .api(dave)
          .post('/api/messages/forward')
          .send({ clientId: 'rl', messageIds: [src.id], chatIds: [g] })
          .expect(201);
        expect(fwd.body).toHaveLength(1);
        for (let i = 0; i < USER_RATE_LIMITS.sendMessage.limit - 1; i++)
          await sendReq(t, dave, g).expect(201);
        await t
          .api(dave)
          .post('/api/messages/forward')
          .send({ clientId: 'rl2', messageIds: [src.id], chatIds: [g] })
          .expect(429);
        // A forward is charged its real copy count: more copies than one window allows can
        // never pass (400, nothing created or charged); a full window's worth passes on a
        // fresh window and uses it up.
        resetUserLimits();
        const many = (await historyOf(t, dave, g, '?limit=13')).map((m) => m.id);
        const targets = [g, ...(await Promise.all([1, 2, 3, 4].map(() => createGroup(dave, []))))];
        const tooBig = await t
          .api(dave)
          .post('/api/messages/forward')
          .send({ clientId: 'rl3', messageIds: many, chatIds: targets })
          .expect(400);
        expect(tooBig.body.error.code).toBe('validation_error');
        const twelve = many.slice(0, 12);
        const big = await t
          .api(dave)
          .post('/api/messages/forward')
          .send({ clientId: 'rl4', messageIds: twelve, chatIds: targets })
          .expect(201);
        expect(big.body).toHaveLength(USER_RATE_LIMITS.sendMessage.limit);
        await sendReq(t, dave, g).expect(429);
      } finally {
        config.rateLimit = false;
        resetUserLimits();
      }
    });
  });

  describe('content types', () => {
    it('media: must be my upload with kind === type; captions optional', async () => {
      const g = await createGroup(alice, [bob]);
      const img = await mkMedia(alice.id, 'image', { width: 10, height: 20 });
      const m = await sendOk(t, alice, g, { type: 'image', mediaId: img.id, text: 'caption' });
      expect(m).toMatchObject({
        type: 'image',
        text: 'caption',
        media: { id: img.id, kind: 'image', mimeType: 'image/png', width: 10, height: 20 },
      });
      const noCaption = await sendOk(t, alice, g, { type: 'image', mediaId: img.id, text: '  ' });
      expect(noCaption.text).toBeNull();
      const bobs = await mkMedia(bob.id, 'image');
      await sendReq(t, alice, g, { type: 'image', mediaId: bobs.id }).expect(404);
      await sendReq(t, alice, g, { type: 'image', mediaId: crypto.randomUUID() }).expect(404);
      const voice = await mkMedia(alice.id, 'voice', { durationMs: 1200, waveform: [0.1, 0.5] });
      const mismatch = await sendReq(t, alice, g, { type: 'audio', mediaId: voice.id }).expect(400);
      expect(mismatch.body.error.code).toBe('validation_error');
      const v = await sendOk(t, alice, g, { type: 'voice', mediaId: voice.id });
      expect(v.media).toMatchObject({ kind: 'voice', durationMs: 1200, waveform: [0.1, 0.5] });
    });

    it('location, poll (stable option ids) and plain contact cards', async () => {
      const g = await createGroup(alice, [bob]);
      const loc = await sendOk(t, alice, g, {
        type: 'location',
        location: { latitude: 52.37, longitude: 4.89, name: 'Dam' },
      });
      expect(loc.location).toEqual({
        latitude: 52.37,
        longitude: 4.89,
        name: 'Dam',
        address: null,
      });
      expect(loc.text).toBeNull();
      const poll = await sendOk(t, alice, g, {
        type: 'poll',
        poll: { question: 'Lunch?', options: ['Pizza', 'Sushi', 'Salad'], allowMultiple: true },
      });
      expect(poll.poll).toMatchObject({
        question: 'Lunch?',
        allowMultiple: true,
        totalVoters: 0,
        myOptionIds: [],
      });
      const ids = poll.poll!.options.map((o) => o.id);
      expect(new Set(ids).size).toBe(3);
      expect(poll.poll!.options.map((o) => [o.text, o.voteCount, o.voterIds])).toEqual([
        ['Pizza', 0, []],
        ['Sushi', 0, []],
        ['Salad', 0, []],
      ]);
      const page = (await t.api(bob).get(`/api/chats/${g}/messages`).expect(200))
        .body as MessagePage;
      expect(page.messages.find((m) => m.id === poll.id)!.poll!.options.map((o) => o.id)).toEqual(
        ids,
      );
      const plain = await sendOk(t, alice, g, {
        type: 'contact',
        contact: { name: 'Plumber', phone: '+1 555 123 4567' },
      });
      expect(plain.contact).toEqual({
        userId: null,
        name: 'Plumber',
        username: null,
        phone: '+15551234567',
      });
      await sendReq(t, alice, g, { type: 'contact', contact: { phone: '+15551234567' } }).expect(
        400,
      );
    });

    it('contact cards with userId are filled server-side (phone only if the sender may see it); unknown/deleted → 400', async () => {
      const g = await createGroup(alice, [bob]);
      const subject = await t.createUser({ displayName: 'Subject', phone: '+4915112345678' });
      const card = await sendOk(t, alice, g, {
        type: 'contact',
        contact: { userId: subject.id, name: 'Spoofed', phone: '+10000000000' },
      });
      expect(card.contact).toEqual({
        userId: subject.id,
        name: 'Subject',
        username: subject.username,
        phone: null,
      });
      await saveContact(subject, alice);
      const visible = await sendOk(t, alice, g, {
        type: 'contact',
        contact: { userId: subject.id },
      });
      expect(visible.contact!.phone).toBe('+4915112345678');
      await sendReq(t, alice, g, {
        type: 'contact',
        contact: { userId: crypto.randomUUID() },
      }).expect(400);
      const gone = await t.createUser();
      await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, gone.id));
      await sendReq(t, alice, g, { type: 'contact', contact: { userId: gone.id } }).expect(400);
    });
  });

  describe('mentions', () => {
    it('mentions = tokens ∩ active members (sender excluded); badge counts per viewer', async () => {
      const g = await createGroup(alice, [bob, carol]);
      const stranger = await t.createUser();
      const text = `hey ${mentionToken(bob.id)} and ${mentionToken(stranger.id)} and ${mentionToken(alice.id)} ${mentionToken(bob.id)}`;
      const m = await sendOk(t, alice, g, text);
      expect(m.mentions).toEqual([bob.id]);
      expect(m.text).toBe(text);
      await sendOk(t, alice, g, 'no mention');
      const cap = await sendOk(t, carol, g, {
        type: 'image',
        mediaId: (await mkMedia(carol.id)).id,
        text: `look ${mentionToken(bob.id)}`,
      });
      expect(cap.mentions).toEqual([bob.id]);
      expect(await summaryOf(t, bob, g)).toMatchObject({ unreadCount: 3, unreadMentionCount: 2 });
      // Sending reads the chat: carol's own caption moved her read position past the others.
      expect(await summaryOf(t, carol, g)).toMatchObject({ unreadCount: 0, unreadMentionCount: 0 });
      await t.api(bob).post(`/api/chats/${g}/read`).send({ seq: m.seq }).expect(204);
      expect(await summaryOf(t, bob, g)).toMatchObject({ unreadCount: 2, unreadMentionCount: 1 });
      // Former members are not mentionable.
      await leaveGroup(g, carol);
      const after = await sendOk(t, alice, g, `bye ${mentionToken(carol.id)}`);
      expect(after.mentions).toEqual([]);
    });
  });

  describe('replies', () => {
    it('same chat: replyTo preview computed at read time; system messages and other chats → 400/404', async () => {
      const g = await createGroup(alice, [bob]);
      const orig = await sendOk(t, bob, g, `original ${mentionToken(alice.id)}`);
      const reply = await sendOk(t, alice, g, { text: 'reply', replyToId: orig.id });
      expect(reply.replyTo).toEqual({
        id: orig.id,
        chatId: g,
        seq: orig.seq,
        senderId: bob.id,
        type: 'text',
        text: `original ${mentionToken(alice.id)}`,
        media: null,
        deleted: false,
      });
      const sys = (await historyOf(t, alice, g)).find((m) => m.type === 'system')!;
      await sendReq(t, alice, g, { replyToId: sys.id }).expect(400);
      const other = await createGroup(carol, [dave]);
      const foreign = await sendOk(t, carol, other, 'elsewhere');
      await sendReq(t, alice, g, { replyToId: foreign.id }).expect(404);
      // Messages hidden for me can't be quoted.
      const hidden = await sendOk(t, bob, g, 'hide me');
      await t.api(alice).delete(`/api/messages/${hidden.id}?for=me`).expect(204);
      await sendReq(t, alice, g, { replyToId: hidden.id }).expect(404);
    });

    it('reply privately: in the direct chat with P, P’s message from a shared group', async () => {
      const g = await createGroup(alice, [bob, carol]);
      const fromBob = await sendOk(t, bob, g, 'group message by bob');
      const fromCarol = await sendOk(t, carol, g, 'group message by carol');
      const d = await openDirect(t, alice, bob);
      const priv = await sendOk(t, alice, d.id, { text: 'about that…', replyToId: fromBob.id });
      expect(priv.replyTo).toMatchObject({
        id: fromBob.id,
        chatId: g,
        seq: fromBob.seq,
        senderId: bob.id,
        text: 'group message by bob',
      });
      // Bob sees the quote in the direct chat too.
      const bobView = (await historyOf(t, bob, d.id)).find((m) => m.id === priv.id)!;
      expect(bobView.replyTo).toMatchObject({ id: fromBob.id, chatId: g });
      // Only P's messages; and only while both are active members of the group.
      await sendReq(t, alice, d.id, { replyToId: fromCarol.id }).expect(404);
      await leaveGroup(g, bob);
      await sendReq(t, alice, d.id, { replyToId: fromBob.id }).expect(404);
    });
  });

  describe('status replies', () => {
    it('visible status + direct chat with its author; stored as a reference resolved at read time', async () => {
      const author = await t.createUser({ displayName: 'Author' });
      const status = await mkStatus(author.id, [alice.id, bob.id], { text: 'sunset' });
      const d = await openDirect(t, alice, author);
      const reply = await sendOk(t, alice, d.id, { text: 'nice!', statusReplyToId: status.id });
      expect(reply.statusReply).toEqual({
        statusId: status.id,
        authorId: author.id,
        type: 'text',
        available: true,
        text: 'sunset',
        backgroundColor: '#6D5DFC',
        font: 1,
        mediaUrl: null,
      });
      // Wrong chat: a group, or a direct chat with someone else → 400.
      const g = await createGroup(alice, [author]);
      await sendReq(t, alice, g, { statusReplyToId: status.id }).expect(400);
      const other = await openDirect(t, alice, bob);
      await sendReq(t, alice, other.id, { statusReplyToId: status.id }).expect(400);
      // Not in the audience, or blocked → 404; own status → 400.
      const d2 = await openDirect(t, carol, author);
      await sendReq(t, carol, d2.id, { statusReplyToId: status.id }).expect(404);
      const mine = await mkStatus(alice.id, [author.id]);
      await sendReq(t, alice, d.id, { statusReplyToId: mine.id }).expect(400);
      await block(author, alice);
      await sendReq(t, alice, d.id, { statusReplyToId: status.id }).expect(404);
      // Expired → 404; after deletion the reply resolves to "Status unavailable".
      const old = await mkStatus(author.id, [bob.id], { expiresAt: new Date(Date.now() - 1000) });
      const bd = await openDirect(t, bob, author);
      await sendReq(t, bob, bd.id, { statusReplyToId: old.id }).expect(404);
      await db.delete(statuses).where(eq(statuses.id, status.id));
      const later = (await historyOf(t, alice, d.id)).find((m) => m.id === reply.id)!;
      expect(later.statusReply).toMatchObject({
        statusId: status.id,
        available: false,
        text: null,
      });
    });
  });

  describe('permissions', () => {
    it('onlyAdminsCanSend, announcement groups and channels', async () => {
      const g = await createGroup(alice, [bob], { settings: { onlyAdminsCanSend: true } });
      const r = await sendReq(t, bob, g).expect(403);
      expect(r.body.error.code).toBe('forbidden');
      await sendReq(t, alice, g).expect(201);

      const { announcementChatId } = await createCommunity(alice);
      await follow(announcementChatId, [bob]);
      await sendReq(t, bob, announcementChatId).expect(403);
      await sendReq(t, alice, announcementChatId).expect(201);

      const ch = await createChannel(alice, { admins: [carol] });
      await follow(ch, [bob]);
      await sendReq(t, bob, ch).expect(403);
      const post = await sendOk(t, carol, ch, 'channel post');
      expect(post.senderId).toBeNull();
      // A post doesn't touch followers' marks and never emits watermarks.
      const bs = await t.connect(bob);
      const log = recordEvents(bs);
      await sendOk(t, alice, ch, 'another');
      await settle();
      expect(log.of('message:new')).toHaveLength(1);
      expect(log.of('chat:watermarks')).toEqual([]);
      expect((await summaryOf(t, bob, ch)).unreadCount).toBe(2);
      bs.disconnect();
    });

    it('former members → 403 not_member; non-members and hidden rows → 404', async () => {
      const g = await createGroup(alice, [bob, carol]);
      await leaveGroup(g, carol, alice);
      const r = await sendReq(t, carol, g).expect(403);
      expect(r.body.error.code).toBe('not_member');
      await sendReq(t, dave, g).expect(404);
      const d = await activeDirect(t, alice, dave);
      await t.api(dave).delete(`/api/chats/${d}`).expect(204);
      await sendReq(t, dave, d).expect(404);
    });

    it('recipient blocked the sender: the send succeeds but is withheld (no event, no unhide, single tick)', async () => {
      const u1 = await t.createUser();
      const u2 = await t.createUser();
      const d = await activeDirect(t, u1, u2);
      await sendOk(t, u2, d, 'hi back');
      await t.api(u2).delete(`/api/chats/${d}`).expect(204);
      await block(u2, u1);
      const s2 = await t.connect(u2);
      const s1 = await t.connect(u1);
      const log2 = recordEvents(s2);
      const log1 = recordEvents(s1);
      const m = await sendOk(t, u1, d, 'can you see this?');
      await settle();
      // Nothing about the message reaches the blocker (only tick updates for their own messages).
      expect(log2.log.filter((e) => e.event !== 'chat:watermarks')).toEqual([]);
      expect(log1.of('message:new').map((p) => p.message.id)).toEqual([m.id]);
      const hidden = await db.select().from(messageHidden).where(eq(messageHidden.messageId, m.id));
      expect(hidden.map((h) => h.userId)).toEqual([u2.id]);
      expect((await memberOf(d, u2))!.hidden).toBe(true);
      const mine = await summaryOf(t, u1, d);
      expect(mine.deliveredWatermark).toBeLessThan(m.seq);
      expect(mine.readWatermark).toBeLessThan(m.seq);
      // The sender doesn't learn about the block.
      expect(mine.permissions.canSend).toBe(true);
      expect(mine.peer!.isBlocked).toBe(false);
      s1.disconnect();
      s2.disconnect();
    });

    it('disappearing chats set expiresAt; system messages never expire', async () => {
      const g = await createGroup(alice, [bob], { disappearingSeconds: 86_400 });
      const m = await sendOk(t, bob, g, 'poof');
      expect(Date.parse(m.expiresAt!) - Date.parse(m.createdAt)).toBe(86_400_000);
      const sys = (await historyOf(t, bob, g)).filter((x) => x.type === 'system');
      expect(sys.every((x) => x.expiresAt === null)).toBe(true);
    });
  });

  describe('GET /chats/:chatId/messages (history paging)', () => {
    let g: string;
    let seqs: number[];

    beforeAll(async () => {
      const owner = await t.createUser({ displayName: 'Owner' });
      const member = await t.createUser({ displayName: 'Member' });
      g = await createGroup(owner, [member, alice]);
      for (let i = 1; i <= 10; i++) {
        await sendOk(t, i % 2 ? owner : member, g, `p${i}`);
        // Gaps in alice's view: a message hidden for her and an expired one.
        if (i === 3)
          await t
            .api(alice)
            .delete(`/api/messages/${(await sendOk(t, owner, g, 'hidden')).id}?for=me`)
            .expect(204);
        if (i === 6) {
          const x = await sendOk(t, owner, g, 'expired');
          await db
            .update(messages)
            .set({ expiresAt: new Date(Date.now() - 1000) })
            .where(eq(messages.id, x.id));
        }
      }
      const all = await historyOf(t, alice, g, '?limit=200');
      expect(all.map((m) => m.text).filter((x) => x === 'hidden' || x === 'expired')).toEqual([]);
      seqs = all.map((m) => m.seq);
    });

    it('latest page ascending with hasMoreBefore/hasMoreAfter and side-loaded users', async () => {
      const page = (await t.api(alice).get(`/api/chats/${g}/messages?limit=4`).expect(200))
        .body as MessagePage;
      expect(page.messages.map((m) => m.text)).toEqual(['p7', 'p8', 'p9', 'p10']);
      expect(page).toMatchObject({ hasMoreBefore: true, hasMoreAfter: false });
      const userIds = page.users.map((u) => u.id);
      for (const m of page.messages) expect(userIds).toContain(m.senderId);
      const full = (await t.api(alice).get(`/api/chats/${g}/messages?limit=200`).expect(200))
        .body as MessagePage;
      expect(full).toMatchObject({ hasMoreBefore: false, hasMoreAfter: false });
      // system messages reference actors/targets → side-loaded
      expect(full.users.map((u) => u.id)).toContain(alice.id);
    });

    it('before / after / around cursors are exclusive; at most one cursor', async () => {
      const p10 = seqs.at(-1)!;
      expect(seqs.at(-1)! - seqs[0]!).toBeGreaterThan(seqs.length - 1); // gaps
      const before = (
        await t.api(alice).get(`/api/chats/${g}/messages?before=${p10}&limit=3`).expect(200)
      ).body as MessagePage;
      expect(before.messages.map((m) => m.text)).toEqual(['p7', 'p8', 'p9']);
      expect(before).toMatchObject({ hasMoreBefore: true, hasMoreAfter: true });
      const after = (
        await t.api(alice).get(`/api/chats/${g}/messages?after=${seqs[0]}&limit=2`).expect(200)
      ).body as MessagePage;
      expect(after.messages.map((m) => m.seq)).toEqual([seqs[1], seqs[2]]);
      expect(after).toMatchObject({ hasMoreBefore: true, hasMoreAfter: true });
      const tail = (
        await t
          .api(alice)
          .get(`/api/chats/${g}/messages?after=${seqs.at(-3)}`)
          .expect(200)
      ).body as MessagePage;
      expect(tail.messages.map((m) => m.text)).toEqual(['p9', 'p10']);
      expect(tail.hasMoreAfter).toBe(false);
      const mid = seqs[5]!;
      const around = (
        await t.api(alice).get(`/api/chats/${g}/messages?around=${mid}&limit=4`).expect(200)
      ).body as MessagePage;
      expect(around.messages.map((m) => m.seq)).toEqual([seqs[4], seqs[5], seqs[6], seqs[7]]);
      expect(around).toMatchObject({ hasMoreBefore: true, hasMoreAfter: true });
      await t.api(alice).get(`/api/chats/${g}/messages?before=5&after=2`).expect(400);
      await t.api(alice).get(`/api/chats/${g}/messages?limit=0`).expect(400);
      await t.api(alice).get(`/api/chats/${g}/messages?limit=201`).expect(400);
      // Blank cursors are treated as absent.
      const blank = (await t.api(alice).get(`/api/chats/${g}/messages?before=&limit=1`).expect(200))
        .body as MessagePage;
      expect(blank.messages.map((m) => m.text)).toEqual(['p10']);
    });

    it('former members read up to left_seq; non-members 404', async () => {
      const u = await t.createUser();
      const owner = await t.createUser();
      const chatId = await createGroup(owner, [u]);
      await sendOk(t, owner, chatId, 'before leaving');
      await leaveGroup(chatId, u);
      await sendOk(t, owner, chatId, 'after leaving');
      const texts = (await historyOf(t, u, chatId)).map((m) => m.text ?? m.system?.kind);
      expect(texts).toContain('before leaving');
      expect(texts).toContain('member_left');
      expect(texts).not.toContain('after leaving');
      const summary = (await t.api(u).get(`/api/chats/${chatId}`).expect(200)).body as ChatSummary;
      expect(summary.lastMessage!.system!.kind).toBe('member_left');
      await t.api(carol).get(`/api/chats/${chatId}/messages`).expect(404);
    });

    it('rejoined members start a new window', async () => {
      const owner = await t.createUser();
      const u = await t.createUser();
      const chatId = await createGroup(owner, [u]);
      await sendOk(t, owner, chatId, 'window 1');
      await leaveGroup(chatId, u);
      await sendOk(t, owner, chatId, 'while away');
      await addToGroup(chatId, owner, [u]);
      const texts = (await historyOf(t, u, chatId)).map((m) => m.text ?? m.system?.kind);
      expect(texts).toEqual(['members_added']);
    });
  });

  describe('first message of a chat with a default timer and a deleted-for-me peer row', () => {
    it('unhides the peer (JOIN before message:new) with only the new message', async () => {
      const u1 = await t.createUser();
      const u2 = await t.createUser();
      await setSettings(u1.id, { defaultDisappearingSeconds: 86_400 });
      const d = await openDirect(t, u1, u2);
      const s2 = await t.connect(u2);
      const log = recordEvents(s2);
      const m = await sendOk(t, u1, d.id, 'hello');
      await settle();
      expect(log.names().slice(0, 2)).toEqual(['chat:upsert', 'message:new']);
      expect(log.of('chat:upsert')[0]!.chat).toMatchObject({
        id: d.id,
        disappearingSeconds: 86_400,
        unreadCount: 1,
      });
      expect(m.expiresAt).not.toBeNull();
      const [row] = await db.select().from(messages).where(eq(messages.id, m.id));
      expect(row!.expiresAt).not.toBeNull();
      s2.disconnect();
    });
  });
});
