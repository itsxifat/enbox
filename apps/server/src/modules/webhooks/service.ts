/**
 * Webhooks module service (docs/design/discord-parity.md W10-E).
 *
 * Management — MANAGE_WEBHOOKS in the channel (computed with its overwrites; 404 for whoever
 * can't see it). A text or announcement channel holds up to WEBHOOKS_PER_CHANNEL webhooks
 * (follower webhooks included), each with a name, an optional avatar (my image upload, the
 * avatar media rules) and a secret URL that is shown once: on create and on regenerate (only
 * its hash is stored; regenerating makes the old URL stop working). A webhook moves to
 * another text channel of its Space with MANAGE_WEBHOOKS there too. Follower webhooks
 * (announcement channels) can't be edited or regenerated here (400); deleting one unfollows
 * (its `channel_follows` row goes with it). Changes are audited (`webhook.create|update|
 * delete`). Locks: the channel rows first (spaces → chats → everything else), then the
 * webhook row, re-read under the lock.
 *
 * Execute — public: the URL is the credential (404 for an unknown id or a wrong secret).
 * A Discord-compatible JSON body: content (≤ 2000), `username` and `avatar_url` for this
 * message only (the avatar is copied through the guarded fetcher; one that can't be falls
 * back to the webhook's), `tts` (MESSAGE_FLAGS.TTS), up to 10 embeds (services/embeds.ts)
 * and `allowed_mentions`. The message is an ordinary `text` message with no sender and the
 * webhook's author override; AutoMod and slowmode judge members, so they don't apply.
 * Mentions: users by default, never @everyone/@here or roles unless `allowed_mentions` says
 * so (`parse` lists the kinds that ping; `users` / `roles` list ids instead). Discord's
 * syntax (`<@id>`, `<@&id>`, `@everyone`, `@here`) is stored as Enbox mention tokens.
 * `?wait=true` answers with the message. A webhook edits (content, embeds; edits never ping
 * again) and deletes its own messages only. Limits: modules/webhooks/limits.ts.
 */
import { and, asc, eq } from 'drizzle-orm';
import type { z } from 'zod';
import {
  MESSAGE_FLAGS,
  PERM,
  extractMentionIds,
  extractSpaceMentions,
  hasPerm,
  type Message,
  type SpaceChannelType,
  type Webhook,
  type WebhookWithUrl,
  type createWebhookSchema,
  type editWebhookMessageSchema,
  type executeWebhookSchema,
  type updateWebhookSchema,
} from '@enbox/shared';
import { db, type DbOrTx, type Tx } from '../../db/index.js';
import {
  channelFollows,
  messages,
  webhooks,
  chats,
  type ChatRow,
  type MessageRow,
} from '../../db/schema.js';
import { HttpError, badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { assertUserLimit } from '../../lib/userLimit.js';
import {
  getChatAccess,
  lockChats,
  type ChatAccess,
  type ChatAccessOptions,
} from '../../services/chats.js';
import { transact } from '../../services/effects.js';
import { cacheExternalImage, prepareEmbeds } from '../../services/embeds.js';
import { requireAvatarMedia } from '../../services/media.js';
import { deleteForEveryoneTx, insertMessage, toMessages } from '../../services/messages.js';
import {
  channelBits,
  loadChannelOverwrites,
  loadSpacePermCtx,
  requireSpaceMember,
  type SpaceChannelAccessInfo,
} from '../../services/spaceAccess.js';
import { audit } from '../../services/spaces.js';
import { uniq } from '../../services/sql.js';
import {
  assertWebhookRoom,
  findWebhookByToken,
  hashWebhookToken,
  newWebhookToken,
  toWebhooks,
  webhookAuthor,
  webhookAvatarUrl,
  webhookTokenMatches,
  webhookUrl,
  type WebhookRow,
} from '../../services/webhooks.js';
import { WEBHOOK_IP_RATE_LIMIT, WEBHOOK_RATE_LIMIT, takeWebhookLimit } from './limits.js';

export type CreateWebhookBody = z.output<typeof createWebhookSchema>;
export type UpdateWebhookBody = z.output<typeof updateWebhookSchema>;
export type ExecuteWebhookInput = z.output<typeof executeWebhookSchema>;
export type EditWebhookMessageBody = z.output<typeof editWebhookMessageSchema>;

/** Creates, edits, regenerations and deletes per user (abuse limit; setting up a Space fits). */
const WEBHOOK_UPDATE_LIMIT = { limit: 120, windowMs: 60 * 60_000 };

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

type ManagerAccess = ChatAccess & { space: SpaceChannelAccessInfo };

/**
 * My access to a Space channel whose webhooks I manage: 404 unless I can see it (`what`
 * names the missing thing), 403 without MANAGE_WEBHOOKS in it. DMs and groups have none.
 */
async function requireWebhookManager(
  dbx: DbOrTx,
  me: string,
  chatId: string,
  opts: ChatAccessOptions & { what?: string } = {},
): Promise<ManagerAccess> {
  const { what = 'Chat', ...accessOpts } = opts;
  let access: ChatAccess;
  try {
    access = await getChatAccess(dbx, me, chatId, accessOpts);
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) throw notFound(what);
    throw err;
  }
  if (!access.space) throw notFound(what);
  if (!hasPerm(access.space.bits, PERM.MANAGE_WEBHOOKS))
    throw forbidden('You need the Manage Webhooks permission in this channel');
  return access as ManagerAccess;
}

