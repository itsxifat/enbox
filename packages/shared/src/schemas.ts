/**
 * Request validation schemas (zod). The server validates every REST body/query and every
 * inbound socket payload with these; clients can reuse them for form validation.
 * Request DTO types are inferred from the schemas (see bottom of file).
 */
import { z } from 'zod';
import {
  ABOUT_MAX_LENGTH,
  DISAPPEARING_OPTIONS,
  DISPLAY_NAME_MAX_LENGTH,
  MAX_CAPTION_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_FORWARD_TARGETS,
  MAX_GROUP_NAME_LENGTH,
  MAX_MESSAGE_LENGTH,
  MESSAGES_PAGE_SIZE,
  PASSWORD_MIN_LENGTH,
  POLL_MAX_OPTIONS,
  POLL_OPTION_MAX_LENGTH,
  STATUS_FONT_COUNT,
  STATUS_TEXT_MAX_LENGTH,
  USERNAME_REGEX,
} from './constants.js';

export const idSchema = z.uuid();
const ids = (max: number) => z.array(idSchema).max(max);

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(USERNAME_REGEX, 'Use 3–32 lowercase letters, numbers, dots or underscores');
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(256);
export const displayNameSchema = z.string().trim().min(1).max(DISPLAY_NAME_MAX_LENGTH);
/** Loose E.164: optional +, 7–15 digits. Spaces/dashes are stripped before validation. */
export const phoneSchema = z
  .string()
  .transform((s) => s.replace(/[\s\-()]/g, ''))
  .pipe(z.string().regex(/^\+?[1-9]\d{6,14}$/, 'Enter a valid phone number'));

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
  phone: phoneSchema.optional(),
  deviceName: z.string().trim().max(100).optional(),
});

export const loginSchema = z.object({
  /** Username or phone number. */
  identifier: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(256),
  deviceName: z.string().trim().max(100).optional(),
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
  /** Media id of an uploaded image, or null to remove the photo. */
  avatarMediaId: idSchema.nullable().optional(),
  username: usernameSchema.optional(),
  phone: phoneSchema.nullable().optional(),
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
    statusPrivacyUserIds: ids(5000),
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
  q: z.string().trim().min(1).max(64),
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

export const createDirectChatSchema = z.object({
  userId: idSchema,
});

export const updateChatPrefsSchema = z
  .object({
    isPinned: z.boolean(),
    isArchived: z.boolean(),
    /** ISO time to mute until (use MUTE_FOREVER_ISO for always), null to unmute. */
    mutedUntil: z.iso.datetime().nullable(),
    markedUnread: z.boolean(),
  })
  .partial();

export const setDisappearingSchema = z.object({
  seconds: disappearingSeconds,
});

export const locationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  name: z.string().trim().max(200).nullable().default(null),
  address: z.string().trim().max(500).nullable().default(null),
});

export const contactCardSchema = z.object({
  userId: idSchema.nullable().default(null),
  name: z.string().trim().min(1).max(DISPLAY_NAME_MAX_LENGTH),
  username: z.string().trim().max(32).nullable().default(null),
  phone: z.string().trim().max(32).nullable().default(null),
});

export const pollInputSchema = z.object({
  question: z.string().trim().min(1).max(300),
  options: z.array(z.string().trim().min(1).max(POLL_OPTION_MAX_LENGTH)).min(2).max(POLL_MAX_OPTIONS),
  allowMultiple: z.boolean().default(false),
});

const MEDIA_MESSAGE_TYPES = ['image', 'video', 'audio', 'voice', 'file'] as const;

export const sendMessageSchema = z
  .object({
    /** Client-generated id (e.g. crypto.randomUUID()); retries with the same id are idempotent. */
    clientId: z.string().min(1).max(64),
    type: z.enum(['text', 'image', 'video', 'audio', 'voice', 'file', 'location', 'contact', 'poll']),
    text: z.string().max(MAX_MESSAGE_LENGTH).optional(),
    mediaId: idSchema.optional(),
    replyToId: idSchema.optional(),
    mentions: ids(MAX_MESSAGE_LENGTH).optional(),
    location: locationSchema.optional(),
    contact: contactCardSchema.optional(),
    poll: pollInputSchema.optional(),
    /** Reply to a status update (direct chats with the status author only). */
    statusReplyToId: idSchema.optional(),
  })
  .superRefine((v, ctx) => {
    const isMedia = (MEDIA_MESSAGE_TYPES as readonly string[]).includes(v.type);
    if (v.type === 'text' && !v.text?.trim()) {
      ctx.addIssue({ code: 'custom', message: 'Text messages need text', path: ['text'] });
    }
    if (isMedia && !v.mediaId) {
      ctx.addIssue({ code: 'custom', message: 'Media messages need mediaId', path: ['mediaId'] });
    }
    if (isMedia && v.text && v.text.length > MAX_CAPTION_LENGTH) {
      ctx.addIssue({ code: 'custom', message: 'Caption too long', path: ['text'] });
    }
    if (v.type === 'location' && !v.location) {
      ctx.addIssue({ code: 'custom', message: 'Location messages need location', path: ['location'] });
    }
    if (v.type === 'contact' && !v.contact) {
      ctx.addIssue({ code: 'custom', message: 'Contact messages need contact', path: ['contact'] });
    }
    if (v.type === 'poll' && !v.poll) {
      ctx.addIssue({ code: 'custom', message: 'Poll messages need poll', path: ['poll'] });
    }
  });

