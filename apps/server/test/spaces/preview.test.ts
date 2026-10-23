/**
 * Space preview (docs/design/discord-parity.md W12-C) and invite unfurls (W12-D): who may
 * preview (listed Spaces only, not the banned), which channels a fresh @everyone member reads
 * (private, role-only, @everyone-denied, age-restricted, voice, forum channels and threads
 * left out; role overwrites ignored), the newest messages of a readable channel only, nothing
 * written (no read rows, no membership), the per-user limit, and the `/join/:code` HTML with
 * Open Graph tags (escaped, the CSP meta and inline script untouched, unknown codes plain).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { count, eq } from 'drizzle-orm';
import {
  PERM,
  type ChatSummary,
  type SpaceCategory,
  type SpaceDetail,
  type SpaceInvite,
  type SpacePreview,
  type SpacePreviewMessages,
  type SpaceRole,
} from '@enbox/shared';
import { config } from '../../src/config.js';
import { db } from '../../src/db/index.js';
import { chatMembers, spaceInvites, spaceMembers, spaces } from '../../src/db/schema.js';
import { resetUserLimits } from '../../src/lib/userLimit.js';
import { resetPreviewCaches } from '../../src/modules/preview/service.js';
import { headEnd, resetUnfurlCache } from '../../src/modules/preview/unfurl.js';
import { spaceRegistryIdle } from '../../src/realtime/spaceRegistry.js';
import { startTestServer, type TestServer, type TestUser } from '../helpers.js';
import { mkMedia, sendOk } from '../messaging/support.js';

const CSP =
  "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self'; script-src 'self' 'sha256-9tPMqlNbG5TX4vK/zdf/O7kYilNK6CmsRJnPewolxz4='\" />";
// The theme script mentions `</head>` on purpose: tags must never land inside a script.
const THEME_SCRIPT = `<script>
      (function () {
        var end = '</head>';
        document.documentElement.dataset.theme = end ? 'dark' : 'light';
      })();
    </script>`;
const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    ${CSP}
    <title>Enbox</title>
    <meta name="description" content="Enbox" />
    ${THEME_SCRIPT}
    <script type="module" crossorigin src="/assets/index-test.js"></script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`;

describe('space preview', () => {
  let t: TestServer;
  let dist: string;
  const prevDist = process.env.WEB_DIST_DIR;
  let owner: TestUser;
  let viewer: TestUser;
  let bob: TestUser;
  let dave: TestUser;
  let rockets: SpaceDetail;
  let hidden: SpaceDetail;
  let mods: SpaceRole;
  const ch: Record<string, ChatSummary> = {};

  const api = (user: TestUser) => ({
    preview: (spaceId: string) => t.api(user).get(`/api/spaces/${spaceId}/preview`),
    messages: (spaceId: string, channelId: string) =>
      t.api(user).get(`/api/spaces/${spaceId}/preview/channels/${channelId}/messages`),
  });

  async function channel(spaceId: string, body: Record<string, unknown>): Promise<ChatSummary> {
    return (await t.api(owner).post(`/api/spaces/${spaceId}/channels`).send(body).expect(201))
      .body as ChatSummary;
  }
  const everyoneOf = (d: SpaceDetail) => d.space.roles.find((r) => r.isDefault)!;
  const general = (d: SpaceDetail) => d.channels.find((c) => c.name === 'general')!;
  const textCategory = (d: SpaceDetail) =>
    d.space.categories.find((c) => c.name === 'Text channels')!;

  async function list(spaceId: string, description = 'A Space worth a look') {
    await t.api(owner).patch(`/api/spaces/${spaceId}`).send({ description }).expect(200);
    await t
      .api(owner)
      .patch(`/api/spaces/${spaceId}/community`)
      .send({ isDiscoverable: true, discoveryCategory: 'science' })
      .expect(200);
  }

  async function invite(spaceId: string, body: Record<string, unknown> = {}): Promise<string> {
    return (
      (await t.api(owner).post(`/api/spaces/${spaceId}/invites`).send(body).expect(201))
        .body as SpaceInvite
    ).code;
  }

  beforeAll(async () => {
    // A built web client to serve (the SPA fallback exists only when index.html does).
    dist = fs.mkdtempSync(path.join(os.tmpdir(), 'enbox-test-web-'));
    fs.writeFileSync(path.join(dist, 'index.html'), INDEX_HTML);
    process.env.WEB_DIST_DIR = dist;
    t = await startTestServer();
    [owner, viewer, bob, dave] = [
      await t.createUser({ displayName: 'Owner' }),
      await t.createUser({ displayName: 'Viewer' }),
      await t.createUser({ displayName: 'Bob' }),
      await t.createUser({ displayName: 'Dave' }),
    ];
    const create = async (name: string) =>
      (await t.api(owner).post('/api/spaces').send({ name }).expect(201)).body as SpaceDetail;
    rockets = await create('Rocket Club');
    hidden = await create('Hidden Den');
    await list(rockets.space.id, 'We build model rockets');

    const sid = rockets.space.id;
    mods = (await t.api(owner).post(`/api/spaces/${sid}/roles`).send({ name: 'Mods' }).expect(201))
      .body as SpaceRole;
    const info = (
      await t.api(owner).post(`/api/spaces/${sid}/categories`).send({ name: 'Info' }).expect(201)
    ).body as SpaceCategory;
    const text = textCategory(rockets).id;
    ch.general = general(rockets);
    ch.welcome = await channel(sid, { type: 'space_text', name: 'welcome', topic: 'Say hi' });
    ch.memes = await channel(sid, { type: 'space_text', name: 'memes', categoryId: text });
    // Private (@everyone denied, the creator allowed), role-only, @everyone denied, age-restricted.
    ch.secret = await channel(sid, {
      type: 'space_text',
      name: 'secret',
      categoryId: text,
      privateRoleIds: [],
    });
    ch.staff = await channel(sid, {
      type: 'space_text',
      name: 'staff',
      categoryId: text,
      privateRoleIds: [mods.id],
    });
    ch.denied = await channel(sid, { type: 'space_text', name: 'denied', categoryId: text });
    await t
      .api(owner)
      .put(`/api/spaces/${sid}/channels/${ch.denied.id}/overwrites/role/${everyoneOf(rockets).id}`)
      .send({ allow: 0, deny: PERM.VIEW_CHANNEL })
      .expect(200);
    ch.nsfw = await channel(sid, {
      type: 'space_text',
      name: 'after-hours',
      categoryId: text,
      nsfw: true,
    });
    // Other kinds.
    ch.voice = rockets.channels.find((c) => c.type === 'space_voice')!;
    ch.forum = await channel(sid, { type: 'space_forum', name: 'ideas', categoryId: text });
    ch.news = await channel(sid, {
      type: 'space_text',
      name: 'announcements',
      categoryId: info.id,
      isNews: true,
    });
    ch.rules = await channel(sid, { type: 'space_text', name: 'rules', categoryId: info.id });
    // A role overwrite never counts: denying Mods leaves #memes readable to @everyone.
    await t
      .api(owner)
      .put(`/api/spaces/${sid}/channels/${ch.memes.id}/overwrites/role/${mods.id}`)
      .send({ allow: 0, deny: PERM.VIEW_CHANNEL })
      .expect(200);
    ch.thread = (
      await t
        .api(owner)
        .post(`/api/chats/${ch.general.id}/threads`)
        .send({ name: 'Launch day' })
        .expect(201)
    ).body as ChatSummary;

    // Bob is a member; Dave was banned without ever joining.
    await t
      .api(bob)
      .post(`/api/invites/${await invite(sid)}/join`)
      .expect(200);
    await t.api(owner).put(`/api/spaces/${sid}/bans/${dave.id}`).send({}).expect(204);
    await spaceRegistryIdle();
  });

  afterAll(async () => {
    await t.close();
    if (prevDist === undefined) delete process.env.WEB_DIST_DIR;
    else process.env.WEB_DIST_DIR = prevDist;
    fs.rmSync(dist, { recursive: true, force: true });
  });

  describe('access', () => {
    it('404s for Spaces not listed in discovery, even to their members', async () => {
      await api(viewer).preview(hidden.space.id).expect(404);
      await api(owner).preview(hidden.space.id).expect(404);
      await api(viewer).messages(hidden.space.id, general(hidden).id).expect(404);
      // Turning discovery off hides a listed Space again.
      await t
        .api(owner)
        .patch(`/api/spaces/${rockets.space.id}/community`)
        .send({ isDiscoverable: false })
        .expect(200);
      await api(viewer).preview(rockets.space.id).expect(404);
      await list(rockets.space.id, 'We build model rockets');
      await api(viewer).preview(rockets.space.id).expect(200);
      // Unknown ids and bad ids.
      await api(viewer).preview('00000000-0000-4000-8000-000000000000').expect(404);
      await api(viewer).preview('nope').expect(400);
    });

    it('404s for a user the Space banned; members may preview too', async () => {
      await api(dave).preview(rockets.space.id).expect(404);
      await api(dave).messages(rockets.space.id, ch.general.id).expect(404);
      await api(bob).preview(rockets.space.id).expect(200);
    });
  });

  describe('the preview', () => {
    it('shows the Space and the channels @everyone reads, by category in sidebar order', async () => {
      const icon = await mkMedia(owner.id, 'image');
      const banner = await mkMedia(owner.id, 'image');
      await db
        .update(spaces)
        .set({ iconMediaId: icon.id, bannerMediaId: banner.id })
        .where(eq(spaces.id, rockets.space.id));
      // Bob comes online: the estimate counts him.
      resetPreviewCaches();
      const sb = await t.connect(bob);
      const p = (await api(viewer).preview(rockets.space.id).expect(200)).body as SpacePreview;
      sb.disconnect();
      expect(p).toMatchObject({
        id: rockets.space.id,
        name: 'Rocket Club',
        description: 'We build model rockets',
        iconUrl: `/uploads/${icon.storageKey}`,
        bannerUrl: `/uploads/${banner.storageKey}`,
        memberCount: 2,
        onlineCount: 1,
      });
      expect(p.channels).toEqual([
        { id: ch.welcome.id, name: 'welcome', topic: 'Say hi', categoryName: null, isNews: false },
        {
          id: ch.general.id,
          name: 'general',
          topic: null,
          categoryName: 'Text channels',
          isNews: false,
        },
        {
          id: ch.memes.id,
          name: 'memes',
          topic: null,
          categoryName: 'Text channels',
          isNews: false,
        },
        { id: ch.news.id, name: 'announcements', topic: null, categoryName: 'Info', isNews: true },
        { id: ch.rules.id, name: 'rules', topic: null, categoryName: 'Info', isNews: false },
      ]);
      // Nothing about members leaks into the payload.
      expect(Object.keys(p).sort()).toEqual(
        [
          'bannerUrl',
          'channels',
          'description',
          'iconUrl',
          'id',
          'memberCount',
          'name',
          'onlineCount',
        ].sort(),
      );
    });

    it('takes the @everyone role into account: a channel opened to @everyone by overwrite shows', async () => {
      const quiet = (
        await t.api(owner).post('/api/spaces').send({ name: 'Quiet Library' }).expect(201)
      ).body as SpaceDetail;
      await list(quiet.space.id);
      const everyone = everyoneOf(quiet);
      await t
        .api(owner)
        .patch(`/api/spaces/${quiet.space.id}/roles/${everyone.id}`)
        .send({ permissions: everyone.permissions & ~PERM.VIEW_CHANNEL })
        .expect(200);
      const lobby = await channel(quiet.space.id, { type: 'space_text', name: 'lobby' });
      await t
        .api(owner)
        .put(`/api/spaces/${quiet.space.id}/channels/${lobby.id}/overwrites/role/${everyone.id}`)
        .send({ allow: PERM.VIEW_CHANNEL, deny: 0 })
        .expect(200);
      // A member overwrite opens #general to Bob only: still not for @everyone.
      await t
        .api(bob)
        .post(`/api/invites/${await invite(quiet.space.id)}/join`)
        .expect(200);
      await t
        .api(owner)
        .put(
          `/api/spaces/${quiet.space.id}/channels/${general(quiet).id}/overwrites/member/${bob.id}`,
        )
        .send({ allow: PERM.VIEW_CHANNEL, deny: 0 })
        .expect(200);
      const p = (await api(viewer).preview(quiet.space.id).expect(200)).body as SpacePreview;
      expect(p.channels.map((c) => c.name)).toEqual(['lobby']);
      await api(viewer).messages(quiet.space.id, general(quiet).id).expect(404);
      await api(viewer).messages(quiet.space.id, lobby.id).expect(200);
    });
  });

  describe('messages', () => {
    it('serves the newest messages of a readable channel, oldest first, viewer-neutral', async () => {
      const sid = rockets.space.id;
      for (let i = 1; i <= 52; i++) await sendOk(t, owner, ch.memes.id, `meme ${i}`);
      const gone = await sendOk(t, owner, ch.memes.id, 'oops, wrong channel');
      await t.api(owner).delete(`/api/messages/${gone.id}?for=everyone`).expect(204);
      const last = await sendOk(t, bob, ch.memes.id, 'last one');
      await t
        .api(owner)
        .put(`/api/messages/${last.id}/reactions/${encodeURIComponent('🚀')}/@me`)
        .expect(204);

      const { messages } = (await api(viewer).messages(sid, ch.memes.id).expect(200))
        .body as SpacePreviewMessages;
      expect(messages).toHaveLength(50);
      expect(messages.map((m) => m.seq)).toEqual(
        [...messages.map((m) => m.seq)].sort((a, b) => a - b),
      );
      expect(messages.at(-1)).toMatchObject({ id: last.id, text: 'last one', senderId: bob.id });
      expect(messages.at(-1)!.reactions).toEqual([{ emoji: '🚀', count: 1, userIds: [] }]);
      // Deleted for everyone: a tombstone.
      expect(messages.at(-2)).toMatchObject({ id: gone.id, text: null, media: null });
      expect(messages.at(-2)!.deletedAt).toBeTruthy();
      // 54 in all: the newest 50 start at the fifth.
      expect(messages[0]!.text).toBe('meme 5');
      // Viewer-specific keys are absent.
      expect('starred' in messages[0]!).toBe(false);
      expect('myReactions' in messages[0]!).toBe(false);
    });

    it('404s for every channel @everyone cannot read, threads and other kinds included', async () => {
      const sid = rockets.space.id;
      await sendOk(t, owner, ch.secret.id, 'top secret');
      for (const c of [ch.secret, ch.staff, ch.denied, ch.nsfw, ch.voice, ch.forum, ch.thread])
        await api(viewer).messages(sid, c.id).expect(404);
      // Another Space's channel under this Space's id.
      await api(viewer).messages(sid, general(hidden).id).expect(404);
      await api(viewer).messages(sid, '00000000-0000-4000-8000-000000000000').expect(404);
      await api(viewer).messages(sid, ch.rules.id).expect(200);
    });

    it('creates no read rows and no membership', async () => {
      const sid = rockets.space.id;
      const rowsOf = async () => Number((await db.select({ n: count() }).from(chatMembers))[0]!.n);
      const before = await rowsOf();
      await api(viewer).preview(sid).expect(200);
      for (const c of [ch.general, ch.memes, ch.news, ch.welcome])
        await api(viewer).messages(sid, c.id).expect(200);
      expect(await rowsOf()).toBe(before);
      expect(await db.select().from(chatMembers).where(eq(chatMembers.userId, viewer.id))).toEqual(
        [],
      );
      expect(
        await db.select().from(spaceMembers).where(eq(spaceMembers.userId, viewer.id)),
      ).toEqual([]);
      const [space] = await db
        .select({ n: spaces.memberCount })
        .from(spaces)
        .where(eq(spaces.id, sid));
      expect(space!.n).toBe(2);
    });

    it('allows 30 channel reads a minute per user', async () => {
      const sid = rockets.space.id;
      resetUserLimits();
      config.rateLimit = true;
      try {
        for (let i = 0; i < 30; i++) await api(viewer).messages(sid, ch.general.id).expect(200);
        const res = await api(viewer).messages(sid, ch.general.id).expect(429);
        expect(res.body.error.code).toBe('rate_limited');
        // Per user: someone else still reads.
        await api(bob).messages(sid, ch.general.id).expect(200);
      } finally {
        config.rateLimit = false;
        resetUserLimits();
      }
    });
  });

  describe('invite unfurls', () => {
    const page = (p: string) => t.api().get(p);
    /** The page without the inserted tag lines must be the built file, byte for byte. */
    const withoutTags = (html: string) =>
      html.replace(/ {2}<meta property="og:type"[\s\S]*?\/>\n {2}(?=<\/head>)/, '');

    it('puts escaped Open Graph and Twitter tags into index.html, the rest untouched', async () => {
      resetUnfurlCache();
      const party = (
        await t.api(owner).post('/api/spaces').send({ name: 'Rock & <Roll> "Club"' }).expect(201)
      ).body as SpaceDetail;
      await t
        .api(owner)
        .patch(`/api/spaces/${party.space.id}`)
        .send({ description: "Loud <b>music</b> & 'fun'\nevery night" })
        .expect(200);
      const icon = await mkMedia(owner.id, 'image');
      await db.update(spaces).set({ iconMediaId: icon.id }).where(eq(spaces.id, party.space.id));
      const code = await invite(party.space.id);

      const res = await page(`/join/${code}`).expect(200);
      expect(res.headers['content-type']).toMatch(/^text\/html/);
      const html = res.text;
      const title = 'Join Rock &amp; &lt;Roll&gt; &quot;Club&quot; on Enbox';
      const description = 'Loud &lt;b&gt;music&lt;/b&gt; &amp; &#39;fun&#39; every night';
      const image = `http://localhost:5173/uploads/${icon.storageKey}`;
      for (const tag of [
        `<meta property="og:type" content="website" />`,
        `<meta property="og:site_name" content="Enbox" />`,
        `<meta property="og:title" content="${title}" />`,
        `<meta property="og:description" content="${description}" />`,
        `<meta property="og:url" content="http://localhost:5173/join/${code}" />`,
        `<meta property="og:image" content="${image}" />`,
        `<meta name="twitter:card" content="summary" />`,
        `<meta name="twitter:title" content="${title}" />`,
        `<meta name="twitter:description" content="${description}" />`,
        `<meta name="twitter:image" content="${image}" />`,
      ])
        expect(html).toContain(tag);
      expect(html).not.toContain('<b>music');
      expect(html).not.toContain('<Roll>');
      // After the inline script, before the real </head>; the CSP meta and the script as built.
      expect(html.indexOf('og:title')).toBeGreaterThan(html.indexOf('</script>'));
      expect(html.indexOf('og:title')).toBeLessThan(headEnd(html));
      expect(html).toContain(CSP);
      expect(html).toContain(THEME_SCRIPT);
      expect(withoutTags(html)).toBe(INDEX_HTML);
    });

    it('serves vanity codes too, and the member count without a description', async () => {
      resetUnfurlCache();
      const club = (await t.api(owner).post('/api/spaces').send({ name: 'Star Club' }).expect(201))
        .body as SpaceDetail;
      await t
        .api(owner)
        .patch(`/api/spaces/${club.space.id}/community`)
        .send({ vanityCode: 'star-club' })
        .expect(200);
      const html = (await page('/join/Star-Club').expect(200)).text;
      expect(html).toContain('<meta property="og:title" content="Join Star Club on Enbox" />');
      expect(html).toContain('<meta property="og:description" content="1 member" />');
      // No icon: the app icon.
      expect(html).toContain(
        '<meta property="og:image" content="http://localhost:5173/icons/icon-512.png" />',
      );
    });

    it('caches a code for a minute', async () => {
      resetUnfurlCache();
      const code = await invite(rockets.space.id);
      expect((await page(`/join/${code}`).expect(200)).text).toContain(
        'content="Join Rocket Club on Enbox"',
      );
      await t
        .api(owner)
        .patch(`/api/spaces/${rockets.space.id}`)
        .send({ name: 'Rocket Society' })
        .expect(200);
      expect((await page(`/join/${code}`).expect(200)).text).toContain(
        'content="Join Rocket Club on Enbox"',
      );
      resetUnfurlCache();
      expect((await page(`/join/${code}`).expect(200)).text).toContain(
        'content="Join Rocket Society on Enbox"',
      );
      await t
        .api(owner)
        .patch(`/api/spaces/${rockets.space.id}`)
        .send({ name: 'Rocket Club' })
        .expect(200);
    });

    it('serves the plain index.html for unknown, malformed, expired and used-up codes', async () => {
      resetUnfurlCache();
      expect((await page('/join/ABCDEFGHJKLMNPQRSTUVWX').expect(200)).text).toBe(INDEX_HTML);
      expect((await page('/join/no').expect(200)).text).toBe(INDEX_HTML);
      expect((await page('/join/%3Cscript%3E').expect(200)).text).toBe(INDEX_HTML);
      const expired = await invite(rockets.space.id);
      await db
        .update(spaceInvites)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(spaceInvites.code, expired));
      expect((await page(`/join/${expired}`).expect(200)).text).toBe(INDEX_HTML);
      const once = await invite(rockets.space.id, { maxUses: 1 });
      await t.api(viewer).post(`/api/invites/${once}/join`).expect(200);
      expect((await page(`/join/${once}`).expect(200)).text).toBe(INDEX_HTML);
      // Other pages of the app are the plain SPA as before.
      expect((await page('/discover').expect(200)).text).toBe(INDEX_HTML);
      await t.api(viewer).post(`/api/spaces/${rockets.space.id}/leave`).expect(204);
    });
  });
});
