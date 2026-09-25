/**
 * Request validation schemas (zod v4). The server validates every REST body/query/params and
 * every inbound socket payload with these; clients can reuse them for form validation.
 * Request DTO types are inferred from the schemas (see bottom of file).
 *
 * Conventions
 * - Ids are RFC-4122 UUIDs, normalised to lowercase (`idSchema`). Path params are parsed with
 *   `idParamSchema(...)` / `inviteParamsSchema` so malformed ids are a 400, never a 500.
 * - Query strings: empty values (`?before=`) are treated as absent before coercion.
 * - Message/status bodies are discriminated by `type` and strict: fields that do not belong
 *   to the type are rejected.
 */
import { z } from 'zod';
import {
  ABOUT_MAX_LENGTH,
  DELETED_USERNAME_PREFIX,
  DISAPPEARING_OPTIONS,
  DISPLAY_NAME_MAX_LENGTH,
  INVITE_CODE_ALPHABET,
  INVITE_CODE_LENGTH,
  MAX_CALL_PARTICIPANTS,
  MAX_CAPTION_LENGTH,
  MAX_COMMUNITY_GROUPS,
  MAX_DESCRIPTION_LENGTH,
  MAX_EMOJI_LENGTH,
  MAX_FORWARD_MESSAGES,
  MAX_FORWARD_TARGETS,
  MAX_GROUP_MEMBERS,
  MAX_GROUP_NAME_LENGTH,
  MAX_MESSAGE_LENGTH,
  MAX_MESSAGES_PAGE_SIZE,
  MAX_PRIVACY_LIST_SIZE,
  MAX_USERS_BATCH,
  MESSAGES_PAGE_SIZE,
  PASSWORD_MIN_LENGTH,
  POLL_MAX_OPTIONS,
  POLL_OPTION_MAX_LENGTH,
  POLL_QUESTION_MAX_LENGTH,
  PUSH_SERVICE_HOST_SUFFIXES,
  PUSH_SERVICE_HOSTS,
  SEARCH_RESULTS_LIMIT,
  STATUS_FONT_COUNT,
  STATUS_TEXT_MAX_LENGTH,
  USERNAME_REGEX,
  WAVEFORM_MAX_SAMPLES,
} from './constants.js';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** UUID, normalised to lowercase (ids from Postgres are lowercase; compare as strings). */
export const idSchema = z.uuid().toLowerCase();
const ids = (max: number) => z.array(idSchema).max(max);
/** Distinct ids (duplicates are rejected). */
const uniqueIds = (min: number, max: number) =>
  z
    .array(idSchema)
    .min(min)
    .max(max)
    .refine((a) => new Set(a).size === a.length, 'Duplicate ids');

/** `idParamSchema('chatId', 'userId')` → `z.object({ chatId: idSchema, userId: idSchema })` for req.params. */
export function idParamSchema<K extends string>(...keys: K[]) {
  return z.object(Object.fromEntries(keys.map((k) => [k, idSchema])) as Record<K, typeof idSchema>);
}

const inviteCodeRegex = new RegExp(`^[${INVITE_CODE_ALPHABET}]{${INVITE_CODE_LENGTH}}$`);
/** Invite code shape (same alphabet/length for groups, channels and communities). */
export const inviteCodeSchema = z.string().regex(inviteCodeRegex, 'Invalid invite code');
export const inviteParamsSchema = z.object({ code: inviteCodeSchema });

/** Treat '' / null (blank form fields, `?x=`) as absent. */
const blankToUndefined = (v: unknown) => (v === '' || v === null ? undefined : v);
/** Optional integer query/multipart field: accepts numbers or numeric strings; blank = absent. */
function optionalInt(inner: z.ZodNumber) {
  return z.preprocess((v: number | string | null | undefined) => blankToUndefined(v), z.coerce.number<number | string | undefined>().pipe(inner).optional());
}
/** Integer query field with a default. */
function intWithDefault(inner: z.ZodNumber, fallback: number) {
  return z.preprocess((v: number | string | null | undefined) => blankToUndefined(v), z.coerce.number<number | string | undefined>().pipe(inner).default(fallback));
}
/** Optional trimmed string query field; blank = absent. */
function optionalQueryString(max: number) {
  return z.preprocess((v: string | null | undefined) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().trim().max(max).optional());
}

