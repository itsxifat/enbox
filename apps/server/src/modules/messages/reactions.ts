/**
 * Reactions, Discord's model (docs/design/discord-parity.md W6-A): several per user (one per
 * emoji), per-emoji summaries (services/messages.ts `toMessages`), delta events instead of a
 * re-serialised `message:updated`, keyset-paged reactor lists and moderator removal.
 *
 * Routes (relative to /api, mounted by ./routes.ts; `:emoji` is URL-encoded: a unicode emoji
 * or a custom emoji token `<:name:id>`):
 *   PUT    /messages/:messageId/reactions/:emoji/@me       add mine
 *   DELETE /messages/:messageId/reactions/:emoji/@me       remove mine
 *   DELETE /messages/:messageId/reactions/:emoji/:userId   remove theirs (moderators)
 *   DELETE /messages/:messageId/reactions/:emoji           clear one emoji (moderators)
 *   DELETE /messages/:messageId/reactions                  clear all (moderators)
 *   GET    /messages/:messageId/reactions/:emoji           reactors, oldest reaction first
 * The APK's single-reaction routes (`PUT/DELETE /messages/:messageId/reaction`, service.ts)
 * use `replaceMyReaction` / `removeMyReactions`.
 *
 * Super reactions (Discord's burst reactions): `?burst=true` on the add, remove and reactor
 * list routes picks the super reaction of the emoji instead of the normal one. A user may
 * hold both kinds of one emoji; each kind is added, removed and listed on its own, while the
 * emoji itself (either kind) counts once toward MAX_UNIQUE_REACTIONS and clearing an emoji
 * clears both kinds. Each new super reaction also spends USER_RATE_LIMITS.superReaction.
 * The APK routes work on normal reactions (removing all of mine removes both kinds).
 *
 * Rules
 * - The message must be visible to me (404). Changes need an active membership (403
 *   not_member); former members still read reactor lists within their window. No reactions
 *   on system or deleted messages (400).
 * - Adding an emoji that is not on the message yet needs ADD_REACTIONS (Space channels:
 *   computed bits), and for another Space's custom emoji USE_EXTERNAL_EMOJI there (the rule
 *   of message sends); joining one that is there needs only VIEW_CHANNEL. Timed-out members don't
 *   react at all. Broadcast channels follow `channelSettings.reactions` ('none' → 403,
 *   'quick' → QUICK_REACTIONS only). At most MAX_UNIQUE_REACTIONS distinct emoji (400).
 * - Writes lock the message row (`FOR NO KEY UPDATE`), so concurrent reactions on one message
 *   are serialised and the cap and the ADD_REACTIONS check hold.
 * - An equivalent of an emoji already on the message joins it under its stored form ('❤'
 *   joins '❤️'; a custom emoji joins by id whatever name its token carries).
 * - Moderators remove others' reactions: MANAGE_MESSAGES in Space channels, admins of groups
 *   and broadcast channels (`canDeleteForEveryoneAsAdmin`), nobody in direct chats. Audited in
 *   Spaces.
 *
 * Events (post-commit): each change is ONE `message:reaction-add` / `-remove` delta to the chat
 * room (`burst: true` for a super reaction), skipping the members who can't see the message
 * (joined after it, cleared or hid it: the `messageUpdatedPayloads` rule) and a direct-chat
 * peer who blocked the reactor; clears are `message:reactions-cleared`. Broadcast channels are
 * anonymous (a delta would name the follower), so their reaction changes keep the
 * viewer-neutral `message:updated` (counts only). DMs and groups send that `message:updated`
 * too, after the deltas, for the Android app.
 */
import { Router } from 'express';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  MAX_UNIQUE_REACTIONS,
  PERM,
  QUICK_REACTIONS,
  USER_RATE_LIMITS,
  hasPerm,
  idSchema,
  isSpaceAdmin,
  isSpaceChatType,
  parseCustomEmoji,
  reactionEmojiSchema,
  reactionKindQuerySchema,
  reactorsQuerySchema,
  type ID,
  type ReactionEvent,
  type SpaceAuditEntry,
  type UserPublic,
} from '@enbox/shared';
import { db, type DbOrTx, type Tx } from '../../db/index.js';
import { blocks, messageReactions, messages, type MessageRow } from '../../db/schema.js';
import { authUserId } from '../../http/auth.js';
import {
  HttpError,
  badRequest,
  forbidden,
  notFound,
  notMember,
  rateLimited,
} from '../../lib/errors.js';
import { assertUserLimit, limitUser } from '../../lib/userLimit.js';
import { parse } from '../../lib/validate.js';
import {
  getChatAccess,
  peersWhoBlockedMe,
  visibleTo,
  type ChatAccess,
} from '../../services/chats.js';
import { transact, type Effects } from '../../services/effects.js';
import { isTimedOut } from '../../services/spaceAccess.js';
import { gateExternalEmoji } from '../../services/spaceEmojis.js';
import { audit } from '../../services/spaces.js';
import { rawRows, uniq } from '../../services/sql.js';
import { toUserPublics } from '../../services/users.js';

