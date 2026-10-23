/**
 * Contracts of the integrations wave (docs/design/discord-parity.md W10-E, W10-F, W12-F, W6-E,
 * W8): webhooks and rich embeds, announcement channels (Publish and Follow), Space templates,
 * message flags, the image proxy and voice channel status. All additive: a webhook or crosspost
 * message has no sender user (`senderId` null) and carries `Message.authorOverride`.
 */
import { z } from 'zod';
import type { ID, ISODate, SpaceChannelType } from './models.js';
import { idSchema } from './schemas.js';

// ---------------------------------------------------------------------------
// Message flags and author overrides
// ---------------------------------------------------------------------------

/** `Message.flags` bits. */
export const MESSAGE_FLAGS = {
  /** Published to the followers of its announcement channel. */
  CROSSPOSTED: 1 << 0,
  /** A copy delivered from a followed announcement channel. */
  IS_CROSSPOST: 1 << 1,
  /** No link previews or players (the author removed them, or lacked EMBED_LINKS). */
  SUPPRESS_EMBEDS: 1 << 2,
  /** Sent with /tts: read aloud to whoever has text-to-speech on. */
  TTS: 1 << 3,
  /** Sent with @silent: no push or desktop notification (unreads and mentions still count). */
  SILENT: 1 << 4,
} as const;

export function hasMessageFlag(flags: number | undefined, flag: number): boolean {
  return ((flags ?? 0) & flag) === flag;
}

/** Who a message shows as when no user sent it: a webhook, or a followed channel's crosspost. */
export interface MessageAuthorOverride {
  kind: 'webhook' | 'crosspost';
  name: string;
  avatarUrl: string | null;
  /** The webhook that posted it (follower webhooks for crossposts); null once deleted. */
  webhookId: ID | null;
  /** Crossposts: where the original lives ("#channel • Space", Go to original). */
  source?: {
    spaceId: ID;
    spaceName: string;
    channelId: ID;
    channelName: string;
    messageId: ID;
  } | null;
}

// ---------------------------------------------------------------------------
// Rich embeds (Discord-compatible limits)
// ---------------------------------------------------------------------------

export const EMBED_LIMITS = {
  perMessage: 10,
  title: 256,
  description: 4096,
  fields: 25,
  fieldName: 256,
  fieldValue: 1024,
  footer: 2048,
  author: 256,
  /** All text of all embeds of a message. */
  total: 6000,
} as const;

export interface EmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

/** A rich embed as stored and sent to clients (camelCase; image URLs are https). */
export interface MessageEmbed {
  title?: string | null;
  description?: string | null;
  url?: string | null;
  /** 0xRRGGBB. */
  color?: number | null;
  timestamp?: ISODate | null;
  author?: { name: string; url?: string | null; iconUrl?: string | null } | null;
  footer?: { text: string; iconUrl?: string | null } | null;
  image?: { url: string } | null;
  thumbnail?: { url: string } | null;
  fields?: EmbedField[];
}