/** Username shape only (trimmed, lowercased, USERNAME_REGEX) — `usernameSchema` adds the reserved-prefix rule. */
export const usernameFormatSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(USERNAME_REGEX, 'Use 3–32 lowercase letters, numbers, dots or underscores, with at least one letter');
/** A username a user may take: the format, and not the reserved `deleted_` prefix (scrubbed accounts). */
export const usernameSchema = usernameFormatSchema.refine((s) => !s.startsWith(DELETED_USERNAME_PREFIX), 'This username is reserved');
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(256);
export const displayNameSchema = z.string().trim().min(1).max(DISPLAY_NAME_MAX_LENGTH);
/**
 * Phone numbers, canonicalised to E.164 with a leading '+': spaces, dashes, dots and
 * parentheses are stripped, a leading international `00` becomes '+', and a missing '+' is
 * added (numbers must include the country code). '+1 (555) 123-4567' → '+15551234567'.
 */
export const phoneSchema = z
  .string()
  .transform((s) => s.replace(/[\s\-().]/g, '').replace(/^00/, '+'))
  .pipe(z.string().regex(/^\+?[1-9]\d{6,14}$/, 'Enter a valid phone number with country code'))
  .transform((s) => (s.startsWith('+') ? s : `+${s}`));

/**
 * One emoji grapheme (incl. skin tones, ZWJ sequences, flags, keycaps), ≤ MAX_EMOJI_LENGTH
 * UTF-16 code units. Rejects text.
 */
export const emojiSchema = z
  .string()
  .min(1)
  .max(MAX_EMOJI_LENGTH)
  .regex(/^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Component}|‍|️|⃣)+$/u, 'Must be an emoji')
  .refine((s) => /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u.test(s), 'Must be an emoji')
  .refine((s) => {
    const Segmenter = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
    if (!Segmenter) return true;
    let n = 0;
    for (const _ of new Segmenter(undefined, { granularity: 'grapheme' }).segment(s)) if (++n > 1) return false;
    return true;
  }, 'Must be a single emoji');

const privacyLevel = z.enum(['everyone', 'contacts', 'nobody']);
const disappearingSeconds = z
  .number()
  .int()
  .refine((n) => (DISAPPEARING_OPTIONS as readonly number[]).includes(n), 'Unsupported timer')
  .nullable();

// ---------------------------------------------------------------------------
// Auth & account
// ---------------------------------------------------------------------------

export const registerSchema = z.object({
  username: usernameSchema,
  displayName: displayNameSchema,
  password: passwordSchema,
  phone: z.preprocess(blankToUndefined, phoneSchema.optional()),
  deviceName: z.string().trim().max(100).optional(),
});

export const loginSchema = z.object({
  /** Username or phone number — see `parseLoginIdentifier`. */
  identifier: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(256),
  deviceName: z.string().trim().max(100).optional(),
});

/**
 * Login identifier rule: starts with '+' or consists only of digits/spaces/dashes/dots/
 * parentheses → phone (canonicalised); otherwise a (lowercased) username.
 */
export function parseLoginIdentifier(identifier: string): { kind: 'phone'; phone: string } | { kind: 'username'; username: string } | null {
  const s = identifier.trim();
  if (/^\+/.test(s) || /^[\d\s\-().]+$/.test(s)) {
    const r = phoneSchema.safeParse(s);
    return r.success ? { kind: 'phone', phone: r.data } : null;
  }
  return s ? { kind: 'username', username: s.toLowerCase() } : null;
}

/**
 * `GET /api/auth/username-available?username=` (public, per-IP rate-limited). Malformed →
 * 400; a well-formed but reserved (`deleted_…`) or taken username → `{ available: false }`.
 */
