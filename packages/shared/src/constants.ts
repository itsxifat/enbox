/**
 * Product limits and tunables shared by server and clients.
 * Keep these in one place so the UI can explain limits the server enforces.
 */
import type { ChannelSettings, GroupSettings, UserSettings } from './models.js';

export const APP_NAME = 'Enbox';

// ---------------------------------------------------------------------------
// Accounts & profiles
// ---------------------------------------------------------------------------

/**
 * Usernames: 3–32 chars of lowercase letters, digits, underscore and dot, with at least one
 * letter (so a login identifier made only of digits is always a phone number).
 * The `deleted_` prefix is reserved for deleted accounts (see `usernameSchema`).
 */
export const USERNAME_REGEX = /^(?=[a-z0-9_.]*[a-z])[a-z0-9_.]{3,32}$/;
/** Usernames of deleted accounts are rewritten to `deleted_<first 12 hex chars of the id>`. */
export const DELETED_USERNAME_PREFIX = 'deleted_';
export const DELETED_ACCOUNT_NAME = 'Deleted account';
export const PASSWORD_MIN_LENGTH = 8;
export const DISPLAY_NAME_MAX_LENGTH = 64;
export const ABOUT_MAX_LENGTH = 140;
export const DEFAULT_ABOUT = 'Hey there! I am using Enbox.';

/** User search (`GET /api/users/search`): username prefix matching needs this many chars. */
export const USER_SEARCH_MIN_PREFIX = 3;
/** Max results of `GET /api/users/search`. */
export const USER_SEARCH_LIMIT = 20;
/** Max ids per `POST /api/users/batch` / `POST /api/users/presence` / `presence:subscribe`. */
export const MAX_USERS_BATCH = 500;
/** Presence subscriptions are per socket; ids beyond this cap are ignored (no error). */
export const MAX_PRESENCE_SUBSCRIPTIONS = 1_000;
/** Max ids in each status privacy list (`statusExcludeUserIds`, `statusOnlyShareWithUserIds`). */
export const MAX_PRIVACY_LIST_SIZE = 5_000;

/**
 * Defaults for every user setting. `users.settings` stores only overrides: always read
 * settings through `resolveUserSettings()` (utils.ts), which merges them over these.
 */
export const DEFAULT_USER_SETTINGS: Readonly<UserSettings> = Object.freeze({
  lastSeenVisibility: 'everyone',
  onlineVisibility: 'everyone',
  profilePhotoVisibility: 'everyone',
  aboutVisibility: 'everyone',
  groupsAddPermission: 'everyone',
  readReceipts: true,
  silenceUnknownCallers: false,
  statusPrivacy: 'contacts',
  statusExcludeUserIds: [],
  statusOnlyShareWithUserIds: [],
  defaultDisappearingSeconds: null,
  messageNotifications: true,
  groupNotifications: true,
  callNotifications: true,
  notificationPreviews: true,
});

// ---------------------------------------------------------------------------
// Chats & messages
// ---------------------------------------------------------------------------

export const MAX_MESSAGE_LENGTH = 65_536;
export const MAX_CAPTION_LENGTH = 4_096;
export const MAX_GROUP_NAME_LENGTH = 100;
export const MAX_DESCRIPTION_LENGTH = 2_048;

/**
 * Groups (and community announcement groups) can hold at most this many active members.
 * Since every community member is in the announcement group, this also caps communities.
 */
export const MAX_GROUP_MEMBERS = 1_024;
/** Communities can link at most this many groups (plus the announcement group). */
export const MAX_COMMUNITY_GROUPS = 100;

/** Group settings written on group creation (merged with the request's `settings`). */
export const DEFAULT_GROUP_SETTINGS: Readonly<GroupSettings> = Object.freeze({
  onlyAdminsCanSend: false,
  onlyAdminsCanEditInfo: false,
  onlyAdminsCanAddMembers: false,
});
/** Fixed settings of every community announcement group (never changeable). */
export const ANNOUNCEMENT_GROUP_SETTINGS: Readonly<GroupSettings> = Object.freeze({
  onlyAdminsCanSend: true,
  onlyAdminsCanEditInfo: true,
  onlyAdminsCanAddMembers: true,
});
/** Channel settings written on channel creation (merged with the request). */
export const DEFAULT_CHANNEL_SETTINGS: Readonly<ChannelSettings> = Object.freeze({
  isPublic: true,
  reactions: 'all',
});

/** A sender may edit a message within this window (channel admins: any post). */
export const EDIT_WINDOW_MS = 15 * 60 * 1000;
/**
 * A sender may delete a message for everyone within this window (60 hours, like WhatsApp's
 * ~2.5 days). Group admins and channel admins may delete any message at any time.
 */
export const DELETE_FOR_EVERYONE_WINDOW_MS = 60 * 60 * 60 * 1000;
/** Messages forwarded this many times or more are labelled "Forwarded many times". */
export const FORWARDED_MANY_TIMES_THRESHOLD = 5;
/** Max chats a message can be forwarded to in one action. */
export const MAX_FORWARD_TARGETS = 5;
/** Max messages forwarded in one action. */
export const MAX_FORWARD_MESSAGES = 50;
/** Max distinct users mentioned in one message (extra mention tokens are plain text). */
export const MAX_MENTIONS = 50;

export const MAX_PINNED_CHATS = 3;
export const MAX_PINNED_MESSAGES = 3;

/** Allowed disappearing-message timers (seconds). `null` means off. */
export const DISAPPEARING_OPTIONS = [24 * 60 * 60, 7 * 24 * 60 * 60, 90 * 24 * 60 * 60] as const;