/** Webhooks post in text channels (announcement channels are text channels too). */
function assertWebhookChannel(chat: Pick<ChatRow, 'type'>): void {
  if (chat.type !== 'space_text')
    throw badRequest('Webhooks can only be added to text and announcement channels');
}

async function requireWebhookRow(
  dbx: DbOrTx,
  webhookId: string,
  opts: { lock?: boolean } = {},
): Promise<WebhookRow> {
  let q = dbx.select().from(webhooks).where(eq(webhooks.id, webhookId)).limit(1).$dynamic();
  if (opts.lock) q = q.for('update');
  const [row] = await q;
  if (!row) throw notFound('Webhook');
  return row;
}

/**
 * The webhook to change, with its channel (and `alsoLock`, a move's target) locked first:
 * an unlocked access check (never queue on a chat I can't see), the chat locks, then the
 * row re-read `FOR UPDATE` and the check repeated under the lock.
 */
async function lockManagedWebhook(
  tx: Tx,
  me: string,
  webhookId: string,
  alsoLock?: string,
): Promise<{ webhook: WebhookRow; access: ManagerAccess; locked: Map<string, ChatRow> }> {
  const first = await requireWebhookRow(tx, webhookId);
  await requireWebhookManager(tx, me, first.channelId, { what: 'Webhook' });
  const ids =
    alsoLock && alsoLock !== first.channelId ? [first.channelId, alsoLock] : [first.channelId];
  const locked = new Map((await lockChats(tx, ids)).map((c) => [c.id, c]));
  const webhook = await requireWebhookRow(tx, webhookId, { lock: true });
  if (webhook.channelId !== first.channelId || !locked.has(webhook.channelId))
    throw conflict('This webhook was just changed. Try again.');
  const access = await requireWebhookManager(tx, me, webhook.channelId, {
    chat: locked.get(webhook.channelId),
    what: 'Webhook',
  });
  return { webhook, access, locked };
}

function assertIncoming(row: WebhookRow): void {
  if (row.kind === 'follower')
    throw badRequest(
      'This webhook delivers a followed announcement channel: it can only be deleted (which unfollows)',
    );
}

async function toWebhook(dbx: DbOrTx, row: WebhookRow): Promise<Webhook> {
  return (await toWebhooks(dbx, [row]))[0]!;
}

// ---------------------------------------------------------------------------
// Management
// ---------------------------------------------------------------------------

/**
 * `GET /spaces/:spaceId/webhooks`: Space-wide MANAGE_WEBHOOKS (403; 404 for non-members),
 * then the webhooks of the channels where my bits keep it (overwrites can take it away),
 * oldest first.
 */
