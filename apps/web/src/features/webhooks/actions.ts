/**
 * Webhook management calls (Space Settings ▸ Integrations). The secret URL comes back only
 * from `createWebhook` and `regenerateWebhookUrl`; the server keeps just its hash.
 */
import type {
  CreateWebhookRequest,
  ID,
  UpdateWebhookRequest,
  Webhook,
  WebhookWithUrl,
} from '@enbox/shared';
import { api } from '@/lib/api';

export const listSpaceWebhooks = (spaceId: ID) =>
  api.get<Webhook[]>(`/api/spaces/${spaceId}/webhooks`);

export const createWebhook = (chatId: ID, body: CreateWebhookRequest) =>
  api.post<WebhookWithUrl>(`/api/chats/${chatId}/webhooks`, body);

export const updateWebhook = (webhookId: ID, body: UpdateWebhookRequest) =>
  api.patch<Webhook>(`/api/webhooks/${webhookId}`, body);

export const deleteWebhook = (webhookId: ID) => api.delete(`/api/webhooks/${webhookId}`);

export const regenerateWebhookUrl = (webhookId: ID) =>
  api.post<WebhookWithUrl>(`/api/webhooks/${webhookId}/token`);

/** Friendly names "New Webhook" picks from (the first one not taken yet). */
export const DEFAULT_WEBHOOK_NAMES = [
  'Captain Hook',
  'Beep Boop',
  'Relay Bot',
  'Courier',
  'Signal Bot',
] as const;

export function defaultWebhookName(taken: readonly string[]): string {
  const used = new Set(taken.map((n) => n.toLowerCase()));
  const free = DEFAULT_WEBHOOK_NAMES.find((n) => !used.has(n.toLowerCase()));
  if (free) return free;
  for (let i = 2; ; i++) {
    const name = `${DEFAULT_WEBHOOK_NAMES[0]} ${i}`;
    if (!used.has(name.toLowerCase())) return name;
  }
}
