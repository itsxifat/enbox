/**
 * Contracts of the expressions, social and navigation wave (docs/design/discord-parity.md
 * W5-C, W6-A/B, W7-A, W10, search): Discord-style reactions, custom Space emoji, friend
 * requests, the Inbox, threads and message search. Wire changes are additive; the old
 * single-reaction route and `Message.myReaction` stay for the Android app.
 */
import { z } from 'zod';
import type { ChatSummary, ID, ISODate, Message, MessageSearchResult, UserPublic } from './models.js';
import { emojiSchema, idSchema } from './schemas.js';

// ---------------------------------------------------------------------------
// Reactions (many per user, one per emoji)
// ---------------------------------------------------------------------------

/** Distinct emoji on one message. */
export const MAX_UNIQUE_REACTIONS = 20;
/** Page size of a reactor list. */
export const REACTORS_PAGE_LIMIT = 100;

export interface ReactionEvent {
  chatId: ID;
  messageId: ID;
  /** Unicode emoji or a custom emoji token (`<:name:id>`). */
  emoji: string;
  emojiId: ID | null;
  userId: ID;
  /** A super reaction (absent = a normal one). */
  burst?: boolean;
}

export const reactorsQuerySchema = z.object({
  /** Keyset cursor: the last user id of the previous page. */
  after: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(REACTORS_PAGE_LIMIT).default(REACTORS_PAGE_LIMIT),
});
export type ReactorsQuery = z.input<typeof reactorsQuerySchema>;

// ---------------------------------------------------------------------------
// Custom emoji
// ---------------------------------------------------------------------------

/** Free for every Space (no boost tiers). */
export const SPACE_EMOJI_LIMIT = 250;
/** Upload cap of one emoji image. */
export const MAX_EMOJI_BYTES = 512 * 1024;
export const CUSTOM_EMOJI_NAME_REGEX = /^[A-Za-z0-9_]{2,32}$/;
/** `<:name:id>` or `<a:name:id>` (animated) anywhere in a text. */
export const CUSTOM_EMOJI_TOKEN_RE =
  /<(a?):([A-Za-z0-9_]{2,32}):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})>/g;

export interface SpaceEmoji {
  id: ID;
  spaceId: ID;
  name: string;
  /** The image (`GET /api/emojis/:emojiId` redirects to it as well). */
  url: string;
  animated: boolean;
  createdBy: ID | null;
}

/** The picker's groups: every Space I am in that has emoji. */
export interface SpaceEmojiGroup {
  spaceId: ID;
  spaceName: string;
  iconUrl: string | null;
  emojis: SpaceEmoji[];
}

export interface CustomEmojiRef {
  id: ID;
  name: string;
  animated: boolean;
}

/** Parse one token (`<:name:id>`), or null. */
export function parseCustomEmoji(token: string): CustomEmojiRef | null {
  const m = /^<(a?):([A-Za-z0-9_]{2,32}):([0-9a-f-]{36})>$/.exec(token);
  return m ? { animated: m[1] === 'a', name: m[2]!, id: m[3]! } : null;
}

export function customEmojiToken(e: CustomEmojiRef): string {
  return `<${e.animated ? 'a' : ''}:${e.name}:${e.id}>`;
}

export const customEmojiTokenSchema = z
  .string()
  .max(80)
  .refine((s) => parseCustomEmoji(s) !== null, 'Must be a custom emoji');

/** A reaction: a unicode emoji or a custom emoji token. */
export const reactionEmojiSchema = z.union([emojiSchema, customEmojiTokenSchema]);

export const createSpaceEmojiSchema = z.object({
  name: z.string().trim().regex(CUSTOM_EMOJI_NAME_REGEX, 'Use 2-32 letters, digits or _'),
  /** An image I uploaded (PNG, JPEG, WebP or GIF, ≤ MAX_EMOJI_BYTES). */
  mediaId: idSchema,
});
export const updateSpaceEmojiSchema = z.object({
  name: z.string().trim().regex(CUSTOM_EMOJI_NAME_REGEX, 'Use 2-32 letters, digits or _'),
});
export type CreateSpaceEmojiRequest = z.input<typeof createSpaceEmojiSchema>;
export type UpdateSpaceEmojiRequest = z.input<typeof updateSpaceEmojiSchema>;

// ---------------------------------------------------------------------------
// Friends (accepting makes both users each other's contacts)
// ---------------------------------------------------------------------------

export interface FriendRequest {
  user: UserPublic;
  direction: 'incoming' | 'outgoing';
  createdAt: ISODate;
}

export interface FriendRequests {
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
}

export const MAX_PENDING_FRIEND_REQUESTS = 1000;

export const sendFriendRequestSchema = z
  .object({ username: z.string().trim().min(1).max(64).optional(), userId: idSchema.optional() })
  .refine((v) => !!v.username !== !!v.userId, 'Give a username or a user id');
export type SendFriendRequest = z.input<typeof sendFriendRequestSchema>;

