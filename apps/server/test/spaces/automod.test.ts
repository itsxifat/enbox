/**
 * AutoMod: the matcher (keywords with `*` wildcards, phrases, the allow list, the regex
 * guard, links), rule CRUD with MANAGE_SPACE (limits, checks, audit, `automod:rules`), every
 * trigger type on sends, exemptions (role, channel, MANAGE_SPACE, owner), the block response,
 * the alert system message in the alert channel (blocked / flagged), the timeout, edits
 * re-checked, and the per-Space cache following rule changes.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  AUTOMOD_BLOCKED_CODE,
  MAX_AUTOMOD_RULES,
  PERM,
  mentionToken,
  type AutoModRule,
  type ChatSummary,
  type Message,
  type MessagePage,
  type SpaceAuditEntry,
  type SpaceDetail,
  type SpaceInvite,
  type SpaceMember,
  type SpaceRole,
  type SystemEvent,
} from '@enbox/shared';
import { db } from '../../src/db/index.js';
import { automodRules, spaceMembers } from '../../src/db/schema.js';
import { spaceRegistryIdle } from '../../src/realtime/spaceRegistry.js';
import {
  DEFAULT_BLOCK_MESSAGE,
  autoModIdle,
  forgetAutoModRules,
  linksOf,
  matchKeywords,
  normalizeText,
  regexProblem,
  resetAutoModLinks,
} from '../../src/services/automod.js';
import { startTestServer, waitForEvent, type TestServer, type TestUser } from '../helpers.js';

describe('AutoMod matcher', () => {
  it('keywords: whole words, case-insensitive; `*` matches word endings, beginnings or parts', () => {
    expect(matchKeywords(['cat'], [], 'my CAT!')).toBe('cat');
    expect(matchKeywords(['cat'], [], 'I like cats')).toBeNull();
    expect(matchKeywords(['cat*'], [], 'a catapult')).toBe('catapult');
    expect(matchKeywords(['*cat'], [], 'bobcat')).toBe('bobcat');
    expect(matchKeywords(['*cat*'], [], 'location')).toBe('location');
    expect(matchKeywords(['*cat*'], [], 'dog')).toBeNull();
  });

  it('phrases, symbols and emoji; fullwidth letters and spacing do not hide a word', () => {
    expect(matchKeywords(['ice cream'], [], 'I love ICE   cream!')).toBe('ice cream');
    expect(matchKeywords(['ice cream'], [], 'nice cream')).toBeNull();
    expect(matchKeywords(['c++'], [], 'I code c++ daily')).toBe('c++');
    expect(matchKeywords(['🍆'], [], 'look 🍆')).toBe('🍆');
    expect(matchKeywords(['bad'], [], 'ｂａｄ word')).toBe('bad');
    // Mention tokens are not words; custom emoji read as their name.
    expect(matchKeywords(['dead'], [], `hi @{deadbeef-0000-4000-8000-000000000000}`)).toBeNull();
    expect(matchKeywords(['blob'], [], `<:blob:deadbeef-0000-4000-8000-000000000000>`)).toBe('blob');
  });

  it('the allow list wins inside an allowed word, not elsewhere', () => {
    expect(matchKeywords(['*ass*'], ['class'], 'my class rocks')).toBeNull();
    expect(matchKeywords(['*ass*'], ['class'], 'my class, you ass')).toBe('ass');
    expect(matchKeywords(['*ass*'], ['class*'], 'classy')).toBeNull();
  });

  it('the regex guard refuses backreferences, lookarounds and nested quantifiers', () => {
    expect(regexProblem('(?:https?://)?discord\\.gg/\\w+')).toBeNull();
    expect(regexProblem('free\\s+n[i1]tro')).toBeNull();
    expect(regexProblem('(ab)+')).toBeNull();
    expect(regexProblem('(a+)+')).toMatch(/nested quantifiers/);
    expect(regexProblem('(a|ab)*')).toMatch(/nested quantifiers/);
    expect(regexProblem('(a?){30}a{30}')).toMatch(/nested quantifiers/);
    expect(regexProblem('(a)\\1')).toMatch(/backreference/);
    expect(regexProblem('(?<x>a)\\k<x>')).toMatch(/backreference/);
    expect(regexProblem('foo(?=bar)')).toMatch(/lookaround/);
    expect(regexProblem('(?<!x)y')).toMatch(/lookaround/);
    expect(regexProblem('(')).toMatch(/not a valid/);
  });

  it('links: scheme, www. and trailing punctuation ignored', () => {
    expect(linksOf(normalizeText('see https://Example.com/x, or www.example.com/x! (http://a.b/c)'))).toEqual([
      'example.com/x',
      'example.com/x',
      'a.b/c',
    ]);
  });
});

const HOUR_AGO = () => new Date(Date.now() - 3_600_000);
const rid = () => Math.random().toString(36).slice(2);

describe('AutoMod', () => {
  let t: TestServer;
  let owner: TestUser;
  let mod: TestUser;
  let bob: TestUser;
  let dave: TestUser;
  let carol: TestUser;
  let detail: SpaceDetail;
  let modLog: ChatSummary;
  let memes: ChatSummary;
  let trusted: SpaceRole;
  const spaceId = () => detail.space.id;
  const general = () => detail.channels.find((c) => c.name === 'general')!;
  const base = () => `/api/spaces/${spaceId()}/automod/rules`;

  const create = (body: Record<string, unknown>, user: TestUser = owner) => t.api(user).post(base()).send(body);
  async function rule(body: Record<string, unknown>): Promise<AutoModRule> {
    return (await create(body).expect(201)).body as AutoModRule;
  }
  const keywordRule = (keywords: string[], extra: Record<string, unknown> = {}) =>
    rule({ name: 'Custom words', triggerType: 'keyword', triggerMetadata: { keywords }, actions: [{ type: 'block' }], ...extra });

  const send = (user: TestUser, chatId: string, text: string) =>
    t.api(user).post(`/api/chats/${chatId}/messages`).send({ clientId: rid(), type: 'text', text });

  async function expectBlocked(user: TestUser, chatId: string, text: string, message = DEFAULT_BLOCK_MESSAGE) {
    const res = await send(user, chatId, text);
    expect(res.status).toBe(403);
    expect(res.body.error).toEqual({ code: AUTOMOD_BLOCKED_CODE, message });
  }
  async function expectSent(user: TestUser, chatId: string, text: string): Promise<Message> {
    const res = await send(user, chatId, text);
    expect(res.status).toBe(201);
    return res.body as Message;
  }

  async function messages(chatId: string): Promise<Message[]> {
    return ((await t.api(owner).get(`/api/chats/${chatId}/messages`).expect(200)).body as MessagePage).messages;
  }
  async function alerts(): Promise<Extract<SystemEvent, { kind: 'automod_alert' }>[]> {
    await autoModIdle();
    return (await messages(modLog.id)).flatMap((m) => (m.system?.kind === 'automod_alert' ? [m.system] : []));
  }
  async function auditLog(action: string): Promise<SpaceAuditEntry[]> {
    await autoModIdle();
    return (await t.api(owner).get(`/api/spaces/${spaceId()}/audit-log`).query({ action }).expect(200))
      .body as SpaceAuditEntry[];
  }
  const memberRow = async (userId: string) =>
    (
      await db
        .select()
        .from(spaceMembers)
        .where(and(eq(spaceMembers.spaceId, spaceId()), eq(spaceMembers.userId, userId)))
    )[0]!;

  beforeAll(async () => {
    t = await startTestServer();
    [owner, mod, bob, dave, carol] = [
      await t.createUser({ displayName: 'Owner' }),
      await t.createUser({ displayName: 'Mod' }),
      await t.createUser({ displayName: 'Bob' }),
      await t.createUser({ displayName: 'Dave' }),
      await t.createUser({ displayName: 'Carol' }),
    ];
    detail = (await t.api(owner).post('/api/spaces').send({ name: 'Guarded' }).expect(201)).body as SpaceDetail;
    const invite = (await t.api(owner).post(`/api/spaces/${spaceId()}/invites`).send({}).expect(201))
      .body as SpaceInvite;
    for (const u of [mod, bob, dave]) await t.api(u).post(`/api/invites/${invite.code}/join`).expect(200);
    const mods = (
      await t.api(owner).post(`/api/spaces/${spaceId()}/roles`).send({ name: 'Mods', permissions: PERM.MANAGE_SPACE }).expect(201)
    ).body as SpaceRole;
    await t.api(owner).put(`/api/spaces/${spaceId()}/members/${mod.id}/roles/${mods.id}`).expect(200);
    trusted = (await t.api(owner).post(`/api/spaces/${spaceId()}/roles`).send({ name: 'Trusted' }).expect(201))
      .body as SpaceRole;
    modLog = (
      await t.api(owner).post(`/api/spaces/${spaceId()}/channels`).send({ type: 'space_text', name: 'mod-log' }).expect(201)
    ).body as ChatSummary;
    memes = (
      await t.api(owner).post(`/api/spaces/${spaceId()}/channels`).send({ type: 'space_text', name: 'memes' }).expect(201)
    ).body as ChatSummary;
    // Settled members (spam_links treats fresh members' links as suspicious).
    await db.update(spaceMembers).set({ joinedAt: HOUR_AGO() }).where(eq(spaceMembers.spaceId, spaceId()));
    await spaceRegistryIdle();
  });
  afterEach(async () => {
    await autoModIdle();
    await db.delete(automodRules).where(eq(automodRules.spaceId, spaceId()));
    await db.update(spaceMembers).set({ timedOutUntil: null }).where(eq(spaceMembers.spaceId, spaceId()));
    forgetAutoModRules();
    resetAutoModLinks();
  });
  afterAll(() => t.close());

  describe('rules', () => {
    it('MANAGE_SPACE manages them: members get 403, non-members 404', async () => {
      await t.api(bob).get(base()).expect(403);
      await create({ name: 'x', triggerType: 'spam_links', actions: [{ type: 'block' }] }, bob).expect(403);
      await t.api(carol).get(base()).expect(404);
      const sock = await t.connect(mod);
      const pushed = waitForEvent(sock, 'automod:rules', { filter: (p) => p.spaceId === spaceId() });
      const created = (
        await create({ name: 'Links', triggerType: 'spam_links', actions: [{ type: 'block' }] }, mod).expect(201)
      ).body as AutoModRule;
      expect(created).toMatchObject({
        spaceId: spaceId(),
        name: 'Links',
        triggerType: 'spam_links',
        triggerMetadata: {},
        actions: [{ type: 'block', customMessage: null }],
        enabled: true,
        exemptRoleIds: [],
        exemptChannelIds: [],
        creatorId: mod.id,
      });
      // The managers' devices get the whole list.
      expect((await pushed).rules.map((r) => r.id)).toEqual([created.id]);
      expect(((await t.api(owner).get(base()).expect(200)).body as AutoModRule[]).map((r) => r.id)).toEqual([created.id]);
      const renamed = (await t.api(owner).patch(`${base()}/${created.id}`).send({ name: 'Spam', enabled: false }).expect(200))
        .body as AutoModRule;
      expect(renamed).toMatchObject({ id: created.id, name: 'Spam', enabled: false });
      await t.api(bob).patch(`${base()}/${created.id}`).send({ name: 'mine' }).expect(403);
      await t.api(bob).delete(`${base()}/${created.id}`).expect(403);
      await t.api(owner).delete(`${base()}/${created.id}`).expect(204);
      await t.api(owner).delete(`${base()}/${created.id}`).expect(404);
      const log = (await auditLog('automod.rule.create')).concat(
        await auditLog('automod.rule.update'),
        await auditLog('automod.rule.delete'),
      );
      expect(log.map((e) => [e.action, e.targetId])).toEqual([
        ['automod.rule.create', created.id],
        ['automod.rule.update', created.id],
        ['automod.rule.delete', created.id],
      ]);
      sock.disconnect();
    });

    it('checks: content per type, one action of each kind, the alert channel, exemptions', async () => {
      const bad = async (body: Record<string, unknown>, re: RegExp) => {
        const res = await create(body).expect(400);
        expect(res.body.error.message).toMatch(re);
      };
      await bad({ name: 'x', triggerType: 'keyword', actions: [{ type: 'block' }] }, /at least one keyword/);
      await bad({ name: 'x', triggerType: 'preset', actions: [{ type: 'block' }] }, /word list/);
      await bad(
        { name: 'x', triggerType: 'keyword', triggerMetadata: { keywords: ['a'] }, actions: [{ type: 'block' }, { type: 'block' }] },
        /one block action/,
      );
      await bad(
        { name: 'x', triggerType: 'keyword', triggerMetadata: { keywords: ['a'] }, actions: [{ type: 'alert', channelId: carol.id }] },
        /alert channel/,
      );
      const everyone = detail.space.roles.find((r) => r.isDefault)!;
      await bad(
        { name: 'x', triggerType: 'keyword', triggerMetadata: { keywords: ['a'] }, actions: [{ type: 'block' }], exemptRoleIds: [everyone.id] },
        /Unknown role/,
      );
      await bad(
        { name: 'x', triggerType: 'keyword', triggerMetadata: { keywords: ['a'] }, actions: [{ type: 'block' }], exemptChannelIds: [carol.id] },
        /Unknown channel/,
      );
      // Metadata of another type is dropped; mention spam has a default limit.
      const ms = await rule({
        name: 'Mentions',
        triggerType: 'mention_spam',
        triggerMetadata: { keywords: ['x'] },
        actions: [{ type: 'block' }],
      });
      expect(ms.triggerMetadata).toEqual({ mentionLimit: 20 });
      // One mention spam rule per Space.
      const dup = await create({ name: 'Again', triggerType: 'mention_spam', actions: [{ type: 'block' }] }).expect(409);
      expect(dup.body.error.code).toBe('conflict');
    });

    it('regular expressions that could backtrack forever are refused (400)', async () => {
      for (const [pattern, re] of [
        ['(a+)+$', /nested quantifiers/],
        ['(x|xy)*z', /nested quantifiers/],
        ['(a)\\1', /backreference/],
        ['spam(?=now)', /lookaround/],
        ['[', /not a valid/],
      ] as const) {
        const res = await create({
          name: 'Patterns',
          triggerType: 'keyword',
          triggerMetadata: { regexPatterns: [pattern] },
          actions: [{ type: 'block' }],
        }).expect(400);
        expect(res.body.error.message).toMatch(re);
      }
      expect(await t.api(owner).get(base()).expect(200).then((r) => r.body)).toEqual([]);
    });

    it(`at most ${MAX_AUTOMOD_RULES} rules per Space`, async () => {
      await db.insert(automodRules).values(
        Array.from({ length: MAX_AUTOMOD_RULES }, (_, i) => ({
          spaceId: spaceId(),
          name: `r${i}`,
          triggerType: 'keyword' as const,
          triggerMetadata: { keywords: [`w${i}`] },
          actions: [{ type: 'block' as const }],
        })),
      );
      const res = await create({ name: 'one more', triggerType: 'keyword', triggerMetadata: { keywords: ['x'] }, actions: [{ type: 'block' }] }).expect(409);
      expect(res.body.error.code).toBe('limit_reached');
    });
  });

  describe('triggers', () => {
    it('keyword: blocks with 403 automod_blocked (custom message), nothing is posted', async () => {
      await keywordRule(['badword', 'bad*', '*thing', '*mid*', 'ice cream'], {
        actions: [{ type: 'block', customMessage: 'Keep it friendly here' }],
      });
      for (const text of ['so BADWORD', 'badness', 'something', 'amidst us', 'I want ICE  cream'])
        await expectBlocked(bob, general().id, text, 'Keep it friendly here');
      await expectSent(bob, general().id, 'a nice cream and a good day');
      const texts = (await messages(general().id)).map((m) => m.text);
      expect(texts).toContain('a nice cream and a good day');
      expect(texts).not.toContain('badness');
    });

    it('keyword: patterns and the allow list', async () => {
      await keywordRule(['*ass*'], {
        triggerMetadata: { keywords: ['*ass*'], regexPatterns: ['discord\\.gg/\\w+'], allowList: ['class', 'pass*'] },
      });
      await expectSent(bob, general().id, 'our class passed');
      await expectBlocked(bob, general().id, 'what an ass');
      await expectBlocked(bob, general().id, 'join discord.gg/abcdef now');
      await expectSent(bob, general().id, 'discord dot gg');
    });

    it('keyword: a slow pattern the guard lets through is cut off by the time budget', async () => {
      // Polynomial, not exponential: allowed when saved, interrupted (= no match) when it runs away.
      await keywordRule(['zzz'], { triggerMetadata: { keywords: ['zzz'], regexPatterns: ['\\d+\\d+\\d+\\d+x'] } });
      const t0 = Date.now();
      await expectSent(bob, general().id, '1'.repeat(4000));
      expect(Date.now() - t0).toBeLessThan(2000);
      await expectBlocked(bob, general().id, 'code 12345x');
    });

    it('preset: built-in lists, with the allow list', async () => {
      await rule({
        name: 'Commonly flagged words',
        triggerType: 'preset',
        triggerMetadata: { presets: ['profanity'], allowList: ['bollocks'] },
        actions: [{ type: 'block' }],
      });
      await expectBlocked(bob, general().id, 'what the FUCK');
      await expectSent(bob, general().id, 'oh bollocks');
      await expectSent(bob, general().id, 'have a lovely day');
    });

    it('mention_spam: unique members, mentionable roles and @everyone over the limit', async () => {
      await rule({ name: 'Mentions', triggerType: 'mention_spam', triggerMetadata: { mentionLimit: 2 }, actions: [{ type: 'block' }] });
      await expectSent(bob, general().id, `${mentionToken(owner.id)} ${mentionToken(mod.id)} ${mentionToken(owner.id)}`);
      await expectBlocked(bob, general().id, `${mentionToken(owner.id)} ${mentionToken(mod.id)} ${mentionToken(dave.id)}`);
      // Tokens of people who are not members do not count.
      await expectSent(bob, general().id, `${mentionToken(carol.id)} ${mentionToken(owner.id)} ${mentionToken(mod.id)}`);
    });

    it('spam_links: links from new members, and the same link more than 3 times', async () => {
      await rule({ name: 'Spam', triggerType: 'spam_links', actions: [{ type: 'block' }] });
      for (let i = 0; i < 3; i++) await expectSent(bob, general().id, `look https://spam.example/x ${i}`);
      await expectBlocked(bob, general().id, 'again www.spam.example/x');
      await expectSent(dave, general().id, 'mine https://spam.example/x');
      await db
        .update(spaceMembers)
        .set({ joinedAt: new Date() })
        .where(and(eq(spaceMembers.spaceId, spaceId()), eq(spaceMembers.userId, dave.id)));
      await expectBlocked(dave, general().id, 'fresh https://other.example');
      await expectSent(dave, general().id, 'no links, all fine');
      await db
        .update(spaceMembers)
        .set({ joinedAt: HOUR_AGO() })
        .where(and(eq(spaceMembers.spaceId, spaceId()), eq(spaceMembers.userId, dave.id)));
    });

    it('polls are checked too', async () => {
      await keywordRule(['forbidden']);
      const res = await t
        .api(bob)
        .post(`/api/chats/${general().id}/messages`)
        .send({ clientId: rid(), type: 'poll', poll: { question: 'Best?', options: ['ok', 'Forbidden fruit'] } });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe(AUTOMOD_BLOCKED_CODE);
    });
  });

  describe('exemptions', () => {
    it('exempt roles and channels, MANAGE_SPACE and the owner; disabled rules', async () => {
      const r = await keywordRule(['nope'], { exemptRoleIds: [trusted.id], exemptChannelIds: [memes.id] });
      await expectBlocked(bob, general().id, 'nope');
      await expectSent(bob, memes.id, 'nope'); // exempt channel
      await expectSent(owner, general().id, 'nope'); // the owner
      await expectSent(mod, general().id, 'nope'); // MANAGE_SPACE
      await t.api(owner).put(`/api/spaces/${spaceId()}/members/${bob.id}/roles/${trusted.id}`).expect(200);
      await expectSent(bob, general().id, 'nope'); // exempt role
      await t.api(owner).delete(`/api/spaces/${spaceId()}/members/${bob.id}/roles/${trusted.id}`).expect(200);
      await expectBlocked(bob, general().id, 'nope');
      // A partial PATCH keeps everything it does not send.
      const off = (await t.api(owner).patch(`${base()}/${r.id}`).send({ enabled: false }).expect(200)).body as AutoModRule;
      expect(off).toMatchObject({
        enabled: false,
        triggerMetadata: { keywords: ['nope'] },
        exemptRoleIds: [trusted.id],
        exemptChannelIds: [memes.id],
      });
      await expectSent(bob, general().id, 'nope');
    });
  });

  describe('actions', () => {
    it('alert + block: an automod_alert in the alert channel says blocked; audit automod.block', async () => {
      const r = await keywordRule(['scam'], {
        name: 'No scams',
        actions: [{ type: 'block' }, { type: 'alert', channelId: modLog.id }],
      });
      const sock = await t.connect(owner);
      const alerted = waitForEvent(sock, 'message:new', { filter: (p) => p.message.chatId === modLog.id });
      await expectBlocked(bob, general().id, 'a scam for you');
      const got = (await alerted).message;
      expect(got.type).toBe('system');
      expect(got.system).toEqual({
        kind: 'automod_alert',
        ruleName: 'No scams',
        userId: bob.id,
        channelId: general().id,
        content: 'a scam for you',
        action: 'blocked',
      });
      expect(await alerts()).toHaveLength(1);
      const [entry] = await auditLog('automod.block');
      expect(entry).toMatchObject({
        actorId: null,
        action: 'automod.block',
        targetType: 'member',
        targetId: bob.id,
        changes: { ruleId: r.id, ruleName: 'No scams', triggerType: 'keyword', channelId: general().id, matched: 'scam' },
      });
      sock.disconnect();
    });

    it('alert only: the message goes through and is flagged (audit automod.flag)', async () => {
      await keywordRule(['sus'], { name: 'Watch', actions: [{ type: 'alert', channelId: modLog.id }] });
      const before = (await alerts()).length;
      const sent = await expectSent(bob, general().id, 'kinda sus');
      expect((await messages(general().id)).some((m) => m.id === sent.id)).toBe(true);
      const list = await alerts();
      expect(list).toHaveLength(before + 1);
      expect(list[list.length - 1]).toMatchObject({ ruleName: 'Watch', userId: bob.id, content: 'kinda sus', action: 'flagged' });
      expect((await auditLog('automod.flag'))[0]).toMatchObject({ targetId: bob.id, changes: { ruleName: 'Watch' } });
    });

    it('timeout: the member is timed out (same events as a moderator timeout), then cannot send', async () => {
      await keywordRule(['spamword'], { name: 'Cool down', actions: [{ type: 'block' }, { type: 'timeout', durationSeconds: 300 }] });
      const sock = await t.connect(owner);
      const updated = waitForEvent(sock, 'space:member-updated', { filter: (p) => p.member.userId === bob.id });
      const t0 = Date.now();
      await expectBlocked(bob, general().id, 'spamword');
      const member = (await updated).member as SpaceMember;
      const until = Date.parse(member.timedOutUntil!);
      expect(until).toBeGreaterThanOrEqual(t0 + 299_000);
      expect(until).toBeLessThanOrEqual(Date.now() + 301_000);
      expect((await memberRow(bob.id)).timedOutUntil?.getTime()).toBe(until);
      const [entry] = await auditLog('automod.timeout');
      expect(entry).toMatchObject({ actorId: null, targetId: bob.id, changes: { durationSeconds: 300, ruleName: 'Cool down' } });
      // Timed out: even harmless messages are refused now.
      const res = await send(bob, general().id, 'hello?');
      expect(res.status).toBe(403);
      expect(res.body.error.code).not.toBe(AUTOMOD_BLOCKED_CODE);
      sock.disconnect();
    });

    it('edits are checked again: a blocked edit keeps the old text', async () => {
      await keywordRule(['hateword']);
      const m = await expectSent(bob, general().id, 'all good');
      const res = await t.api(bob).patch(`/api/messages/${m.id}`).send({ text: 'now a HATEWORD' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe(AUTOMOD_BLOCKED_CODE);
      expect((await messages(general().id)).find((x) => x.id === m.id)?.text).toBe('all good');
      await t.api(bob).patch(`/api/messages/${m.id}`).send({ text: 'still good' }).expect(200);
    });
  });

  it('the cache follows rule changes at once (perm_version)', async () => {
    const r = await keywordRule(['alpha']);
    await expectBlocked(bob, general().id, 'alpha');
    await t.api(owner).patch(`${base()}/${r.id}`).send({ triggerMetadata: { keywords: ['beta'] } }).expect(200);
    await expectSent(bob, general().id, 'alpha');
    await expectBlocked(bob, general().id, 'beta');
    await t.api(owner).delete(`${base()}/${r.id}`).expect(204);
    await expectSent(bob, general().id, 'beta');
  });
});