export const usernameAvailabilityQuerySchema = z.object({
  username: usernameFormatSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: passwordSchema,
});

export const deleteAccountSchema = z.object({
  password: z.string().min(1).max(256),
});

export const updateProfileSchema = z.object({
  displayName: displayNameSchema.optional(),
  about: z.string().trim().max(ABOUT_MAX_LENGTH).optional(),
  /** Media id of an image uploaded by the caller, or null to remove the photo. */
  avatarMediaId: idSchema.nullable().optional(),
  username: usernameSchema.optional(),
  /** null (or '') removes the phone number. */
  phone: z.preprocess((v) => (v === '' ? null : v), phoneSchema.nullable().optional()),
});

export const updateSettingsSchema = z
  .object({
    lastSeenVisibility: privacyLevel,
    onlineVisibility: z.enum(['everyone', 'same_as_last_seen']),
    profilePhotoVisibility: privacyLevel,
    aboutVisibility: privacyLevel,
    groupsAddPermission: privacyLevel,
    readReceipts: z.boolean(),
    silenceUnknownCallers: z.boolean(),
    statusPrivacy: z.enum(['contacts', 'contacts_except', 'only_share_with']),
    statusExcludeUserIds: ids(MAX_PRIVACY_LIST_SIZE),
    statusOnlyShareWithUserIds: ids(MAX_PRIVACY_LIST_SIZE),
    defaultDisappearingSeconds: disappearingSeconds,
    messageNotifications: z.boolean(),
    groupNotifications: z.boolean(),
    callNotifications: z.boolean(),
    notificationPreviews: z.boolean(),
  })
  .partial();

// ---------------------------------------------------------------------------
// Users & contacts
// ---------------------------------------------------------------------------

export const userSearchQuerySchema = z.object({
  /** Leading '@' is ignored. Matching rules: docs/ARCHITECTURE.md "User search". */
  q: z
    .string()
    .trim()
    .transform((s) => s.replace(/^@/, ''))
    .pipe(z.string().min(1).max(64)),
});

export const usernameParamsSchema = z.object({ username: z.string().trim().toLowerCase().min(1).max(64) });

/** `POST /api/users/batch` and `POST /api/users/presence`. Unknown ids are omitted from the response. */
export const usersBatchSchema = z.object({
  userIds: ids(MAX_USERS_BATCH).min(1),
});

export const addContactSchema = z
  .object({
    userId: idSchema.optional(),
    username: usernameSchema.optional(),
    phone: phoneSchema.optional(),
    name: z.string().trim().min(1).max(DISPLAY_NAME_MAX_LENGTH).optional(),
  })
  .refine((v) => [v.userId, v.username, v.phone].filter((x) => x !== undefined).length === 1, {
    message: 'Provide exactly one of userId, username or phone',
  });

export const updateContactSchema = z.object({
  name: z.string().trim().min(1).max(DISPLAY_NAME_MAX_LENGTH).nullable(),
});

// ---------------------------------------------------------------------------
// Chats & messages
// ---------------------------------------------------------------------------

/** `userId` = the caller creates/opens the "Message yourself" chat. */
export const createDirectChatSchema = z.object({
  userId: idSchema,
});

export const updateChatPrefsSchema = z
  .object({
    /** At most MAX_PINNED_CHATS pinned chats (409 limit_reached). */
    isPinned: z.boolean(),
    isArchived: z.boolean(),
    /** ISO time to mute until (use MUTE_FOREVER_ISO for always), null to unmute. */
    mutedUntil: z.iso.datetime({ offset: true }).nullable(),
    /** Marking unread never moves the read position; reading clears it. */
    markedUnread: z.boolean(),
  })
  .partial();

/** Body of `POST /api/chats/:chatId/read` (same semantics as the `chat:read` socket event). */
export const readBodySchema = z.object({
  /** Read everything up to this seq (clamped to the latest visible seq). */
  seq: z.number().int().nonnegative(),
});