const httpsUrl = z
  .string()
  .trim()
  .max(2048)
  .regex(/^https:\/\//i, 'Must be an https URL');

/** An embed in a webhook body (Discord's snake_case shape). */
export const embedInputSchema = z.object({
  title: z.string().max(EMBED_LIMITS.title).optional(),
  description: z.string().max(EMBED_LIMITS.description).optional(),
  url: httpsUrl.optional(),
  color: z.number().int().min(0).max(0xffffff).optional(),
  timestamp: z.iso.datetime({ offset: true }).optional(),
  author: z
    .object({
      name: z.string().min(1).max(EMBED_LIMITS.author),
      url: httpsUrl.optional(),
      icon_url: httpsUrl.optional(),
    })
    .optional(),
  footer: z
    .object({ text: z.string().min(1).max(EMBED_LIMITS.footer), icon_url: httpsUrl.optional() })
    .optional(),
  image: z.object({ url: httpsUrl }).optional(),
  thumbnail: z.object({ url: httpsUrl }).optional(),
  fields: z
    .array(
      z.object({
        name: z.string().min(1).max(EMBED_LIMITS.fieldName),
        value: z.string().min(1).max(EMBED_LIMITS.fieldValue),
        inline: z.boolean().optional(),
      }),
    )
    .max(EMBED_LIMITS.fields)
    .optional(),
});
export type EmbedInput = z.input<typeof embedInputSchema>;

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

export const WEBHOOKS_PER_CHANNEL = 15;
export const WEBHOOK_NAME_MAX_LENGTH = 80;

export type WebhookKind = 'incoming' | 'follower';

export interface Webhook {
  id: ID;
  spaceId: ID;
  channelId: ID;
  kind: WebhookKind;
  name: string;
  avatarUrl: string | null;
  createdBy: ID | null;
  createdAt: ISODate;
  /** Follower webhooks: the announcement channel they deliver from. */
  sourceChannel?: { id: ID; name: string; spaceId: ID; spaceName: string } | null;
}

/** Create and regenerate answers: the secret URL, shown once (only its hash is stored). */
export interface WebhookWithUrl extends Webhook {
  url: string;
}

export const createWebhookSchema = z.object({
  name: z.string().trim().min(1).max(WEBHOOK_NAME_MAX_LENGTH),
  avatarMediaId: idSchema.nullable().optional(),
});
export const updateWebhookSchema = z.object({
  name: z.string().trim().min(1).max(WEBHOOK_NAME_MAX_LENGTH).optional(),
  avatarMediaId: idSchema.nullable().optional(),
  /** Move it to another text channel of the same Space. */
  channelId: idSchema.optional(),
});
export type CreateWebhookRequest = z.input<typeof createWebhookSchema>;
export type UpdateWebhookRequest = z.input<typeof updateWebhookSchema>;

/** `POST /api/webhooks/:webhookId/:token` (public): a Discord-compatible body. */
export const executeWebhookSchema = z
  .object({
    content: z.string().max(2000).optional(),
    username: z.string().trim().min(1).max(WEBHOOK_NAME_MAX_LENGTH).optional(),
    avatar_url: httpsUrl.optional(),
    tts: z.boolean().optional(),
    embeds: z.array(embedInputSchema).max(EMBED_LIMITS.perMessage).optional(),
    allowed_mentions: z
      .object({
        parse: z.array(z.enum(['users', 'roles', 'everyone'])).optional(),
        users: z.array(idSchema).max(100).optional(),
        roles: z.array(idSchema).max(100).optional(),
      })
      .optional(),
  })
  .refine((b) => !!b.content?.trim() || (b.embeds?.length ?? 0) > 0, {
    message: 'Send content or at least one embed',
  });
export const executeWebhookQuerySchema = z.object({
  /** `true`: answer 200 with the message (else 204). */
  wait: z.enum(['true', 'false']).optional(),
});
export const editWebhookMessageSchema = z.object({
  content: z.string().max(2000).optional(),
  embeds: z.array(embedInputSchema).max(EMBED_LIMITS.perMessage).optional(),
});
export type ExecuteWebhookBody = z.input<typeof executeWebhookSchema>;

// ---------------------------------------------------------------------------
// Announcement channels: Publish and Follow
// ---------------------------------------------------------------------------

/** Publishes per announcement channel per hour (Discord: 10). */
export const PUBLISH_LIMIT_PER_HOUR = 10;

export interface ChannelFollow {
  id: ID;
  sourceChannel: {
    id: ID;
    name: string;
    spaceId: ID;
    spaceName: string;
    spaceIconUrl: string | null;
  };
  targetChannel: { id: ID; name: string; spaceId: ID };
  webhookId: ID | null;
  createdBy: ID | null;
  createdAt: ISODate;
}

/** `POST /api/chats/:chatId/followers`: deliver this announcement channel's posts there. */
export const followChannelSchema = z.object({ targetChannelId: idSchema });
export type FollowChannelRequest = z.input<typeof followChannelSchema>;

// ---------------------------------------------------------------------------
// Space templates
// ---------------------------------------------------------------------------

/** Role/channel references inside a snapshot are indexes into its own arrays. */
export interface TemplateRole {
  name: string;
  /** The @everyone role (index 0). */
  isDefault: boolean;
  color: string | null;
  permissions: number;
  hoist: boolean;
  mentionable: boolean;
}

export interface TemplateOverwrite {
  /** Index into `roles`. */
  role: number;
  allow: number;
  deny: number;
}

export interface TemplateChannel {
  type: Exclude<SpaceChannelType, 'space_thread'>;
  name: string;
  topic: string | null;
  /** Index into `categories`, or null at the top. */
  category: number | null;
  nsfw: boolean;
  slowmodeSeconds: number;
  userLimit: number | null;
  isNews: boolean;
  overwrites: TemplateOverwrite[];
}

export interface TemplateCategory {
  name: string;
  overwrites: TemplateOverwrite[];
}

export interface SpaceTemplateSnapshot {
  roles: TemplateRole[];
  categories: TemplateCategory[];
  /** In sidebar order within each category. */
  channels: TemplateChannel[];
  /** Index into `channels` of the system channel (welcome messages), or null. */
  systemChannel: number | null;
  /** Index into `channels` of the AFK voice channel, or null. */
  afkChannel: number | null;
}

export interface SpaceTemplate {
  code: string;
  name: string;
  description: string | null;
  sourceSpaceId: ID | null;
  creatorId: ID | null;
  usageCount: number;
  createdAt: ISODate;
  updatedAt: ISODate;
  /** The source Space changed since the last sync. */
  isDirty: boolean;
  snapshot: SpaceTemplateSnapshot;
}

/** The built-in "Create Your Space" choices (their snapshots live in starterTemplates.ts). */
export const STARTER_TEMPLATE_IDS = [
  'gaming',
  'school-club',
  'study-group',
  'friends',
  'artists',
  'local-community',
] as const;
export type StarterTemplateId = (typeof STARTER_TEMPLATE_IDS)[number];

export const createTemplateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(120).nullable().optional(),
});
export const updateTemplateSchema = createTemplateSchema.partial();
export type CreateTemplateRequest = z.input<typeof createTemplateSchema>;
export type UpdateTemplateRequest = z.input<typeof updateTemplateSchema>;

// ---------------------------------------------------------------------------
// Voice channel status (Discord: "Set a channel status")
// ---------------------------------------------------------------------------

export const VOICE_STATUS_MAX_LENGTH = 500;
export const voiceStatusSchema = z.object({
  /** null or empty clears it. Cleared when the channel empties. */
  status: z.string().trim().max(VOICE_STATUS_MAX_LENGTH).nullable(),
});
export type VoiceStatusRequest = z.input<typeof voiceStatusSchema>;
