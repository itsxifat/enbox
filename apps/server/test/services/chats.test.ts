import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { mentionToken } from '@enbox/shared';
import { db } from '../../src/db/index.js';
import { chatMembers, chats, messageHidden, messages, users } from '../../src/db/schema.js';
import {
  assertCanSend,
  getChatAccess,
  lockChats,
  maxVisibleSeq,
  requireActiveMember,
  visibleTo,
  windowOf,
} from '../../src/services/chats.js';
import { transact } from '../../src/services/effects.js';
import { upsertMembership } from '../../src/services/membership.js';
import {
  chatSummariesForPairs,
  toChatSummaries,
  toChatSummary,
} from '../../src/services/summaries.js';
import { pairKey } from '../../src/services/sql.js';
import { startTestServer, type TestServer, type TestUser } from '../helpers.js';
import {
  block,
  countQueries,
  createChannel,
  createDirect,
  createGroup,
  memberRow,
  send,
  setSettings,
} from './fixtures.js';

describe('services/chats + summaries', () => {
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

  describe('visibility window', () => {
    it('applies joined / cleared / left / hidden-for-me / expired', async () => {
      const chatId = await createGroup(alice, [bob]);
      const m1 = await send(alice, chatId, 'm1');
      const m2 = await send(alice, chatId, 'm2');
      // carol joins: sees nothing before the join message
      await transact((tx, fx) =>
        upsertMembership(tx, fx, {
          kind: 'activate',
          chatId,
          userIds: [carol.id],
          addedBy: alice.id,
          systemEvent: { kind: 'members_added', actorId: alice.id, userIds: [carol.id] },
        }),
      );
      const m3 = await send(alice, chatId, 'm3');
      const m4 = await send(alice, chatId, 'm4 hidden for bob');
      await db.insert(messageHidden).values({ userId: bob.id, messageId: m4.message.id });
      const m5 = await send(alice, chatId, 'm5 expired');
      await db
        .update(messages)
        .set({ expiresAt: new Date(Date.now() - 1) })
        .where(eq(messages.id, m5.message.id));
      // bob clears up to m2
      await db
        .update(chatMembers)
        .set({ clearedSeq: m2.message.seq })
        .where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, bob.id)));
      // carol is removed after m3 → window ends at the removal message
      const removal = await transact((tx, fx) =>
        upsertMembership(tx, fx, {
          kind: 'deactivate',
          chatId,
          userId: carol.id,
          reason: 'removed',
          systemEvent: { kind: 'member_removed', actorId: alice.id, userId: carol.id },
        }),
      );
      const m6 = await send(alice, chatId, 'm6 after removal');

      const visibleIds = async (userId: string) => {
        const member = await memberRow(chatId, userId);
        const rows = await db
          .select({ id: messages.id })
          .from(messages)
          .where(and(eq(messages.chatId, chatId), visibleTo(windowOf(member))));
        return new Set(rows.map((r) => r.id));
      };
      const bobSees = await visibleIds(bob.id);
      expect(bobSees.has(m1.message.id)).toBe(false); // cleared
      expect(bobSees.has(m2.message.id)).toBe(false); // cleared (inclusive)
      expect(bobSees.has(m3.message.id)).toBe(true);
      expect(bobSees.has(m4.message.id)).toBe(false); // hidden for me
      expect(bobSees.has(m5.message.id)).toBe(false); // expired
      expect(bobSees.has(m6.message.id)).toBe(true);

      const carolSees = await visibleIds(carol.id);
      expect(carolSees.has(m2.message.id)).toBe(false); // before joining
      expect(carolSees.has(m3.message.id)).toBe(true);
      expect(carolSees.has(removal.systemMessage!.id)).toBe(true); // sees own removal
      expect(carolSees.has(m6.message.id)).toBe(false); // after leaving

      const carolMember = await memberRow(chatId, carol);
      expect(await maxVisibleSeq(db, chatId, windowOf(carolMember))).toBe(
        Number(removal.systemMessage!.seq),
      );
      expect(await maxVisibleSeq(db, chatId, windowOf(carolMember), Number(m3.message.seq))).toBe(
        Number(m3.message.seq),
      );
    });
  });

  describe('lockChats', () => {
    it('locks and returns rows in sorted id order', async () => {
      const a = await createGroup(alice);
      const b = await createGroup(alice);
      const rows = await db.transaction((tx) => lockChats(tx, [b, a, b]));
      expect(rows.map((r) => r.id)).toEqual([a, b].sort());
    });
  });

  describe('access guards', () => {
    it('getChatAccess / requireActiveMember / assertCanSend', async () => {
      const chatId = await createGroup(alice, [bob], { settings: { onlyAdminsCanSend: true } });
      const a = await requireActiveMember(db, alice.id, chatId);
      expect(a.permissions.canSend).toBe(true);
      const b = await getChatAccess(db, bob.id, chatId);
      expect(b.permissions.canSend).toBe(false);
      expect(() => assertCanSend(b)).toThrow(
        expect.objectContaining({ status: 403, code: 'forbidden' }),
      );
      await expect(getChatAccess(db, carol.id, chatId)).rejects.toMatchObject({ status: 404 });
      const locked = await db.transaction((tx) =>
        requireActiveMember(tx, alice.id, chatId, { lock: true }),
      );
      expect(locked.chat.id).toBe(chatId);
      await expect(
        db.transaction((tx) => getChatAccess(tx, alice.id, crypto.randomUUID(), { lock: true })),
      ).rejects.toMatchObject({ status: 404 });

      await transact((tx, fx) =>
        upsertMembership(tx, fx, {
          kind: 'deactivate',
          chatId,
          userId: bob.id,
          reason: 'left',
          systemEvent: { kind: 'member_left', actorId: bob.id },
        }),
      );
      await expect(requireActiveMember(db, bob.id, chatId)).rejects.toMatchObject({
        status: 403,
        code: 'not_member',
      });
      const former = await getChatAccess(db, bob.id, chatId);
      expect(former.membership).toBe('left');
      expect(Object.values(former.permissions).every((v) => v === false)).toBe(true);

      // Direct chats: I blocked the peer → 403 blocked; peer deleted → forbidden; peer blocked me → allowed.
      const dm = await createDirect(alice, carol);
      await block(alice, carol);
      const blockedAccess = await getChatAccess(db, alice.id, dm);
      expect(() => assertCanSend(blockedAccess)).toThrow(
        expect.objectContaining({ code: 'blocked' }),
      );
      const carolAccess = await getChatAccess(db, carol.id, dm, { allowHidden: true });
      expect(() => assertCanSend(carolAccess)).not.toThrow();
      await expect(getChatAccess(db, carol.id, dm)).rejects.toMatchObject({ status: 404 }); // hidden row
    });
  });

  describe('toChatSummaries', () => {
    it('counts unread and mentions (own and system messages excluded) and shows the last VISIBLE message', async () => {
      const chatId = await createGroup(alice, [bob, carol], { name: 'Friends' });
      await send(bob, chatId, 'one');
      await send(bob, chatId, `hey ${mentionToken(alice.id)}`);
      await send(alice, chatId, 'mine'); // advances alice's read → everything before is read
      await send(carol, chatId, `again ${mentionToken(alice.id)}`);
      await send(bob, chatId, 'two');
      const hidden = await send(bob, chatId, 'deleted for alice');
      await db.insert(messageHidden).values({ userId: alice.id, messageId: hidden.message.id });

      const s = (await toChatSummary(db, alice.id, chatId))!;
      expect(s.unreadCount).toBe(2);
      expect(s.unreadMentionCount).toBe(1);
      expect(s.lastMessage!.text).toBe('two');
      expect(s.lastSeq).toBe(Number(hidden.message.seq));
      expect(s.lastActivityAt).toBe(s.lastMessage!.createdAt);
      expect(s).toMatchObject({
        type: 'group',
        name: 'Friends',
        membership: 'active',
        myRole: 'owner',
        memberCount: 3,
        peer: null,
        isAnnouncement: false,
      });
      expect(s.inviteCode).toMatch(/^[A-Za-z0-9]{22}$/);

      const forBob = (await toChatSummary(db, bob.id, chatId))!;
      expect(forBob.unreadCount).toBe(0); // sending read everything up to bob's last message
      expect(forBob.lastMessage!.text).toBe('deleted for alice');
      const forCarol = (await toChatSummary(db, carol.id, chatId))!;
      expect(forCarol.unreadCount).toBe(2); // bob's "two" and "deleted for alice"
      expect(forCarol.unreadMentionCount).toBe(0);
    });

    it('clamps former members to left_seq (lastMessage, unread window, no invite code, no permissions)', async () => {
      const chatId = await createGroup(alice, [bob]);
      await send(alice, chatId, 'before removal');
      const { systemMessage } = await transact((tx, fx) =>
        upsertMembership(tx, fx, {
          kind: 'deactivate',
          chatId,
          userId: bob.id,
          reason: 'removed',
          systemEvent: { kind: 'member_removed', actorId: alice.id, userId: bob.id },
        }),
      );
      await send(alice, chatId, 'after removal 1');
      await send(alice, chatId, 'after removal 2');
      const s = (await toChatSummary(db, bob.id, chatId))!;
      expect(s.membership).toBe('removed');
      expect(s.myRole).toBe('member');
      expect(s.lastSeq).toBe(Number(systemMessage!.seq));
      expect(s.lastMessage!.id).toBe(systemMessage!.id);
      expect(s.unreadCount).toBe(1); // "before removal" only; the system message doesn't count
      expect(s.inviteCode).toBeNull();
      expect(Object.values(s.permissions).every((v) => v === false)).toBe(true);
      expect(s.readWatermark).toBeLessThanOrEqual(s.lastSeq);
      expect(s.deliveredWatermark).toBeLessThanOrEqual(s.lastSeq);
    });

    it('excludes hidden chats (unless includeHidden) and keeps archived / left ones', async () => {
      const dan = await t.createUser();
      const dm = await createDirect(dan, alice);
      const group = await createGroup(dan, [alice]);
      await db
        .update(chatMembers)
        .set({ isArchived: true })
        .where(and(eq(chatMembers.chatId, group), eq(chatMembers.userId, dan.id)));
      const aliceList = await toChatSummaries(db, alice.id);
      expect(aliceList.map((c) => c.id)).toContain(group);
      expect(aliceList.map((c) => c.id)).not.toContain(dm); // alice's row is hidden until the first message
      expect(
        (await toChatSummaries(db, alice.id, [dm], { includeHidden: true })).map((c) => c.id),
      ).toEqual([dm]);
      const danList = await toChatSummaries(db, dan.id);
      expect(danList.map((c) => c.id).sort()).toEqual([dm, group].sort());
      expect(danList.find((c) => c.id === group)!.isArchived).toBe(true);
      // Sorted by activity (newest first).
      const times = danList.map((c) => c.lastActivityAt);
      expect([...times].sort().reverse()).toEqual(times);
      // Explicit ids keep the input order.
      expect((await toChatSummaries(db, dan.id, [group, dm])).map((c) => c.id)).toEqual([
        group,
        dm,
      ]);
    });

    it('direct chats: peer UserPublic, self chat peer = me, canSend follows blocks/deletion', async () => {
      const erin = await t.createUser({ displayName: 'Erin' });
      const dm = await createDirect(erin, bob);
      let s = (await toChatSummary(db, erin.id, dm))!;
      expect(s.peer).toMatchObject({
        id: bob.id,
        displayName: 'Bob',
        isBlocked: false,
        isDeleted: false,
      });
      expect(s.name).toBeNull();
      expect(s.permissions).toMatchObject({
        canSend: true,
        canCall: true,
        canLeave: false,
        canInvite: false,
      });
      await block(erin, bob);
      s = (await toChatSummary(db, erin.id, dm))!;
      expect(s.peer!.isBlocked).toBe(true);
      expect(s.permissions.canSend).toBe(false);

      const self = await createDirect(erin, erin);
      const selfSummary = (await toChatSummary(db, erin.id, self))!;
      expect(selfSummary.peer!.id).toBe(erin.id);
      expect(selfSummary.permissions).toMatchObject({ canSend: true, canCall: false });
      await send(erin, self, 'note to self');
      const after = (await toChatSummary(db, erin.id, self))!;
      expect(after.readWatermark).toBe(after.lastSeq); // no other members → lastSeq
      expect(after.deliveredWatermark).toBe(after.lastSeq);

      const frank = await t.createUser();
      const dm2 = await createDirect(erin, frank);
      await db
        .update(users)
        .set({ deletedAt: new Date(), displayName: 'Deleted account' })
        .where(eq(users.id, frank.id));
      const del = (await toChatSummary(db, erin.id, dm2))!;
      expect(del.peer).toMatchObject({ isDeleted: true, displayName: 'Deleted account' });
      expect(del.permissions.canSend).toBe(false);
    });

    it('invite code only with canInvite; channel summaries have no ticks and count followers', async () => {
      const chatId = await createGroup(alice, [bob], {
        settings: { onlyAdminsCanAddMembers: true },
      });
      expect((await toChatSummary(db, alice.id, chatId))!.inviteCode).not.toBeNull();
      const bobView = (await toChatSummary(db, bob.id, chatId))!;
      expect(bobView.inviteCode).toBeNull();
      expect(bobView.permissions).toMatchObject({
        canInvite: false,
        canAddMembers: false,
        canSend: true,
        canLeave: true,
      });
      expect(bobView.groupSettings).toEqual({
        onlyAdminsCanSend: false,
        onlyAdminsCanEditInfo: false,
        onlyAdminsCanAddMembers: true,
      });

      const channelId = await createChannel(alice);
      await transact((tx, fx) =>
        upsertMembership(tx, fx, {
          kind: 'activate',
          chatId: channelId,
          userIds: [bob.id, carol.id],
        }),
      );
      await send(alice, channelId, 'post');
      const ch = (await toChatSummary(db, bob.id, channelId))!;
      expect(ch).toMatchObject({
        type: 'channel',
        memberCount: 3,
        readWatermark: 0,
        deliveredWatermark: 0,
        groupSettings: null,
        inviteCode: null,
        myRole: 'member',
      });
      expect(ch.channelSettings).toEqual({ isPublic: true, reactions: 'all' });
      expect(ch.lastMessage!.senderId).toBeNull();
      expect(ch.unreadCount).toBe(1);
      const owner = (await toChatSummary(db, alice.id, channelId))!;
      expect(owner.inviteCode).not.toBeNull();
      expect(owner.permissions).toMatchObject({
        canSend: true,
        canLeave: false,
        canManageAdmins: true,
      });
    });

    it('serializes 200 chats with a fixed, small number of queries', async () => {
      const heavy = await t.createUser();
      const other = await t.createUser();
      for (let i = 0; i < 100; i++) {
        const g = await createGroup(heavy, [other, bob]);
        await send(other, g, `g${i}`);
        const d = await createDirect(heavy, await t.createUser());
        await send(heavy, d, `d${i}`);
      }
      const { result, queries } = await countQueries(() => toChatSummaries(db, heavy.id));
      expect(result).toHaveLength(200);
      expect(queries).toBeLessThanOrEqual(20);
      const small = await countQueries(() => toChatSummaries(db, heavy.id, [result[0]!.id]));
      expect(small.queries).toBeLessThanOrEqual(20);
      expect(
        result
          .filter((c) => c.type === 'group')
          .every((c) => c.unreadCount === 1 && c.memberCount === 3),
      ).toBe(true);
    }, 60_000);

    it('chatSummariesForPairs serializes one chat for many viewers in one batch', async () => {
      const chatId = await createGroup(alice, [bob, carol]);
      await send(bob, chatId, 'hi all');
      const map = await chatSummariesForPairs(
        db,
        [alice, bob, carol].map((u) => ({ chatId, userId: u.id })),
      );
      expect(map.get(pairKey(chatId, alice.id))!.unreadCount).toBe(1);
      expect(map.get(pairKey(chatId, bob.id))!.unreadCount).toBe(0);
      expect(map.get(pairKey(chatId, bob.id))!.myRole).toBe('member');
      expect(map.get(pairKey(chatId, alice.id))!.myRole).toBe('owner');
    });

    it('computes watermarks per viewer from the other active members', async () => {
      const chatId = await createGroup(alice, [bob, carol]);
      const m = await send(alice, chatId, 'tick me');
      const seq = Number(m.message.seq);
      await db
        .update(chatMembers)
        .set({ lastReadSeq: seq, lastDeliveredSeq: seq })
        .where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, bob.id)));
      await db
        .update(chatMembers)
        .set({ lastDeliveredSeq: seq })
        .where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, carol.id)));
      const s = (await toChatSummary(db, alice.id, chatId))!;
      expect(s.deliveredWatermark).toBe(seq);
      expect(s.readWatermark).toBeLessThan(seq); // carol hasn't read
      await setSettings(bob, { readReceipts: false }); // groups ignore the setting
      expect((await toChatSummary(db, alice.id, chatId))!.deliveredWatermark).toBe(seq);
      const [chat] = await db.select().from(chats).where(eq(chats.id, chatId));
      expect(Number(chat!.lastSeq)).toBe(seq);
      await setSettings(bob, { readReceipts: true });
    });
  });
});
