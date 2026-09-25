import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  CALL_RING_TIMEOUT_MS,
  MUTE_FOREVER_ISO,
  PUSH_MESSAGE_TTL_SEC,
  mentionToken,
  type PushPayload,
} from '@enbox/shared';
import { config } from '../../src/config.js';
import { db } from '../../src/db/index.js';
import { callParticipants, calls, chatMembers, pushSubscriptions } from '../../src/db/schema.js';
import {
  getPushSender,
  pushIdle,
  setPushSender,
  type PushOptions,
  type PushTarget,
} from '../../src/modules/push/sender.js';
import { transact } from '../../src/services/effects.js';
import { domainEvents } from '../../src/services/events.js';
import { upsertMembership } from '../../src/services/membership.js';
import { advanceRead } from '../../src/services/watermarks.js';
import { startTestServer, type TestServer, type TestUser } from '../helpers.js';
import {
  block,
  createChannel,
  createDirect,
  createGroup,
  saveContact,
  send,
  setSettings,
} from '../services/fixtures.js';
import { giveProfile, newDevice } from './util.js';

interface Sent {
  endpoint: string;
  payload: PushPayload;
  opts: PushOptions;
}

describe('push: subscriptions and notifications', () => {
  let t: TestServer;
  let sent: Sent[];
  /** endpoint → statusCode to fail with. */
  let failWith: Map<string, number>;
  let endpointCounter = 0;

  const fakeSender = async (target: PushTarget, payload: PushPayload, opts: PushOptions) => {
    const status = failWith.get(target.endpoint);
    if (status) throw Object.assign(new Error(`push failed ${status}`), { statusCode: status });
    sent.push({ endpoint: target.endpoint, payload, opts });
  };

  beforeAll(async () => {
    t = await startTestServer();
    setPushSender(fakeSender);
  });
  afterAll(async () => {
    setPushSender(undefined);
    await t.close();
  });
  beforeEach(() => {
    sent = [];
    failWith = new Map();
  });

  /** Subscribe a user's device through the API; returns the endpoint. */
  async function subscribe(user: TestUser): Promise<string> {
    const endpoint = `https://fcm.googleapis.com/fcm/send/device-${++endpointCounter}`;
    await t
      .api(user)
      .post('/api/push/subscriptions')
      .send({ endpoint, keys: { p256dh: 'BPublicKey', auth: 'authSecret' } })
      .expect(204);
    return endpoint;
  }

  const to = (endpoint: string) => sent.filter((s) => s.endpoint === endpoint);

  describe('POST/DELETE /push/subscriptions', () => {
    it('stores the subscription bound to my user and session', async () => {
      const u = await t.createUser();
      const endpoint = await subscribe(u);
      const [row] = await db
        .select()
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.endpoint, endpoint));
      expect(row).toMatchObject({
        userId: u.id,
        sessionId: u.sessionId,
        p256dh: 'BPublicKey',
        auth: 'authSecret',
      });
    });

    it.each([
      'http://fcm.googleapis.com/fcm/send/x',
      'https://evil.example.com/push',
      'https://fcm.googleapis.com.evil.com/x',
      'https://user@fcm.googleapis.com/x',
      'https://127.0.0.1/x',
      'not a url',
    ])('rejects the endpoint %s (anti-SSRF allowlist)', async (endpoint) => {
      const u = await t.createUser();
      const res = await t
        .api(u)
        .post('/api/push/subscriptions')
        .send({ endpoint, keys: { p256dh: 'p', auth: 'a' } })
        .expect(400);
      expect(res.body.error.code).toBe('validation_error');
    });

    it('accepts the allow-listed push services and validates keys', async () => {
      const u = await t.createUser();
      for (const endpoint of [
        'https://updates.push.services.mozilla.com/wpush/v2/x',
        'https://web.push.apple.com/abc',
        'https://wns2-par02p.notify.windows.com/w/?token=x',
      ]) {
        await t
          .api(u)
          .post('/api/push/subscriptions')
          .send({ endpoint, keys: { p256dh: 'p', auth: 'a' } })
          .expect(204);
      }
      await t
        .api(u)
        .post('/api/push/subscriptions')
        .send({ endpoint: 'https://fcm.googleapis.com/fcm/send/k' })
        .expect(400);
      await t
        .api(u)
        .post('/api/push/subscriptions')
        .send({
          endpoint: 'https://fcm.googleapis.com/fcm/send/k',
          keys: { p256dh: '', auth: 'a' },
        })
        .expect(400);
    });

    it('upserts by endpoint: subscribing again reassigns the row to the current user and session', async () => {
      const a = await t.createUser();
      const b = await t.createUser();
      const endpoint = await subscribe(a);
      await t
        .api(b)
        .post('/api/push/subscriptions')
        .send({ endpoint, keys: { p256dh: 'new', auth: 'new' } })
        .expect(204);
      const rows = await db
        .select()
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.endpoint, endpoint));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        userId: b.id,
        sessionId: b.sessionId,
        p256dh: 'new',
        auth: 'new',
      });
    });

    it('unsubscribes only my own subscription (idempotent 204)', async () => {
      const a = await t.createUser();
      const b = await t.createUser();
      const endpoint = await subscribe(a);
      await t.api(b).delete('/api/push/subscriptions').send({ endpoint }).expect(204);
      expect(
        await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint)),
      ).toHaveLength(1);
      await t.api(a).delete('/api/push/subscriptions').send({ endpoint }).expect(204);
      expect(
        await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint)),
      ).toHaveLength(0);
      await t.api(a).delete('/api/push/subscriptions').send({ endpoint }).expect(204);
      await t.api(a).delete('/api/push/subscriptions').send({}).expect(400);
    });
  });

  describe('message pushes', () => {
    let alice: TestUser;
    let bob: TestUser;
    let bobTablet: TestUser;
    let aliceEp: string;
    let bobEp: string;
    let bobEp2: string;
    let direct: string;

    beforeAll(async () => {
      alice = await t.createUser({ displayName: 'Alice' });
      bob = await t.createUser({ displayName: 'Bob' });
      bobTablet = await newDevice(bob, 'Tablet');
      direct = await createDirect(alice, bob);
    });
    beforeEach(async () => {
      await db.delete(pushSubscriptions);
      aliceEp = await subscribe(alice);
      bobEp = await subscribe(bob);
      bobEp2 = await subscribe(bobTablet);
    });

    it('direct: every subscription of the recipient (not the sender) gets the message push', async () => {
      await send(alice, direct, 'hello bob');
      await pushIdle();
      const expected: PushPayload = {
        type: 'message',
        title: 'Alice',
        body: 'hello bob',
        tag: `chat:${direct}`,
        url: `/chats/${direct}`,
        chatId: direct,
      };
      expect(to(bobEp)).toEqual([
        { endpoint: bobEp, payload: expected, opts: { ttl: PUSH_MESSAGE_TTL_SEC } },
      ]);
      expect(to(bobEp2).map((s) => s.payload)).toEqual([expected]);
      expect(to(aliceEp)).toEqual([]);
    });

    it("titles direct pushes with the name the recipient saved, and uses the sender's visible avatar as icon", async () => {
      const u = await t.createUser({ displayName: 'Real Name' });
      const avatarUrl = await giveProfile(u.id);
      const chat = await createDirect(u, bob);
      await saveContact(bob, u, 'Saved Name');
      await send(u, chat, 'yo');
      await pushIdle();
      expect(to(bobEp)[0]!.payload).toMatchObject({
        title: 'Saved Name',
        body: 'yo',
        icon: avatarUrl,
      });
      // A hidden photo is not leaked through the notification.
      sent = [];
      await setSettings(u, { profilePhotoVisibility: 'nobody' });
      await send(u, chat, 'again');
      await pushIdle();
      expect(to(bobEp)[0]!.payload.icon).toBeUndefined();
    });

    it('groups: title = group name, body = "Sender: preview", mentions rendered as each recipient knows the users', async () => {
      const carol = await t.createUser({ displayName: 'Carol' });
      const carolEp = await subscribe(carol);
      await saveContact(carol, bob, 'Bobby');
      const group = await createGroup(alice, [bob, carol], { name: 'Friends' });
      await pushIdle(); // system messages never push
      expect(sent).toEqual([]);
      await send(alice, group, `hey ${mentionToken(bob.id)} and ${mentionToken(carol.id)}`);
      await pushIdle();
      expect(to(bobEp)[0]!.payload).toMatchObject({
        type: 'message',
        title: 'Friends',
        body: 'Alice: hey @Bob and @Carol',
        tag: `chat:${group}`,
        url: `/chats/${group}`,
        chatId: group,
      });
      expect(to(carolEp)[0]!.payload.body).toBe('Alice: hey @Bobby and @Carol');
      expect(to(aliceEp)).toEqual([]);
    });

    it('notificationPreviews off → generic body (direct and group)', async () => {
      const group = await createGroup(alice, [bob], { name: 'Secret club' });
      await setSettings(bob, { notificationPreviews: false });
      try {
        await send(alice, direct, 'the secret');
        await send(alice, group, 'the other secret');
        await pushIdle();
        expect(to(bobEp).map((s) => [s.payload.title, s.payload.body])).toEqual([
          ['Alice', 'New message'],
          ['Secret club', 'New message'],
        ]);
      } finally {
        await setSettings(bob, { notificationPreviews: true });
      }
    });

    it('messageNotifications / groupNotifications gate direct and group pushes separately', async () => {
      const group = await createGroup(alice, [bob], { name: 'G' });
      await setSettings(bob, { messageNotifications: false });
      await send(alice, direct, 'direct 1');
      await send(alice, group, 'group 1');
      await pushIdle();
      expect(to(bobEp).map((s) => s.payload.body)).toEqual(['Alice: group 1']);
      sent = [];
      await setSettings(bob, { messageNotifications: true, groupNotifications: false });
      await send(alice, direct, 'direct 2');
      await send(alice, group, 'group 2');
      await pushIdle();
      expect(to(bobEp).map((s) => s.payload.body)).toEqual(['direct 2']);
      await setSettings(bob, { groupNotifications: true });
    });

    it('muted chats never push (until the mute expires)', async () => {
      await db
        .update(chatMembers)
        .set({ mutedUntil: new Date(MUTE_FOREVER_ISO) })
        .where(and(eq(chatMembers.chatId, direct), eq(chatMembers.userId, bob.id)));
      await send(alice, direct, 'muted');
      await pushIdle();
      expect(sent).toEqual([]);
      await db
        .update(chatMembers)
        .set({ mutedUntil: new Date(Date.now() - 1000) })
        .where(and(eq(chatMembers.chatId, direct), eq(chatMembers.userId, bob.id)));
      await send(alice, direct, 'unmuted');
      await pushIdle();
      expect(to(bobEp).map((s) => s.payload.body)).toEqual(['unmuted']);
    });

    it('never for channels, call messages or messages withheld by a block', async () => {
      const channel = await createChannel(alice);
      await transact((tx, fx) =>
        upsertMembership(tx, fx, { kind: 'activate', chatId: channel, userIds: [bob.id] }),
      );
      await send(alice, channel, 'channel post');
      await send(alice, direct, {
        type: 'call',
        text: null,
        clientId: null,
        metadata: {
          call: {
            callId: crypto.randomUUID(),
            callType: 'audio',
            isGroup: false,
            initiatorId: alice.id,
            status: 'ringing',
            durationSec: null,
          },
        },
      });
      const eve = await t.createUser({ displayName: 'Eve' });
      const eveChat = await createDirect(eve, bob);
      await block(bob, eve);
      await send(eve, eveChat, 'withheld');
      await pushIdle();
      expect(sent).toEqual([]);
    });

    it('renders non-text previews and truncates long ones to 120 characters', async () => {
      await send(alice, direct, {
        type: 'location',
        text: null,
        metadata: { location: { latitude: 1, longitude: 2, name: 'Home', address: null } },
      });
      await send(alice, direct, 'x'.repeat(300));
      await pushIdle();
      const bodies = to(bobEp).map((s) => s.payload.body);
      expect(bodies[0]).toBe('📍 Home');
      expect(Array.from(bodies[1]!)).toHaveLength(120);
      expect(bodies[1]!.endsWith('…')).toBe(true);
    });

    it('deletes subscriptions the push service reports gone (404/410) and keeps them on other errors', async () => {
      failWith.set(bobEp, 410);
      failWith.set(bobEp2, 500);
      await send(alice, direct, 'first');
      await pushIdle();
      expect(
        await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, bobEp)),
      ).toEqual([]);
      expect(
        await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, bobEp2)),
      ).toHaveLength(1);
      failWith.clear();
      failWith.set(bobEp2, 404);
      await send(alice, direct, 'second');
      await pushIdle();
      expect(
        await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, bob.id)),
      ).toEqual([]);
      expect(sent).toEqual([]);
    });

    it('is disabled without VAPID keys (and no injected sender)', async () => {
      setPushSender(undefined);
      try {
        expect(config.vapid.publicKey).toBeUndefined();
        expect(getPushSender()).toBeNull();
        await send(alice, direct, 'nobody hears this');
        await pushIdle();
        expect(sent).toEqual([]);
      } finally {
        setPushSender(fakeSender);
      }
    });

    it('dismiss: reading clears the notification on my devices (only when unread messages were cleared)', async () => {
      await send(alice, direct, 'read me');
      await pushIdle();
      sent = [];
      await transact((tx, fx) =>
        advanceRead(tx, fx, { chatId: direct, userId: bob.id, seq: 1_000_000 }),
      );
      await pushIdle();
      const dismiss: PushPayload = {
        type: 'dismiss',
        title: '',
        body: '',
        tag: `chat:${direct}`,
        url: `/chats/${direct}`,
        chatId: direct,
      };
      expect(to(bobEp).map((s) => s.payload)).toEqual([dismiss]);
      expect(to(bobEp2).map((s) => s.payload)).toEqual([dismiss]);
      expect(to(aliceEp)).toEqual([]);
      sent = [];
      await transact((tx, fx) =>
        advanceRead(tx, fx, { chatId: direct, userId: bob.id, seq: 1_000_000 }),
      );
      await pushIdle();
      expect(sent).toEqual([]);
    });

    it('dismiss is never sent for channels', async () => {
      const channel = await createChannel(alice);
      await transact((tx, fx) =>
        upsertMembership(tx, fx, { kind: 'activate', chatId: channel, userIds: [bob.id] }),
      );
      await send(alice, channel, 'post');
      await transact((tx, fx) =>
        advanceRead(tx, fx, { chatId: channel, userId: bob.id, seq: 1_000_000 }),
      );
      await pushIdle();
      expect(sent).toEqual([]);
    });
  });

  describe('call pushes', () => {
    let caller: TestUser;
    let callee: TestUser;
    let calleeEp: string;
    let chatId: string;

    beforeAll(async () => {
      caller = await t.createUser({ displayName: 'Caller' });
      callee = await t.createUser({ displayName: 'Callee' });
      chatId = await createDirect(caller, callee);
    });
    beforeEach(async () => {
      await db.delete(pushSubscriptions);
      calleeEp = await subscribe(callee);
      await subscribe(caller);
      await setSettings(callee, { callNotifications: true, silenceUnknownCallers: false });
    });

    async function insertCall(opts: { hidden?: boolean; isGroup?: boolean; chat?: string } = {}) {
      const [call] = await db
        .insert(calls)
        .values({
          chatId: opts.chat ?? chatId,
          initiatorId: caller.id,
          type: 'audio',
          isGroup: opts.isGroup ?? false,
          status: 'missed',
        })
        .returning();
      await db.insert(callParticipants).values([
        { callId: call!.id, userId: caller.id, status: 'left' },
        {
          callId: call!.id,
          userId: callee.id,
          status: 'missed',
          hiddenAt: opts.hidden ? new Date() : null,
        },
      ]);
      return call!.id;
    }

    it('call.ringing → a high-urgency call push with the ring timeout as TTL (not to silent callees or with callNotifications off)', async () => {
      const silent = await t.createUser();
      const silentEp = await subscribe(silent);
      const muted = await t.createUser();
      const mutedEp = await subscribe(muted);
      await setSettings(muted, { callNotifications: false });
      const callId = crypto.randomUUID();
      domainEvents.emit('call.ringing', {
        callId,
        chatId,
        callerId: caller.id,
        callType: 'video',
        isGroup: false,
        userIds: [callee.id, silent.id, muted.id],
        silentUserIds: [silent.id],
      });
      await pushIdle();
      expect(sent).toEqual([
        {
          endpoint: calleeEp,
          payload: {
            type: 'call',
            title: 'Caller',
            body: 'Incoming video call',
            tag: `call:${callId}`,
            url: `/chats/${chatId}`,
            chatId,
            callId,
          },
          opts: { ttl: CALL_RING_TIMEOUT_MS / 1000, urgency: 'high' },
        },
      ]);
      expect(to(silentEp)).toEqual([]);
      expect(to(mutedEp)).toEqual([]);
    });

    it('group calls are titled with the group name', async () => {
      const group = await createGroup(caller, [callee], { name: 'Team' });
      const callId = crypto.randomUUID();
      domainEvents.emit('call.ringing', {
        callId,
        chatId: group,
        callerId: caller.id,
        callType: 'audio',
        isGroup: true,
        userIds: [callee.id],
        silentUserIds: [],
      });
      await pushIdle();
      expect(to(calleeEp).map((s) => s.payload)).toEqual([
        {
          type: 'call',
          title: 'Team',
          body: 'Caller · Incoming group voice call',
          tag: `call:${callId}`,
          url: `/chats/${group}`,
          chatId: group,
          callId,
        },
      ]);
    });

    it('call.ring-stopped → call_cancel ("Missed call" only when missed)', async () => {
      const callId = await insertCall();
      domainEvents.emit('call.ring-stopped', {
        callId,
        chatId,
        userId: callee.id,
        reason: 'timeout',
        finalStatus: 'missed',
      });
      await pushIdle();
      expect(to(calleeEp)).toEqual([
        {
          endpoint: calleeEp,
          payload: {
            type: 'call_cancel',
            title: 'Caller',
            body: 'Missed call',
            tag: `call:${callId}`,
            url: `/chats/${chatId}`,
            chatId,
            callId,
          },
          opts: { ttl: PUSH_MESSAGE_TTL_SEC, urgency: 'high' },
        },
      ]);
      sent = [];
      domainEvents.emit('call.ring-stopped', {
        callId,
        chatId,
        userId: callee.id,
        reason: 'answered_elsewhere',
        finalStatus: 'joined',
      });
      await pushIdle();
      expect(to(calleeEp).map((s) => s.payload.body)).toEqual(['']);
    });

    it('no call_cancel for silent rings, hidden participants or callNotifications off', async () => {
      await setSettings(callee, { silenceUnknownCallers: true });
      const silentCall = await insertCall();
      domainEvents.emit('call.ring-stopped', {
        callId: silentCall,
        chatId,
        userId: callee.id,
        reason: 'timeout',
        finalStatus: 'missed',
      });
      await pushIdle();
      await setSettings(callee, { silenceUnknownCallers: false });
      const hiddenCall = await insertCall({ hidden: true });
      domainEvents.emit('call.ring-stopped', {
        callId: hiddenCall,
        chatId,
        userId: callee.id,
        reason: 'timeout',
        finalStatus: 'missed',
      });
      await pushIdle();
      await setSettings(callee, { callNotifications: false });
      const offCall = await insertCall();
      domainEvents.emit('call.ring-stopped', {
        callId: offCall,
        chatId,
        userId: callee.id,
        reason: 'timeout',
        finalStatus: 'missed',
      });
      await pushIdle();
      expect(sent).toEqual([]);
      // A contact is not an "unknown caller".
      await setSettings(callee, { callNotifications: true, silenceUnknownCallers: true });
      await saveContact(callee, caller);
      const knownCall = await insertCall();
      domainEvents.emit('call.ring-stopped', {
        callId: knownCall,
        chatId,
        userId: callee.id,
        reason: 'cancelled',
        finalStatus: 'missed',
      });
      await pushIdle();
      expect(to(calleeEp).map((s) => s.payload.type)).toEqual(['call_cancel']);
    });
  });
});