export async function listSpaceWebhooks(me: string, spaceId: string): Promise<Webhook[]> {
  const access = await requireSpaceMember(db, spaceId, me);
  if (!hasPerm(access.base, PERM.MANAGE_WEBHOOKS))
    throw forbidden('You need the Manage Webhooks permission');
  const rows = await db
    .select({ webhook: webhooks, type: chats.type })
    .from(webhooks)
    .innerJoin(chats, eq(chats.id, webhooks.channelId))
    .where(eq(webhooks.spaceId, spaceId))
    .orderBy(asc(webhooks.createdAt), asc(webhooks.id));
  const overwrites = await loadChannelOverwrites(db, uniq(rows.map((r) => r.webhook.channelId)));
  const mine = rows.filter((r) =>
    hasPerm(
      channelBits(
        access.ctx,
        me,
        access.me,
        r.type as SpaceChannelType,
        overwrites.get(r.webhook.channelId) ?? [],
        access.base,
      ),
      PERM.MANAGE_WEBHOOKS,
    ),
  );
  return toWebhooks(
    db,
    mine.map((r) => r.webhook),
  );
}

/** `GET /chats/:chatId/webhooks` (MANAGE_WEBHOOKS there), oldest first. */
export async function listChannelWebhooks(me: string, chatId: string): Promise<Webhook[]> {
  await requireWebhookManager(db, me, chatId);
  const rows = await db
    .select()
    .from(webhooks)
    .where(eq(webhooks.channelId, chatId))
    .orderBy(asc(webhooks.createdAt), asc(webhooks.id));
  return toWebhooks(db, rows);
}

/** `POST /chats/:chatId/webhooks` → the webhook with its URL (`origin`: the app's). */
export async function createWebhook(
  me: string,
  chatId: string,
  body: CreateWebhookBody,
  origin: string,
): Promise<WebhookWithUrl> {
  assertUserLimit(me, 'webhookUpdate', WEBHOOK_UPDATE_LIMIT);
  return transact(async (tx) => {
    // The channel row lock serialises the count with concurrent creates and moves.
    const access = await requireWebhookManager(tx, me, chatId, { lock: true });
    assertWebhookChannel(access.chat);
    await assertWebhookRoom(tx, chatId);
    const avatar = body.avatarMediaId ? await requireAvatarMedia(tx, body.avatarMediaId, me) : null;
    const token = newWebhookToken();
    const [row] = await tx
      .insert(webhooks)
      .values({
        spaceId: access.space.ctx.spaceId,
        channelId: chatId,
        kind: 'incoming',
        name: body.name,
        avatarMediaId: avatar?.id ?? null,
        tokenHash: hashWebhookToken(token),
        createdBy: me,
      })
      .returning();
    await audit(tx, {
      spaceId: access.space.ctx.spaceId,
      actorId: me,
      action: 'webhook.create',
      targetId: row!.id,
      changes: { name: body.name, channelId: chatId },
    });
    return { ...(await toWebhook(tx, row!)), url: webhookUrl(origin, row!.id, token) };
  });
}

/**
 * `PATCH /webhooks/:webhookId`: name, avatar (null removes it) or another text channel of
 * the Space (MANAGE_WEBHOOKS there too, room for one more). Nothing changed → as is.
 */
export async function updateWebhook(
  me: string,
  webhookId: string,
  body: UpdateWebhookBody,
): Promise<Webhook> {
  assertUserLimit(me, 'webhookUpdate', WEBHOOK_UPDATE_LIMIT);
  return transact(async (tx) => {
    const target = body.channelId;
    if (target) await requireWebhookManager(tx, me, target);
    const { webhook, locked } = await lockManagedWebhook(tx, me, webhookId, target);
    assertIncoming(webhook);
    const next = {
      name: webhook.name,
      avatarMediaId: webhook.avatarMediaId,
      channelId: webhook.channelId,
    };
    const changes: Record<string, unknown> = {};
    if (body.name !== undefined && body.name !== webhook.name) {
      changes.name = [webhook.name, body.name];
      next.name = body.name;
    }
    if (body.avatarMediaId !== undefined && body.avatarMediaId !== webhook.avatarMediaId) {
      if (body.avatarMediaId) await requireAvatarMedia(tx, body.avatarMediaId, me);
      changes.avatar = body.avatarMediaId ? 'changed' : 'removed';
      next.avatarMediaId = body.avatarMediaId;
    }
    if (target && target !== webhook.channelId) {
      const chat = locked.get(target);
      if (!chat || chat.spaceId !== webhook.spaceId) throw notFound('Chat');
      await requireWebhookManager(tx, me, target, { chat });
      assertWebhookChannel(chat);
      await assertWebhookRoom(tx, target);
      changes.channelId = [webhook.channelId, target];
      next.channelId = target;
    }
    if (Object.keys(changes).length === 0) return toWebhook(tx, webhook);
    const [row] = await tx
      .update(webhooks)
      .set({ ...next, updatedAt: new Date() })
      .where(eq(webhooks.id, webhookId))
      .returning();
    await audit(tx, {
      spaceId: webhook.spaceId,
      actorId: me,
      action: 'webhook.update',
      targetId: webhookId,
      changes,
    });
    return toWebhook(tx, row!);
  });
}

