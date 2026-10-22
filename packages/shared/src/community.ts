/**
 * Contracts of the community wave (docs/design/discord-parity.md W10-W12): scheduled events,
 * forum channels, AutoMod, Space discovery, the welcome screen and onboarding. All additive.
 * Permission bits are all in use until 64-bit permissions (W4): events need MANAGE_CHANNELS
 * to create (creator or MANAGE_SPACE to edit), AutoMod / discovery / onboarding MANAGE_SPACE,
 * forum posts SEND_MESSAGES.
 */
import { z } from 'zod';
import type { ChatSummary, ID, ISODate, Message, UserPublic } from './models.js';
import { idSchema } from './schemas.js';

// ---------------------------------------------------------------------------
// Scheduled events
// ---------------------------------------------------------------------------

export type SpaceEventEntity = 'voice' | 'external';
export type SpaceEventStatus = 'scheduled' | 'active' | 'completed' | 'canceled';

export const EVENT_NAME_MAX_LENGTH = 100;
export const EVENT_DESCRIPTION_MAX_LENGTH = 1000;
export const EVENT_LOCATION_MAX_LENGTH = 100;
/** Scheduled or active events per Space. */
export const MAX_SPACE_EVENTS = 100;

export interface SpaceEvent {
  id: ID;
  spaceId: ID;
  channelId: ID | null;
  creatorId: ID | null;
  name: string;
  description: string | null;
  entityType: SpaceEventEntity;
  location: string | null;
  startAt: ISODate;
  endAt: ISODate | null;
  status: SpaceEventStatus;
  imageUrl: string | null;
  interestedCount: number;
  /** Viewer-specific: I marked myself interested. */
  interested: boolean;
}

const eventFields = {
  name: z.string().trim().min(1).max(EVENT_NAME_MAX_LENGTH),
  description: z.string().trim().max(EVENT_DESCRIPTION_MAX_LENGTH).nullable(),
  entityType: z.enum(['voice', 'external']),
  /** Voice events: a voice channel of the Space. */
  channelId: idSchema.nullable(),
  /** External events: required. */
  location: z.string().trim().max(EVENT_LOCATION_MAX_LENGTH).nullable(),
  startAt: z.iso.datetime({ offset: true }),
  /** Required for external events; after `startAt`. */
  endAt: z.iso.datetime({ offset: true }).nullable(),
  imageMediaId: idSchema.nullable(),
};
export const createSpaceEventSchema = z.object(eventFields).partial({
  description: true,
  channelId: true,
  location: true,
  endAt: true,
  imageMediaId: true,
});
export const updateSpaceEventSchema = z
  .object({
    ...eventFields,
    /** scheduled → active (start), active → completed (end), scheduled → canceled. */
    status: z.enum(['active', 'completed', 'canceled']),
  })
  .partial();
export type CreateSpaceEventRequest = z.input<typeof createSpaceEventSchema>;
export type UpdateSpaceEventRequest = z.input<typeof updateSpaceEventSchema>;

// ---------------------------------------------------------------------------
// Forum channels (space_forum): posts are threads whose first message is the post
// ---------------------------------------------------------------------------

export const MAX_FORUM_TAGS = 20;
export const FORUM_TAG_NAME_MAX_LENGTH = 20;
export const FORUM_GUIDELINES_MAX_LENGTH = 4096;

export interface ForumTag {
  /** Short client-made id, unique in the forum. */
  id: string;
  name: string;
  emoji: string | null;
  /** Only members with MANAGE_MESSAGES may apply it. */
  moderated: boolean;
}

export interface ForumSettings {
  layout: 'list' | 'gallery';
  defaultSort: 'activity' | 'created';
  /** A post must wear at least one tag. */
  requireTag: boolean;
  /** Reaction offered on every post (unicode or custom token). */
  defaultReaction: string | null;
  /** Shown above the posts (markdown). */
  guidelines: string | null;
}

export const DEFAULT_FORUM_SETTINGS: ForumSettings = Object.freeze({
  layout: 'list',
  defaultSort: 'activity',
  requireTag: false,
  defaultReaction: null,
  guidelines: null,
});

export const forumTagSchema = z.object({
  id: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(FORUM_TAG_NAME_MAX_LENGTH),
  emoji: z.string().trim().max(80).nullable(),
  moderated: z.boolean(),
});
export const forumSettingsSchema = z
  .object({
    layout: z.enum(['list', 'gallery']),
    defaultSort: z.enum(['activity', 'created']),
    requireTag: z.boolean(),
    defaultReaction: z.string().trim().max(80).nullable(),
    guidelines: z.string().trim().max(FORUM_GUIDELINES_MAX_LENGTH).nullable(),
  })
  .partial();
