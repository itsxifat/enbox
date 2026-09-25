/**
 * Database schema (PostgreSQL, Drizzle ORM). Normative semantics: docs/ARCHITECTURE.md.
 *
 * Design notes
 * - Every chat has a monotonically increasing `last_seq`; each message gets the next seq
 *   (allocated under the chat row lock with `UPDATE chats SET last_seq = last_seq + 1 ...
 *   RETURNING`). Seqs are strictly increasing per chat but gaps are possible (purges), so
 *   never derive counts by subtracting seqs. Watermark receipts:
 *   `chat_members.last_read_seq / last_delivered_seq` replace per-message receipt rows.
 * - Chat membership rows are kept after leaving a group (`left_at`, `left_seq`) so former
 *   members keep read-only access to history up to `left_seq`, like WhatsApp. Channel
 *   follower rows are deleted on unfollow.
 * - Members only see messages with `seq > joined_seq` (channel followers: joined_seq = 0).
 * - Type-specific message content (location, contact, poll definition, system event, call
 *   record, status-reply reference) lives in `messages.metadata` (jsonb). Reply quotes are
 *   computed at read time from `reply_to_id` (no snapshot).
 * - Users are soft-deleted (`deleted_at`); rows are never hard-deleted, so FKs to users
 *   never fire in practice.
 * - All timestamps have millisecond precision so ISO cursors round-trip exactly.
 * - Raw SQL: int8 values are parsed as JS numbers (see db/index.ts); timestamps from raw rows
 *   go through `toIso()` (db/types.ts).
 */
import { relations, sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type {
  CallStatus,
  CallParticipantStatus,
  CallType,
  ChannelSettings,
  ChatType,
  GroupSettings,
  MediaKind,
  MemberRole,
  MessageType,
  StatusType,
  UserSettings,
} from '@enbox/shared';
import type { MessageMetadata } from './types.js';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date', precision: 3 });
const createdAt = () => ts('created_at').notNull().defaultNow();

// ---------------------------------------------------------------------------
// Users & auth
// ---------------------------------------------------------------------------

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Stored lowercase. Deleted accounts: `deleted_<first 12 hex chars of id>`. */
    username: text('username').notNull(),
    displayName: text('display_name').notNull(),
    /** Canonical E.164 with a leading '+', unique when present. */
    phone: text('phone'),
    passwordHash: text('password_hash').notNull(),
    about: text('about').notNull(),
    avatarMediaId: uuid('avatar_media_id').references((): AnyPgColumn => media.id, { onDelete: 'set null' }),
    /** Partial overrides; read through `resolveUserSettings()` (merges DEFAULT_USER_SETTINGS). */
    settings: jsonb('settings').$type<Partial<UserSettings>>().notNull().default({}),
    lastSeenAt: ts('last_seen_at'),
    /** Soft delete (PII scrubbed). Deleted users can't log in, be found, added, messaged or called. */
    deletedAt: ts('deleted_at'),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('users_username_uq').on(t.username),
    /** Username prefix search (`LIKE 'q%'`). */
    index('users_username_prefix_idx').on(t.username.op('text_pattern_ops')),
    uniqueIndex('users_phone_uq').on(t.phone),
    index('users_display_name_idx').on(sql`lower(${t.displayName})`),
    index('users_avatar_idx').on(t.avatarMediaId).where(sql`${t.avatarMediaId} is not null`),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** sha256(token) hex. The raw token is only ever returned once at login. */
    tokenHash: text('token_hash').notNull(),
    deviceName: text('device_name').notNull(),
    userAgent: text('user_agent'),
    ip: text('ip'),
    createdAt: createdAt(),
    lastActiveAt: ts('last_active_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
  },
  (t) => [uniqueIndex('sessions_token_hash_uq').on(t.tokenHash), index('sessions_user_idx').on(t.userId)],
);

export const contacts = pgTable(
  'contacts',
  {
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name'),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.ownerId, t.contactId] }), index('contacts_contact_idx').on(t.contactId)],
);

export const blocks = pgTable(
  'blocks',
  {
    blockerId: uuid('blocker_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    blockedId: uuid('blocked_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.blockerId, t.blockedId] }), index('blocks_blocked_idx').on(t.blockedId)],
);

export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** The session that registered it: logging out / revoking the session removes it. */
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    /** Unique: subscribing again (any user/session) reassigns the row (upsert). */
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('push_subscriptions_endpoint_uq').on(t.endpoint),
    index('push_subscriptions_user_idx').on(t.userId),
    index('push_subscriptions_session_idx').on(t.sessionId),
  ],
);

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

