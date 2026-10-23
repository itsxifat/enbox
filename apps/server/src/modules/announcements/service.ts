/**
 * Announcement channels (Discord's announcement channels, docs/design/discord-parity.md
 * W10-F): Publish and Follow. An announcement channel is a `space_text` chat with `is_news`
 * (created or converted by the channel routes, modules/spaces/routes.ts).
 *
 * - Publish (`POST /messages/:id/crosspost`): a message of an announcement channel, not a
 *   system/call/poll message, not deleted, not itself a copy and not published yet (409); its
 *   author (who can still send there) or MANAGE_MESSAGES. At most PUBLISH_LIMIT_PER_HOUR per
 *   channel: counted under the channel lock from the `message.publish` audit entries of the
 *   last hour (the publish time; a database count, so every process agrees). Sets
 *   MESSAGE_FLAGS.CROSSPOSTED (`message:updated`), then delivers after commit.
 * - Delivery: one copy per follower channel through its follower webhook — `sender_id` null,
 *   `author_override` {kind 'crosspost', "<Space> #<channel>", the Space icon, the source},
 *   IS_CROSSPOST (+ the original's SUPPRESS_EMBEDS), `crosspost_of` = the original, its text,
 *   files, sticker and embeds. In this process, ≤ DELIVERY_CONCURRENCY targets at once, one
 *   short transaction each: the target chat lock first (lock order), then the follow (gone or
 *   webhook-less → skipped) and the original `FOR SHARE`, so an edit or delete of the
 *   original committing meanwhile waits for the copy and then reaches it. Failures are
 *   logged, never thrown.
 * - Edits of a published message and its deletion for everyone follow to the copies
 *   (`propagateCrosspostEdit` / `propagateCrosspostDelete`, called by the messages module).
 *   Each copy re-reads the original under its own chat lock, so the last edit always wins.
 * - Follow (`POST /chats/:id/followers`): the source an announcement channel I can see, the
 *   target a text channel (any Space) where I have MANAGE_WEBHOOKS; not the same channel, not
 *   twice (409; a follow whose webhook was deleted is replaced). Creates the follower webhook
 *   (named after the source Space, its icon) and the `channel_follows` row, posts a
 *   `channel_followed` system message in the target and audits `channel.follow` there.
 * - Unfollow (`DELETE /channel-follows/:id`): MANAGE_WEBHOOKS in the target; the follower
 *   webhook goes with it (`channel.unfollow`). Lists: a channel's followers (MANAGE_WEBHOOKS
 *   in it) and the channels followed into a Space (MANAGE_WEBHOOKS there; only target
 *   channels I can see).
 *
 * Copies ping nobody new: @everyone and role mentions never carry over, and Space pushes skip
 * messages without a sender.
 */
import { and, asc, count, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  MESSAGE_FLAGS,
  PERM,
  PUBLISH_LIMIT_PER_HOUR,
  WEBHOOKS_PER_CHANNEL,
  WEBHOOK_NAME_MAX_LENGTH,
  hasMessageFlag,
  hasPerm,
  type ChannelFollow,
  type Message,
  type MessageAuthorOverride,
} from '@enbox/shared';
import { db, type DbOrTx, type Tx } from '../../db/index.js';
import {
  channelFollows,
  chats,
  media,
  messageAttachments,
  messages,
  spaceAuditLog,
  spaces,
  webhooks,
  type MessageRow,
} from '../../db/schema.js';
import type { MessageMetadata } from '../../db/types.js';
import {
  badRequest,
  conflict,
  forbidden,
  limitReached,
  notFound,
  rateLimited,
} from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { assertUserLimit } from '../../lib/userLimit.js';
import { getChatAccess, lockChat, requireActiveMember } from '../../services/chats.js';
import { transact } from '../../services/effects.js';
import { staticMediaUrl } from '../../services/media.js';
import {
  createMessage,
  deleteForEveryoneTx,
  deriveMentions,
  loadVisibleMessage,
  toMessages,
} from '../../services/messages.js';
import {
  channelBits,
  loadChannelOverwrites,
  lockSpace,
  requireSpaceBit,
  requireSpacePermission,
} from '../../services/spaceAccess.js';
import { audit } from '../../services/spaces.js';
import { insertFollowerWebhook } from '../../services/webhooks.js';