/** `POST /webhooks/:webhookId/token`: a new secret URL; the old one stops working at once. */
export async function regenerateWebhookToken(
  me: string,
  webhookId: string,
  origin: string,
): Promise<WebhookWithUrl> {
  assertUserLimit(me, 'webhookUpdate', WEBHOOK_UPDATE_LIMIT);
  return transact(async (tx) => {
    const { webhook } = await lockManagedWebhook(tx, me, webhookId);
    assertIncoming(webhook);
    const token = newWebhookToken();
    const [row] = await tx
      .update(webhooks)
      .set({ tokenHash: hashWebhookToken(token), updatedAt: new Date() })
      .where(eq(webhooks.id, webhookId))
      .returning();
    await audit(tx, {
      spaceId: webhook.spaceId,
      actorId: me,
      action: 'webhook.update',
      targetId: webhookId,
      changes: { url: 'regenerated' },
    });
    return { ...(await toWebhook(tx, row!)), url: webhookUrl(origin, webhookId, token) };
  });
}

/**
 * `DELETE /webhooks/:webhookId`. Its messages stay (they keep their author snapshot). A
 * follower webhook's follow goes too: the channel is unfollowed.
 */
export async function deleteWebhook(me: string, webhookId: string): Promise<void> {
  assertUserLimit(me, 'webhookUpdate', WEBHOOK_UPDATE_LIMIT);
  await transact(async (tx) => {
    const { webhook } = await lockManagedWebhook(tx, me, webhookId);
    if (webhook.kind === 'follower')
      await tx.delete(channelFollows).where(eq(channelFollows.webhookId, webhook.id));
    await tx.delete(webhooks).where(eq(webhooks.id, webhook.id));
    await audit(tx, {
      spaceId: webhook.spaceId,
      actorId: me,
      action: 'webhook.delete',
      targetId: webhook.id,
      changes: {
        name: webhook.name,
        channelId: webhook.channelId,
        ...(webhook.kind === 'follower' ? { kind: 'follower' } : {}),
      },
    });
  });
}

// ---------------------------------------------------------------------------
// Execute (public)
// ---------------------------------------------------------------------------