export const media = pgTable(
  'media',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    uploaderId: uuid('uploader_id').references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
    kind: text('kind').$type<MediaKind>().notNull(),
    /** Sniffed type (never the client's claim). */
    mimeType: text('mime_type').notNull(),
    /** Sanitised basename. */
    fileName: text('file_name'),
    size: bigint('size', { mode: 'number' }).notNull(),
    width: integer('width'),
    height: integer('height'),
    durationMs: integer('duration_ms'),
    waveform: jsonb('waveform').$type<number[]>(),
    /** Storage key relative to the uploads directory (also the public URL path). Extension from the sniffed type. */
    storageKey: text('storage_key').notNull(),
    /** Optional client-generated JPEG/WebP thumbnail/poster. */
    thumbnailKey: text('thumbnail_key'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('media_storage_key_uq').on(t.storageKey),
    index('media_uploader_idx').on(t.uploaderId),
    /** Orphan GC scans by age. */
    index('media_created_idx').on(t.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// Communities
// ---------------------------------------------------------------------------

export const communities = pgTable(
  'communities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description'),
    avatarMediaId: uuid('avatar_media_id').references(() => media.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    /** Unique across chats.invite_code too (regenerate on collision). */
    inviteCode: text('invite_code').notNull(),
    /**
     * The announcement group (a `group` chat with is_announcement = true). Set in the create
     * transaction and never null while the community exists (nullable only because of the
     * circular FK; deactivation deletes the chat first).
     */
    announcementChatId: uuid('announcement_chat_id').references((): AnyPgColumn => chats.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('communities_invite_code_uq').on(t.inviteCode),
    index('communities_avatar_idx').on(t.avatarMediaId).where(sql`${t.avatarMediaId} is not null`),
  ],
);

/** Authoritative community membership/roles; mirrored into the announcement chat's chat_members. */
export const communityMembers = pgTable(
  'community_members',
  {
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').$type<MemberRole>().notNull().default('member'),
    joinedAt: ts('joined_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.communityId, t.userId] }),
    index('community_members_user_idx').on(t.userId),
    /** Exactly one owner per community. */
    uniqueIndex('community_members_owner_uq').on(t.communityId).where(sql`${t.role} = 'owner'`),
  ],
);

// ---------------------------------------------------------------------------
// Chats
// ---------------------------------------------------------------------------

export const chats = pgTable(
  'chats',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: text('type').$type<ChatType>().notNull(),
    name: text('name'),
    description: text('description'),
    avatarMediaId: uuid('avatar_media_id').references(() => media.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    /** `directChatKey(a, b)` for direct chats (`a:a` for "Message yourself"); one chat per pair. */
    directKey: text('direct_key'),
    communityId: uuid('community_id').references((): AnyPgColumn => communities.id, { onDelete: 'set null' }),
    isAnnouncement: boolean('is_announcement').notNull().default(false),
    /** Groups only, always complete (DEFAULT_GROUP_SETTINGS merged at creation). */
    groupSettings: jsonb('group_settings').$type<GroupSettings>(),
    /** Channels only, always complete (DEFAULT_CHANNEL_SETTINGS merged at creation). */
    channelSettings: jsonb('channel_settings').$type<ChannelSettings>(),
    /** Groups and channels (not announcement groups); unique across communities.invite_code too. */
    inviteCode: text('invite_code'),
    disappearingSeconds: integer('disappearing_seconds'),
    lastSeq: bigint('last_seq', { mode: 'number' }).notNull().default(0),
    lastMessageAt: ts('last_message_at'),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('chats_direct_key_uq').on(t.directKey),
    uniqueIndex('chats_invite_code_uq').on(t.inviteCode),
    index('chats_community_idx').on(t.communityId),
    /** One announcement group per community. */
    uniqueIndex('chats_community_announcement_uq').on(t.communityId).where(sql`${t.isAnnouncement}`),
    /** Channel discovery. */
    index('chats_channels_idx').on(t.createdAt).where(sql`${t.type} = 'channel'`),
    index('chats_avatar_idx').on(t.avatarMediaId).where(sql`${t.avatarMediaId} is not null`),
    check('chats_type_ck', sql`${t.type} in ('direct', 'group', 'channel')`),
    check('chats_direct_key_ck', sql`(${t.type} = 'direct') = (${t.directKey} is not null)`),
    check('chats_group_settings_ck', sql`(${t.type} = 'group') = (${t.groupSettings} is not null)`),
    check('chats_channel_settings_ck', sql`(${t.type} = 'channel') = (${t.channelSettings} is not null)`),
    check('chats_community_ck', sql`${t.communityId} is null or ${t.type} = 'group'`),
    check('chats_announcement_ck', sql`not ${t.isAnnouncement} or (${t.communityId} is not null and ${t.inviteCode} is null)`),
  ],
);

export const chatMembers = pgTable(
  'chat_members',
  {
    chatId: uuid('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Reset to 'member' on leave/removal. Announcement groups mirror community_members.role. */
    role: text('role').$type<MemberRole>().notNull().default('member'),
    addedBy: uuid('added_by').references(() => users.id, { onDelete: 'set null' }),
    joinedAt: ts('joined_at').notNull().defaultNow(),
    /**
     * Messages with seq <= joined_seq predate this membership and are not visible.
     * Groups: (seq of the join/add system message) − 1; channels: 0.
     */
    joinedSeq: bigint('joined_seq', { mode: 'number' }).notNull().default(0),
    /** Set when the user left or was removed; history stays readable up to left_seq (= seq of that system message). */
    leftAt: ts('left_at'),
    leftSeq: bigint('left_seq', { mode: 'number' }),
    leftReason: text('left_reason').$type<'left' | 'removed'>(),
    /** Watermarks: monotonic, clamped to the member's latest visible seq, initialised to joined_seq. */
    lastReadSeq: bigint('last_read_seq', { mode: 'number' }).notNull().default(0),
    lastReadAt: ts('last_read_at'),
    lastDeliveredSeq: bigint('last_delivered_seq', { mode: 'number' }).notNull().default(0),
    lastDeliveredAt: ts('last_delivered_at'),
    /** "Clear chat" / "Delete chat": messages with seq <= cleared_seq are hidden for this member. */
    clearedSeq: bigint('cleared_seq', { mode: 'number' }).notNull().default(0),
    isPinned: boolean('is_pinned').notNull().default(false),
    pinnedAt: ts('pinned_at'),
    isArchived: boolean('is_archived').notNull().default(false),
    mutedUntil: ts('muted_until'),
    markedUnread: boolean('marked_unread').notNull().default(false),
    /** "Delete chat" for me (also sets cleared_seq): hidden from the list until a new visible message arrives. */
    hidden: boolean('hidden').notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.chatId, t.userId] }),
    index('chat_members_user_idx').on(t.userId),
    index('chat_members_user_active_idx').on(t.userId).where(sql`${t.leftAt} is null`),
    index('chat_members_chat_active_idx').on(t.chatId).where(sql`${t.leftAt} is null`),
    /** Exactly one active owner per group/channel. */
    uniqueIndex('chat_members_owner_uq').on(t.chatId).where(sql`${t.role} = 'owner' and ${t.leftAt} is null`),
    check('chat_members_left_ck', sql`(${t.leftAt} is null) = (${t.leftSeq} is null) and (${t.leftAt} is null) = (${t.leftReason} is null)`),
    check('chat_members_left_role_ck', sql`${t.leftAt} is null or ${t.role} = 'member'`),
  ],
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chatId: uuid('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    seq: bigint('seq', { mode: 'number' }).notNull(),
    /** Null only for system messages (call messages: the initiator). */
    senderId: uuid('sender_id').references(() => users.id, { onDelete: 'set null' }),
    /** Client id for idempotent sends; forwards use `<clientId>:<sourceIndex>`; null for server messages. */
    clientId: text('client_id'),
    type: text('type').$type<MessageType>().notNull(),
    text: text('text'),
    mediaId: uuid('media_id').references(() => media.id, { onDelete: 'set null' }),
    metadata: jsonb('metadata').$type<MessageMetadata>().notNull().default({}),
    replyToId: uuid('reply_to_id').references((): AnyPgColumn => messages.id, { onDelete: 'set null' }),
    forwardCount: integer('forward_count').notNull().default(0),
    /** Derived from the text's mention tokens (active members, ≤ MAX_MENTIONS). */
    mentions: uuid('mentions').array().notNull().default(sql`'{}'::uuid[]`),
    editedAt: ts('edited_at'),
    deletedAt: ts('deleted_at'),
    expiresAt: ts('expires_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('messages_chat_seq_uq').on(t.chatId, t.seq),
    uniqueIndex('messages_client_id_uq')
      .on(t.chatId, t.senderId, t.clientId)
      .where(sql`${t.clientId} is not null`),
    index('messages_sender_idx').on(t.senderId),
    index('messages_expires_idx').on(t.expiresAt).where(sql`${t.expiresAt} is not null`),
    index('messages_reply_to_idx').on(t.replyToId).where(sql`${t.replyToId} is not null`),
    index('messages_media_idx').on(t.mediaId).where(sql`${t.mediaId} is not null`),
    check('messages_system_sender_ck', sql`(${t.type} = 'system') = (${t.senderId} is null)`),
  ],
);

/** "Delete for me", plus messages withheld from a recipient who blocked the sender. */
export const messageHidden = pgTable(
  'message_hidden',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.messageId] }), index('message_hidden_message_idx').on(t.messageId)],
);

