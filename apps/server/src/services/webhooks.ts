/**
 * Webhook rows shared by the webhooks module (incoming webhooks) and announcement channels
 * (follower webhooks that deliver crossposts). The webhooks builder owns this file.
 */
import type { MessageAuthorOverride } from '@enbox/shared';
import type { Tx } from '../db/index.js';
import { webhooks } from '../db/schema.js';

export type WebhookRow = typeof webhooks.$inferSelect;

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