/** Follower channels written to at once by one delivery (or one propagation). */
export const DELIVERY_CONCURRENCY = 4;

/** Follow / unfollow, per user (each writes a webhook and a system message). */
const FOLLOW_LIMIT = { limit: 30, windowMs: 60 * 60_000 } as const;

/** The audit action whose entries of the last hour count toward PUBLISH_LIMIT_PER_HOUR. */
const PUBLISH_ACTION = 'message.publish';
const HOUR_MS = 3_600_000;

// ---------------------------------------------------------------------------
// Background work (tests await it with `crosspostIdle`)
// ---------------------------------------------------------------------------

const inflight = new Set<Promise<unknown>>();

function track(work: Promise<unknown>): void {
  const p = work.catch((err: unknown) => logger.error({ err }, 'crosspost work failed'));
  inflight.add(p);
  void p.finally(() => inflight.delete(p));
}

/** Resolve once every delivery and propagation started so far has finished (tests). */
export async function crosspostIdle(): Promise<void> {
  while (inflight.size) await Promise.all([...inflight]);
}

/** Run `fn` over `items`, at most `limit` at a time; a failing item is logged and skipped. */
async function eachLimited<T>(
  items: readonly T[],
  limit: number,
  what: string,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++]!;
      try {
        await fn(item);
      } catch (err) {
        logger.warn({ err, item }, `${what} failed`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

// ---------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------

/** Types a publish copies (polls would split their votes across copies). */
const PUBLISHABLE = new Set<MessageRow['type']>([
  'text',
  'image',
  'video',
  'audio',
  'voice',
  'file',
  'location',
  'contact',
]);

/** Publishes in the channel during the last hour (the caller holds the channel lock). */
async function publishesLastHour(tx: Tx, spaceId: string, chatId: string): Promise<number> {
  const [row] = await tx
    .select({ n: count() })
    .from(spaceAuditLog)
    .where(
      and(
        eq(spaceAuditLog.spaceId, spaceId),
        gt(spaceAuditLog.createdAt, new Date(Date.now() - HOUR_MS)),
        eq(spaceAuditLog.action, PUBLISH_ACTION),
        eq(spaceAuditLog.targetId, chatId),
      ),
    );
  return Number(row?.n ?? 0);
}

/**
 * `POST /messages/:messageId/crosspost` → the message (CROSSPOSTED set). Rules: header. The
 * copies are written after commit (`message:new` in each follower channel).
 */
export async function publishMessage(me: string, messageId: string): Promise<Message> {
  const row = await transact(async (tx, fx) => {
    const first = await loadVisibleMessage(tx, me, messageId);
    // The channel lock serializes publishes (the hourly count) and edits/deletes of the message.
    const access = await requireActiveMember(tx, me, first.message.chatId, { lock: true });
    const { message } = await loadVisibleMessage(tx, me, messageId, { chatId: access.chat.id });
    const chat = access.chat;
    if (chat.type !== 'space_text' || !chat.isNews || !access.space || !chat.spaceId)
      throw badRequest('Only messages of announcement channels can be published');
    if (!PUBLISHABLE.has(message.type)) throw badRequest('This message cannot be published');
    if (message.deletedAt) throw badRequest('This message was deleted');
    if (hasMessageFlag(message.flags, MESSAGE_FLAGS.IS_CROSSPOST))
      throw badRequest('Messages from followed channels cannot be published again');
    if (hasMessageFlag(message.flags, MESSAGE_FLAGS.CROSSPOSTED))
      throw conflict('This message was already published');
    const { bits } = access.space;
    const author = message.senderId === me && hasPerm(bits, PERM.SEND_MESSAGES);
    if (!author && !hasPerm(bits, PERM.MANAGE_MESSAGES))
      throw forbidden('You can only publish your own messages');
    if ((await publishesLastHour(tx, chat.spaceId, chat.id)) >= PUBLISH_LIMIT_PER_HOUR)
      throw rateLimited(
        `An announcement channel can publish ${PUBLISH_LIMIT_PER_HOUR} messages an hour. Try again later.`,
      );
    const [updated] = await tx
      .update(messages)
      .set({ flags: sql`${messages.flags} | ${MESSAGE_FLAGS.CROSSPOSTED}` })
      .where(eq(messages.id, messageId))
      .returning();
    await audit(tx, {
      spaceId: chat.spaceId,
      actorId: me,
      action: PUBLISH_ACTION,
      targetType: 'channel',
      targetId: chat.id,
      changes: { messageId },
    });
    fx.messageUpdated(messageId);
    fx.add(() => track(deliverCrosspost(messageId)));
    return updated!;
  });
  const [out] = await toMessages(db, me, [row]);
  return out!;
}

/** Where copies of a channel's posts say they come from (the Space and channel as they are now). */
interface Origin {
  spaceId: string;
  spaceName: string;
  iconUrl: string | null;
  channelId: string;
  channelName: string;
}

async function loadOrigin(dbx: DbOrTx, channelId: string): Promise<Origin | null> {
  const [row] = await dbx
    .select({
      chat: { id: chats.id, name: chats.name },
      space: { id: spaces.id, name: spaces.name },
      icon: media,
    })
    .from(chats)
    .innerJoin(spaces, eq(spaces.id, chats.spaceId))
    .leftJoin(media, eq(media.id, spaces.iconMediaId))
    .where(eq(chats.id, channelId))
    .limit(1);
  if (!row) return null;
  return {
    spaceId: row.space.id,
    spaceName: row.space.name,
    iconUrl: row.icon ? staticMediaUrl(row.icon) : null,
    channelId: row.chat.id,
    channelName: row.chat.name ?? 'announcements',
  };
}

type FileInput = { mediaId: string; description: string | null };

/** The original's `message_attachments` rows (several files or alt text), in order. */
async function filesOf(dbx: DbOrTx, messageId: string): Promise<FileInput[]> {
  return dbx
    .select({ mediaId: messageAttachments.mediaId, description: messageAttachments.description })
    .from(messageAttachments)
    .where(eq(messageAttachments.messageId, messageId))
    .orderBy(asc(messageAttachments.position));
}

/** What a copy keeps of the original (like a forward, plus embeds; never a reply link). */
function copiedContent(src: MessageRow, files: FileInput[]) {
  const md = src.metadata ?? {};
  const metadata: MessageMetadata = {};
  if (md.location) metadata.location = { ...md.location };
  if (md.contact) metadata.contact = { ...md.contact };
  return {
    type: src.type,
    text: src.text,
    mediaId: src.mediaId,
    ...(src.mediaId && files.length ? { attachments: files } : {}),
    stickerId: src.stickerId,
    embeds: src.embeds ?? [],
    metadata,
  };
}

/** Copy a published message into every channel following its channel (after commit). */
async function deliverCrosspost(sourceId: string): Promise<void> {
  const [src] = await db
    .select({ chatId: messages.chatId })
    .from(messages)
    .where(eq(messages.id, sourceId))
    .limit(1);
  if (!src) return;
  const follows = await db
    .select({ id: channelFollows.id, targetChannelId: channelFollows.targetChannelId })
    .from(channelFollows)
    .where(
      and(
        eq(channelFollows.sourceChannelId, src.chatId),
        sql`${channelFollows.webhookId} is not null`,
      ),
    )
    .orderBy(asc(channelFollows.createdAt));
  if (follows.length === 0) return;
  const origin = await loadOrigin(db, src.chatId);
  if (!origin) return;
  const files = await filesOf(db, sourceId);
  await eachLimited(follows, DELIVERY_CONCURRENCY, 'crosspost delivery', (f) =>
    deliverOne(sourceId, f, origin, files),
  );
}

async function deliverOne(
  sourceId: string,
  target: { id: string; targetChannelId: string },
  origin: Origin,
  files: FileInput[],
): Promise<void> {
  await transact(async (tx, fx) => {
    await lockChat(tx, target.targetChannelId);
    const [follow] = await tx
      .select()
      .from(channelFollows)
      .where(eq(channelFollows.id, target.id))
      .limit(1);
    if (!follow?.webhookId) return; // unfollowed, or its webhook was deleted
    const [src] = await tx
      .select()
      .from(messages)
      .where(eq(messages.id, sourceId))
      .limit(1)
      .for('share');
    if (!src || src.deletedAt || !hasMessageFlag(src.flags, MESSAGE_FLAGS.CROSSPOSTED)) return;
    const [copy] = await tx
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.crosspostOf, sourceId), eq(messages.chatId, follow.targetChannelId)))
      .limit(1);
    if (copy) return;
    const authorOverride: MessageAuthorOverride = {
      kind: 'crosspost',
      name: `${origin.spaceName} #${origin.channelName}`,
      avatarUrl: origin.iconUrl,
      webhookId: follow.webhookId,
      source: {
        spaceId: origin.spaceId,
        spaceName: origin.spaceName,
        channelId: origin.channelId,
        channelName: origin.channelName,
        messageId: src.id,
      },
    };
    await createMessage(tx, fx, {
      ...copiedContent(src, files),
      chatId: follow.targetChannelId,
      senderId: null,
      authorOverride,
      webhookId: follow.webhookId,
      // A copy keeps its original's suppressed link previews (never its /tts).
      flags: MESSAGE_FLAGS.IS_CROSSPOST | (src.flags & MESSAGE_FLAGS.SUPPRESS_EMBEDS),
      crosspostOf: src.id,
    });
  });
}

