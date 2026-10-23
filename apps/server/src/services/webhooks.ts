/**
 * Webhook rows shared by the webhooks module (incoming webhooks) and announcement channels
 * (follower webhooks that deliver crossposts): the wire shape, the secret of an incoming
 * webhook's URL and the author its messages show as. The webhooks builder owns this file.
 *
 * The secret is 32 random bytes (base64url, 43 characters); only its sha256 is stored
 * (`token_hash`), so a URL is shown once — on create and on regenerate — and a request is
 * checked by hashing what it carries and comparing in constant time. Follower webhooks have
 * no secret: nothing outside the server can post through them.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { count, eq, inArray } from 'drizzle-orm';
import { WEBHOOKS_PER_CHANNEL, type MessageAuthorOverride, type Webhook } from '@enbox/shared';
import type { DbOrTx, Tx } from '../db/index.js';
import { chats, media, spaces, webhooks } from '../db/schema.js';
import { limitReached } from '../lib/errors.js';
import { loadMediaMap, staticMediaUrl } from './media.js';
import { uniq } from './sql.js';

export type WebhookRow = typeof webhooks.$inferSelect;

/**
 * 409 `limit_reached` when the channel already holds WEBHOOKS_PER_CHANNEL webhooks (follower
 * webhooks count too). Call with the channel row locked, so concurrent adds can't both pass.
 */
export async function assertWebhookRoom(dbx: DbOrTx, chatId: string): Promise<void> {
  const [n] = await dbx.select({ n: count() }).from(webhooks).where(eq(webhooks.channelId, chatId));
  if (Number(n?.n ?? 0) >= WEBHOOKS_PER_CHANNEL)
    throw limitReached(`A channel can have at most ${WEBHOOKS_PER_CHANNEL} webhooks`);
}

/** A URL secret: 32 random bytes, base64url. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** A new URL secret (store `hashWebhookToken(token)`, hand the token out once). */
export function newWebhookToken(): string {
  return randomBytes(32).toString('base64url');
}

/** What `token_hash` holds for a secret (hex sha256). */
export function hashWebhookToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** The hash of no secret at all: compared against when there is nothing to compare with. */
const NO_HASH = Buffer.alloc(32);

/**
 * Whether `token` is the secret of this incoming webhook, in constant time (the hash is
 * computed and compared even for a malformed token or a webhook without a secret).
 */
export function webhookTokenMatches(
  row: Pick<WebhookRow, 'kind' | 'tokenHash'> | null,
  token: string,
): boolean {
  const given = createHash('sha256').update(token).digest();
  const stored = row?.tokenHash ? Buffer.from(row.tokenHash, 'hex') : NO_HASH;
  const equal = stored.length === given.length && timingSafeEqual(stored, given);
  return equal && !!row?.tokenHash && row.kind === 'incoming' && TOKEN_PATTERN.test(token);
}

/** The URL that executes the webhook (`POST`), under the app's public origin. */
export function webhookUrl(origin: string, webhookId: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}/api/webhooks/${webhookId}/${token}`;
}

/** An incoming webhook by id, when `token` is its secret (else null: unknown or wrong). */
export async function findWebhookByToken(
  dbx: DbOrTx,
  webhookId: string,
  token: string,
): Promise<WebhookRow | null> {
  const [row] = await dbx.select().from(webhooks).where(eq(webhooks.id, webhookId)).limit(1);
  return webhookTokenMatches(row ?? null, token) ? row! : null;
}

/** A webhook's avatar as served (the static image; null without one). */
export async function webhookAvatarUrl(
  dbx: DbOrTx,
  row: Pick<WebhookRow, 'avatarMediaId'>,
): Promise<string | null> {
  if (!row.avatarMediaId) return null;
  const [m] = await dbx
    .select({
      storageKey: media.storageKey,
      thumbnailKey: media.thumbnailKey,
      animated: media.animated,
    })
    .from(media)
    .where(eq(media.id, row.avatarMediaId))
    .limit(1);
  return m ? staticMediaUrl(m) : null;
}

/** Wire webhooks, in input order: avatars and follower sources in one query each. */
export async function toWebhooks(dbx: DbOrTx, rows: readonly WebhookRow[]): Promise<Webhook[]> {
  if (rows.length === 0) return [];
  const avatars = await loadMediaMap(
    dbx,
    rows.map((r) => r.avatarMediaId),
  );
  const sourceIds = uniq(rows.map((r) => r.sourceChannelId).filter((x): x is string => !!x));
  const sources = new Map(
    (sourceIds.length
      ? await dbx
          .select({ id: chats.id, name: chats.name, spaceId: spaces.id, spaceName: spaces.name })
          .from(chats)
          .innerJoin(spaces, eq(spaces.id, chats.spaceId))
          .where(inArray(chats.id, sourceIds))
      : []
    ).map((s) => [s.id, s]),
  );
  return rows.map((r) => {
    const avatar = r.avatarMediaId ? avatars.get(r.avatarMediaId) : undefined;
    const source = r.sourceChannelId ? sources.get(r.sourceChannelId) : undefined;
    const out: Webhook = {
      id: r.id,
      spaceId: r.spaceId,
      channelId: r.channelId,
      kind: r.kind,
      name: r.name,
      avatarUrl: avatar ? staticMediaUrl(avatar) : null,
      createdBy: r.createdBy,
      createdAt: r.createdAt.toISOString(),
    };
    if (r.kind === 'follower')
      out.sourceChannel = source
        ? {
            id: source.id,
            name: source.name ?? '',
            spaceId: source.spaceId,
            spaceName: source.spaceName,
          }
        : null;
    return out;
  });
}

/** A follower webhook in `channelId` delivering `sourceChannelId`'s published posts. */
export async function insertFollowerWebhook(
  tx: Tx,
  values: {
    spaceId: string;
    channelId: string;
    sourceChannelId: string;
    name: string;
    avatarMediaId: string | null;
    createdBy: string | null;
  },
): Promise<WebhookRow> {
  const [row] = await tx
    .insert(webhooks)
    .values({ ...values, kind: 'follower', tokenHash: null })
    .returning();
  return row!;
}

/** The author a webhook's messages show as (a snapshot: later renames don't rewrite them). */
export function webhookAuthor(
  row: Pick<WebhookRow, 'id' | 'name'>,
  avatarUrl: string | null,
  overrides: { name?: string; avatarUrl?: string | null } = {},
): MessageAuthorOverride {
  return {
    kind: 'webhook',
    name: overrides.name ?? row.name,
    avatarUrl: overrides.avatarUrl !== undefined ? overrides.avatarUrl : avatarUrl,
    webhookId: row.id,
  };
}
