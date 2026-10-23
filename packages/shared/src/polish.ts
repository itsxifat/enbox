/**
 * Contracts of the polish wave (docs/design/discord-parity.md W6-C super reactions, W5-B polls,
 * W5-D composer and forwarding, W16 accessibility, W3-D server tags, W10-B forum post actions
 * and media channels). All additive: old clients keep working with the fields they know.
 */
import { z } from 'zod';
import type { ChatSummary, ID, ISODate } from './models.js';
import { idSchema } from './schemas.js';

// ---------------------------------------------------------------------------
// Super reactions
// ---------------------------------------------------------------------------

/**
 * `?burst=true` on `PUT|DELETE /api/messages/:messageId/reactions/:emoji/@me`,
 * `DELETE …/:emoji/:userId` and `GET …/:emoji` (reactor list): the super reaction of that
 * emoji instead of the normal one. A user may hold both kinds of the same emoji. Distinct
 * emoji (either kind) count toward MAX_UNIQUE_REACTIONS; clearing an emoji clears both kinds.
 */
export const reactionKindQuerySchema = z.object({
  burst: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});
export type ReactionKindQuery = z.input<typeof reactionKindQuerySchema>;

// ---------------------------------------------------------------------------
// Polls (Discord's: a duration, End Poll Now, a result message)
// ---------------------------------------------------------------------------

// POLL_DURATIONS_HOURS and DEFAULT_POLL_DURATION_HOURS live in constants.ts (schemas use them).

/** One winning answer of an ended poll (ties: several). */
export interface PollResultWinner {
  optionId: string;
  text: string;
  emoji: string | null;
  votes: number;
}

// ---------------------------------------------------------------------------
// Forwarding: where it came from, and an optional message
// ---------------------------------------------------------------------------

/**
 * `Message.forwardedFrom`: the original of a forwarded copy (ids and its time only: clients
 * show the channel and Space names only when they already know that chat, and the jump link
 * only works for people who can see it).
 */
export interface ForwardSource {
  chatId: ID;
  messageId: ID;
  /** The original's Space (null for DMs and groups). */
  spaceId: ID | null;
  createdAt: ISODate;
}

// `ForwardRequest.comment` (≤ FORWARD_COMMENT_MAX_LENGTH, constants.ts) is sent as a normal
// text message after the copies, in each chat.

// ---------------------------------------------------------------------------
// Server tags (a short tag a member wears next to their name, from a Space they're in)
// ---------------------------------------------------------------------------

/** Badge icons a tag can wear (the web maps each id to an icon). */
export const SPACE_TAG_BADGES = [
  'leaf',
  'flame',
  'heart',
  'star',
  'moon',
  'sun',
  'bolt',
  'skull',
  'crown',
  'sword',
  'shield',
  'gem',
  'music',
  'gamepad',
  'paw',
  'flower',
  'ghost',
  'rocket',
  'wave',
  'book',
  'coffee',
  'cat',
  'dice',
  'bug',
] as const;
export type SpaceTagBadge = (typeof SPACE_TAG_BADGES)[number];

/** 2-4 letters or digits (any script). */
export const SPACE_TAG_RE = /^[\p{L}\p{N}]{2,4}$/u;

/** `Space.tag`: the Space's tag (null = none). */
export interface SpaceTag {
  tag: string;
  badge: SpaceTagBadge;
  /** Lowercase `#rrggbb`: the badge's colour. */
  color: string;
}

/** `UserPublic.spaceTag`: the tag the user wears (they must still be a member of that Space). */
export interface UserSpaceTag extends SpaceTag {
  spaceId: ID;
}

/** `PUT /api/spaces/:spaceId/tag` (MANAGE_SPACE): set or change the tag (space:updated). */
export const spaceTagSchema = z.object({
  tag: z.string().trim().regex(SPACE_TAG_RE, 'Use 2 to 4 letters or numbers'),
  badge: z.enum(SPACE_TAG_BADGES),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Use a #rrggbb colour')
    .transform((s) => s.toLowerCase()),
});
export type SpaceTagRequest = z.input<typeof spaceTagSchema>;

/**
 * `PUT /api/me/space-tag`: wear the tag of a Space I'm in (null = none). Leaving the Space, or
 * the Space removing its tag, takes it off. My devices and everyone get `user:changed`.
 */
export const adoptSpaceTagSchema = z.object({ spaceId: idSchema.nullable() });
export type AdoptSpaceTagRequest = z.input<typeof adoptSpaceTagSchema>;

// ---------------------------------------------------------------------------
// Forum posts: follow, pin; media channels
// ---------------------------------------------------------------------------

/**
 * `GET /api/spaces/:spaceId/followed-threads`: the posts and threads I follow there (open
 * ones first, newest activity first; up to 100). Creating a post or replying in one follows it.
 */
export interface FollowedThreads {
  threads: ChatSummary[];
}

/** `thread:follow` (my devices): I followed or unfollowed a post or thread. */
export interface ThreadFollowEvent {
  threadId: ID;
  parentId: ID;
  spaceId: ID;
  following: boolean;
}