/** Discord's mention syntax → Enbox tokens (ids are UUIDs here; tokens are lowercase). */
const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const USER_SYNTAX = new RegExp(`<@!?(${UUID})>`, 'g');
const ROLE_SYNTAX = new RegExp(`<@&(${UUID})>`, 'g');
/** `@everyone` / `@here` as words (not `x@here.com`, not an `@{everyone}` token). */
const EVERYONE_SYNTAX = /(^|[^\w@{])@(everyone|here)\b/g;

export function toEnboxMentions(text: string): string {
  return text
    .replace(USER_SYNTAX, (_, id: string) => `@{${id.toLowerCase()}}`)
    .replace(ROLE_SYNTAX, (_, id: string) => `@{role:${id.toLowerCase()}}`)
    .replace(EVERYONE_SYNTAX, '$1@{$2}');
}

/** Stored text of `content` (Enbox tokens; blank → null). */
function contentText(content: string | undefined): string | null {
  return content?.trim() ? toEnboxMentions(content) : null;
}

/** What may ping, from `allowed_mentions` (Discord's rules; absent = users only). */
interface MentionRules {
  users: 'all' | ReadonlySet<string>;
  roles: 'all' | ReadonlySet<string>;
  everyone: boolean;
}

export function mentionRules(am: ExecuteWebhookInput['allowed_mentions']): MentionRules {
  if (!am) return { users: 'all', roles: new Set(), everyone: false };
  const parse = new Set(am.parse ?? []);
  if (parse.has('users') && am.users?.length)
    throw badRequest('allowed_mentions: "users" can\'t be in parse and listed at once');
  if (parse.has('roles') && am.roles?.length)
    throw badRequest('allowed_mentions: "roles" can\'t be in parse and listed at once');
  return {
    users: parse.has('users') ? 'all' : new Set(am.users ?? []),
    roles: parse.has('roles') ? 'all' : new Set(am.roles ?? []),
    everyone: parse.has('everyone'),
  };
}

/** The @everyone/@here and role mentions of `text` that ping (the Space's own roles only). */
function spaceMentionsOf(
  text: string | null,
  rules: MentionRules,
  spaceRoleIds: ReadonlySet<string>,
): { everyone: boolean; roleIds: string[] } {
  const m = extractSpaceMentions(text);
  const allowed = rules.roles;
  return {
    everyone: rules.everyone && (m.everyone || m.here),
    roleIds: m.roleIds.filter(
      (id) => spaceRoleIds.has(id) && (allowed === 'all' || allowed.has(id)),
    ),
  };
}

/** The request's IP budget, then the secret (404), then the webhook's own budget (429). */
async function authenticate(webhookId: string, token: string, ip: string): Promise<WebhookRow> {
  takeWebhookLimit(`ip\u0000${ip}`, WEBHOOK_IP_RATE_LIMIT);
  const row = await findWebhookByToken(db, webhookId, token);
  if (!row) throw notFound('Webhook');
  takeWebhookLimit(`webhook\u0000${row.id}`, WEBHOOK_RATE_LIMIT);
  return row;
}

/**
 * Inside the posting transaction: the webhook's channel locked (lock order: chats first),
 * then the webhook re-read `FOR KEY SHARE` — deleted, regenerated or moved since the request
 * was authenticated → 404 / 409.
 */
async function lockWebhookChannel(tx: Tx, hook: WebhookRow, token: string): Promise<WebhookRow> {
  const [chat] = await lockChats(tx, [hook.channelId]);
  if (!chat) throw notFound('Webhook');
  const [row] = await tx
    .select()
    .from(webhooks)
    .where(eq(webhooks.id, hook.id))
    .limit(1)
    .for('key share');
  if (!row || !webhookTokenMatches(row, token)) throw notFound('Webhook');
  if (row.channelId !== hook.channelId)
    throw conflict('This webhook was just moved to another channel. Send again.');
  return row;
}

export interface ExecuteOptions {
  /** `?wait=true`: answer with the message. */
  wait: boolean;
  ip: string;
}

/** `POST /webhooks/:webhookId/:token` → the message (`wait`) or null. */
export async function executeWebhook(
  webhookId: string,
  token: string,
  body: ExecuteWebhookInput,
  opts: ExecuteOptions,
): Promise<Message | null> {
  const hook = await authenticate(webhookId, token, opts.ip);
  const rules = mentionRules(body.allowed_mentions);
  const text = contentText(body.content);
  // Third-party images are fetched before the transaction (no locks held meanwhile).
  const embeds = await prepareEmbeds(body.embeds ?? []);
  if (!text && embeds.length === 0)
    throw badRequest("embeds: None of the embeds' images could be loaded");
  const avatar = body.avatar_url ? await cacheExternalImage(body.avatar_url) : null;
  const row = await transact(async (tx, fx) => {
    const webhook = await lockWebhookChannel(tx, hook, token);
    const ctx = await loadSpacePermCtx(tx, webhook.spaceId);
    const roleIds = new Set((ctx?.roles ?? []).filter((r) => !r.isDefault).map((r) => r.id));
    const authorOverride = webhookAuthor(webhook, await webhookAvatarUrl(tx, webhook), {
      ...(body.username ? { name: body.username } : {}),
      ...(avatar ? { avatarUrl: avatar } : {}),
    });
    const inserted = await insertMessage(tx, {
      chatId: webhook.channelId,
      senderId: null,
      type: 'text',
      text,
      authorOverride,
      webhookId: webhook.id,
      embeds,
      flags: body.tts ? MESSAGE_FLAGS.TTS : 0,
      spaceMentions: spaceMentionsOf(text, rules, roleIds),
    });
    const message = inserted.message;
    // Users who may not be pinged stay plain mentions in the text, without the ping.
    const users = rules.users;
    if (users !== 'all') {
      const kept = message.mentions.filter((id) => users.has(id));
      if (kept.length !== message.mentions.length) {
        await tx.update(messages).set({ mentions: kept }).where(eq(messages.id, message.id));
        // `publish` serialises this very row: keep it as stored.
        message.mentions = kept;
      }
    }
    inserted.publish(fx);
    return message;
  });
  if (!opts.wait) return null;
  const [message] = await toMessages(db, null, [row], { fresh: true });
  return message!;
}

/**
 * A message this webhook posted, its chat locked and the webhook re-checked under the lock;
 * 404 for anything else (another webhook's, deleted, unknown).
 */
async function lockOwnMessage(
  tx: Tx,
  hook: WebhookRow,
  token: string,
  messageId: string,
): Promise<MessageRow> {
  const find = async () => {
    const [m] = await tx
      .select()
      .from(messages)
      .where(and(eq(messages.id, messageId), eq(messages.webhookId, hook.id)))
      .limit(1);
    if (!m || m.deletedAt) throw notFound('Message');
    return m;
  };
  const first = await find();
  await lockChats(tx, [first.chatId]);
  const [row] = await tx
    .select()
    .from(webhooks)
    .where(eq(webhooks.id, hook.id))
    .limit(1)
    .for('key share');
  if (!row || !webhookTokenMatches(row, token)) throw notFound('Webhook');
  return find();
}

const sameEmbeds = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * `PATCH /webhooks/:webhookId/:token/messages/:messageId`: new content and/or embeds (an
 * empty result → 400). Mentions the new text no longer holds are dropped; none are added
 * (edits never ping). `message:updated` → the channel.
 */
export async function editWebhookMessage(
  webhookId: string,
  token: string,
  messageId: string,
  body: EditWebhookMessageBody,
  ip: string,
): Promise<Message> {
  const hook = await authenticate(webhookId, token, ip);
  const embeds = body.embeds ? await prepareEmbeds(body.embeds) : undefined;
  const row = await transact(async (tx, fx) => {
    const current = await lockOwnMessage(tx, hook, token, messageId);
    const text = body.content !== undefined ? contentText(body.content) : current.text;
    const nextEmbeds = embeds ?? current.embeds;
    if (!text && nextEmbeds.length === 0)
      throw badRequest('A message needs content or at least one embed');
    if (text === current.text && sameEmbeds(nextEmbeds, current.embeds)) return current;
    const tokens = new Set(extractMentionIds(text, Number.MAX_SAFE_INTEGER));
    const space = extractSpaceMentions(text);
    const [updated] = await tx
      .update(messages)
      .set({
        text,
        embeds: nextEmbeds,
        mentions: current.mentions.filter((id) => tokens.has(id)),
        mentionEveryone: current.mentionEveryone && (space.everyone || space.here),
        mentionRoleIds: current.mentionRoleIds.filter((id) => space.roleIds.includes(id)),
        editedAt: new Date(),
      })
      .where(eq(messages.id, current.id))
      .returning();
    fx.messageUpdated(current.id);
    return updated!;
  });
  const [message] = await toMessages(db, null, [row]);
  return message!;
}

/** `DELETE /webhooks/:webhookId/:token/messages/:messageId`: deleted for everyone. */
export async function deleteWebhookMessage(
  webhookId: string,
  token: string,
  messageId: string,
  ip: string,
): Promise<void> {
  const hook = await authenticate(webhookId, token, ip);
  await transact(async (tx, fx) => {
    const current = await lockOwnMessage(tx, hook, token, messageId);
    await deleteForEveryoneTx(tx, fx, current.id);
  });
}