// ---------------------------------------------------------------------------
// Edits and deletes of a published message
// ---------------------------------------------------------------------------

/** The live copies of a published message. */
async function copiesOf(sourceId: string) {
  return db
    .select({ id: messages.id, chatId: messages.chatId })
    .from(messages)
    .where(and(eq(messages.crosspostOf, sourceId), isNull(messages.deletedAt)));
}

/** After an edit of a published message: its copies take the new text (`message:updated` each). */
export function propagateCrosspostEdit(row: Pick<MessageRow, 'id' | 'flags'>): void {
  if (!hasMessageFlag(row.flags, MESSAGE_FLAGS.CROSSPOSTED)) return;
  track(
    (async () => {
      const copies = await copiesOf(row.id);
      await eachLimited(copies, DELIVERY_CONCURRENCY, 'crosspost edit', (c) =>
        transact(async (tx, fx) => {
          const chat = await lockChat(tx, c.chatId);
          const [copy] = await tx
            .select()
            .from(messages)
            .where(eq(messages.id, c.id))
            .for('update');
          // The original as committed now: the last of several quick edits always wins.
          const [src] = await tx.select().from(messages).where(eq(messages.id, row.id));
          if (!copy || copy.deletedAt || !src || src.deletedAt) return;
          if (copy.text === src.text) return;
          const mentions = await deriveMentions(tx, c.chatId, null, src.text, undefined, {
            spaceId: chat.spaceId,
          });
          await tx
            .update(messages)
            .set({ text: src.text, mentions, editedAt: src.editedAt ?? new Date() })
            .where(eq(messages.id, c.id));
          fx.messageUpdated(c.id);
        }),
      );
    })(),
  );
}

