import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { DELETE_FOR_EVERYONE_WINDOW_MS, EDIT_WINDOW_MS, mentionToken, type Message, type MessageInfo, type MessageSearchResult } from '@enbox/shared';
import { db } from '../../src/db/index.js';
import { chatPins, chats, messageReactions, messages, pollVotes, starredMessages } from '../../src/db/schema.js';
import { escapeLike, listStarred, searchMessages } from '../../src/modules/messages/service.js';
import { emitAck, startTestServer, type TestServer, type TestUser } from '../helpers.js';
import { countQueries, createChannel, createGroup, goOffline, recordEvents, setSettings, settle } from '../services/fixtures.js';
import { activeDirect, addToGroup, follow, historyOf, leaveGroup, mkMedia, mkStatus, openDirect, sendOk, sendReq } from './support.js';

const ageMessage = (id: string, ms: number) => db.update(messages).set({ createdAt: new Date(Date.now() - ms) }).where(eq(messages.id, id));

describe('messages module (REST)', () => {
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

  describe('PATCH /messages/:messageId (edit)', () => {
    it('sender within the window: text + mentions re-derived, edited_at, message:updated to the room', async () => {
      const g = await createGroup(alice, [bob, carol]);
      const m = await sendOk(t, alice, g, `hi ${mentionToken(bob.id)}`);
      const bs = await t.connect(bob);
      const log = recordEvents(bs);
      const res = await t.api(alice).patch(`/api/messages/${m.id}`).send({ text: `  hi ${mentionToken(carol.id)}  ` }).expect(200);
      const edited = res.body as Message;
      expect(edited).toMatchObject({ id: m.id, text: `hi ${mentionToken(carol.id)}`, mentions: [carol.id], starred: false });
      expect(edited.editedAt).not.toBeNull();
      await settle();
      const upd = log.of('message:updated');
      expect(upd).toHaveLength(1);
      expect(upd[0]!.message).toMatchObject({ id: m.id, text: `hi ${mentionToken(carol.id)}`, mentions: [carol.id] });
      expect(upd[0]!.message).not.toHaveProperty('myReaction');
      // Unchanged text → no-op, no event.
      log.clear();
      await t.api(alice).patch(`/api/messages/${m.id}`).send({ text: `hi ${mentionToken(carol.id)}` }).expect(200);
      await settle();
      expect(log.log).toEqual([]);
      bs.disconnect();
    });

    it('rules: not the sender 403, window 410, text required, captions ≤ limit and may be emptied, non-editable types 400', async () => {
      const g = await createGroup(alice, [bob]);
      const m = await sendOk(t, alice, g, 'original');
      const r1 = await t.api(bob).patch(`/api/messages/${m.id}`).send({ text: 'hijack' }).expect(403);
      expect(r1.body.error.code).toBe('forbidden');
      await t.api(alice).patch(`/api/messages/${m.id}`).send({ text: '   ' }).expect(400);
      await t.api(alice).patch(`/api/messages/${m.id}`).send({}).expect(400);
      await ageMessage(m.id, EDIT_WINDOW_MS + 1000);
      const late = await t.api(alice).patch(`/api/messages/${m.id}`).send({ text: 'too late' }).expect(410);
      expect(late.body.error.code).toBe('expired');

      const img = await sendOk(t, alice, g, { type: 'image', mediaId: (await mkMedia(alice.id)).id, text: 'caption' });
      await t.api(alice).patch(`/api/messages/${img.id}`).send({ text: 'x'.repeat(4097) }).expect(400);
      const emptied = await t.api(alice).patch(`/api/messages/${img.id}`).send({ text: '' }).expect(200);
      expect(emptied.body.text).toBeNull();
      const loc = await sendOk(t, alice, g, { type: 'location', location: { latitude: 1, longitude: 2 } });
      await t.api(alice).patch(`/api/messages/${loc.id}`).send({ text: 'x' }).expect(400);
      const sys = (await historyOf(t, alice, g)).find((x) => x.type === 'system')!;
      await t.api(alice).patch(`/api/messages/${sys.id}`).send({ text: 'x' }).expect(400);

      const del = await sendOk(t, alice, g, 'deleted');
      await t.api(alice).delete(`/api/messages/${del.id}?for=everyone`).expect(204);
      await t.api(alice).patch(`/api/messages/${del.id}`).send({ text: 'x' }).expect(403);
      await t.api(carol).patch(`/api/messages/${m.id}`).send({ text: 'x' }).expect(404);
      await t.api(alice).patch(`/api/messages/${crypto.randomUUID()}`).send({ text: 'x' }).expect(404);
      // Lost the right to send (onlyAdminsCanSend) → can't edit either.
      const g2 = await createGroup(alice, [bob]);
      const bm = await sendOk(t, bob, g2, 'mine');
      await db.update(chats).set({ groupSettings: { onlyAdminsCanSend: true, onlyAdminsCanEditInfo: false, onlyAdminsCanAddMembers: false } }).where(eq(chats.id, g2));
      await t.api(bob).patch(`/api/messages/${bm.id}`).send({ text: 'x' }).expect(403);
      // Former members → 403 not_member.
      const g3 = await createGroup(alice, [bob]);
      const fm = await sendOk(t, bob, g3, 'before leaving');
      await leaveGroup(g3, bob);
      const former = await t.api(bob).patch(`/api/messages/${fm.id}`).send({ text: 'x' }).expect(403);
      expect(former.body.error.code).toBe('not_member');
    });

    it('channels: any admin may edit a post; message:updated reaches the whole room; followers cannot', async () => {
      const ch = await createChannel(alice, { admins: [carol] });
      await follow(ch, [bob]);
      const post = await sendOk(t, alice, ch, 'channel post');
      const bs = await t.connect(bob);
      const log = recordEvents(bs);
      const res = await t.api(carol).patch(`/api/messages/${post.id}`).send({ text: 'fixed typo' }).expect(200);
      expect(res.body).toMatchObject({ text: 'fixed typo', senderId: null });
      await settle();
      expect(log.of('message:updated').map((p) => p.message.text)).toEqual(['fixed typo']);
      await t.api(bob).patch(`/api/messages/${post.id}`).send({ text: 'x' }).expect(403);
      bs.disconnect();
    });

    it('message:updated skips members who cannot see the message (joined later / hidden)', async () => {
      const g = await createGroup(alice, [bob]);
      const m = await sendOk(t, alice, g, 'early');
      await addToGroup(g, alice, [carol]);
      await t.api(bob).delete(`/api/messages/${m.id}?for=me`).expect(204);
      const cs = await t.connect(carol);
      const bs = await t.connect(bob);
      const as = await t.connect(alice);
      const lc = recordEvents(cs);
      const lb = recordEvents(bs);
      const la = recordEvents(as);
      await t.api(alice).patch(`/api/messages/${m.id}`).send({ text: 'early (edited)' }).expect(200);
      await settle();
      expect(la.of('message:updated')).toHaveLength(1);
      expect(lb.of('message:updated')).toEqual([]);
      expect(lc.of('message:updated')).toEqual([]);
      for (const s of [cs, bs, as]) s.disconnect();
    });
  });

  describe('DELETE /messages/:messageId', () => {
    it('for me: hidden for me only, my star removed, message:removed → my devices', async () => {
      const g = await createGroup(alice, [bob]);
      const m = await sendOk(t, alice, g, 'bye');
      await t.api(bob).put(`/api/messages/${m.id}/star`).expect(204);
      const b1 = await t.connect(bob);
      const b2 = await t.connect(bob);
      const a1 = await t.connect(alice);
      const l1 = recordEvents(b1);
      const l2 = recordEvents(b2);
      const la = recordEvents(a1);
      await t.api(bob).delete(`/api/messages/${m.id}`).expect(204); // default: for=me
      await settle();
      expect(l1.of('message:removed')).toEqual([{ chatId: g, messageIds: [m.id] }]);
      expect(l2.of('message:removed')).toEqual([{ chatId: g, messageIds: [m.id] }]);
      expect(la.log).toEqual([]);
      expect((await historyOf(t, bob, g)).map((x) => x.id)).not.toContain(m.id);
      expect((await historyOf(t, alice, g)).map((x) => x.id)).toContain(m.id);
      expect(await db.select().from(starredMessages).where(eq(starredMessages.messageId, m.id))).toEqual([]);
      await t.api(bob).delete(`/api/messages/${m.id}?for=me`).expect(404);
      await t.api(bob).delete(`/api/messages/${m.id}?for=nobody`).expect(400);
      // Former members may still delete for themselves; system messages too.
      const sys = (await historyOf(t, bob, g)).find((x) => x.type === 'system')!;
      await leaveGroup(g, bob);
      await t.api(bob).delete(`/api/messages/${sys.id}?for=me`).expect(204);
      for (const s of [b1, b2, a1]) s.disconnect();
    });

    it('for everyone: scrubs content, reactions, pins, stars and votes; tombstone to the room; chat:pins; quotes show deleted', async () => {
      const g = await createGroup(alice, [bob, carol]);
      const poll = await sendOk(t, alice, g, { type: 'poll', poll: { question: 'Q?', options: ['a', 'b'] } });
      const media = await mkMedia(alice.id, 'image');
      const m = await sendOk(t, alice, g, { type: 'image', mediaId: media.id, text: `pic for ${mentionToken(bob.id)}` });
      const reply = await sendOk(t, bob, g, { text: 'nice', replyToId: m.id });
      await t.api(bob).put(`/api/messages/${m.id}/reaction`).send({ emoji: '👍' }).expect(200);
      await t.api(bob).put(`/api/messages/${m.id}/star`).expect(204);
      await t.api(alice).post(`/api/chats/${g}/pins`).send({ messageId: m.id }).expect(200);
      await t.api(bob).put(`/api/messages/${poll.id}/vote`).send({ optionIds: [poll.poll!.options[0]!.id] }).expect(200);

      const bs = await t.connect(bob);
      const log = recordEvents(bs);
      await t.api(alice).delete(`/api/messages/${m.id}?for=everyone`).expect(204);
      await t.api(alice).delete(`/api/messages/${poll.id}?for=everyone`).expect(204);
      await settle();
      const names = log.log.filter((e) => e.event === 'message:updated' || e.event === 'chat:pins').map((e) => e.event);
      expect(names).toEqual(['message:updated', 'chat:pins', 'message:updated']);
      const tomb = log.of('message:updated')[0]!.message;
      expect(tomb).toMatchObject({ id: m.id, type: 'image', text: null, media: null, mentions: [], reactions: [], replyTo: null });
      expect(tomb.deletedAt).not.toBeNull();
      expect(log.of('chat:pins')).toEqual([{ chatId: g, messageIds: [] }]);

      const [row] = await db.select().from(messages).where(eq(messages.id, m.id));
      expect(row).toMatchObject({ text: null, mediaId: null, metadata: {}, mentions: [] });
      expect(await db.select().from(messageReactions).where(eq(messageReactions.messageId, m.id))).toEqual([]);
      expect(await db.select().from(starredMessages).where(eq(starredMessages.messageId, m.id))).toEqual([]);
      expect(await db.select().from(chatPins).where(eq(chatPins.messageId, m.id))).toEqual([]);
      expect(await db.select().from(pollVotes).where(eq(pollVotes.messageId, poll.id))).toEqual([]);
      const history = await historyOf(t, carol, g);
      expect(history.find((x) => x.id === reply.id)!.replyTo).toMatchObject({ id: m.id, deleted: true, text: null, media: null });
      expect(history.find((x) => x.id === poll.id)).toMatchObject({ poll: null, deletedAt: expect.any(String) });
      // Idempotent.
      await t.api(alice).delete(`/api/messages/${m.id}?for=everyone`).expect(204);
      bs.disconnect();
    });

    it('rights: sender within the window; group admins any time; never in direct chats for others; never system messages', async () => {
      const g = await createGroup(alice, [bob, carol], { admins: [carol] });
      const bm = await sendOk(t, bob, g, 'bob says');
      const am = await sendOk(t, alice, g, 'alice says');
      const r = await t.api(bob).delete(`/api/messages/${am.id}?for=everyone`).expect(403);
      expect(r.body.error.code).toBe('forbidden');
      await ageMessage(bm.id, DELETE_FOR_EVERYONE_WINDOW_MS + 1000);
      const late = await t.api(bob).delete(`/api/messages/${bm.id}?for=everyone`).expect(410);
      expect(late.body.error.code).toBe('expired');
      await t.api(carol).delete(`/api/messages/${bm.id}?for=everyone`).expect(204); // admin, any time
      const sys = (await historyOf(t, alice, g)).find((x) => x.type === 'system')!;
      await t.api(alice).delete(`/api/messages/${sys.id}?for=everyone`).expect(400);

      const d = await activeDirect(t, alice, dave);
      const dm = await sendOk(t, dave, d, 'from dave');
      await t.api(alice).delete(`/api/messages/${dm.id}?for=everyone`).expect(403);
      await t.api(dave).delete(`/api/messages/${dm.id}?for=everyone`).expect(204);

      const ch = await createChannel(alice, { admins: [carol] });
      const post = await sendOk(t, alice, ch, 'post');
      await ageMessage(post.id, DELETE_FOR_EVERYONE_WINDOW_MS + 1000);
      await t.api(carol).delete(`/api/messages/${post.id}?for=everyone`).expect(204);

      const g2 = await createGroup(alice, [bob]);
      const fm = await sendOk(t, bob, g2, 'x');
      await leaveGroup(g2, bob);
      const former = await t.api(bob).delete(`/api/messages/${fm.id}?for=everyone`).expect(403);
      expect(former.body.error.code).toBe('not_member');
    });
  });

  describe('reactions', () => {
    it('one reaction per user (replace / remove), myReaction in REST, message:updated to the room', async () => {
      const g = await createGroup(alice, [bob, carol]);
      const m = await sendOk(t, alice, g, 'react to me');
      const as = await t.connect(alice);
      const log = recordEvents(as);
      let res = await t.api(bob).put(`/api/messages/${m.id}/reaction`).send({ emoji: '👍' }).expect(200);
      expect(res.body).toMatchObject({ myReaction: '👍', reactions: [{ emoji: '👍', count: 1, userIds: [bob.id] }] });
      await t.api(carol).put(`/api/messages/${m.id}/reaction`).send({ emoji: '👍' }).expect(200);
      res = await t.api(bob).put(`/api/messages/${m.id}/reaction`).send({ emoji: '❤️' }).expect(200);
      expect(res.body.myReaction).toBe('❤️');
      expect(res.body.reactions).toEqual([
        { emoji: '👍', count: 1, userIds: [carol.id] },
        { emoji: '❤️', count: 1, userIds: [bob.id] },
      ]);
      // Same emoji again → no event.
      await t.api(bob).put(`/api/messages/${m.id}/reaction`).send({ emoji: '❤️' }).expect(200);
      res = await t.api(bob).delete(`/api/messages/${m.id}/reaction`).expect(200);
      expect(res.body).toMatchObject({ myReaction: null, reactions: [{ emoji: '👍', count: 1, userIds: [carol.id] }] });
      await t.api(bob).delete(`/api/messages/${m.id}/reaction`).expect(200);
      await settle();
      const upd = log.of('message:updated');
      expect(upd).toHaveLength(4);
      expect(upd.at(-1)!.message.reactions).toEqual([{ emoji: '👍', count: 1, userIds: [carol.id] }]);
      expect(upd[0]!.message).not.toHaveProperty('myReaction');
      const page = await historyOf(t, carol, g);
      expect(page.find((x) => x.id === m.id)!.myReaction).toBe('👍');
      as.disconnect();
    });

    it('validates emoji and targets; former members → 403', async () => {
      const g = await createGroup(alice, [bob, carol]);
      const m = await sendOk(t, alice, g, 'x');
      await t.api(bob).put(`/api/messages/${m.id}/reaction`).send({ emoji: 'lol' }).expect(400);
      await t.api(bob).put(`/api/messages/${m.id}/reaction`).send({ emoji: '👍👍' }).expect(400);
      await t.api(bob).put(`/api/messages/${m.id}/reaction`).send({ emoji: '👍🏽' }).expect(200);
      await t.api(bob).put(`/api/messages/${m.id}/reaction`).send({ emoji: '👨‍👩‍👧' }).expect(200);
      const sys = (await historyOf(t, bob, g)).find((x) => x.type === 'system')!;
      await t.api(bob).put(`/api/messages/${sys.id}/reaction`).send({ emoji: '👍' }).expect(400);
      const del = await sendOk(t, alice, g, 'gone');
      await t.api(alice).delete(`/api/messages/${del.id}?for=everyone`).expect(204);
      await t.api(bob).put(`/api/messages/${del.id}/reaction`).send({ emoji: '👍' }).expect(400);
      await t.api(dave).put(`/api/messages/${m.id}/reaction`).send({ emoji: '👍' }).expect(404);
      await leaveGroup(g, carol);
      const former = await t.api(carol).put(`/api/messages/${m.id}/reaction`).send({ emoji: '👍' }).expect(403);
      expect(former.body.error.code).toBe('not_member');
    });

    it('channels: reactions setting all / quick / none, anonymous userIds for everyone', async () => {
      const ch = await createChannel(alice);
      await follow(ch, [bob, carol]);
      const post = await sendOk(t, alice, ch, 'post');
      const cs = await t.connect(carol);
      const log = recordEvents(cs);
      const res = await t.api(bob).put(`/api/messages/${post.id}/reaction`).send({ emoji: '🦄' }).expect(200);
      expect(res.body).toMatchObject({ myReaction: '🦄', reactions: [{ emoji: '🦄', count: 1, userIds: [] }], senderId: null });
      await settle();
      expect(log.of('message:updated')[0]!.message.reactions).toEqual([{ emoji: '🦄', count: 1, userIds: [] }]);
      const page = (await t.api(carol).get(`/api/chats/${ch}/messages`).expect(200)).body;
      expect(page.messages.find((x: Message) => x.id === post.id).reactions[0].userIds).toEqual([]);
      expect(page.users.map((u: { id: string }) => u.id)).not.toContain(bob.id);

      const quick = await createChannel(alice, { settings: { reactions: 'quick' } });
      await follow(quick, [bob]);
      const qp = await sendOk(t, alice, quick, 'quick only');
      const denied = await t.api(bob).put(`/api/messages/${qp.id}/reaction`).send({ emoji: '🦄' }).expect(403);
      expect(denied.body.error.code).toBe('forbidden');
      await t.api(bob).put(`/api/messages/${qp.id}/reaction`).send({ emoji: '❤️' }).expect(200);
      await t.api(bob).put(`/api/messages/${qp.id}/reaction`).send({ emoji: '❤' }).expect(200); // without VS16

      const none = await createChannel(alice, { settings: { reactions: 'none' } });
      await follow(none, [bob]);
      const np = await sendOk(t, alice, none, 'no reactions');
      await t.api(bob).put(`/api/messages/${np.id}/reaction`).send({ emoji: '👍' }).expect(403);
      cs.disconnect();
    });
  });

  describe('stars', () => {
    it('star / unstar privately (no events); starred list newest star first with chat previews', async () => {
      const g = await createGroup(alice, [bob], { name: 'Stars group' });
      const d = await activeDirect(t, bob, carol);
      const m1 = await sendOk(t, alice, g, 'first');
      const m2 = await sendOk(t, carol, d, 'second');
      const m3 = await sendOk(t, alice, g, 'third');
      const as = await t.connect(alice);
      const la = recordEvents(as);
      await t.api(bob).put(`/api/messages/${m1.id}/star`).expect(204);
      await new Promise((r) => setTimeout(r, 5));
      await t.api(bob).put(`/api/messages/${m2.id}/star`).expect(204);
      await new Promise((r) => setTimeout(r, 5));
      await t.api(bob).put(`/api/messages/${m3.id}/star`).expect(204);
      await t.api(bob).put(`/api/messages/${m3.id}/star`).expect(204); // idempotent
      await settle();
      expect(la.log).toEqual([]);
      const list = (await t.api(bob).get('/api/messages/starred').expect(200)).body as MessageSearchResult[];
      expect(list.map((r) => r.message.id)).toEqual([m3.id, m2.id, m1.id]);
      expect(list[0]!.message.starred).toBe(true);
      expect(list[0]!.chat).toEqual({ id: g, type: 'group', name: 'Stars group', avatarUrl: null, peer: null });
      expect(list[1]!.chat).toMatchObject({ id: d, type: 'direct', name: null, peer: { id: carol.id, displayName: 'Carol' } });
      expect((await historyOf(t, bob, g)).find((x) => x.id === m1.id)!.starred).toBe(true);
      expect((await historyOf(t, alice, g)).find((x) => x.id === m1.id)!.starred).toBe(false);

      await t.api(bob).delete(`/api/messages/${m3.id}/star`).expect(204);
      await t.api(bob).delete(`/api/messages/${m3.id}/star`).expect(204);
      expect(((await t.api(bob).get('/api/messages/starred').expect(200)).body as MessageSearchResult[]).map((r) => r.message.id)).toEqual([m2.id, m1.id]);
      // Invisible → 404; system → 400; after leaving, stars outside the window disappear from the list.
      await t.api(dave).put(`/api/messages/${m1.id}/star`).expect(404);
      const sys = (await historyOf(t, bob, g)).find((x) => x.type === 'system')!;
      await t.api(bob).put(`/api/messages/${sys.id}/star`).expect(400);
      await t.api(alice).delete(`/api/messages/${m1.id}?for=everyone`).expect(204);
      expect(((await t.api(bob).get('/api/messages/starred').expect(200)).body as MessageSearchResult[]).map((r) => r.message.id)).toEqual([m2.id]);
      as.disconnect();
    });
  });

  describe('GET /messages/:messageId/info', () => {
    it('sender only; readBy / deliveredTo / pending from watermarks; 404 in channels', async () => {
      const g = await createGroup(alice, [bob, carol, dave]);
      const bs = await t.connect(bob);
      const cs = await t.connect(carol);
      await goOffline(dave);
      const m = await sendOk(t, alice, g, 'who read this?');
      await emitAck(bs, 'chat:read', { chatId: g, seq: m.seq });
      const info = (await t.api(alice).get(`/api/messages/${m.id}/info`).expect(200)).body as MessageInfo;
      expect(info.messageId).toBe(m.id);
      expect(info.readBy.map((r) => r.user.id)).toEqual([bob.id]);
      expect(info.readBy[0]!.at).not.toBeNull();
      expect(info.deliveredTo.map((r) => r.user.id)).toEqual([carol.id]);
      expect(info.pending.map((u) => u.id)).toEqual([dave.id]);
      const denied = await t.api(bob).get(`/api/messages/${m.id}/info`).expect(403);
      expect(denied.body.error.code).toBe('forbidden');
      await t.createUser().then((u) => t.api(u).get(`/api/messages/${m.id}/info`).expect(404));
      // Members who joined after the message are not listed.
      const late = await t.createUser();
      await addToGroup(g, alice, [late]);
      const again = (await t.api(alice).get(`/api/messages/${m.id}/info`).expect(200)).body as MessageInfo;
      expect([...again.readBy.map((r) => r.user.id), ...again.deliveredTo.map((r) => r.user.id), ...again.pending.map((u) => u.id)]).not.toContain(late.id);

      const ch = await createChannel(alice);
      const post = await sendOk(t, alice, ch, 'post');
      await t.api(alice).get(`/api/messages/${post.id}/info`).expect(404);
      bs.disconnect();
      cs.disconnect();
    });

    it('direct chats with read receipts off report delivery only', async () => {
      const u1 = await t.createUser();
      const u2 = await t.createUser();
      const d = await activeDirect(t, u1, u2);
      const m = await sendOk(t, u1, d, 'receipt?');
      await t.api(u2).post(`/api/chats/${d}/read`).send({ seq: m.seq }).expect(204);
      let info = (await t.api(u1).get(`/api/messages/${m.id}/info`).expect(200)).body as MessageInfo;
      expect(info.readBy.map((r) => r.user.id)).toEqual([u2.id]);
      await setSettings(u2.id, { readReceipts: false });
      info = (await t.api(u1).get(`/api/messages/${m.id}/info`).expect(200)).body as MessageInfo;
      expect(info.readBy).toEqual([]);
      expect(info.deliveredTo.map((r) => r.user.id)).toEqual([u2.id]);
      // Self chat: nobody else.
      const self = await openDirect(t, u1, u1);
      const note = await sendOk(t, u1, self.id, 'note');
      expect((await t.api(u1).get(`/api/messages/${note.id}/info`).expect(200)).body).toEqual({ messageId: note.id, readBy: [], deliveredTo: [], pending: [] });
    });
  });

  describe('POST /messages/forward', () => {
    it('copies content to every target (forwardCount + 1, fresh poll ids, target timer, mentions re-derived) and fans out per copy', async () => {
      const src = await createGroup(alice, [bob]);
      const t1 = await createGroup(alice, [carol], { disappearingSeconds: 86_400 });
      const t2 = await activeDirect(t, alice, dave);
      const status = await mkStatus(bob.id, [alice.id]);
      const d = await openDirect(t, alice, bob);
      const statusReply = await sendOk(t, alice, d.id, { text: `re ${mentionToken(carol.id)}`, statusReplyToId: status.id });
      const img = await sendOk(t, bob, src, { type: 'image', mediaId: (await mkMedia(bob.id)).id, text: 'photo' });
      const poll = await sendOk(t, bob, src, { type: 'poll', poll: { question: 'Q', options: ['x', 'y'] }, replyToId: img.id });
      await t.api(alice).put(`/api/messages/${poll.id}/vote`).send({ optionIds: [poll.poll!.options[0]!.id] }).expect(200);
      await t.api(alice).put(`/api/messages/${img.id}/reaction`).send({ emoji: '🔥' }).expect(200);

      const cs = await t.connect(carol);
      const logC = recordEvents(cs);
      const res = await t.api(alice).post('/api/messages/forward').send({ clientId: 'fwd-1', messageIds: [img.id, poll.id, statusReply.id], chatIds: [t1, t2] }).expect(201);
      const out = res.body as Message[];
      expect(out.map((m) => [m.chatId, m.type])).toEqual([
        [t1, 'image'],
        [t1, 'poll'],
        [t1, 'text'],
        [t2, 'image'],
        [t2, 'poll'],
        [t2, 'text'],
      ]);
      for (const m of out) {
        expect(m.senderId).toBe(alice.id);
        expect(m.forwardCount).toBe(1);
        expect(m.replyTo).toBeNull();
        expect(m.statusReply).toBeNull();
        expect(m.reactions).toEqual([]);
      }
      expect(out[0]).toMatchObject({ text: 'photo', media: { id: img.media!.id }, clientId: 'fwd-1:0' });
      expect(out[0]!.expiresAt).not.toBeNull();
      expect(out[3]!.expiresAt).toBeNull();
      expect(out[1]!.poll).toMatchObject({ question: 'Q', totalVoters: 0, myOptionIds: [] });
      expect(out[1]!.poll!.options.map((o) => o.id)).not.toEqual(poll.poll!.options.map((o) => o.id));
      expect(out[2]!.mentions).toEqual([carol.id]); // carol is in t1
      expect(out[5]!.mentions).toEqual([]); // not in the direct chat with dave
      await settle();
      expect(logC.of('message:new').map((p) => p.message.id)).toEqual(out.slice(0, 3).map((m) => m.id));

      // Retry: idempotent, same messages, 200, nothing new.
      logC.clear();
      const retry = await t.api(alice).post('/api/messages/forward').send({ clientId: 'fwd-1', messageIds: [img.id, poll.id, statusReply.id], chatIds: [t1, t2] }).expect(200);
      expect((retry.body as Message[]).map((m) => m.id)).toEqual(out.map((m) => m.id));
      await settle();
      expect(logC.log).toEqual([]);

      // Forwarding a forward increments again.
      const again = await t.api(alice).post('/api/messages/forward').send({ clientId: 'fwd-2', messageIds: [out[0]!.id], chatIds: [src] }).expect(201);
      expect(again.body[0].forwardCount).toBe(2);
      cs.disconnect();
    });

    it('sources must be visible, not deleted, not system; targets need canSend (nothing is created on failure)', async () => {
      const g = await createGroup(alice, [bob]);
      const hiddenFromCarol = await sendOk(t, alice, g, 'not for carol');
      const carolChat = await createGroup(carol, []);
      await t.api(carol).post('/api/messages/forward').send({ clientId: 'f1', messageIds: [hiddenFromCarol.id], chatIds: [carolChat] }).expect(404);
      const sys = (await historyOf(t, alice, g)).find((x) => x.type === 'system')!;
      await t.api(alice).post('/api/messages/forward').send({ clientId: 'f2', messageIds: [sys.id], chatIds: [g] }).expect(400);
      const del = await sendOk(t, alice, g, 'gone');
      await t.api(alice).delete(`/api/messages/${del.id}?for=everyone`).expect(204);
      await t.api(alice).post('/api/messages/forward').send({ clientId: 'f3', messageIds: [del.id], chatIds: [g] }).expect(400);

      const ok = await sendOk(t, alice, g, 'forward me');
      const adminsOnly = await createGroup(dave, [alice], { settings: { onlyAdminsCanSend: true } });
      const before = await db.select().from(messages).where(eq(messages.chatId, g));
      const denied = await t.api(alice).post('/api/messages/forward').send({ clientId: 'f4', messageIds: [ok.id], chatIds: [g, adminsOnly] }).expect(403);
      expect(denied.body.error.code).toBe('forbidden');
      expect(await db.select().from(messages).where(eq(messages.chatId, g))).toHaveLength(before.length);
      await t.api(alice).post('/api/messages/forward').send({ clientId: 'f5', messageIds: [ok.id], chatIds: [crypto.randomUUID()] }).expect(404);
      await t.api(alice).post('/api/messages/forward').send({ clientId: 'f6', messageIds: [ok.id, ok.id], chatIds: [g] }).expect(400);
      await t.api(alice).post('/api/messages/forward').send({ clientId: 'f7', messageIds: [ok.id], chatIds: Array.from({ length: 6 }, () => crypto.randomUUID()) }).expect(400);
    });
  });

  describe('PUT /messages/:messageId/vote', () => {
    it('single choice: replace / retract; unknown options and multiple ids → 400; message:updated', async () => {
      const g = await createGroup(alice, [bob, carol]);
      const poll = await sendOk(t, alice, g, { type: 'poll', poll: { question: 'Best?', options: ['A', 'B', 'C'] } });
      const [a, b] = poll.poll!.options.map((o) => o.id);
      const as = await t.connect(alice);
      const log = recordEvents(as);
      let res = await t.api(bob).put(`/api/messages/${poll.id}/vote`).send({ optionIds: [a] }).expect(200);
      expect(res.body.poll).toMatchObject({ totalVoters: 1, myOptionIds: [a] });
      expect(res.body.poll.options[0]).toMatchObject({ id: a, voteCount: 1, voterIds: [bob.id] });
      res = await t.api(bob).put(`/api/messages/${poll.id}/vote`).send({ optionIds: [b] }).expect(200);
      expect(res.body.poll.options.map((o: { voteCount: number }) => o.voteCount)).toEqual([0, 1, 0]);
      await t.api(bob).put(`/api/messages/${poll.id}/vote`).send({ optionIds: [b] }).expect(200); // unchanged
      await t.api(bob).put(`/api/messages/${poll.id}/vote`).send({ optionIds: [a, b] }).expect(400);
      await t.api(bob).put(`/api/messages/${poll.id}/vote`).send({ optionIds: ['nope'] }).expect(400);
      await t.api(bob).put(`/api/messages/${poll.id}/vote`).send({ optionIds: [a, a] }).expect(400);
      await t.api(carol).put(`/api/messages/${poll.id}/vote`).send({ optionIds: [b] }).expect(200);
      res = await t.api(bob).put(`/api/messages/${poll.id}/vote`).send({ optionIds: [] }).expect(200);
      expect(res.body.poll).toMatchObject({ totalVoters: 1, myOptionIds: [] });
      await settle();
      const upd = log.of('message:updated');
      expect(upd).toHaveLength(4);
      expect(upd.at(-1)!.message.poll).toMatchObject({ totalVoters: 1 });
      expect(upd.at(-1)!.message.poll).not.toHaveProperty('myOptionIds');
      const text = await sendOk(t, alice, g, 'not a poll');
      await t.api(bob).put(`/api/messages/${text.id}/vote`).send({ optionIds: [] }).expect(400);
      await t.api(dave).put(`/api/messages/${poll.id}/vote`).send({ optionIds: [a] }).expect(404);
      as.disconnect();
    });

    it('multiple choice; channels are anonymous', async () => {
      const ch = await createChannel(alice);
      await follow(ch, [bob, carol]);
      const poll = await sendOk(t, alice, ch, { type: 'poll', poll: { question: 'Pick', options: ['1', '2', '3'], allowMultiple: true } });
      const ids = poll.poll!.options.map((o) => o.id);
      const res = await t.api(bob).put(`/api/messages/${poll.id}/vote`).send({ optionIds: [ids[0], ids[2]] }).expect(200);
      expect(res.body.poll).toMatchObject({ totalVoters: 1, myOptionIds: [ids[0], ids[2]] });
      await t.api(carol).put(`/api/messages/${poll.id}/vote`).send({ optionIds: [ids[2]] }).expect(200);
      const page = (await t.api(alice).get(`/api/chats/${ch}/messages`).expect(200)).body;
      const p = page.messages.find((m: Message) => m.id === poll.id).poll;
      expect(p.options.map((o: { voteCount: number; voterIds: string[] }) => [o.voteCount, o.voterIds])).toEqual([
        [1, []],
        [0, []],
        [2, []],
      ]);
      expect(p.totalVoters).toBe(2);
      expect(p.myOptionIds).toEqual([]);
    });
  });

  describe('GET /search/messages', () => {
    it('finds only messages visible to me, optionally in one chat, newest first', async () => {
      const g = await createGroup(alice, [bob]);
      const other = await createGroup(carol, [dave]);
      const a1 = await sendOk(t, alice, g, 'the Quokka is happy');
      await sendOk(t, carol, other, 'quokka elsewhere');
      const cap = await sendOk(t, bob, g, { type: 'image', mediaId: (await mkMedia(bob.id)).id, text: 'QUOKKA photo' });
      const gone = await sendOk(t, alice, g, 'quokka deleted');
      await t.api(alice).delete(`/api/messages/${gone.id}?for=everyone`).expect(204);
      const hidden = await sendOk(t, alice, g, 'quokka hidden');
      await t.api(bob).delete(`/api/messages/${hidden.id}?for=me`).expect(204);
      const d = await activeDirect(t, bob, dave);
      const dm = await sendOk(t, dave, d, 'a quokka for bob');

      const res = (await t.api(bob).get('/api/search/messages?q=quokka').expect(200)).body as MessageSearchResult[];
      expect(res.map((r) => r.message.id)).toEqual([dm.id, cap.id, a1.id]);
      expect(res[0]!.chat).toMatchObject({ id: d, type: 'direct', peer: { id: dave.id } });
      expect(res[1]!.chat).toMatchObject({ id: g, type: 'group', name: 'Group', peer: null });
      const inChat = (await t.api(bob).get(`/api/search/messages?q=quokka&chatId=${g}&limit=1`).expect(200)).body as MessageSearchResult[];
      expect(inChat.map((r) => r.message.id)).toEqual([cap.id]);
      await t.api(bob).get(`/api/search/messages?q=quokka&chatId=${other}`).expect(404);
      await t.api(bob).get('/api/search/messages?q=').expect(400);
      await t.api(bob).get('/api/search/messages?q=x&limit=101').expect(400);
    });

    it('respects membership windows: nothing before joined_seq, nothing after left_seq, nothing cleared', async () => {
      const g = await createGroup(alice, [bob]);
      await sendOk(t, alice, g, 'zebra before carol');
      await addToGroup(g, alice, [carol]);
      const during = await sendOk(t, alice, g, 'zebra while carol is here');
      await leaveGroup(g, carol);
      await sendOk(t, alice, g, 'zebra after carol left');
      const res = (await t.api(carol).get('/api/search/messages?q=zebra').expect(200)).body as MessageSearchResult[];
      expect(res.map((r) => r.message.id)).toEqual([during.id]);
      await t.api(bob).post(`/api/chats/${g}/clear`).expect(204);
      expect((await t.api(bob).get('/api/search/messages?q=zebra').expect(200)).body).toEqual([]);
      const newer = await sendOk(t, alice, g, 'zebra after clear');
      expect(((await t.api(bob).get('/api/search/messages?q=zebra').expect(200)).body as MessageSearchResult[]).map((r) => r.message.id)).toEqual([newer.id]);
    });

    it('search and the starred list use a fixed number of queries (no N+1)', async () => {
      const u = await t.createUser();
      const peers = await Promise.all([1, 2, 3, 4, 5, 6].map(() => t.createUser()));
      const run = async (n: number) => {
        await db.delete(starredMessages).where(eq(starredMessages.userId, u.id));
        for (const p of peers.slice(0, n)) {
          const d = await activeDirect(t, p, u);
          const g = await createGroup(p, [u]);
          for (const chatId of [d, g]) {
            const m = await sendOk(t, p, chatId, `needle ${n} ${mentionToken(u.id)}`);
            await t.api(u).put(`/api/messages/${m.id}/star`).expect(204);
            await t.api(u).put(`/api/messages/${m.id}/reaction`).send({ emoji: '👍' }).expect(200);
          }
        }
        const search = await countQueries(() => searchMessages(u.id, { q: `needle ${n}`, limit: 50 }));
        const starred = await countQueries(() => listStarred(u.id));
        expect(search.result).toHaveLength(2 * n);
        expect(starred.result).toHaveLength(2 * n);
        return [search.queries, starred.queries];
      };
      const small = await run(1);
      const large = await run(6);
      expect(large).toEqual(small);
    });

    it('escapes LIKE wildcards', async () => {
      const g = await createGroup(dave, []);
      const pct = await sendOk(t, dave, g, 'discount 100% off');
      const under = await sendOk(t, dave, g, 'snake_case name');
      await sendOk(t, dave, g, 'discount 1000 off');
      await sendOk(t, dave, g, 'snakeXcase name');
      const back = await sendOk(t, dave, g, 'path C:\\temp');
      const q = async (s: string) => ((await t.api(dave).get(`/api/search/messages?q=${encodeURIComponent(s)}`).expect(200)).body as MessageSearchResult[]).map((r) => r.message.id);
      expect(await q('100%')).toEqual([pct.id]);
      expect(await q('e_c')).toEqual([under.id]);
      expect(await q('C:\\t')).toEqual([back.id]);
      expect(escapeLike('a%b_c\\d')).toBe('a\\%b\\_c\\\\d');
    });
  });

  describe('channels are never a reply-privately source', () => {
    it('only groups qualify', async () => {
      const ch = await createChannel(bob);
      await follow(ch, [alice]);
      const post = await sendOk(t, bob, ch, 'post');
      const d = await openDirect(t, alice, bob);
      await sendReq(t, alice, d.id, { replyToId: post.id }).expect(404);
    });
  });
});