export const forumTagsSchema = z
  .array(forumTagSchema)
  .max(MAX_FORUM_TAGS)
  .refine((tags) => new Set(tags.map((t) => t.id)).size === tags.length, 'Duplicate tag ids');

/** `SpaceChannelInfo.forum` of a forum channel. */
export interface ForumInfo {
  tags: ForumTag[];
  settings: ForumSettings;
}

/** One post in the forum list: the thread and its first message (the post itself). */
export interface ForumPost {
  thread: ChatSummary;
  firstMessage: Message | null;
}

export interface ForumPostsPage {
  posts: ForumPost[];
  nextCursor: string | null;
  users: UserPublic[];
}

export const createForumPostSchema = z.object({
  name: z.string().trim().min(1).max(100),
  /** The post's text (the thread's first message); may be empty with media. */
  text: z.string().max(4000).default(''),
  mediaId: idSchema.optional(),
  appliedTags: z.array(z.string().trim().min(1).max(40)).max(5).default([]),
  clientId: z.string().min(1).max(48),
});
export const forumPostsQuerySchema = z.object({
  sort: z.enum(['activity', 'created']).optional(),
  tag: z.string().trim().max(40).optional(),
  q: z.string().trim().max(100).optional(),
  archived: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  before: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
});
export type CreateForumPostRequest = z.input<typeof createForumPostSchema>;
export type ForumPostsQuery = z.input<typeof forumPostsQuerySchema>;

// ---------------------------------------------------------------------------
// AutoMod
// ---------------------------------------------------------------------------

export type AutoModTriggerType = 'keyword' | 'spam_links' | 'mention_spam' | 'preset';
export type AutoModPreset = 'profanity' | 'sexual' | 'slurs';
export const AUTOMOD_PRESETS: readonly AutoModPreset[] = ['profanity', 'sexual', 'slurs'];
export const MAX_AUTOMOD_RULES = 20;

export interface AutoModTriggerMetadata {
  /** keyword: words or phrases; `*` at either end matches part of a word. */
  keywords?: string[];
  /** keyword: JavaScript-style patterns (no flags; case-insensitive). */
  regexPatterns?: string[];
  /** Never flagged even when a keyword or preset matches. */
  allowList?: string[];
  /** mention_spam: unique user + role mentions allowed in one message. */
  mentionLimit?: number;
  /** preset: built-in word lists. */
  presets?: AutoModPreset[];
}

export type AutoModAction =
  | { type: 'block'; customMessage?: string | null }
  | { type: 'alert'; channelId: ID }
  | { type: 'timeout'; durationSeconds: number };

export interface AutoModRule {
  id: ID;
  spaceId: ID;
  name: string;
  triggerType: AutoModTriggerType;
  triggerMetadata: AutoModTriggerMetadata;
  actions: AutoModAction[];
  enabled: boolean;
  exemptRoleIds: ID[];
  exemptChannelIds: ID[];
  creatorId: ID | null;
  createdAt: ISODate;
}

const triggerMetadataSchema = z.object({
  keywords: z.array(z.string().trim().min(1).max(60)).max(1000).optional(),
  regexPatterns: z.array(z.string().min(1).max(260)).max(10).optional(),
  allowList: z.array(z.string().trim().min(1).max(60)).max(100).optional(),
  mentionLimit: z.number().int().min(1).max(50).optional(),
  presets: z.array(z.enum(['profanity', 'sexual', 'slurs'])).max(3).optional(),
});
const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('block'), customMessage: z.string().trim().max(150).nullable().optional() }),
  z.object({ type: z.literal('alert'), channelId: idSchema }),
  z.object({ type: z.literal('timeout'), durationSeconds: z.number().int().min(60).max(28 * 86400) }),
]);
export const createAutoModRuleSchema = z.object({
  name: z.string().trim().min(1).max(100),
  triggerType: z.enum(['keyword', 'spam_links', 'mention_spam', 'preset']),
  triggerMetadata: triggerMetadataSchema.default({}),
  actions: z.array(actionSchema).min(1).max(3),
  enabled: z.boolean().default(true),
  exemptRoleIds: z.array(idSchema).max(20).default([]),
  exemptChannelIds: z.array(idSchema).max(50).default([]),
});
export const updateAutoModRuleSchema = createAutoModRuleSchema.omit({ triggerType: true }).partial();
export type CreateAutoModRuleRequest = z.input<typeof createAutoModRuleSchema>;
export type UpdateAutoModRuleRequest = z.input<typeof updateAutoModRuleSchema>;

/** The 403 code of a send AutoMod blocked (the message is not created). */
export const AUTOMOD_BLOCKED_CODE = 'automod_blocked';

// ---------------------------------------------------------------------------
// Discovery, welcome screen, onboarding
// ---------------------------------------------------------------------------