export const editMessageSchema = z.object({
  text: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
});

export const deleteMessageQuerySchema = z.object({
  for: z.enum(['me', 'everyone']).default('me'),
});

export const reactSchema = z.object({
  /** A single emoji (grapheme cluster). */
  emoji: z.string().min(1).max(16),
});

export const forwardSchema = z.object({
  messageIds: z.array(idSchema).min(1).max(50),
  chatIds: z.array(idSchema).min(1).max(MAX_FORWARD_TARGETS),
});

export const pollVoteSchema = z.object({
  /** Empty array retracts the vote. */
  optionIds: z.array(z.string().min(1).max(64)).max(POLL_MAX_OPTIONS),
});

export const listMessagesQuerySchema = z.object({
  /** Return messages with seq < before (older page). */
  before: z.coerce.number().int().positive().optional(),
  /** Return messages with seq > after (newer page / catch-up). */
  after: z.coerce.number().int().nonnegative().optional(),
  /** Return a page centred on this seq (jump to message). */
  around: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(MESSAGES_PAGE_SIZE),
});

export const chatMediaQuerySchema = z.object({
  kind: z.enum(['media', 'docs', 'links', 'voice']).default('media'),
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(60),
});

export const searchMessagesQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  chatId: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const pinMessageSchema = z.object({
  messageId: idSchema,
});