export const setDisappearingSchema = z.object({
  seconds: disappearingSeconds,
});

export const locationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  name: z.string().trim().max(200).nullable().default(null),
  address: z.string().trim().max(500).nullable().default(null),
});

/**
 * Contact card. With `userId`, name/username/phone are ignored and filled server-side.
 * Without it, `name` is required.
 */
export const contactCardSchema = z
  .object({
    userId: idSchema.nullable().default(null),
    name: z.string().trim().min(1).max(DISPLAY_NAME_MAX_LENGTH).optional(),
    username: usernameSchema.nullable().default(null),
    phone: phoneSchema.nullable().default(null),
  })
  .refine((v) => v.userId !== null || !!v.name, { message: 'Contact cards need a name', path: ['name'] });

export const pollInputSchema = z.object({
  question: z.string().trim().min(1).max(POLL_QUESTION_MAX_LENGTH),
  options: z
    .array(z.string().trim().min(1).max(POLL_OPTION_MAX_LENGTH))
    .min(2)
    .max(POLL_MAX_OPTIONS)
    .refine((o) => new Set(o.map((s) => s.toLowerCase())).size === o.length, 'Options must be different'),
  allowMultiple: z.boolean().default(false),
});

export const MEDIA_MESSAGE_TYPES = ['image', 'video', 'audio', 'voice', 'file'] as const;

const sendBase = {
  /** Client-generated id (e.g. crypto.randomUUID()); retries with the same id return the original message. */
  clientId: z.string().min(1).max(64),
  /** Message to quote: same chat and visible to the sender (or "reply privately", see ARCHITECTURE). */
  replyToId: idSchema.optional(),
  /** Reply to a status update (direct chat with the status author only). */
  statusReplyToId: idSchema.optional(),
};

/**
 * `POST /api/chats/:chatId/messages`. Mentions are `@{<uuid>}` tokens inside `text`; the
 * server derives `Message.mentions` from them (there is no `mentions` field).
 */
export const sendMessageSchema = z
  .discriminatedUnion('type', [
    z.strictObject({
      ...sendBase,
      type: z.literal('text'),
      text: z.string().max(MAX_MESSAGE_LENGTH).refine((s) => s.trim().length > 0, 'Text messages need text'),
    }),
    z.strictObject({
      ...sendBase,
      type: z.enum(MEDIA_MESSAGE_TYPES),
      /** An upload by the caller whose kind equals `type`. */
      mediaId: idSchema,
      /** Caption. */
      text: z.string().max(MAX_CAPTION_LENGTH).optional(),
    }),
    z.strictObject({ ...sendBase, type: z.literal('location'), location: locationSchema }),
    z.strictObject({ ...sendBase, type: z.literal('contact'), contact: contactCardSchema }),
    z.strictObject({ ...sendBase, type: z.literal('poll'), poll: pollInputSchema }),
  ])
  .refine((v) => !(v.replyToId && v.statusReplyToId), { message: 'Reply to a message or a status, not both', path: ['statusReplyToId'] });

/**
 * Edit text or a caption (sender only, within EDIT_WINDOW_MS; channel admins: any post).
 * Text messages need non-empty text (≤ MAX_MESSAGE_LENGTH); captions may be emptied and are
 * limited to MAX_CAPTION_LENGTH (checked server-side by type). Mentions are re-derived.
 */
export const editMessageSchema = z.object({
  text: z.string().trim().max(MAX_MESSAGE_LENGTH),
});

export const deleteMessageQuerySchema = z.object({
  for: z.enum(['me', 'everyone']).default('me'),
});

export const reactSchema = z.object({
  emoji: emojiSchema,
});

export const forwardSchema = z.object({
  /** Retries with the same clientId are idempotent (copies use `<clientId>:<index>`). */
  clientId: z.string().min(1).max(48),
  messageIds: uniqueIds(1, MAX_FORWARD_MESSAGES),
  chatIds: uniqueIds(1, MAX_FORWARD_TARGETS),
});

