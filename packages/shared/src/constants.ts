/**
 * Product limits and tunables shared by server and clients.
 * Keep these in one place so the UI can explain limits the server enforces.
 */

export const APP_NAME = 'Enbox';

/** Usernames: 3–32 chars, lowercase letters, digits, underscore and dot. */
export const USERNAME_REGEX = /^[a-z0-9_.]{3,32}$/;
export const PASSWORD_MIN_LENGTH = 8;
export const DISPLAY_NAME_MAX_LENGTH = 64;
export const ABOUT_MAX_LENGTH = 140;
export const DEFAULT_ABOUT = 'Hey there! I am using Enbox.';

export const MAX_MESSAGE_LENGTH = 65_536;
export const MAX_CAPTION_LENGTH = 4_096;
export const MAX_GROUP_NAME_LENGTH = 100;
export const MAX_DESCRIPTION_LENGTH = 2_048;

/** Groups (and community announcement groups) can hold at most this many members. */
export const MAX_GROUP_MEMBERS = 1_024;
/** Communities can link at most this many groups (plus the announcement group). */
export const MAX_COMMUNITY_GROUPS = 100;
/** Group/1:1 calls use a full-mesh WebRTC topology, which caps participants. */
export const MAX_CALL_PARTICIPANTS = 8;
/** How long an unanswered call rings before it is marked missed. */
export const CALL_RING_TIMEOUT_MS = 45_000;

/** A sender may edit a message within this window. */
export const EDIT_WINDOW_MS = 15 * 60 * 1000;
/** A sender may delete a message for everyone within this window (admins can always delete in groups). */
export const DELETE_FOR_EVERYONE_WINDOW_MS = 60 * 60 * 60 * 1000;
/** Messages forwarded this many times or more are labelled "Forwarded many times". */
export const FORWARDED_MANY_TIMES_THRESHOLD = 5;
/** Max chats a message can be forwarded to in one action. */
export const MAX_FORWARD_TARGETS = 5;

export const MAX_PINNED_CHATS = 3;
export const MAX_PINNED_MESSAGES = 3;

/** Status updates (stories) disappear after 24h. */
export const STATUS_TTL_MS = 24 * 60 * 60 * 1000;
export const STATUS_TEXT_MAX_LENGTH = 700;
export const STATUS_BACKGROUND_COLORS = [
  '#6D5DFC',
  '#0EA5E9',
  '#10B981',
  '#F59E0B',
  '#EF4444',
  '#EC4899',
  '#8B5CF6',
  '#14B8A6',
  '#334155',
  '#A16207',
] as const;
export const STATUS_FONT_COUNT = 5;

/** Allowed disappearing-message timers (seconds). `null` means off. */
export const DISAPPEARING_OPTIONS = [24 * 60 * 60, 7 * 24 * 60 * 60, 90 * 24 * 60 * 60] as const;

export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;

export const POLL_MAX_OPTIONS = 12;
export const POLL_OPTION_MAX_LENGTH = 100;

/** Upload limits in bytes. */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

/** Default page size for message history. */
export const MESSAGES_PAGE_SIZE = 50;
export const SEARCH_RESULTS_LIMIT = 50;

/** A far-future timestamp used for "mute always". */
export const MUTE_FOREVER_ISO = '9999-12-31T23:59:59.000Z';

/** Typing indicators expire client-side after this long without a refresh. */
export const TYPING_TIMEOUT_MS = 6_000;