export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;
/** Max UTF-16 code units of a reaction emoji (one grapheme, see `emojiSchema`). */
export const MAX_EMOJI_LENGTH = 16;

export const POLL_QUESTION_MAX_LENGTH = 300;
export const POLL_MAX_OPTIONS = 12;
export const POLL_OPTION_MAX_LENGTH = 100;

/** Default page size for message history. */
export const MESSAGES_PAGE_SIZE = 50;
/** Max `limit` of a message page. */
export const MAX_MESSAGES_PAGE_SIZE = 200;
export const SEARCH_RESULTS_LIMIT = 50;

/** A far-future timestamp used for "mute always". */
export const MUTE_FOREVER_ISO = '9999-12-31T23:59:59.000Z';

/** Typing indicators expire client-side after this long without a refresh. */
export const TYPING_TIMEOUT_MS = 6_000;
/** While the user keeps typing/recording, clients re-send the state this often. */
export const TYPING_REFRESH_MS = 3_000;

// ---------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------

/** Alphabet of invite codes (URL-safe, no look-alike characters). */
export const INVITE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
/** Invite codes are this many characters (≈ 128 bits). */
export const INVITE_CODE_LENGTH = 22;

// ---------------------------------------------------------------------------
// Status updates (stories)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

/**
 * Group/1:1 calls use a full-mesh WebRTC topology, which caps participants (joined users,
 * caller included). A call rings at most `MAX_CALL_PARTICIPANTS - 1` users.
 */
export const MAX_CALL_PARTICIPANTS = 8;
/** How long an invitee rings before becoming `missed`. */
export const CALL_RING_TIMEOUT_MS = 45_000;
/**
 * A joined participant whose call socket disconnected may reclaim the call with
 * `call:rejoin` within this window; afterwards they are marked `left`.
 */
export const CALL_RECONNECT_GRACE_MS = 20_000;

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

/** Upload limits in bytes. */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
/** Optional client-generated thumbnail/poster (multipart `thumbnail`). */
export const MAX_THUMBNAIL_BYTES = 200 * 1024;
export const THUMBNAIL_MIME_TYPES = ['image/jpeg', 'image/webp'] as const;
/** Voice-note waveform: at most this many 0..1 samples. */
export const WAVEFORM_MAX_SAMPLES = 64;
/** Sanitised file names are truncated to this many characters. */
export const MAX_FILE_NAME_LENGTH = 200;
/** Clients re-encode photos so the longest side is at most this (strips EXIF). */
export const IMAGE_MAX_DIMENSION = 2_560;
/** Clients re-encode avatars so the longest side is at most this. */
export const AVATAR_MAX_DIMENSION = 640;
/** Raster types accepted as avatars (user, group, community, channel). */
export const AVATAR_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
/** Unreferenced media rows/files older than this are garbage-collected. */
export const ORPHAN_MEDIA_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Sniffed MIME types accepted per upload kind. `null` = anything (served as an attachment).
 * SVG is never accepted as an image. Audio-only WebM/MP4 files sniff as `video/*`, so the
 * audio and voice kinds accept those containers too.
 */
export const MEDIA_MIME_ALLOWLIST = {
  image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif'],
  video: ['video/mp4', 'video/webm', 'video/quicktime'],
  audio: [
    'audio/mpeg',
    'audio/mp4',
    'audio/aac',
    'audio/ogg',
    'audio/webm',
    'audio/wav',
    'audio/opus',
    'video/webm',
    'video/mp4',
  ],
  voice: [
    'audio/mpeg',
    'audio/mp4',
    'audio/aac',
    'audio/ogg',
    'audio/webm',
    'audio/wav',
    'audio/opus',
    'video/webm',
    'video/mp4',
  ],
  file: null,
} as const satisfies Record<
  'image' | 'video' | 'audio' | 'voice' | 'file',
  readonly string[] | null
>;

// ---------------------------------------------------------------------------
// Web push
// ---------------------------------------------------------------------------

/** Push endpoints must be https on one of these hosts ... */
export const PUSH_SERVICE_HOSTS = [
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'web.push.apple.com',
] as const;
/** ... or on a subdomain of one of these. */
export const PUSH_SERVICE_HOST_SUFFIXES = [
  '.notify.windows.com',
  '.push.apple.com',
  '.push.services.mozilla.com',
] as const;
/** TTL of message pushes (seconds). Call pushes use CALL_RING_TIMEOUT_MS / 1000. */
export const PUSH_MESSAGE_TTL_SEC = 24 * 60 * 60;

// ---------------------------------------------------------------------------
// Per-user / per-socket rate limits (server: `limitUser()` in lib/userLimit.ts)
// ---------------------------------------------------------------------------

/**
 * `limit` actions per `windowMs`. Exceeding one returns 429 `rate_limited` (acks: `{ ok:false }`),
 * except `typing`, which is dropped silently. Per-IP limits (auth, invites, uploads, general
 * API) are separate (server lib/rateLimit.ts).
 */
export const USER_RATE_LIMITS = {
  /** Message sends and forwards, per user. */
  sendMessage: { limit: 60, windowMs: 10_000 },
  /** Users added to groups/communities (counted per added user), per user. */
  addMembers: { limit: 200, windowMs: 60 * 60_000 },
  /** `call:start`, per user. */
  callStart: { limit: 10, windowMs: 60_000 },
  /** `chat:typing`, per socket and chat. */
  typing: { limit: 1, windowMs: 1_000 },
  /** `presence:subscribe` events, per socket. */
  presenceSubscribe: { limit: 30, windowMs: 60_000 },
  /** `GET /api/users/search` and `POST /api/contacts`, per user. */
  userSearch: { limit: 60, windowMs: 60_000 },
} as const;