/** After a delete for everyone of a message: its copies are deleted too (no-op without any). */
export function propagateCrosspostDelete(messageId: string): void {
  track(
    (async () => {
      const copies = await copiesOf(messageId);
      await eachLimited(copies, DELIVERY_CONCURRENCY, 'crosspost delete', (c) =>
        transact(async (tx, fx) => {
          await lockChat(tx, c.chatId);
          const [copy] = await tx
            .select({ deletedAt: messages.deletedAt })
            .from(messages)
            .where(eq(messages.id, c.id));
          if (!copy || copy.deletedAt) return;
          await deleteForEveryoneTx(tx, fx, c.id);
        }),
      );
    })(),
  );
}

// ---------------------------------------------------------------------------
// Follow
// ---------------------------------------------------------------------------

type FollowRow = typeof channelFollows.$inferSelect;

/** ChannelFollow objects (one query for names, one for icons), in the order given. */
async function toChannelFollows(dbx: DbOrTx, rows: readonly FollowRow[]): Promise<ChannelFollow[]> {
  if (rows.length === 0) return [];
  const src = alias(chats, 'src');
  const dst = alias(chats, 'dst');
  const info = await dbx
    .select({
      id: channelFollows.id,
      srcName: src.name,
      dstName: dst.name,
      dstSpaceId: dst.spaceId,
      spaceId: spaces.id,
      spaceName: spaces.name,
      icon: media,
    })
    .from(channelFollows)
    .innerJoin(src, eq(src.id, channelFollows.sourceChannelId))
    .innerJoin(spaces, eq(spaces.id, src.spaceId))
    .innerJoin(dst, eq(dst.id, channelFollows.targetChannelId))
    .leftJoin(media, eq(media.id, spaces.iconMediaId))
    .where(
      inArray(
        channelFollows.id,
        rows.map((r) => r.id),
      ),
    );
  const byId = new Map(info.map((i) => [i.id, i]));
  return rows.flatMap((r) => {
    const i = byId.get(r.id);
    if (!i) return [];
    return [
      {
        id: r.id,
        sourceChannel: {
          id: r.sourceChannelId,
          name: i.srcName ?? 'announcements',
          spaceId: i.spaceId,
          spaceName: i.spaceName,
          spaceIconUrl: i.icon ? staticMediaUrl(i.icon) : null,
        },
        targetChannel: {
          id: r.targetChannelId,
          name: i.dstName ?? 'channel',
          spaceId: i.dstSpaceId!,
        },
        webhookId: r.webhookId,
        createdBy: r.createdBy,
        createdAt: r.createdAt.toISOString(),
      },
    ];
  });
}