export const uploadMediaMetaSchema = z.object({
  kind: z.enum(['image', 'video', 'audio', 'voice', 'file']),
  width: z.coerce.number().int().positive().max(20_000).optional(),
  height: z.coerce.number().int().positive().max(20_000).optional(),
  durationMs: z.coerce.number().int().nonnegative().max(24 * 60 * 60 * 1000).optional(),
  /** JSON-encoded number[] (multipart fields are strings). */
  waveform: z
    .string()
    .max(4096)
    .optional()
    .transform((s, ctx) => {
      if (s === undefined || s === '') return undefined;
      try {
        const arr = JSON.parse(s);
        if (!Array.isArray(arr) || arr.length > 128 || arr.some((n) => typeof n !== 'number')) throw 0;
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

export const createGroupSchema = z.object({
  name: groupNameSchema,
  description: descriptionSchema.optional(),
  avatarMediaId: idSchema.optional(),
  memberIds: ids(1023).default([]),
  /** Create the group inside a community (caller must be a community admin). */
  communityId: idSchema.optional(),
  disappearingSeconds: disappearingSeconds.optional(),
  settings: z
    .object({
      onlyAdminsCanSend: z.boolean(),
      onlyAdminsCanEditInfo: z.boolean(),
      onlyAdminsCanAddMembers: z.boolean(),
    })
    .partial()
    .optional(),
});

export const updateGroupSchema = z.object({
  name: groupNameSchema.optional(),
  description: descriptionSchema.nullable().optional(),
  avatarMediaId: idSchema.nullable().optional(),
});

export const updateGroupSettingsSchema = z
  .object({
    onlyAdminsCanSend: z.boolean(),
    onlyAdminsCanEditInfo: z.boolean(),
    onlyAdminsCanAddMembers: z.boolean(),
  })
  .partial();

export const addMembersSchema = z.object({
  userIds: z.array(idSchema).min(1).max(1023),
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
  /** Existing groups (caller must be admin of each) to link on creation. */
  groupIds: ids(100).default([]),
});

export const updateCommunitySchema = z.object({
  name: groupNameSchema.optional(),
  description: descriptionSchema.nullable().optional(),
  avatarMediaId: idSchema.nullable().optional(),
});

export const createCommunityGroupSchema = createGroupSchema.omit({ communityId: true });

export const linkGroupsSchema = z.object({
  chatIds: z.array(idSchema).min(1).max(100),
});

export const createChannelSchema = z.object({
  name: groupNameSchema,
  description: descriptionSchema.optional(),
  avatarMediaId: idSchema.optional(),
  isPublic: z.boolean().default(true),
});

export const updateChannelSchema = z.object({
  name: groupNameSchema.optional(),
  description: descriptionSchema.nullable().optional(),
  avatarMediaId: idSchema.nullable().optional(),
  isPublic: z.boolean().optional(),
  reactions: z.enum(['all', 'quick', 'none']).optional(),
});

export const channelDiscoverQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export const createStatusSchema = z
  .object({
    type: z.enum(['text', 'image', 'video']),
    text: z.string().trim().max(STATUS_TEXT_MAX_LENGTH).optional(),
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
    mediaId: idSchema.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.type === 'text' && !v.text) {
      ctx.addIssue({ code: 'custom', message: 'Text status needs text', path: ['text'] });
    }
    if (v.type !== 'text' && !v.mediaId) {
      ctx.addIssue({ code: 'custom', message: 'Media status needs mediaId', path: ['mediaId'] });
    }
  });

export const statusReactSchema = z.object({
  emoji: z.string().min(1).max(16),
});

// ---------------------------------------------------------------------------
// Calls & push
// ---------------------------------------------------------------------------

export const callLogQuerySchema = z.object({
  /** ISO timestamp cursor: return calls created before this. */
  before: z.iso.datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const pushSubscribeSchema = z.object({
  endpoint: z.url().max(2048),
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

export const receiptPayloadSchema = z.object({
  chatId: idSchema,
  seq: z.number().int().nonnegative(),
});

export const presenceSubscribeSchema = z.object({
  userIds: z.array(idSchema).max(500),
});

export const callStartSchema = z.object({
  chatId: idSchema,
  type: z.enum(['audio', 'video']),
  /** For group chats: ring only these members (default: all members). */
  userIds: z.array(idSchema).max(64).optional(),
});

export const callIdSchema = z.object({
  callId: idSchema,
});

export const callInviteSchema = z.object({
  callId: idSchema,
  userIds: z.array(idSchema).min(1).max(64),
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
export type ChangePasswordRequest = z.input<typeof changePasswordSchema>;
export type DeleteAccountRequest = z.input<typeof deleteAccountSchema>;
export type UpdateProfileRequest = z.input<typeof updateProfileSchema>;
export type UpdateSettingsRequest = z.input<typeof updateSettingsSchema>;
export type AddContactRequest = z.input<typeof addContactSchema>;
export type UpdateContactRequest = z.input<typeof updateContactSchema>;
export type CreateDirectChatRequest = z.input<typeof createDirectChatSchema>;
export type UpdateChatPrefsRequest = z.input<typeof updateChatPrefsSchema>;
export type SetDisappearingRequest = z.input<typeof setDisappearingSchema>;
export type SendMessageRequest = z.input<typeof sendMessageSchema>;
export type EditMessageRequest = z.input<typeof editMessageSchema>;
export type ReactRequest = z.input<typeof reactSchema>;
export type ForwardRequest = z.input<typeof forwardSchema>;
export type PollVoteRequest = z.input<typeof pollVoteSchema>;
export type ListMessagesQuery = z.input<typeof listMessagesQuerySchema>;
export type ChatMediaQuery = z.input<typeof chatMediaQuerySchema>;
export type SearchMessagesQuery = z.input<typeof searchMessagesQuerySchema>;
export type PinMessageRequest = z.input<typeof pinMessageSchema>;
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
export type CreateStatusRequest = z.input<typeof createStatusSchema>;
export type StatusReactRequest = z.input<typeof statusReactSchema>;
export type CallLogQuery = z.input<typeof callLogQuerySchema>;
export type PushSubscribeRequest = z.input<typeof pushSubscribeSchema>;

export type TypingPayload = z.infer<typeof typingPayloadSchema>;
export type ReceiptPayload = z.infer<typeof receiptPayloadSchema>;
export type PresenceSubscribePayload = z.infer<typeof presenceSubscribeSchema>;
export type CallStartPayload = z.infer<typeof callStartSchema>;
export type CallIdPayload = z.infer<typeof callIdSchema>;
export type CallInvitePayload = z.infer<typeof callInviteSchema>;
export type CallSignalPayload = z.infer<typeof callSignalSchema>;
export type CallMediaStatePayload = z.infer<typeof callMediaStateSchema>;