// ---------------------------------------------------------------------------
// Emoji identity
// ---------------------------------------------------------------------------

const stripVs16 = (s: string) => s.replace(/️/g, '');
const QUICK = new Set(QUICK_REACTIONS.map(stripVs16));

/** The same reaction: identical, the same custom emoji (by id), or equal but for VS16. */
export function sameReaction(a: string, b: string): boolean {
  if (a === b) return true;
  const ca = parseCustomEmoji(a);
  const cb = parseCustomEmoji(b);
  if (ca || cb) return !!ca && !!cb && ca.id === cb.id;
  return stripVs16(a) === stripVs16(b);
}

/** The custom emoji id of a token (null for unicode emoji). */
const emojiIdOf = (emoji: string): ID | null => parseCustomEmoji(emoji)?.id ?? null;

// ---------------------------------------------------------------------------
// Loading & rules
// ---------------------------------------------------------------------------

/** A message being reacted to and the viewer's access to its chat. */
interface Target {
  message: MessageRow;
  access: ChatAccess;
}

/**
 * The message if it is visible to `me` (404 otherwise, whatever the reason). `write`: lock
 * the row and require an active membership (403 not_member). Space channels need no
 * `chat_members` row (their access is computed).
 */
async function loadTarget(
  dbx: DbOrTx,
  me: string,
  messageId: string,
  opts: { write: boolean },
): Promise<Target> {
  const [head] = await dbx
    .select({ chatId: messages.chatId })
    .from(messages)
    .where(eq(messages.id, messageId))
    .limit(1);
  if (!head) throw notFound('Message');
  let access: ChatAccess;
  try {
    access = await getChatAccess(dbx, me, head.chatId);
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) throw notFound('Message');
    throw e;
  }
  let q = dbx
    .select()
    .from(messages)
    .where(and(eq(messages.id, messageId), visibleTo(access.window)))
    .limit(1)
    .$dynamic();
  if (opts.write) q = q.for('no key update');
  const [message] = await q;
  if (!message) throw notFound('Message');
  if (opts.write && access.membership !== 'active') throw notMember();
  return { message, access };
}

function assertReactable(message: MessageRow): void {
  if (message.type === 'system' || message.deletedAt)
    throw badRequest('You cannot react to this message');
}

/**
 * 403 unless I may add `emoji` (`joining`: someone already reacted with it). A new custom
 * emoji of another Space (or an unknown id) needs USE_EXTERNAL_EMOJI in a Space channel: the
 * rule of message sends (`gateExternalEmoji` would turn the token into `:name:`), refused here.
 */
async function assertMayAdd(
  dbx: DbOrTx,
  access: ChatAccess,
  emoji: string,
  joining: boolean,
): Promise<void> {
  const { chat, space } = access;
  if (chat.type === 'channel') {
    const mode = chat.channelSettings?.reactions ?? 'all';
    if (mode === 'none') throw forbidden('Reactions are turned off in this channel');
    if (mode === 'quick' && !QUICK.has(stripVs16(emoji)))
      throw forbidden('Only quick reactions are allowed in this channel');
  }
  if (!space) return;
  if (isTimedOut(space.me.member) && !isSpaceAdmin(space.base))
    throw forbidden('You cannot react while you are timed out');
  if (joining) return;
  if (!hasPerm(space.bits, PERM.ADD_REACTIONS))
    throw forbidden('You cannot add new reactions in this channel');
  if (parseCustomEmoji(emoji) && (await gateExternalEmoji(dbx, access, emoji)) !== emoji)
    throw forbidden('You cannot use emoji from other Spaces in this channel');
}