export const messageReactions = pgTable(
  'message_reactions',
  {
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    emoji: text('emoji').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.userId] })],
);

export const starredMessages = pgTable(
  'starred_messages',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.messageId] }), index('starred_messages_message_idx').on(t.messageId)],
);

export const chatPins = pgTable(
  'chat_pins',
  {
    chatId: uuid('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    /** Must belong to chat_id (checked by the service). */
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    pinnedBy: uuid('pinned_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.chatId, t.messageId] }), index('chat_pins_message_idx').on(t.messageId)],
);

export const pollVotes = pgTable(
  'poll_votes',
  {
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    optionId: text('option_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.userId, t.optionId] })],
);

// ---------------------------------------------------------------------------
// Status updates
// ---------------------------------------------------------------------------

export const statuses = pgTable(
  'statuses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').$type<StatusType>().notNull(),
    text: text('text'),
    backgroundColor: text('background_color'),
    font: integer('font'),
    mediaId: uuid('media_id').references(() => media.id, { onDelete: 'set null' }),
    /** Audience snapshot at post time (author's contacts per status privacy, minus blocks/deleted). */
    audience: uuid('audience').array().notNull().default(sql`'{}'::uuid[]`),
    createdAt: createdAt(),
    expiresAt: ts('expires_at').notNull(),
  },
  (t) => [
    index('statuses_user_expires_idx').on(t.userId, t.expiresAt),
    index('statuses_expires_idx').on(t.expiresAt),
    /** Feed lookup: `audience @> ARRAY[$viewer]::uuid[]`. */
    index('statuses_audience_gin').using('gin', t.audience),
    index('statuses_media_idx').on(t.mediaId).where(sql`${t.mediaId} is not null`),
  ],
);

export const statusViews = pgTable(
  'status_views',
  {
    statusId: uuid('status_id')
      .notNull()
      .references(() => statuses.id, { onDelete: 'cascade' }),
    viewerId: uuid('viewer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    viewedAt: ts('viewed_at').notNull().defaultNow(),
    reaction: text('reaction'),
  },
  (t) => [primaryKey({ columns: [t.statusId, t.viewerId] }), index('status_views_viewer_idx').on(t.viewerId)],
);

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

export const calls = pgTable(
  'calls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chatId: uuid('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    initiatorId: uuid('initiator_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').$type<CallType>().notNull(),
    isGroup: boolean('is_group').notNull().default(false),
    status: text('status').$type<CallStatus>().notNull().default('ringing'),
    /** The chat message that records this call in history. */
    messageId: uuid('message_id').references((): AnyPgColumn => messages.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    answeredAt: ts('answered_at'),
    endedAt: ts('ended_at'),
  },
  (t) => [
    index('calls_chat_idx').on(t.chatId, t.createdAt),
    /** One live call per chat (also serializes concurrent call:start). */
    uniqueIndex('calls_chat_live_uq').on(t.chatId).where(sql`${t.status} in ('ringing', 'ongoing')`),
    /** Timeout job and crash recovery. */
    index('calls_live_idx').on(t.createdAt).where(sql`${t.status} in ('ringing', 'ongoing')`),
    index('calls_message_idx').on(t.messageId).where(sql`${t.messageId} is not null`),
  ],
);

export const callParticipants = pgTable(
  'call_participants',
  {
    callId: uuid('call_id')
      .notNull()
      .references(() => calls.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: text('status').$type<CallParticipantStatus>().notNull().default('invited'),
    /** Last (re-)invite time; the ring timeout counts from here. */
    invitedAt: ts('invited_at').notNull().defaultNow(),
    joinedAt: ts('joined_at'),
    leftAt: ts('left_at'),
    /** Session whose socket is this participant's call socket (set on start/accept/join/rejoin). */
    sessionId: uuid('session_id').references(() => sessions.id, { onDelete: 'set null' }),
    /** Set when the call socket disconnects; cleared by call:rejoin. Left after CALL_RECONNECT_GRACE_MS. */
    disconnectedAt: ts('disconnected_at'),
    audioMuted: boolean('audio_muted').notNull().default(false),
    videoOff: boolean('video_off').notNull().default(false),
    screenSharing: boolean('screen_sharing').notNull().default(false),
    /** Removed from this user's call log (also set at creation for a callee who blocked the caller: never shown to them). */
    hiddenAt: ts('hidden_at'),
  },
  (t) => [
    primaryKey({ columns: [t.callId, t.userId] }),
    /** Call log: my calls by time. */
    index('call_participants_user_idx').on(t.userId, t.invitedAt),
    /** A user is joined to at most one call ("busy" otherwise). */
    uniqueIndex('call_participants_one_joined_uq').on(t.userId).where(sql`${t.status} = 'joined'`),
  ],
);

// ---------------------------------------------------------------------------
// Relations (for the relational query API: db.query.*)
// ---------------------------------------------------------------------------

export const usersRelations = relations(users, ({ one, many }) => ({
  avatar: one(media, { fields: [users.avatarMediaId], references: [media.id] }),
  sessions: many(sessions),
  memberships: many(chatMembers),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const chatsRelations = relations(chats, ({ one, many }) => ({
  avatar: one(media, { fields: [chats.avatarMediaId], references: [media.id] }),
  community: one(communities, { fields: [chats.communityId], references: [communities.id] }),
  members: many(chatMembers),
  messages: many(messages),
}));

export const chatMembersRelations = relations(chatMembers, ({ one }) => ({
  chat: one(chats, { fields: [chatMembers.chatId], references: [chats.id] }),
  user: one(users, { fields: [chatMembers.userId], references: [users.id] }),
}));

export const messagesRelations = relations(messages, ({ one, many }) => ({
  chat: one(chats, { fields: [messages.chatId], references: [chats.id] }),
  sender: one(users, { fields: [messages.senderId], references: [users.id] }),
  media: one(media, { fields: [messages.mediaId], references: [media.id] }),
  replyTo: one(messages, { fields: [messages.replyToId], references: [messages.id] }),
  reactions: many(messageReactions),
}));

export const messageReactionsRelations = relations(messageReactions, ({ one }) => ({
  message: one(messages, { fields: [messageReactions.messageId], references: [messages.id] }),
}));

export const communitiesRelations = relations(communities, ({ one, many }) => ({
  avatar: one(media, { fields: [communities.avatarMediaId], references: [media.id] }),
  members: many(communityMembers),
  groups: many(chats),
}));

export const communityMembersRelations = relations(communityMembers, ({ one }) => ({
  community: one(communities, { fields: [communityMembers.communityId], references: [communities.id] }),
  user: one(users, { fields: [communityMembers.userId], references: [users.id] }),
}));

export const statusesRelations = relations(statuses, ({ one, many }) => ({
  user: one(users, { fields: [statuses.userId], references: [users.id] }),
  media: one(media, { fields: [statuses.mediaId], references: [media.id] }),
  views: many(statusViews),
}));

export const statusViewsRelations = relations(statusViews, ({ one }) => ({
  status: one(statuses, { fields: [statusViews.statusId], references: [statuses.id] }),
}));

export const callsRelations = relations(calls, ({ one, many }) => ({
  chat: one(chats, { fields: [calls.chatId], references: [chats.id] }),
  participants: many(callParticipants),
}));

export const callParticipantsRelations = relations(callParticipants, ({ one }) => ({
  call: one(calls, { fields: [callParticipants.callId], references: [calls.id] }),
}));

export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type MediaRow = typeof media.$inferSelect;
export type ChatRow = typeof chats.$inferSelect;
export type ChatMemberRow = typeof chatMembers.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type CommunityRow = typeof communities.$inferSelect;
export type CommunityMemberRow = typeof communityMembers.$inferSelect;
export type StatusRow = typeof statuses.$inferSelect;
export type CallRow = typeof calls.$inferSelect;
export type CallParticipantRow = typeof callParticipants.$inferSelect;
export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;