export const DISCOVERY_CATEGORIES = [
  { id: 'gaming', name: 'Gaming' },
  { id: 'music', name: 'Music' },
  { id: 'entertainment', name: 'Entertainment' },
  { id: 'education', name: 'Education' },
  { id: 'science', name: 'Science & Tech' },
  { id: 'art', name: 'Art & Creativity' },
  { id: 'community', name: 'Community' },
  { id: 'sports', name: 'Sports & Fitness' },
  { id: 'other', name: 'Other' },
] as const;
export type DiscoveryCategory = (typeof DISCOVERY_CATEGORIES)[number]['id'];
export const DISCOVERY_PAGE_SIZE = 24;
export const MAX_DISCOVERY_TAGS = 5;

export interface DiscoverableSpace {
  id: ID;
  name: string;
  description: string | null;
  iconUrl: string | null;
  bannerUrl: string | null;
  memberCount: number;
  category: DiscoveryCategory | null;
  tags: string[];
  /** I am already a member. */
  joined: boolean;
}

export interface DiscoveryPage {
  spaces: DiscoverableSpace[];
  total: number;
}

export const discoveryQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.enum(DISCOVERY_CATEGORIES.map((c) => c.id) as [DiscoveryCategory, ...DiscoveryCategory[]]).optional(),
  offset: z.coerce.number().int().min(0).max(1000).default(0),
});
export type DiscoveryQuery = z.input<typeof discoveryQuerySchema>;

export interface WelcomeScreen {
  enabled: boolean;
  description: string | null;
  /** Up to 5 recommended channels. */
  channels: { channelId: ID; description: string; emoji: string | null }[];
}

export const welcomeScreenSchema = z.object({
  enabled: z.boolean(),
  description: z.string().trim().max(140).nullable(),
  channels: z
    .array(
      z.object({
        channelId: idSchema,
        description: z.string().trim().min(1).max(50),
        emoji: z.string().trim().max(80).nullable(),
      }),
    )
    .max(5),
});

export interface OnboardingOption {
  id: string;
  title: string;
  description: string | null;
  emoji: string | null;
  /** Roles a member gets for picking it. */
  roleIds: ID[];
}

export interface OnboardingPrompt {
  id: string;
  title: string;
  singleSelect: boolean;
  required: boolean;
  options: OnboardingOption[];
}

export interface SpaceOnboarding {
  enabled: boolean;
  prompts: OnboardingPrompt[];
}

export const onboardingSchema = z.object({
  enabled: z.boolean(),
  prompts: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(40),
        title: z.string().trim().min(1).max(100),
        singleSelect: z.boolean(),
        required: z.boolean(),
        options: z
          .array(
            z.object({
              id: z.string().trim().min(1).max(40),
              title: z.string().trim().min(1).max(50),
              description: z.string().trim().max(100).nullable(),
              emoji: z.string().trim().max(80).nullable(),
              roleIds: z.array(idSchema).max(10),
            }),
          )
          .min(1)
          .max(20),
      }),
    )
    .max(15),
});
export const onboardingAnswersSchema = z.object({
  /** Picked option ids across all prompts. */
  optionIds: z.array(z.string().trim().min(1).max(40)).max(100),
});
export type OnboardingAnswersRequest = z.input<typeof onboardingAnswersSchema>;

/** `PATCH /api/spaces/:spaceId/community`: discovery listing, welcome screen, onboarding. */
export const updateSpaceCommunitySchema = z
  .object({
    isDiscoverable: z.boolean(),
    discoveryCategory: z
      .enum(DISCOVERY_CATEGORIES.map((c) => c.id) as [DiscoveryCategory, ...DiscoveryCategory[]])
      .nullable(),
    discoveryTags: z.array(z.string().trim().toLowerCase().min(1).max(24)).max(MAX_DISCOVERY_TAGS),
    /** Lowercase letters, digits and dashes (3-32), unique across invite codes. */
    vanityCode: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9-]{3,32}$/, 'Use 3-32 letters, digits or dashes')
      .nullable(),
    welcomeScreen: welcomeScreenSchema.nullable(),
    onboarding: onboardingSchema.nullable(),
  })
  .partial();
export type UpdateSpaceCommunityRequest = z.input<typeof updateSpaceCommunitySchema>;

/** `GET /api/spaces/:spaceId/community`: the settings above (members read; MANAGE_SPACE edits). */
export interface SpaceCommunity {
  isDiscoverable: boolean;
  discoveryCategory: DiscoveryCategory | null;
  discoveryTags: string[];
  vanityCode: string | null;
  welcomeScreen: WelcomeScreen | null;
  onboarding: SpaceOnboarding | null;
}

