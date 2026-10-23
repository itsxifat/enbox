/**
 * Reply pings (`mentionRepliedAuthor`, Discord's "@ ON / @ OFF"): a reply in a group or Space
 * channel mentions the replied message's author unless turned off; never myself, never in
 * direct chats; the ping survives edits while text tokens are re-derived.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Message, SpaceDetail, SpaceInvite } from '@enbox/shared';
import { spaceRegistryIdle } from '../../src/realtime/spaceRegistry.js';
import { startTestServer, type TestServer, type TestUser } from '../helpers.js';
import { createGroup } from '../services/fixtures.js';
import { activeDirect, sendOk, sendReq, summaryOf } from './support.js';

describe('reply pings', () => {
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

  const edit = async (user: TestUser, id: string, text: string) =>
    (await t.api(user).patch(`/api/messages/${id}`).send({ text }).expect(200)).body as Message;

  it('a group reply mentions the replied author by default; mentionRepliedAuthor: false does not', async () => {
    const g = await createGroup(alice, [bob]);
    const q = await sendOk(t, bob, g, 'pizza or sushi?');
    const loud = await sendOk(t, alice, g, { text: 'sushi', replyToId: q.id });
    expect(loud.mentions).toEqual([bob.id]);
    const quiet = await sendOk(t, alice, g, {
      text: 'sushi again',
      replyToId: q.id,
      mentionRepliedAuthor: false,
    });
    expect(quiet.mentions).toEqual([]);
    expect((await summaryOf(t, bob, g)).unreadMentionCount).toBe(1);
    // The flag is validated.
    await sendReq(t, alice, g, { text: 'x', replyToId: q.id, mentionRepliedAuthor: 'no' }).expect(
      400,
    );
  });

  it('never pings me, a direct chat peer, or the same person twice', async () => {
    const g = await createGroup(alice, [bob, carol]);
    const mine = await sendOk(t, alice, g, 'note to self');
    expect((await sendOk(t, alice, g, { text: 'me again', replyToId: mine.id })).mentions).toEqual(
      [],
    );

    const q = await sendOk(t, bob, g, 'hi');
    const both = await sendOk(t, alice, g, {
      text: `@{${carol.id}} and @{${bob.id}} look`,
      replyToId: q.id,
    });
    // The reply's author first, then the text's tokens, each once.
    expect(both.mentions).toEqual([bob.id, carol.id]);

    const dm = await activeDirect(t, alice, bob);
    const dq = await sendOk(t, bob, dm, 'dm question');
    expect((await sendOk(t, alice, dm, { text: 'dm answer', replyToId: dq.id })).mentions).toEqual(
      [],
    );
  });

  it('the ping survives edits; text mentions are re-derived', async () => {
    const g = await createGroup(alice, [bob, carol]);
    const q = await sendOk(t, bob, g, 'question');
    const r = await sendOk(t, alice, g, { text: 'answer', replyToId: q.id });
    expect(r.mentions).toEqual([bob.id]);
    expect((await edit(alice, r.id, `answer, cc @{${carol.id}}`)).mentions).toEqual([
      bob.id,
      carol.id,
    ]);
    expect((await edit(alice, r.id, 'answer, edited')).mentions).toEqual([bob.id]);

    const quiet = await sendOk(t, alice, g, {
      text: 'quiet answer',
      replyToId: q.id,
      mentionRepliedAuthor: false,
    });
    expect((await edit(alice, quiet.id, 'still quiet')).mentions).toEqual([]);
  });

  it('Space channels: replies ping the author', async () => {
    const detail = (await t.api(alice).post('/api/spaces').send({ name: 'Pings' }).expect(201))
      .body as SpaceDetail;
    const invite = (
      await t.api(alice).post(`/api/spaces/${detail.space.id}/invites`).send({}).expect(201)
    ).body as SpaceInvite;
    await t.api(bob).post(`/api/invites/${invite.code}/join`).expect(200);
    await spaceRegistryIdle();
    const general = detail.channels.find((c) => c.name === 'general')!;
    const q = await sendOk(t, bob, general.id, 'anyone?');
    const loud = await sendOk(t, alice, general.id, { text: 'me!', replyToId: q.id });
    expect(loud.mentions).toEqual([bob.id]);
    const quiet = await sendOk(t, alice, general.id, {
      text: 'me too',
      replyToId: q.id,
      mentionRepliedAuthor: false,
    });
    expect(quiet.mentions).toEqual([]);
  });
});