/** `sent`: a new request; `accepted`: they had asked me first, so we are friends now. */
export interface SendFriendRequestResult {
  status: 'sent' | 'accepted';
}

// ---------------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------------

export interface InboxMention {
  message: Message;
  chat: Pick<ChatSummary, 'id' | 'type' | 'name'> & {
    spaceId: ID | null;
    spaceName: string | null;
    spaceIconUrl: string | null;
    /** Threads: the channel they belong to. */
    parentName: string | null;
  };
}

export interface InboxMentionsPage {
  items: InboxMention[];
  /** Pass as `before` for the next page; null at the end. */
  nextCursor: string | null;
  users: UserPublic[];
}

export const inboxMentionsQuerySchema = z.object({
  before: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
  spaceId: idSchema.optional(),
  /** Include @everyone/@here and role mentions (default true). */
  everyone: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v !== 'false'),
  roles: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v !== 'false'),
});
export type InboxMentionsQuery = z.input<typeof inboxMentionsQuerySchema>;

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

export const THREAD_AUTO_ARCHIVE_MINUTES = [60, 1440, 4320, 10080] as const;
export const THREAD_NAME_MAX_LENGTH = 100;

/** `ChatSummary.thread` of a `space_thread`. */
export interface ThreadInfo {
  parentId: ID;
  starterMessageId: ID | null;
  ownerId: ID | null;
  archived: boolean;
  locked: boolean;
  autoArchiveMinutes: number;
  messageCount: number;
  /** Forum posts: the forum tag ids it wears. */
  appliedTags?: string[];
  /** Forum posts: pinned to the top of its forum (one per forum). */
  pinned?: boolean;
  /** I follow it (sidebar, notifications). Viewer-specific. */
  following?: boolean;
}

/** `Message.thread` of a thread's starter message (the parent channel shows it). */
export interface MessageThreadRef {
  id: ID;
  name: string;
  messageCount: number;
  lastMessageAt: ISODate | null;
  archived: boolean;
}

const autoArchiveMinutes = z
  .number()
  .int()
  .refine(
    (v) => (THREAD_AUTO_ARCHIVE_MINUTES as readonly number[]).includes(v),
    'Use 60, 1440, 4320 or 10080 minutes',
  );

export const createThreadSchema = z.object({
  name: z.string().trim().min(1).max(THREAD_NAME_MAX_LENGTH),
  /** Start it from this message of the channel (one thread per message). */
  messageId: idSchema.optional(),
  autoArchiveMinutes: autoArchiveMinutes.optional(),
});
export const updateThreadSchema = z
  .object({
    name: z.string().trim().min(1).max(THREAD_NAME_MAX_LENGTH),
    archived: z.boolean(),
    locked: z.boolean(),
    autoArchiveMinutes,
    /** Forum posts (the author or MANAGE_MESSAGES; moderated tags need MANAGE_MESSAGES). */
    appliedTags: z.array(z.string().trim().min(1).max(40)).max(5),
    /** Forum posts (MANAGE_THREADS or MANAGE_MESSAGES): pinning one unpins the forum's other. */
    pinned: z.boolean(),
  })
  .partial();
export const threadsQuerySchema = z.object({
  archived: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  before: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
});
export type CreateThreadRequest = z.input<typeof createThreadSchema>;
export type UpdateThreadRequest = z.input<typeof updateThreadSchema>;
export type ThreadsQuery = z.input<typeof threadsQuerySchema>;

export interface ThreadsPage {
  threads: ChatSummary[];
  nextCursor: string | null;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export const SEARCH_HAS = ['link', 'file', 'image', 'video', 'sound', 'poll'] as const;
export type SearchHas = (typeof SEARCH_HAS)[number];
export const SEARCH_PAGE_SIZE = 25;

export const messageSearchSchema = z.object({
  /** Words to look for (may be empty when filters are given). */
  q: z.string().trim().max(200).optional(),
  authorId: idSchema.optional(),
  /** In a Space: one of its channels (or threads). */
  channelId: idSchema.optional(),
  mentions: idSchema.optional(),
  has: z
    .union([z.enum(SEARCH_HAS), z.array(z.enum(SEARCH_HAS)).max(SEARCH_HAS.length)])
    .optional()
    .transform((v) => (v === undefined ? [] : Array.isArray(v) ? v : [v])),
  before: z.iso.datetime({ offset: true }).optional(),
  after: z.iso.datetime({ offset: true }).optional(),
  pinned: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  sort: z.enum(['newest', 'oldest']).default('newest'),
  offset: z.coerce.number().int().min(0).max(5000).default(0),
});
export type MessageSearchQuery = z.input<typeof messageSearchSchema>;

export interface MessageSearchPage {
  /** Matches overall (capped; `capped` when there are more). */
  total: number;
  capped: boolean;
  items: MessageSearchResult[];
  users: UserPublic[];
}

/** Upper bound of `total` (counting beyond it is not worth the query). */
export const SEARCH_TOTAL_CAP = 5000;
