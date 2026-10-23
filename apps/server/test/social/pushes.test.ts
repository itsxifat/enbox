/**
 * Reaction and followed-thread pushes (modules/push): `reactionNotifications` ('dms' by default:
 * direct and group chats; 'all': Spaces too; 'off'), never for my own reactions, once per
 * message per window, not when muted, in do not disturb or from someone I ignore or blocked,
 * no text without previews; posts and threads I follow push every message unless the thread,
 * its channel or the Space is muted for me, the thread's own level says otherwise, or the
 * message is @silent.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  MESSAGE_FLAGS,
  MUTE_FOREVER_ISO,
  type ChatSummary,
  type PushPayload,
  type SpaceDetail,
  type SpaceInvite,
} from '@enbox/shared';
import { db } from '../../src/db/index.js';
import { blocks } from '../../src/db/schema.js';
import { resetReactionPushes } from '../../src/modules/push/reactionNotifications.js';
import { pushIdle, setPushSender, type PushTarget } from '../../src/modules/push/sender.js';
import { spaceRegistryIdle } from '../../src/realtime/spaceRegistry.js';
import { startTestServer, type TestServer, type TestUser } from '../helpers.js';
import { block, createGroup, send, setAvailability, setSettings } from '../services/fixtures.js';
import { activeDirect, sendOk } from '../messaging/support.js';

const enc = encodeURIComponent;

describe('reaction and followed thread pushes', () => {
  let t: TestServer;
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let pushes: { endpoint: string; payload: PushPayload }[];

  beforeAll(async () => {
    t = await startTestServer();
    setPushSender(async (target: PushTarget, payload: PushPayload) => {
      pushes.push({ endpoint: target.endpoint, payload });
    });
    alice = await t.createUser({ displayName: 'Alice' });
    bob = await t.createUser({ displayName: 'Bob' });
    carol = await t.createUser({ displayName: 'Carol' });
  });
  afterAll(async () => {
    setPushSender(undefined);
    await t.close();
  });
  beforeEach(() => {
    pushes = [];
    resetReactionPushes();
  });

  const react = (user: TestUser, messageId: string, emoji: string) =>
    t
      .api(user)
      .put(`/api/messages/${messageId}/reactions/${enc(emoji)}/@me`)
      .expect(204);
  const to = (endpoint: string) =>
    pushes.filter((p) => p.endpoint === endpoint).map((p) => p.payload);

  async function subscribe(user: TestUser): Promise<string> {
    const endpoint = `https://fcm.googleapis.com/fcm/send/pushes-${user.id}`;
    await t
      .api(user)
      .post('/api/push/subscriptions')
      .send({ endpoint, keys: { p256dh: 'BPublicKey', auth: 'authSecret' } })
      .expect(204);
    return endpoint;
  }

  async function space(owner: TestUser, name: string, members: TestUser[]) {
    const detail = (await t.api(owner).post('/api/spaces').send({ name }).expect(201))
      .body as SpaceDetail;
    const invite = (
      await t.api(owner).post(`/api/spaces/${detail.space.id}/invites`).send({}).expect(201)
    ).body as SpaceInvite;
    for (const u of members) await t.api(u).post(`/api/invites/${invite.code}/join`).expect(200);
    await spaceRegistryIdle();
    return { detail, general: detail.channels.find((c) => c.name === 'general')! };
  }

  describe('reactions', () => {
    it('push the author of a DM message once per window, never for their own', async () => {
      const d = await activeDirect(t, bob, alice);
      const m = await sendOk(t, bob, d, 'see you at 8');
      const endpoint = await subscribe(bob);
      await react(alice, m.id, '👍');
      await pushIdle();
      expect(to(endpoint)).toEqual([
        expect.objectContaining({
          type: 'message',
          title: 'Alice',
          body: 'Reacted 👍 to your message: see you at 8',
          tag: `reaction:${m.id}`,
          url: `/chats/${d}?m=${m.seq}&mid=${m.id}`,
          chatId: d,
        }),
      ]);
      // More within the window: still one.
      await react(alice, m.id, '🎉');
      await pushIdle();
      expect(to(endpoint)).toHaveLength(1);
      // My own reaction.
      resetReactionPushes();
      pushes = [];
      await react(bob, m.id, '🔥');
      await pushIdle();
      expect(to(endpoint)).toEqual([]);
    });

    it('follow reactionNotifications: groups by default, Spaces with all, never with off', async () => {
      const g = await createGroup(bob, [alice, carol], { name: 'Hikers' });
      const gm = await sendOk(t, bob, g, 'trail at 9');
      const endpoint = await subscribe(bob);
      await react(carol, gm.id, '🎉');
      await pushIdle();
      expect(to(endpoint)).toEqual([
        expect.objectContaining({
          title: 'Hikers',
          body: 'Carol reacted 🎉 to your message: trail at 9',
          tag: `reaction:${gm.id}`,
        }),
      ]);

      const { detail, general } = await space(bob, 'Peaks', [alice]);
      const sm = await sendOk(t, bob, general.id, 'summit photos');
      pushes = [];
      await react(alice, sm.id, '😍');
      await pushIdle();
      expect(to(endpoint)).toEqual([]);
      await setSettings(bob, { reactionNotifications: 'all' });
      await react(alice, sm.id, '🔥');
      await pushIdle();
      expect(to(endpoint)).toEqual([
        expect.objectContaining({
          title: '#general · Peaks',
          body: 'Alice reacted 🔥 to your message: summit photos',
          url: `/spaces/${detail.space.id}/${general.id}?m=${sm.seq}&mid=${sm.id}`,
        }),
      ]);

      await setSettings(bob, { reactionNotifications: 'off' });
      resetReactionPushes();
      pushes = [];
      await react(alice, gm.id, '😂');
      await react(alice, sm.id, '😂');
      await pushIdle();
      expect(to(endpoint)).toEqual([]);
      await setSettings(bob, { reactionNotifications: 'dms' });
    });

    it('not when muted, in do not disturb, ignored or blocked; no text without previews', async () => {
      const d = await activeDirect(t, bob, carol);
      const m = await sendOk(t, bob, d, 'secret plan');
      const endpoint = await subscribe(bob);
      const attempt = async (emoji: string) => {
        resetReactionPushes();
        pushes = [];
        await react(carol, m.id, emoji);
        await pushIdle();
        return to(endpoint);
      };

      await t
        .api(bob)
        .patch(`/api/chats/${d}/prefs`)
        .send({ mutedUntil: MUTE_FOREVER_ISO })
        .expect(200);
      expect(await attempt('😀')).toEqual([]);
      await t.api(bob).patch(`/api/chats/${d}/prefs`).send({ mutedUntil: null }).expect(200);

      await setAvailability(bob, 'dnd');
      expect(await attempt('😃')).toEqual([]);
      await setAvailability(bob, 'online');

      await t.api(bob).put(`/api/users/${carol.id}/ignore`).expect(204);
      expect(await attempt('😄')).toEqual([]);
      await t.api(bob).delete(`/api/users/${carol.id}/ignore`).expect(204);

      await block(bob, carol);
      expect(await attempt('😁')).toEqual([]);
      await db
        .delete(blocks)
        .where(and(eq(blocks.blockerId, bob.id), eq(blocks.blockedId, carol.id)));

      await setSettings(bob, { notificationPreviews: false });
      expect(await attempt('😆')).toEqual([
        expect.objectContaining({ body: 'Reacted 😆 to your message' }),
      ]);
      await setSettings(bob, { notificationPreviews: true });
    });
  });

  describe('followed threads', () => {
    it('push every message unless muted (thread, channel, Space), set otherwise, or @silent', async () => {
      const { detail, general } = await space(alice, 'Crew', [bob, carol]);
      const thread = (
        await t
          .api(alice)
          .post(`/api/chats/${general.id}/threads`)
          .send({ name: 'Plans' })
          .expect(201)
      ).body as ChatSummary;
      await spaceRegistryIdle();
      await t.api(bob).put(`/api/threads/${thread.id}/follow`).expect(200);
      const [eb, ec] = [await subscribe(bob), await subscribe(carol)];
      const post = async (text: string) => {
        pushes = [];
        await sendOk(t, alice, thread.id, text);
        await pushIdle();
        return { bob: to(eb), carol: to(ec) };
      };

      const first = await post('who brings snacks?');
      expect(first.bob).toEqual([
        expect.objectContaining({
          title: '#Plans · Crew',
          body: 'Alice: who brings snacks?',
          tag: `chat:${thread.id}`,
        }),
      ]);
      // Carol doesn't follow it (the Space's default: mentions only).
      expect(first.carol).toEqual([]);

      for (const path of [
        `/api/chats/${thread.id}/prefs`,
        `/api/chats/${general.id}/prefs`,
        `/api/spaces/${detail.space.id}/members/me`,
      ]) {
        await t.api(bob).patch(path).send({ mutedUntil: MUTE_FOREVER_ISO }).expect(200);
        expect((await post(`muted at ${path}`)).bob).toEqual([]);
        await t.api(bob).patch(path).send({ mutedUntil: null }).expect(200);
      }
      // The thread's own level wins.
      await t
        .api(bob)
        .patch(`/api/chats/${thread.id}/prefs`)
        .send({ notifyLevel: 'none' })
        .expect(200);
      expect((await post('quiet please')).bob).toEqual([]);
      await t
        .api(bob)
        .patch(`/api/chats/${thread.id}/prefs`)
        .send({ notifyLevel: null })
        .expect(200);
      expect((await post('back on')).bob).toHaveLength(1);

      pushes = [];
      await send(alice, thread.id, { text: 'shh', flags: MESSAGE_FLAGS.SILENT });
      await pushIdle();
      expect(to(eb)).toEqual([]);

      // Unfollowed: the channel's rules again (mentions only).
      await t.api(bob).delete(`/api/threads/${thread.id}/follow`).expect(204);
      expect((await post('anyone?')).bob).toEqual([]);
      expect((await post(`@{${bob.id}} you?`)).bob).toHaveLength(1);
    });
  });
});