/** Moderators: MANAGE_MESSAGES in Space channels, admins elsewhere, nobody in direct chats. */
function assertModerator(access: ChatAccess): void {
  if (!access.permissions.canDeleteForEveryoneAsAdmin)
    throw forbidden("You cannot remove other people's reactions here");
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** One emoji on a message (both kinds). */
interface EmojiGroup {
  emoji: string;
  count: number;
  /** `me` reacted with it (a normal reaction). */
  mine: boolean;
  /** `me` super-reacted with it. */
  mineBurst: boolean;
}

/** The distinct emoji on a message, either kind (bounded by MAX_UNIQUE_REACTIONS). */
async function emojiGroups(dbx: DbOrTx, messageId: string, me: string): Promise<EmojiGroup[]> {
  const rows = await rawRows<{ emoji: string; n: number; mine: boolean; mine_burst: boolean }>(
    dbx,
    sql`select emoji, count(*)::int as n,
          bool_or(user_id = ${me}::uuid and not burst) as mine,
          bool_or(user_id = ${me}::uuid and burst) as mine_burst
        from message_reactions where message_id = ${messageId}::uuid group by emoji`,
  );
  return rows.map((r) => ({
    emoji: r.emoji,
    count: Number(r.n),
    mine: !!r.mine,
    mineBurst: !!r.mine_burst,
  }));
}

/**
 * Add my reaction of one kind (rules above). Returns the stored emoji, or null when it was
 * mine already. A new super reaction spends USER_RATE_LIMITS.superReaction (429 when spent).
 */
async function insertMine(
  tx: Tx,
  target: Target,
  me: string,
  emoji: string,
  groups: EmojiGroup[],
  burst = false,
): Promise<string | null> {
  const same = groups.find((g) => sameReaction(g.emoji, emoji));
  if (burst ? same?.mineBurst : same?.mine) return null;
  await assertMayAdd(tx, target.access, emoji, !!same);
  if (!same && groups.length >= MAX_UNIQUE_REACTIONS)
    throw badRequest(`A message can have at most ${MAX_UNIQUE_REACTIONS} different reactions`);
  const rule = USER_RATE_LIMITS.superReaction;
  if (burst && !limitUser(me, 'superReaction', rule.limit, rule.windowMs))
    throw rateLimited('You have sent a lot of Super Reactions, try again later');
  const stored = same?.emoji ?? emoji;
  const rows = await tx
    .insert(messageReactions)
    .values({
      messageId: target.message.id,
      userId: me,
      emoji: stored,
      emojiId: emojiIdOf(stored),
      burst,
    })
    .onConflictDoNothing()
    .returning({ emoji: messageReactions.emoji });
  return rows.length ? stored : null;
}

/** One stored reaction of a user: its emoji and kind. */
interface Held {
  emoji: string;
  burst: boolean;
}

/**
 * Delete `userId`'s reactions on a message that `match` (≤ 2 × MAX_UNIQUE_REACTIONS rows).
 * Returns them oldest first.
 */
async function deleteUserReactions(
  tx: Tx,
  messageId: string,
  userId: string,
  match: (r: Held) => boolean,
): Promise<Held[]> {
  const theirs = and(
    eq(messageReactions.messageId, messageId),
    eq(messageReactions.userId, userId),
  );
  const rows = await tx
    .select({ emoji: messageReactions.emoji, burst: messageReactions.burst })
    .from(messageReactions)
    .where(theirs)
    .orderBy(asc(messageReactions.createdAt));
  const doomed = rows.filter(match);
  for (const burst of [false, true]) {
    const emojis = doomed.filter((r) => r.burst === burst).map((r) => r.emoji);
    if (emojis.length)
      await tx
        .delete(messageReactions)
        .where(
          and(theirs, eq(messageReactions.burst, burst), inArray(messageReactions.emoji, emojis)),
        );
  }
  return doomed;
}

/** `match` for one emoji of one kind. */
const heldAs =
  (emoji: string, burst: boolean) =>
  (r: Held): boolean =>
    r.burst === burst && sameReaction(r.emoji, emoji);

// ---------------------------------------------------------------------------
// Events & audit
// ---------------------------------------------------------------------------

type Delta = {
  event: 'message:reaction-add' | 'message:reaction-remove';
  emoji: string;
  userId: string;
  /** A super reaction. */
  burst: boolean;
};

const deltasOf = (event: Delta['event'], userId: string, held: Held[]): Delta[] =>
  held.map((r) => ({ event, emoji: r.emoji, userId, burst: r.burst }));

/**
 * Members of the room who must not hear about reactions on this message: those for whom it
 * is invisible (as `messageUpdatedPayloads`) and a direct-chat peer who blocked the actor.
 */
async function audienceExcept(tx: DbOrTx, target: Target): Promise<string[]> {
  const { chat } = target.access;
  const seq = Number(target.message.seq);
  let rows: { user_id: string }[] = [];
  if (chat.type === 'direct' || chat.type === 'group') {
    rows = await rawRows(
      tx,
      sql`select cm.user_id from chat_members cm
          where cm.chat_id = ${chat.id}::uuid and cm.left_at is null
            and (cm.joined_seq >= ${seq} or cm.cleared_seq >= ${seq}
                 or exists (select 1 from message_hidden h
                            where h.user_id = cm.user_id and h.message_id = ${target.message.id}::uuid))`,
    );
  } else if (isSpaceChatType(chat.type)) {
    // Only future-only read rows (converted history) hide a message there (index range scan).
    rows = await rawRows(
      tx,
      sql`select user_id from chat_members
          where chat_id = ${chat.id}::uuid and joined_seq > 0 and joined_seq >= ${seq}`,
    );
  }
  return uniq([...(await peersWhoBlockedMe(tx, target.access)), ...rows.map((r) => r.user_id)]);
}

/** Register the events of reaction changes on one message (see the header), in order. */
async function publish(tx: Tx, fx: Effects, target: Target, deltas: Delta[]): Promise<void> {
  if (deltas.length === 0) return;
  const { chat } = target.access;
  if (chat.type === 'channel') {
    fx.messageUpdated(target.message.id);
    return;
  }
  const exceptUserIds = await audienceExcept(tx, target);
  for (const d of deltas) {
    const payload: ReactionEvent = {
      chatId: chat.id,
      messageId: target.message.id,
      emoji: d.emoji,
      emojiId: emojiIdOf(d.emoji),
      userId: d.userId,
      ...(d.burst ? { burst: true } : {}),
    };
    fx.toChat(chat.id, d.event, payload, { exceptUserIds });
    // Reaction notifications (push/reactionNotifications.ts).
    if (d.event === 'message:reaction-add')
      fx.domain('reaction.added', {
        message: target.message,
        chat,
        userId: d.userId,
        emoji: d.emoji,
        burst: d.burst,
      });
  }
  legacyMessageUpdated(fx, target, exceptUserIds);
}

/**
 * The Android app merges only `message:updated`: DMs and groups also send it, after the
 * deltas, so the app stays live (Spaces never reach that app). The web merges the deltas
 * first; the full message that follows carries the same counts.
 */
function legacyMessageUpdated(fx: Effects, target: Target, exceptUserIds: string[]): void {
  const { type } = target.access.chat;
  if (type === 'direct' || type === 'group')
    fx.messageUpdated(target.message.id, { exceptUserIds });
}

async function publishCleared(
  tx: Tx,
  fx: Effects,
  target: Target,
  emojis: (string | null)[],
): Promise<void> {
  const { chat } = target.access;
  const exceptUserIds = await audienceExcept(tx, target);
  for (const emoji of emojis)
    fx.toChat(
      chat.id,
      'message:reactions-cleared',
      { chatId: chat.id, messageId: target.message.id, emoji },
      { exceptUserIds },
    );
  legacyMessageUpdated(fx, target, exceptUserIds);
}

/** Space channels: record a moderator's removal in the Space's audit log. */
async function auditRemoval(
  tx: Tx,
  target: Target,
  actorId: string,
  entry: {
    action: string;
    targetType: SpaceAuditEntry['targetType'];
    targetId: string;
    changes: Record<string, unknown>;
  },
): Promise<void> {
  const { chat, space } = target.access;
  if (!space || !chat.spaceId) return;
  await audit(tx, { spaceId: chat.spaceId, actorId, ...entry });
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

function limit(userId: string): void {
  assertUserLimit(userId, 'reaction', USER_RATE_LIMITS.reaction);
}

/**
 * `PUT /messages/:messageId/reactions/:emoji/@me[?burst=true]`: add mine of that kind (no-op
 * when it is already mine).
 */
export async function addReaction(
  me: string,
  messageId: string,
  emoji: string,
  burst = false,
): Promise<void> {
  limit(me);
  await transact(async (tx, fx) => {
    const target = await loadTarget(tx, me, messageId, { write: true });
    assertReactable(target.message);
    const groups = await emojiGroups(tx, messageId, me);
    const stored = await insertMine(tx, target, me, emoji, groups, burst);
    if (stored)
      await publish(tx, fx, target, [
        { event: 'message:reaction-add', emoji: stored, userId: me, burst },
      ]);
  });
}

/** `DELETE /messages/:messageId/reactions/:emoji/@me[?burst=true]`: remove mine (or no-op). */
export async function removeMyReaction(
  me: string,
  messageId: string,
  emoji: string,
  burst = false,
): Promise<void> {
  limit(me);
  await transact(async (tx, fx) => {
    const target = await loadTarget(tx, me, messageId, { write: true });
    const removed = await deleteUserReactions(tx, messageId, me, heldAs(emoji, burst));
    await publish(tx, fx, target, deltasOf('message:reaction-remove', me, removed));
  });
}

/**
 * `DELETE /messages/:messageId/reactions/:emoji/:userId[?burst=true]` (moderators; my own id
 * works like `@me`). Broadcast channels: 403 (reactors are anonymous there). Audited in Spaces.
 */
export async function removeUserReaction(
  actorId: string,
  messageId: string,
  emoji: string,
  userId: string,
  burst = false,
): Promise<void> {
  if (userId === actorId) return removeMyReaction(actorId, messageId, emoji, burst);
  limit(actorId);
  await transact(async (tx, fx) => {
    const target = await loadTarget(tx, actorId, messageId, { write: true });
    assertModerator(target.access);
    if (target.access.chat.type === 'channel')
      throw forbidden('Reactions are anonymous in channels');
    const removed = await deleteUserReactions(tx, messageId, userId, heldAs(emoji, burst));
    if (removed.length === 0) return;
    await publish(tx, fx, target, deltasOf('message:reaction-remove', userId, removed));
    await auditRemoval(tx, target, actorId, {
      action: 'message.reaction_remove',
      targetType: 'member',
      targetId: userId,
      changes: {
        messageId,
        channelId: target.access.chat.id,
        emoji: removed[0]!.emoji,
        ...(burst ? { burst: true } : {}),
      },
    });
  });
}

/**
 * `DELETE /messages/:messageId/reactions[/:emoji]` (moderators): clear one emoji (`emoji`) or
 * every reaction (`null`). `message:reactions-cleared` → room. Audited in Spaces.
 */
export async function clearReactions(
  actorId: string,
  messageId: string,
  emoji: string | null,
): Promise<void> {
  limit(actorId);
  await transact(async (tx, fx) => {
    const target = await loadTarget(tx, actorId, messageId, { write: true });
    assertModerator(target.access);
    let cleared: (string | null)[] = [];
    if (emoji === null) {
      const rows = await tx
        .delete(messageReactions)
        .where(eq(messageReactions.messageId, messageId))
        .returning({ emoji: messageReactions.emoji });
      if (rows.length) cleared = [null];
    } else {
      const stored = (await emojiGroups(tx, messageId, actorId))
        .map((g) => g.emoji)
        .filter((s) => sameReaction(s, emoji));
      if (stored.length)
        await tx
          .delete(messageReactions)
          .where(
            and(eq(messageReactions.messageId, messageId), inArray(messageReactions.emoji, stored)),
          );
      cleared = stored;
    }
    if (cleared.length === 0) return;
    await publishCleared(tx, fx, target, cleared);
    await auditRemoval(tx, target, actorId, {
      action: 'message.reactions_clear',
      targetType: 'channel',
      targetId: target.access.chat.id,
      changes: { messageId, emoji: emoji === null ? null : cleared[0] },
    });
  });
}

/**
 * The APK's `PUT /messages/:messageId/reaction` (one reaction per user): my other normal
 * reactions on the message are removed (super ones stay), then this one is added under the
 * same rules as `addReaction` (a refused emoji rolls the removals back). Returns the row.
 */
export async function replaceMyReaction(
  me: string,
  messageId: string,
  emoji: string,
): Promise<MessageRow> {
  limit(me);
  return transact(async (tx, fx) => {
    const target = await loadTarget(tx, me, messageId, { write: true });
    assertReactable(target.message);
    const removed = await deleteUserReactions(
      tx,
      messageId,
      me,
      (r) => !r.burst && !sameReaction(r.emoji, emoji),
    );
    const stored = await insertMine(tx, target, me, emoji, await emojiGroups(tx, messageId, me));
    const deltas = deltasOf('message:reaction-remove', me, removed);
    if (stored)
      deltas.push({ event: 'message:reaction-add', emoji: stored, userId: me, burst: false });
    await publish(tx, fx, target, deltas);
    return target.message;
  });
}

/**
 * The APK's `DELETE /messages/:messageId/reaction`: remove all of mine, both kinds (no-op
 * without any).
 */
export async function removeMyReactions(me: string, messageId: string): Promise<MessageRow> {
  limit(me);
  return transact(async (tx, fx) => {
    const target = await loadTarget(tx, me, messageId, { write: true });
    const removed = await deleteUserReactions(tx, messageId, me, () => true);
    await publish(tx, fx, target, deltasOf('message:reaction-remove', me, removed));
    return target.message;
  });
}

/**
 * `GET /messages/:messageId/reactions/:emoji[?burst=true]`: who reacted with exactly this
 * emoji (the chip's stored form) and kind, oldest reaction first, as UserPublic for me.
 * Keyset cursor `after`: the last user of the previous page (gone since → empty page). Direct
 * chats leave out users I blocked (as `toMessages`); broadcast channels are anonymous (403).
 */
export async function listReactors(
  me: string,
  messageId: string,
  emoji: string,
  query: { after?: string; limit: number },
  burst = false,
): Promise<UserPublic[]> {
  const { access } = await loadTarget(db, me, messageId, { write: false });
  if (access.chat.type === 'channel') throw forbidden('Reactions are anonymous in channels');
  const ofEmoji = and(
    eq(messageReactions.messageId, messageId),
    eq(messageReactions.emoji, emoji),
    eq(messageReactions.burst, burst),
  );
  let cursor: { at: Date; userId: string } | null = null;
  if (query.after) {
    const [c] = await db
      .select({ at: messageReactions.createdAt })
      .from(messageReactions)
      .where(and(ofEmoji, eq(messageReactions.userId, query.after)))
      .limit(1);
    if (!c) return [];
    cursor = { at: c.at, userId: query.after };
  }
  const rows = await db
    .select({ userId: messageReactions.userId })
    .from(messageReactions)
    .where(
      and(
        ofEmoji,
        cursor
          ? sql`(${messageReactions.createdAt}, ${messageReactions.userId}) > (${cursor.at.toISOString()}::timestamptz, ${cursor.userId}::uuid)`
          : undefined,
        access.chat.type === 'direct'
          ? sql`not exists (select 1 from ${blocks} where ${blocks.blockerId} = ${me} and ${blocks.blockedId} = ${messageReactions.userId})`
          : undefined,
      ),
    )
    .orderBy(asc(messageReactions.createdAt), asc(messageReactions.userId))
    .limit(query.limit);
  return toUserPublics(
    db,
    me,
    rows.map((r) => r.userId),
  );
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const router = Router();

const messageParams = z.object({ messageId: idSchema });
const reactionParams = messageParams.extend({ emoji: reactionEmojiSchema });
const userReactionParams = reactionParams.extend({ userId: idSchema });

// `@me` before `:userId` (literal segments first).
router.put('/messages/:messageId/reactions/:emoji/@me', async (req, res) => {
  const me = authUserId(req);
  const { messageId, emoji } = parse(reactionParams, req.params);
  const { burst } = parse(reactionKindQuerySchema, req.query);
  await addReaction(me, messageId, emoji, burst);
  res.status(204).end();
});

router.delete('/messages/:messageId/reactions/:emoji/@me', async (req, res) => {
  const me = authUserId(req);
  const { messageId, emoji } = parse(reactionParams, req.params);
  const { burst } = parse(reactionKindQuerySchema, req.query);
  await removeMyReaction(me, messageId, emoji, burst);
  res.status(204).end();
});

router.delete('/messages/:messageId/reactions/:emoji/:userId', async (req, res) => {
  const me = authUserId(req);
  const { messageId, emoji, userId } = parse(userReactionParams, req.params);
  const { burst } = parse(reactionKindQuerySchema, req.query);
  await removeUserReaction(me, messageId, emoji, userId, burst);
  res.status(204).end();
});

router.delete('/messages/:messageId/reactions/:emoji', async (req, res) => {
  const me = authUserId(req);
  const { messageId, emoji } = parse(reactionParams, req.params);
  await clearReactions(me, messageId, emoji);
  res.status(204).end();
});

router.delete('/messages/:messageId/reactions', async (req, res) => {
  const me = authUserId(req);
  const { messageId } = parse(messageParams, req.params);
  await clearReactions(me, messageId, null);
  res.status(204).end();
});

router.get('/messages/:messageId/reactions/:emoji', async (req, res) => {
  const me = authUserId(req);
  const { messageId, emoji } = parse(reactionParams, req.params);
  const query = parse(reactorsQuerySchema, req.query);
  const { burst } = parse(reactionKindQuerySchema, req.query);
  res.json(await listReactors(me, messageId, emoji, query, burst));
});