export const pollVoteSchema = z.object({
  /** Empty array retracts the vote. Single-choice polls accept at most one id. */
  optionIds: z
    .array(z.string().min(1).max(64))
    .max(POLL_MAX_OPTIONS)
    .refine((a) => new Set(a).size === a.length, 'Duplicate options'),
});

/**
 * Message history paging. Use at most one cursor; cursors are exclusive seqs.
 * - none: the latest `limit` visible messages (hasMoreAfter = false)
 * - `before=N`: the `limit` highest visible seqs < N
 * - `after=N`: the `limit` lowest visible seqs > N
 * - `around=N`: ⌈limit/2⌉ messages with seq ≤ N (incl. N) and the rest > N
 */
export const listMessagesQuerySchema = z
  .object({
    before: optionalInt(z.number().int().positive()),
    after: optionalInt(z.number().int().nonnegative()),
    around: optionalInt(z.number().int().positive()),
    limit: intWithDefault(z.number().int().min(1).max(MAX_MESSAGES_PAGE_SIZE), MESSAGES_PAGE_SIZE),
  })
  .refine((v) => [v.before, v.after, v.around].filter((x) => x !== undefined).length <= 1, {
    message: 'Use at most one of before, after, around',
  });

/** Shared media gallery; newest first, `before` = exclusive seq cursor, fewer than `limit` = end. */
export const chatMediaQuerySchema = z.object({
  kind: z.enum(['media', 'docs', 'links', 'voice']).default('media'),
  before: optionalInt(z.number().int().positive()),
  limit: intWithDefault(z.number().int().min(1).max(MAX_MESSAGES_PAGE_SIZE), 60),
});

/** `GET /api/messages/starred`: optionally only the stars of one chat (404 unless I have a non-hidden row). */
export const starredMessagesQuerySchema = z.object({
  chatId: z.preprocess(blankToUndefined, idSchema.optional()),
});

export const searchMessagesQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  chatId: z.preprocess(blankToUndefined, idSchema.optional()),
  limit: intWithDefault(z.number().int().min(1).max(100), SEARCH_RESULTS_LIMIT),
});

export const pinMessageSchema = z.object({
  messageId: idSchema,
});

/**
 * Multipart fields of `POST /api/media` (plus the `file` part and an optional `thumbnail`
 * part: JPEG/WebP ≤ MAX_THUMBNAIL_BYTES). Blank fields are ignored.
 */
export const uploadMediaMetaSchema = z.object({
  kind: z.enum(MEDIA_MESSAGE_TYPES),
  width: optionalInt(z.number().int().positive().max(20_000)),
  height: optionalInt(z.number().int().positive().max(20_000)),
  durationMs: optionalInt(
    z
      .number()
      .int()
      .nonnegative()
      .max(24 * 60 * 60 * 1000),
  ),
  /** JSON-encoded number[] (multipart fields are strings), ≤ WAVEFORM_MAX_SAMPLES values clamped to 0..1. */
  waveform: z
    .string()
    .max(4096)
    .optional()
    .transform((s, ctx) => {
      if (s === undefined || s === '') return undefined;
      try {
        const arr: unknown = JSON.parse(s);
        if (!Array.isArray(arr) || arr.length > WAVEFORM_MAX_SAMPLES || arr.some((n) => typeof n !== 'number' || !Number.isFinite(n))) throw 0;
        return (arr as number[]).map((n) => Math.max(0, Math.min(1, n)));
      } catch {
        ctx.addIssue({ code: 'custom', message: 'Invalid waveform' });
        return z.NEVER;
      }
    }),
});

// ---------------------------------------------------------------------------
// Groups, communities, channels, invites
// ---------------------------------------------------------------------------

const groupNameSchema = z.string().trim().min(1).max(MAX_GROUP_NAME_LENGTH);
const descriptionSchema = z.string().trim().max(MAX_DESCRIPTION_LENGTH);
const groupSettingsInput = z
  .object({
    onlyAdminsCanSend: z.boolean(),
    onlyAdminsCanEditInfo: z.boolean(),
    onlyAdminsCanAddMembers: z.boolean(),
  })
  .partial();

