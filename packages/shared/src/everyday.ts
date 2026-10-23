/**
 * Contracts of the everyday wave (docs/design/discord-parity.md "Remaining gaps" waves 1, 3,
 * 4, 5 and 6): channel mentions, the Space message limit, synced appearance preferences,
 * bookmarks and reminders, and friend invite links. All additive.
 */
import { z } from 'zod';
import type { ID, ISODate, Message, UserPublic } from './models.js';

// ---------------------------------------------------------------------------
// Channel mentions and the Space message limit
// ---------------------------------------------------------------------------

/** `#{<uuid>}` in message text: a link to that channel (shown as "#name" to who can see it). */
export const CHANNEL_MENTION_RE =
  /#\{([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\}/g;

export function channelMentionToken(channelId: ID): string {
  return `#{${channelId}}`;
}

/**
 * Space channels (and their threads): text and captions are capped here, Discord's limit for
 * its paid tier (DMs and groups keep MAX_MESSAGE_LENGTH). Longer text is offered as a .txt
 * upload by the composer. The server answers 400 `validation_error` above it.
 */
export const SPACE_MESSAGE_MAX_LENGTH = 4000;
/** The composer's counter shows from here (Discord: the last 10%). */
export const MESSAGE_COUNTER_FROM = 3600;

// ---------------------------------------------------------------------------
// Synced preferences (appearance and accessibility that follow me across devices)
// ---------------------------------------------------------------------------

/** Serialized size cap of my synced preferences. */
export const PREFERENCES_MAX_BYTES = 16_384;

/**
 * `GET /api/me/preferences`: device preferences I chose to sync (keys are the web client's
 * DevicePrefs names; the server stores them as given). `updatedAt` orders writes from devices.
 */
export interface SyncedPreferences {
  prefs: Record<string, unknown>;
  updatedAt: ISODate | null;
}

/**
 * `PATCH /api/me/preferences`: merge these keys (null deletes one). `me:preferences` carries
 * the whole result to my other devices.
 */
export const preferencesPatchSchema = z
  .record(z.string().min(1).max(64), z.unknown())
  .refine((v) => JSON.stringify(v).length <= PREFERENCES_MAX_BYTES, 'Too many preferences');
export type PreferencesPatch = z.input<typeof preferencesPatchSchema>;

// ---------------------------------------------------------------------------
// Bookmarks and reminders ("Save message" and "Remind me")
// ---------------------------------------------------------------------------

export const MAX_BOOKMARKS = 500;

export interface Bookmark {
  messageId: ID;
  chatId: ID;
  createdAt: ISODate;
  /** Remind me then (null = a plain bookmark). */
  remindAt: ISODate | null;
  /** The reminder fired (kept in the list, marked done). */
  remindedAt: ISODate | null;
  /** The message as I can see it now (null = deleted or no longer visible to me). */
  message: Message | null;
}

/** `PUT /api/messages/:messageId/bookmark`: save it, or change its reminder. */
export const bookmarkSchema = z.object({
  remindAt: z.iso.datetime({ offset: true }).nullable().optional(),
});
export type BookmarkRequest = z.input<typeof bookmarkSchema>;

export const bookmarksQuerySchema = z.object({
  /** `reminders`: only the ones with a reminder (upcoming first, then done). */
  filter: z.enum(['all', 'reminders']).default('all'),
  before: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type BookmarksQuery = z.input<typeof bookmarksQuerySchema>;

export interface BookmarksPage {
  bookmarks: Bookmark[];
  nextCursor: string | null;
  users: UserPublic[];
}

// ---------------------------------------------------------------------------
// Friend invite links
// ---------------------------------------------------------------------------

/** Discord's friend invites: a link that expires after a week or five uses. */
export const FRIEND_INVITE_TTL_DAYS = 7;
export const FRIEND_INVITE_MAX_USES = 5;

export interface FriendInvite {
  code: string;
  createdAt: ISODate;
  expiresAt: ISODate;
  uses: number;
  maxUses: number;
}

/** `GET /api/friend-invites/:code`: whose link it is (404 once expired or used up). */
export interface FriendInvitePreview {
  inviter: UserPublic;
  expiresAt: ISODate;
}

/** `POST /api/friend-invites/:code/accept`: now friends (or already were). */
export interface FriendInviteAccepted {
  status: 'friends' | 'already_friends';
  userId: ID;
}
