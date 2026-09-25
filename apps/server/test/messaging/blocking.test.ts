/**
 * Blocking in direct chats (docs "Blocking"): whatever the blocked party does in the chat —
 * sends, timer changes, pins, edits, reactions, votes, calls — is never emitted or pushed to
 * the blocker, never unhides the blocker's chat and never moves the blocker's marks (so the
 * blocked party's ticks stay single). Regression tests for review findings AUTHZ-1, P1, P2,
 * P3 and F1.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Message } from '@enbox/shared';
import { resetCallState } from '../../src/modules/calls/state.js';
import { startTestServer, type TestServer, type TestUser } from '../helpers.js';
import { ackCall } from '../calls/helpers.js';
import { block, recordEvents, settle } from '../services/fixtures.js';
import { activeDirect, historyOf, memberOf, openDirect, sendOk, summaryOf } from './support.js';

describe('blocking: the blocked party never reaches the blocker', () => {
  let t: TestServer;

  beforeAll(async () => {
    t = await startTestServer();
  });
  afterAll(async () => {
    resetCallState();
    await t.close();
  });

  /** Events of a recorded socket that mention `id` anywhere in their payload. */
  const mentioning = (log: { event: string; payload: unknown }[], id: string) => log.filter((e) => JSON.stringify(e.payload ?? null).includes(id));

  const pair = async (): Promise<[TestUser, TestUser]> => [await t.createUser(), await t.createUser()];

  describe('sends (P1): no chat:watermarks for withheld messages', () => {
    it('a brand-new direct chat the blocker has never seen: no event carries its id', async () => {
      const [a, b] = await pair();
      await block(b, a);
      const chat = await openDirect(t, a, b); // b's row is hidden, nothing emitted to b
      const sb = await t.connect(b);
      const lb = recordEvents(sb);
      await sendOk(t, a, chat.id, 'withheld 1');
      await settle();
      expect(mentioning(lb.log, chat.id)).toEqual([]);
      expect((await memberOf(chat.id, b))!.hidden).toBe(true);
      sb.disconnect();
    });

    it('a chat the blocker deleted: no chat:watermarks at the moment of each withheld send', async () => {
      const [a, b] = await pair();
      const d = await activeDirect(t, a, b);
      await sendOk(t, b, d, 'hi back');
      await t.api(b).delete(`/api/chats/${d}`).expect(204);
      await block(b, a);
      const sb = await t.connect(b);
      const lb = recordEvents(sb);
      await sendOk(t, a, d, 'withheld 2');
      await sendOk(t, a, d, 'withheld 3');
      await settle();
      expect((await memberOf(d, b))!.hidden).toBe(true);
      expect(mentioning(lb.log, d)).toEqual([]);
      sb.disconnect();
    });

    it('a chat the blocker still sees: the withheld send moves none of their ticks', async () => {
      const [a, b] = await pair();
      const d = await activeDirect(t, a, b);
      await sendOk(t, b, d, 'hi back');
      await block(b, a);
      const sb = await t.connect(b);
      const lb = recordEvents(sb);
      await sendOk(t, a, d, 'withheld 4');
      await settle();
      expect(lb.log).toEqual([]);
      sb.disconnect();
    });

    it('a call to a callee who blocked the caller: the call message is withheld without any event (known issue 1)', async () => {
      const [a, b] = await pair();
      const d = await activeDirect(t, a, b);
      await t.api(b).delete(`/api/chats/${d}`).expect(204);
      await block(b, a);
      const sa = await t.connect(a);
      const sb = await t.connect(b);
      const lb = recordEvents(sb);
      const call = await ackCall(sa, 'call:start', { chatId: d, type: 'audio' });
      await settle(300);
      expect(mentioning(lb.log, d)).toEqual([]);
      expect(mentioning(lb.log, call.id)).toEqual([]);
      expect((await memberOf(d, b))!.hidden).toBe(true);
      sa.disconnect();
      sb.disconnect();
    });
  });

  describe('timer changes (AUTHZ-1, P2, F1)', () => {
    it('never unhide the chat of a blocker who never saw it, nor notify them', async () => {
      const [a, b] = await pair();
      await block(b, a);
      const chat = await openDirect(t, a, b);
      const sb = await t.connect(b);
      const lb = recordEvents(sb);
      await t.api(a).put(`/api/chats/${chat.id}/disappearing`).send({ seconds: 86_400 }).expect(200);
      await settle();
      expect((await memberOf(chat.id, b))!.hidden).toBe(true);
      expect(mentioning(lb.log, chat.id)).toEqual([]);
      sb.disconnect();
    });

    it("never unhide the blocker's deleted chat nor move their delivered mark past withheld messages", async () => {
      const [a, b] = await pair();
      const d = await activeDirect(t, a, b);
      await sendOk(t, b, d, 'hi back');
      await t.api(b).delete(`/api/chats/${d}`).expect(204);
      await block(b, a);
      const sb = await t.connect(b);
      const lb = recordEvents(sb);
      const m1 = await sendOk(t, a, d, 'withheld 1');
      await t.api(a).put(`/api/chats/${d}/disappearing`).send({ seconds: 86_400 }).expect(200);
      await settle();
      expect(lb.log).toEqual([]);
      expect((await memberOf(d, b))!.hidden).toBe(true);
      // "clamping keeps my ticks single": B (online) never had M1 or the timer message delivered.
      expect((await summaryOf(t, a, d)).deliveredWatermark).toBeLessThan(m1.seq);
      // The system message is withheld from B like a send (never in B's history).
      await t.api(b).post('/api/chats/direct').send({ userId: a.id }).expect(200);
      expect((await historyOf(t, b, d)).filter((m) => m.type === 'system')).toEqual([]);
      sb.disconnect();
    });

    it('a blocker who still sees the chat gets no chat:updated either', async () => {
      const [a, b] = await pair();
      const d = await activeDirect(t, a, b);
      await block(b, a);
      const sb = await t.connect(b);
      const lb = recordEvents(sb);
      await t.api(a).put(`/api/chats/${d}/disappearing`).send({ seconds: 604_800 }).expect(200);
      await settle();
      expect(lb.log).toEqual([]);
      sb.disconnect();
    });
  });

  describe('pins (AUTHZ-1, P2, F1)', () => {
    it("pinning a withheld message never unhides the blocker's chat nor reaches them", async () => {
      const [a, b] = await pair();
      await block(b, a);
      const chat = await openDirect(t, a, b);
      const m = await sendOk(t, a, chat.id, 'withheld');
      const sb = await t.connect(b);
      const lb = recordEvents(sb);
      await t.api(a).post(`/api/chats/${chat.id}/pins`).send({ messageId: m.id }).expect(200);
      await settle();
      expect((await memberOf(chat.id, b))!.hidden).toBe(true);
      expect(mentioning(lb.log, chat.id)).toEqual([]);
      sb.disconnect();
    });

    it("never reveals the withheld message's id to a blocker in the room (pin and unpin)", async () => {
      const [a, b] = await pair();
      const d = await activeDirect(t, a, b);
      await block(b, a);
      const sb = await t.connect(b); // b's row is visible: b is in the chat room
      const lb = recordEvents(sb);
      const withheld = await sendOk(t, a, d, 'withheld 3');
      await t.api(a).post(`/api/chats/${d}/pins`).send({ messageId: withheld.id }).expect(200);
      await t.api(a).delete(`/api/chats/${d}/pins/${withheld.id}`).expect(200);
      await settle();
      expect(lb.log).toEqual([]);
      sb.disconnect();
    });

    it("the blocker's own pins list them without the blocked party's withheld pin", async () => {
      const [a, b] = await pair();
      const d = await activeDirect(t, a, b);
      const mine = await sendOk(t, b, d, 'pin me');
      await block(b, a);
      const withheld = await sendOk(t, a, d, 'withheld pin');
      await t.api(a).post(`/api/chats/${d}/pins`).send({ messageId: withheld.id }).expect(200);
      const sa = await t.connect(a);
      const sb = await t.connect(b);
      const [la, lb] = [recordEvents(sa), recordEvents(sb)];
      await t.api(b).post(`/api/chats/${d}/pins`).send({ messageId: mine.id }).expect(200);
      await settle();
      expect(lb.of('chat:pins')).toEqual([{ chatId: d, messageIds: [mine.id] }]);
      expect(la.of('chat:pins')).toEqual([{ chatId: d, messageIds: [withheld.id, mine.id] }]);
      expect(mentioning(lb.log, withheld.id)).toEqual([]);
      sa.disconnect();
      sb.disconnect();
    });

    it("keep the sender's ticks single for the pinned withheld message (delivered and read)", async () => {
      const [a, b] = await pair();
      const d = await activeDirect(t, a, b);
      await sendOk(t, b, d, 'hi back');
      await block(b, a);
      const sb = await t.connect(b);
      const m1 = await sendOk(t, a, d, 'withheld 1');
      await t.api(a).post(`/api/chats/${d}/pins`).send({ messageId: m1.id }).expect(200);
      await settle();
      // B opens the chat and reads everything B can see.
      await t.api(b).post(`/api/chats/${d}/read`).send({ seq: (await summaryOf(t, b, d)).lastSeq }).expect((r) => expect(r.status).toBeLessThan(300));
      const mine = await summaryOf(t, a, d);
      expect(mine.deliveredWatermark).toBeLessThan(m1.seq);
      expect(mine.readWatermark).toBeLessThan(m1.seq);
      sb.disconnect();
    });
  });

  describe('edits, reactions and votes (P3)', () => {
    it('are applied but never emitted to the blocker; their history leaves them out', async () => {
      const [a, b] = await pair();
      const d = await activeDirect(t, a, b);
      const beforeBlock = await sendOk(t, a, d, 'typo');
      const bMsg = await sendOk(t, b, d, 'react to me');
      const poll = await sendOk(t, b, d, { type: 'poll', poll: { question: 'Lunch?', options: ['yes', 'no'] } });
      await block(b, a);
      const sa = await t.connect(a);
      const sb = await t.connect(b);
      const [la, lb] = [recordEvents(sa), recordEvents(sb)];

      await t.api(a).patch(`/api/messages/${beforeBlock.id}`).send({ text: 'fixed' }).expect(200);
      const reacted = (await t.api(a).put(`/api/messages/${bMsg.id}/reaction`).send({ emoji: '👍' }).expect(200)).body as Message;
      expect(reacted.reactions).toEqual([{ emoji: '👍', count: 1, userIds: [a.id] }]);
      const voted = (await t.api(a).put(`/api/messages/${poll.id}/vote`).send({ optionIds: [poll.poll!.options[0]!.id] }).expect(200)).body as Message;
      expect(voted.poll!.options[0]).toMatchObject({ voteCount: 1, voterIds: [a.id] });
      await t.api(a).delete(`/api/messages/${bMsg.id}/reaction`).expect(200);
      await t.api(a).put(`/api/messages/${bMsg.id}/reaction`).send({ emoji: '🎉' }).expect(200);
      await settle();

      // The blocked party's own devices see everything; the blocker receives nothing live.
      expect(la.of('message:updated').length).toBe(5);
      expect(lb.log).toEqual([]);

      // Viewer-specific history: the blocker doesn't see the blocked party's reaction/vote.
      const bView = await historyOf(t, b, d);
      expect(bView.find((m) => m.id === bMsg.id)!.reactions).toEqual([]);
      expect(bView.find((m) => m.id === poll.id)!.poll).toMatchObject({ totalVoters: 0, options: [{ voteCount: 0, voterIds: [] }, { voteCount: 0, voterIds: [] }] });
      // ...while the blocked party's view of the same messages is complete.
      const aView = await historyOf(t, a, d);
      expect(aView.find((m) => m.id === bMsg.id)!.reactions).toEqual([{ emoji: '🎉', count: 1, userIds: [a.id] }]);
      expect(aView.find((m) => m.id === poll.id)!.poll!.totalVoters).toBe(1);

      // The blocker's own interactions still reach both of them.
      await t.api(b).put(`/api/messages/${bMsg.id}/reaction`).send({ emoji: '❤️' }).expect(200);
      await settle();
      expect(lb.of('message:updated').map((p) => p.message.id)).toEqual([bMsg.id]);
      sa.disconnect();
      sb.disconnect();
    });
  });
});