/** `POST /api/groups` (plain group) and `POST /api/communities/:id/groups` (group inside a community). */
export const createGroupSchema = z.object({
  name: groupNameSchema,
  description: descriptionSchema.optional(),
  avatarMediaId: idSchema.optional(),
  /** Other users to add (same rules as `POST /groups/:id/members`; the creator is implicit). */
  memberIds: uniqueIds(0, MAX_GROUP_MEMBERS - 1).default([]),
  /** Default: the creator's `defaultDisappearingSeconds`. */
  disappearingSeconds: disappearingSeconds.optional(),
  /** Merged over DEFAULT_GROUP_SETTINGS. */
  settings: groupSettingsInput.optional(),
});

/** PATCH semantics: omitted fields are unchanged; one system message per changed field. */
export const updateGroupSchema = z.object({
  name: groupNameSchema.optional(),
  description: descriptionSchema.nullable().optional(),
  avatarMediaId: idSchema.nullable().optional(),
});

/** One `settings_changed` system message per changed key. */
export const updateGroupSettingsSchema = groupSettingsInput;

export const addMembersSchema = z.object({
  userIds: uniqueIds(1, MAX_GROUP_MEMBERS - 1),
});

export const setRoleSchema = z.object({
  role: z.enum(['admin', 'member']),
});

export const transferOwnershipSchema = z.object({
  userId: idSchema,
});

export const createCommunitySchema = z.object({
  name: groupNameSchema,
  description: descriptionSchema.optional(),
  avatarMediaId: idSchema.optional(),
  /** Existing groups (caller must admin each; not linked elsewhere) to link on creation. */
  groupIds: uniqueIds(0, MAX_COMMUNITY_GROUPS).default([]),
});

export const updateCommunitySchema = z.object({
  name: groupNameSchema.optional(),
  description: descriptionSchema.nullable().optional(),
  avatarMediaId: idSchema.nullable().optional(),
});

export const createCommunityGroupSchema = createGroupSchema;

export const linkGroupsSchema = z.object({
  chatIds: uniqueIds(1, MAX_COMMUNITY_GROUPS),
});

export const createChannelSchema = z.object({
  name: groupNameSchema,
  description: descriptionSchema.optional(),
  avatarMediaId: idSchema.optional(),
  isPublic: z.boolean().default(true),
  reactions: z.enum(['all', 'quick', 'none']).default('all'),
});

export const updateChannelSchema = z.object({
  name: groupNameSchema.optional(),
  description: descriptionSchema.nullable().optional(),
  avatarMediaId: idSchema.nullable().optional(),
  isPublic: z.boolean().optional(),
  reactions: z.enum(['all', 'quick', 'none']).optional(),
});

export const channelDiscoverQuerySchema = z.object({
  q: optionalQueryString(100),
  limit: intWithDefault(z.number().int().min(1).max(100), 30),
});

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export const createStatusSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('text'),
    text: z.string().trim().min(1).max(STATUS_TEXT_MAX_LENGTH),
    backgroundColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    font: z
      .number()
      .int()
      .min(0)
      .max(STATUS_FONT_COUNT - 1)
      .optional(),
  }),
  z.strictObject({
    type: z.enum(['image', 'video']),
    /** An upload by the caller whose kind equals `type`. */
    mediaId: idSchema,
    /** Caption. */
    text: z.string().trim().max(STATUS_TEXT_MAX_LENGTH).optional(),
  }),
]);

export const statusReactSchema = z.object({
  emoji: emojiSchema,
});

// ---------------------------------------------------------------------------
// Calls & push
// ---------------------------------------------------------------------------

export const callLogQuerySchema = z.object({
  /** ISO timestamp cursor (exclusive): calls created before this. */
  before: z.preprocess(blankToUndefined, z.iso.datetime({ offset: true }).optional()),
  limit: intWithDefault(z.number().int().min(1).max(100), 50),
});