/** `POST /chats/:chatId/followers { targetChannelId }` → the follow (201). Rules: header. */
export async function followChannel(
  me: string,
  sourceId: string,
  targetId: string,
): Promise<ChannelFollow> {
  if (sourceId === targetId) throw badRequest('A channel cannot follow itself');
  assertUserLimit(me, 'channelFollow', FOLLOW_LIMIT);
  const row = await transact(async (tx, fx) => {
    const source = await getChatAccess(tx, me, sourceId);
    if (source.chat.type !== 'space_text' || !source.chat.isNews || !source.chat.spaceId)
      throw badRequest('Only announcement channels can be followed');
    const peek = await getChatAccess(tx, me, targetId);
    if (!peek.space || !peek.chat.spaceId) throw notFound('Channel');
    // Lock order: the target Space, then its channel (the follow, webhook and notice go there).
    await lockSpace(tx, peek.chat.spaceId);
    const target = await getChatAccess(tx, me, targetId, { lock: true });
    if (target.chat.type !== 'space_text')
      throw badRequest('Announcements can only be followed into a text channel');
    requireSpaceBit(target, PERM.MANAGE_WEBHOOKS, 'You need Manage Webhooks in that channel');
    const [existing] = await tx
      .select()
      .from(channelFollows)
      .where(
        and(
          eq(channelFollows.sourceChannelId, sourceId),
          eq(channelFollows.targetChannelId, targetId),
        ),
      )
      .limit(1);
    if (existing?.webhookId)
      throw conflict('That channel already follows this announcement channel');
    // A follow whose webhook was deleted delivers nothing: following again replaces it.
    if (existing) await tx.delete(channelFollows).where(eq(channelFollows.id, existing.id));
    const [hooks] = await tx
      .select({ n: count() })
      .from(webhooks)
      .where(eq(webhooks.channelId, targetId));
    if (Number(hooks?.n ?? 0) >= WEBHOOKS_PER_CHANNEL)
      throw limitReached(`A channel can have at most ${WEBHOOKS_PER_CHANNEL} webhooks`);
    const [sourceSpace] = await tx
      .select({ id: spaces.id, name: spaces.name, iconMediaId: spaces.iconMediaId })
      .from(spaces)
      .where(eq(spaces.id, source.chat.spaceId));
    if (!sourceSpace) throw notFound('Channel');
    const hook = await insertFollowerWebhook(tx, {
      spaceId: target.chat.spaceId!,
      channelId: targetId,
      sourceChannelId: sourceId,
      name: sourceSpace.name.slice(0, WEBHOOK_NAME_MAX_LENGTH),
      avatarMediaId: sourceSpace.iconMediaId,
      createdBy: me,
    });
    const [follow] = await tx
      .insert(channelFollows)
      .values({
        sourceChannelId: sourceId,
        targetChannelId: targetId,
        webhookId: hook.id,
        createdBy: me,
      })
      .returning();
    await createMessage(tx, fx, {
      chatId: targetId,
      senderId: null,
      type: 'system',
      metadata: {
        system: {
          kind: 'channel_followed',
          actorId: me,
          channelId: sourceId,
          spaceName: sourceSpace.name,
          channelName: source.chat.name ?? 'announcements',
        },
      },
    });
    await audit(tx, {
      spaceId: target.chat.spaceId!,
      actorId: me,
      action: 'channel.follow',
      targetType: 'channel',
      targetId,
      changes: { sourceChannelId: sourceId, sourceSpaceId: sourceSpace.id, webhookId: hook.id },
    });
    return follow!;
  });
  return (await toChannelFollows(db, [row]))[0]!;
}

