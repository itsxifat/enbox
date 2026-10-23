/**
 * Messages with up to 10 files (Discord): a media send's `extraMediaIds` (distinct uploads of
 * mine, any kind but voice) and `descriptions` (alt text, aligned, blank = none). The first
 * file stays `Message.media` (old clients show it); `Message.attachments` lists them all, in
 * order, whenever there are several or some alt text (`message_attachments` rows). Space
 * channels need ATTACH_FILES; forwards keep every file; delete for everyone clears them;
 * `message:new` carries them; a retry with the same clientId returns the original.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import {
  MAX_ALT_TEXT_LENGTH,
  PERM,
  type MediaKind,
  type Message,
  type SpaceDetail,
  type SpaceInvite,
} from '@enbox/shared';
import { db } from '../../src/db/index.js';
import { messageAttachments, messages } from '../../src/db/schema.js';
import { spaceRegistryIdle } from '../../src/realtime/spaceRegistry.js';
import {
  expectNoEvent,
  startTestServer,
  waitForEvent,
  type TestServer,
  type TestUser,
} from '../helpers.js';
import { createGroup } from '../services/fixtures.js';
import { historyOf, mkMedia, newClientId, sendOk, sendReq } from './support.js';

const rowsOf = (messageId: string) =>
  db
    .select()
    .from(messageAttachments)
    .where(eq(messageAttachments.messageId, messageId))
    .orderBy(asc(messageAttachments.position));

const messageCount = async (chatId: string) =>
  (await db.select({ id: messages.id }).from(messages).where(eq(messages.chatId, chatId))).length;

/** What a test reads of `Message.attachments`: id, kind and alt text, in order. */
const filesOf = (m: Pick<Message, 'attachments'>) =>
  m.attachments?.map((a) => [a.id, a.kind, a.description]);