/** https://<host>[:port]/... with a plain DNS host (no userinfo, no IP literal tricks). */
function isAllowedPushHost(url: string): boolean {
  const m = /^https:\/\/([a-z0-9.-]+)(?::\d{1,5})?(?:[/?#]|$)/i.exec(url);
  if (!m) return false;
  const host = m[1]!.toLowerCase();
  return (PUSH_SERVICE_HOSTS as readonly string[]).includes(host) || PUSH_SERVICE_HOST_SUFFIXES.some((s) => host.endsWith(s));
}

/** Push endpoint: https on an allow-listed push service host (anti-SSRF). */
export const pushEndpointSchema = z
  .url({ protocol: /^https$/ })
  .max(2048)
  .refine(isAllowedPushHost, 'Unsupported push service');

export const pushSubscribeSchema = z.object({
  endpoint: pushEndpointSchema,
  keys: z.object({
    p256dh: z.string().min(1).max(512),
    auth: z.string().min(1).max(512),
  }),
});

export const pushUnsubscribeSchema = z.object({
  endpoint: z.url().max(2048),
});

// ---------------------------------------------------------------------------
// Socket payloads (client -> server)
// ---------------------------------------------------------------------------

export const typingPayloadSchema = z.object({
  chatId: idSchema,
  state: z.enum(['typing', 'recording', 'idle']),
});

/** `chat:read`: I have read everything up to `seq`. */
export const receiptPayloadSchema = z.object({
  chatId: idSchema,
  seq: z.number().int().nonnegative(),
});

export const presenceSubscribeSchema = z.object({
  userIds: ids(MAX_USERS_BATCH),
});

/** Optional initial media state (default: unmuted; video off for audio calls). */
const callMediaInit = {
  audioMuted: z.boolean().optional(),
  videoOff: z.boolean().optional(),
};

export const callStartSchema = z.object({
  chatId: idSchema,
  type: z.enum(['audio', 'video']),
  /**
   * Group chats: ring only these members. Required when the chat has more than
   * MAX_CALL_PARTICIPANTS − 1 other active members.
   */
  userIds: uniqueIds(1, MAX_CALL_PARTICIPANTS - 1).optional(),
  ...callMediaInit,
});

export const callIdSchema = z.object({
  callId: idSchema,
});

/** `call:accept`, `call:join`, `call:rejoin`. */
export const callJoinSchema = z.object({
  callId: idSchema,
  ...callMediaInit,
});

export const callInviteSchema = z.object({
  callId: idSchema,
  userIds: uniqueIds(1, MAX_CALL_PARTICIPANTS - 1),
});

export const callSignalSchema = z.object({
  callId: idSchema,
  toUserId: idSchema,
  signal: z.discriminatedUnion('type', [
    z.object({ type: z.literal('offer'), sdp: z.string().max(100_000) }),
    z.object({ type: z.literal('answer'), sdp: z.string().max(100_000) }),
    z.object({
      type: z.literal('candidate'),
      candidate: z
        .object({
          candidate: z.string().max(2_000).optional(),
          sdpMid: z.string().max(64).nullable().optional(),
          sdpMLineIndex: z.number().int().nullable().optional(),
          usernameFragment: z.string().max(256).nullable().optional(),
        })
        .nullable(),
    }),
  ]),
});

export const callMediaStateSchema = z.object({
  callId: idSchema,
  audioMuted: z.boolean(),
  videoOff: z.boolean(),
  screenSharing: z.boolean(),
});

// ---------------------------------------------------------------------------
// Inferred request types
// ---------------------------------------------------------------------------

export type RegisterRequest = z.input<typeof registerSchema>;
export type LoginRequest = z.input<typeof loginSchema>;
export type UsernameAvailabilityQuery = z.input<typeof usernameAvailabilityQuerySchema>;
export type ChangePasswordRequest = z.input<typeof changePasswordSchema>;
export type DeleteAccountRequest = z.input<typeof deleteAccountSchema>;
export type UpdateProfileRequest = z.input<typeof updateProfileSchema>;
export type UpdateSettingsRequest = z.input<typeof updateSettingsSchema>;
export type UserSearchQuery = z.input<typeof userSearchQuerySchema>;
export type UsersBatchRequest = z.input<typeof usersBatchSchema>;
export type AddContactRequest = z.input<typeof addContactSchema>;
export type UpdateContactRequest = z.input<typeof updateContactSchema>;
export type CreateDirectChatRequest = z.input<typeof createDirectChatSchema>;
export type UpdateChatPrefsRequest = z.input<typeof updateChatPrefsSchema>;
export type ReadRequest = z.input<typeof readBodySchema>;
export type SetDisappearingRequest = z.input<typeof setDisappearingSchema>;
export type SendMessageRequest = z.input<typeof sendMessageSchema>;
export type EditMessageRequest = z.input<typeof editMessageSchema>;
export type DeleteMessageQuery = z.input<typeof deleteMessageQuerySchema>;
export type ReactRequest = z.input<typeof reactSchema>;
export type ForwardRequest = z.input<typeof forwardSchema>;
export type PollVoteRequest = z.input<typeof pollVoteSchema>;
export type ListMessagesQuery = z.input<typeof listMessagesQuerySchema>;
export type ChatMediaQuery = z.input<typeof chatMediaQuerySchema>;
export type StarredMessagesQuery = z.input<typeof starredMessagesQuerySchema>;
export type SearchMessagesQuery = z.input<typeof searchMessagesQuerySchema>;
export type PinMessageRequest = z.input<typeof pinMessageSchema>;
export type UploadMediaMeta = z.input<typeof uploadMediaMetaSchema>;
export type CreateGroupRequest = z.input<typeof createGroupSchema>;
export type UpdateGroupRequest = z.input<typeof updateGroupSchema>;
export type UpdateGroupSettingsRequest = z.input<typeof updateGroupSettingsSchema>;
export type AddMembersRequest = z.input<typeof addMembersSchema>;
export type SetRoleRequest = z.input<typeof setRoleSchema>;
export type TransferOwnershipRequest = z.input<typeof transferOwnershipSchema>;
export type CreateCommunityRequest = z.input<typeof createCommunitySchema>;
export type UpdateCommunityRequest = z.input<typeof updateCommunitySchema>;
export type CreateCommunityGroupRequest = z.input<typeof createCommunityGroupSchema>;
export type LinkGroupsRequest = z.input<typeof linkGroupsSchema>;
export type CreateChannelRequest = z.input<typeof createChannelSchema>;
export type UpdateChannelRequest = z.input<typeof updateChannelSchema>;
export type ChannelDiscoverQuery = z.input<typeof channelDiscoverQuerySchema>;
export type CreateStatusRequest = z.input<typeof createStatusSchema>;
export type StatusReactRequest = z.input<typeof statusReactSchema>;
export type CallLogQuery = z.input<typeof callLogQuerySchema>;
export type PushSubscribeRequest = z.input<typeof pushSubscribeSchema>;
export type PushUnsubscribeRequest = z.input<typeof pushUnsubscribeSchema>;

export type TypingPayload = z.infer<typeof typingPayloadSchema>;
export type ReceiptPayload = z.infer<typeof receiptPayloadSchema>;
export type PresenceSubscribePayload = z.infer<typeof presenceSubscribeSchema>;
export type CallStartPayload = z.input<typeof callStartSchema>;
export type CallIdPayload = z.infer<typeof callIdSchema>;
export type CallJoinPayload = z.input<typeof callJoinSchema>;
export type CallInvitePayload = z.input<typeof callInviteSchema>;
export type CallSignalPayload = z.infer<typeof callSignalSchema>;
export type CallMediaStatePayload = z.infer<typeof callMediaStateSchema>;