/** `GET /chats/:chatId/followers`: the channels following this one (MANAGE_WEBHOOKS in it). */
export async function listFollowers(me: string, chatId: string): Promise<ChannelFollow[]> {
  const access = await getChatAccess(db, me, chatId);
  if (!access.space) throw notFound('Channel');
  requireSpaceBit(access, PERM.MANAGE_WEBHOOKS, 'You need Manage Webhooks in this channel');
  const rows = await db
    .select()
    .from(channelFollows)
    .where(eq(channelFollows.sourceChannelId, chatId))
    .orderBy(asc(channelFollows.createdAt));
  return toChannelFollows(db, rows);
}

/**
 * `GET /spaces/:spaceId/follows`: the channels followed into this Space (MANAGE_WEBHOOKS),
 * those whose target channel I can see.
 */
export async function listSpaceFollows(me: string, spaceId: string): Promise<ChannelFollow[]> {
  const access = await requireSpacePermission(db, spaceId, me, PERM.MANAGE_WEBHOOKS);
  const rows = await db
    .select({ follow: channelFollows })
    .from(channelFollows)
    .innerJoin(chats, eq(chats.id, channelFollows.targetChannelId))
    .where(eq(chats.spaceId, spaceId))
    .orderBy(asc(channelFollows.createdAt));
  const overwrites = await loadChannelOverwrites(
    db,
    rows.map((r) => r.follow.targetChannelId),
  );
  const visible = rows.filter((r) =>
    hasPerm(
      channelBits(
        access.ctx,
        me,
        access.me,
        'space_text',
        overwrites.get(r.follow.targetChannelId) ?? [],
        access.base,
      ),
      PERM.VIEW_CHANNEL,
    ),
  );
  return toChannelFollows(
    db,
    visible.map((r) => r.follow),
  );
}

/** `DELETE /channel-follows/:followId`: MANAGE_WEBHOOKS in the target; the webhook goes too. */
export async function unfollowChannel(me: string, followId: string): Promise<void> {
  assertUserLimit(me, 'channelFollow', FOLLOW_LIMIT);
  await transact(async (tx) => {
    const [peek] = await tx
      .select({ targetChannelId: channelFollows.targetChannelId, spaceId: chats.spaceId })
      .from(channelFollows)
      .innerJoin(chats, eq(chats.id, channelFollows.targetChannelId))
      .where(eq(channelFollows.id, followId))
      .limit(1);
    if (!peek?.spaceId) throw notFound('Follow');
    await lockSpace(tx, peek.spaceId);
    // 404 unless I can see the target channel; 403 without MANAGE_WEBHOOKS there.
    const target = await getChatAccess(tx, me, peek.targetChannelId, { lock: true });
    requireSpaceBit(target, PERM.MANAGE_WEBHOOKS, 'You need Manage Webhooks in that channel');
    const [gone] = await tx
      .delete(channelFollows)
      .where(eq(channelFollows.id, followId))
      .returning();
    if (!gone) throw notFound('Follow');
    if (gone.webhookId) await tx.delete(webhooks).where(eq(webhooks.id, gone.webhookId));
    await audit(tx, {
      spaceId: peek.spaceId,
      actorId: me,
      action: 'channel.unfollow',
      targetType: 'channel',
      targetId: gone.targetChannelId,
      changes: { sourceChannelId: gone.sourceChannelId },
    });
  });
}