describe('messages with several files', () => {
  let t: TestServer;
  let alice: TestUser;
  let bob: TestUser;

  beforeAll(async () => {
    t = await startTestServer();
    alice = await t.createUser({ displayName: 'Alice' });
    bob = await t.createUser({ displayName: 'Bob' });
  });
  afterAll(() => t.close());

  async function uploads(owner: TestUser, kinds: MediaKind[]) {
    const out = [];
    for (const kind of kinds) out.push(await mkMedia(owner.id, kind));
    return out;
  }

  it('one file with alt text: a row is written and `attachments` is present; without, just `media`', async () => {
    const g = await createGroup(alice, [bob]);
    const img = await mkMedia(alice.id, 'image', { width: 40, height: 30 });
    const m = await sendOk(t, alice, g, {
      type: 'image',
      mediaId: img.id,
      text: 'my cat',
      descriptions: ['  A grey cat asleep on a sofa  '],
    });
    expect(m).toMatchObject({ type: 'image', text: 'my cat', media: { id: img.id } });
    expect(filesOf(m)).toEqual([[img.id, 'image', 'A grey cat asleep on a sofa']]);
    expect(m.attachments![0]).toMatchObject({ ...m.media, description: expect.any(String) });
    expect(await rowsOf(m.id)).toMatchObject([
      { position: 0, mediaId: img.id, description: 'A grey cat asleep on a sofa' },
    ]);
    // The other member reads the same.
    const seen = (await historyOf(t, bob, g)).find((x) => x.id === m.id)!;
    expect(filesOf(seen)).toEqual(filesOf(m));

    // No alt text (none, or blank): nothing written, the message has just `media`.
    for (const descriptions of [undefined, ['   '], [null]]) {
      const plain = await sendOk(t, alice, g, { type: 'image', mediaId: img.id, descriptions });
      expect(plain.media!.id).toBe(img.id);
      expect(plain).not.toHaveProperty('attachments');
      expect(await rowsOf(plain.id)).toEqual([]);
    }
  });

  it('ten files of mixed kinds, in order, with their alt text; the caption belongs to the message', async () => {
    const g = await createGroup(alice, [bob]);
    const files = await uploads(alice, [
      'image',
      'video',
      'audio',
      'file',
      'image',
      'image',
      'file',
      'video',
      'audio',
      'image',
    ]);
    const ids = files.map((f) => f.id);
    const m = await sendOk(t, alice, g, {
      type: 'image',
      mediaId: ids[0],
      extraMediaIds: ids.slice(1),
      // Fewer than the files: the rest have none.
      descriptions: ['first', null, '', 'a document'],
      text: 'holiday dump',
    });
    expect(m).toMatchObject({ type: 'image', text: 'holiday dump', media: { id: ids[0] } });
    expect(filesOf(m)).toEqual(
      files.map((f, i) => [f.id, f.kind, i === 0 ? 'first' : i === 3 ? 'a document' : null]),
    );
    expect((await rowsOf(m.id)).map((r) => [r.position, r.mediaId])).toEqual(
      ids.map((id, i) => [i, id]),
    );
    expect(filesOf((await historyOf(t, bob, g)).find((x) => x.id === m.id)!)).toEqual(filesOf(m));

    // Any kind may come first (its kind is the message's type).
    const doc = await sendOk(t, alice, g, {
      type: 'file',
      mediaId: ids[3],
      extraMediaIds: [ids[0], ids[2]],
    });
    expect(doc).toMatchObject({ type: 'file', text: null, media: { id: ids[3] } });
    expect(filesOf(doc)).toEqual([
      [ids[3], 'file', null],
      [ids[0], 'image', null],
      [ids[2], 'audio', null],
    ]);
  });

  it('eleven files, duplicates, extra alt text and over-long alt text → 400; nothing is written', async () => {
    const g = await createGroup(alice, [bob]);
    const ids = (
      await uploads(
        alice,
        Array.from({ length: 11 }, () => 'image' as const),
      )
    ).map((f) => f.id);
    const before = await messageCount(g);
    const refused = [
      { mediaId: ids[0], extraMediaIds: ids.slice(1) },
      { mediaId: ids[0], extraMediaIds: [ids[1], ids[1]] },
      { mediaId: ids[0], extraMediaIds: [ids[1], ids[0]] },
      { mediaId: ids[0], extraMediaIds: [ids[1]], descriptions: ['a', 'b', 'c'] },
      { mediaId: ids[0], descriptions: ['x'.repeat(MAX_ALT_TEXT_LENGTH + 1)] },
    ];
    for (const body of refused) {
      const res = await sendReq(t, alice, g, { type: 'image', ...body }).expect(400);
      expect(res.body.error.code).toBe('validation_error');
    }
    expect(await messageCount(g)).toBe(before);
    // Exactly ten, and alt text of the longest length, pass.
    const ten = await sendOk(t, alice, g, {
      type: 'image',
      mediaId: ids[0],
      extraMediaIds: ids.slice(1, 10),
      descriptions: ['x'.repeat(MAX_ALT_TEXT_LENGTH)],
    });
    expect(ten.attachments).toHaveLength(10);
  });

  it('someone else’s media is refused like the single-file rule; voice notes take no other files', async () => {
    const g = await createGroup(alice, [bob]);
    const [img, pdf] = await uploads(alice, ['image', 'file']);
    const bobs = await mkMedia(bob.id, 'image');
    const notMine = await sendReq(t, alice, g, {
      type: 'image',
      mediaId: img!.id,
      extraMediaIds: [pdf!.id, bobs.id],
    }).expect(404);
    expect(notMine.body.error.code).toBe('not_found');
    await sendReq(t, alice, g, {
      type: 'image',
      mediaId: img!.id,
      extraMediaIds: [crypto.randomUUID()],
    }).expect(404);
    // Bob can't post his own upload alongside Alice's either.
    await sendReq(t, bob, g, { type: 'image', mediaId: bobs.id, extraMediaIds: [img!.id] }).expect(
      404,
    );

    const voice = await mkMedia(alice.id, 'voice', { durationMs: 1500 });
    const withExtras = await sendReq(t, alice, g, {
      type: 'voice',
      mediaId: voice.id,
      extraMediaIds: [img!.id],
    }).expect(400);
    expect(withExtras.body.error.code).toBe('validation_error');
    // A voice note is not an extra file either; the first file still needs kind === type.
    await sendReq(t, alice, g, {
      type: 'image',
      mediaId: img!.id,
      extraMediaIds: [voice.id],
    }).expect(400);
    await sendReq(t, alice, g, {
      type: 'video',
      mediaId: img!.id,
      extraMediaIds: [pdf!.id],
    }).expect(400);
    // A voice note alone (with alt text) is fine.
    const v = await sendOk(t, alice, g, {
      type: 'voice',
      mediaId: voice.id,
      descriptions: ['me humming'],
    });
    expect(filesOf(v)).toEqual([[voice.id, 'voice', 'me humming']]);
  });

  it('a Space channel without ATTACH_FILES → 403', async () => {
    const owner = await t.createUser({ displayName: 'Owner' });
    const detail = (await t.api(owner).post('/api/spaces').send({ name: 'Files' }).expect(201))
      .body as SpaceDetail;
    const invite = (
      await t.api(owner).post(`/api/spaces/${detail.space.id}/invites`).send({}).expect(201)
    ).body as SpaceInvite;
    await t.api(bob).post(`/api/invites/${invite.code}/join`).expect(200);
    await spaceRegistryIdle();
    const general = detail.channels.find((c) => c.name === 'general')!;
    const everyone = detail.space.roles.find((r) => r.isDefault)!;
    const [a, b] = await uploads(bob, ['image', 'file']);
    const body = { type: 'image', mediaId: a!.id, extraMediaIds: [b!.id] };

    const ok = await sendOk(t, bob, general.id, body);
    expect(filesOf(ok)).toEqual([
      [a!.id, 'image', null],
      [b!.id, 'file', null],
    ]);
    await t
      .api(owner)
      .put(`/api/spaces/${detail.space.id}/channels/${general.id}/overwrites/role/${everyone.id}`)
      .send({ allow: 0, deny: PERM.ATTACH_FILES })
      .expect(200);
    const denied = await sendReq(t, bob, general.id, body).expect(403);
    expect(denied.body.error.code).toBe('forbidden');
  });

  it('forward keeps every file and its alt text (one query for the batch); delete for everyone clears them', async () => {
    const g = await createGroup(alice, [bob]);
    const target = await createGroup(bob, [alice]);
    const other = await createGroup(bob, []);
    const files = await uploads(alice, ['image', 'video', 'file']);
    const multi = await sendOk(t, alice, g, {
      type: 'image',
      mediaId: files[0]!.id,
      extraMediaIds: [files[1]!.id, files[2]!.id],
      descriptions: [null, 'a clip'],
      text: 'three',
    });
    const single = await sendOk(t, alice, g, { type: 'image', mediaId: files[0]!.id });
    const res = await t
      .api(bob)
      .post('/api/messages/forward')
      .send({ clientId: 'fwd-files', messageIds: [multi.id, single.id], chatIds: [target, other] })
      .expect(201);
    const copies = res.body as Message[];
    expect(copies.map((c) => c.chatId)).toEqual([target, target, other, other]);
    for (const [i, copy] of copies.entries()) {
      if (i % 2 === 0) {
        expect(copy).toMatchObject({ type: 'image', text: 'three', forwardCount: 1 });
        expect(filesOf(copy)).toEqual(filesOf(multi));
        expect(await rowsOf(copy.id)).toHaveLength(3);
      } else {
        expect(copy.media!.id).toBe(files[0]!.id);
        expect(copy).not.toHaveProperty('attachments');
      }
    }

    await t.api(alice).delete(`/api/messages/${multi.id}?for=everyone`).expect(204);
    expect(await rowsOf(multi.id)).toEqual([]);
    const tombstone = (await historyOf(t, bob, g)).find((x) => x.id === multi.id)!;
    expect(tombstone).toMatchObject({ deletedAt: expect.any(String), media: null });
    expect(tombstone).not.toHaveProperty('attachments');
    // The copies are other messages: they keep their files.
    const copy = (await historyOf(t, bob, target)).find((x) => x.id === copies[0]!.id)!;
    expect(filesOf(copy)).toEqual(filesOf(multi));
  });

  it('message:new carries the attachments; a retry with the same clientId returns the original', async () => {
    const g = await createGroup(alice, [bob]);
    const files = await uploads(alice, ['image', 'image', 'audio']);
    const ids = files.map((f) => f.id);
    const clientId = newClientId();
    const socket = await t.connect(bob);
    const arrived = waitForEvent(socket, 'message:new', {
      filter: (p) => p.message.clientId === clientId,
    });
    const body = {
      type: 'image',
      clientId,
      mediaId: ids[0],
      extraMediaIds: ids.slice(1),
      descriptions: ['left', 'right'],
    };
    const first = await sendReq(t, alice, g, body).expect(201);
    const event = await arrived;
    expect(event.message.id).toBe(first.body.id);
    expect(filesOf(event.message)).toEqual([
      [ids[0], 'image', 'left'],
      [ids[1], 'image', 'right'],
      [ids[2], 'audio', null],
    ]);

    // Same clientId (even with other files): 200, the original, nothing written or emitted.
    const quiet = expectNoEvent(socket, 'message:new');
    const retry = await sendReq(t, alice, g, { ...body, extraMediaIds: [ids[1]] }).expect(200);
    expect(retry.body.id).toBe(first.body.id);
    expect(filesOf(retry.body as Message)).toEqual(filesOf(event.message));
    await quiet;
    expect(await rowsOf(first.body.id)).toHaveLength(3);
    socket.disconnect();
  });
});
