/**
 * Database schema (PostgreSQL, Drizzle ORM).
 *
 * Design notes
 * - Every chat has a monotonically increasing `last_seq`; each message gets the next seq
 *   (allocated with `UPDATE chats SET last_seq = last_seq + 1 ... RETURNING`), which gives
 *   gap-free ordering, cheap pagination and watermark-based receipts:
 *   `chat_members.last_read_seq / last_delivered_seq` replace per-message receipt rows.
 * - Chat membership rows are kept after leaving (`left_at`, `left_seq`) so former members
 *   keep read-only access to history up to `left_seq`, like WhatsApp.
 * - New members only see messages with `seq > joined_seq`.
 * - Type-specific message content (location, contact, poll definition, system event,
 *   call record, status reply, reply snapshot) lives in `messages.metadata` (jsonb).
 */
import { relations, sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
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

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const createdAt = () => ts('created_at').notNull().defaultNow();

// ---------------------------------------------------------------------------
// Users & auth
// ---------------------------------------------------------------------------

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Stored lowercase. */
    username: text('username').notNull(),
    displayName: text('display_name').notNull(),
    /** Normalised E.164-ish, unique when present. */
    phone: text('phone'),
    passwordHash: text('password_hash').notNull(),
    about: text('about').notNull(),
    avatarMediaId: uuid('avatar_media_id').references((): AnyPgColumn => media.id, { onDelete: 'set null' }),
    /** Partial settings; merge over DEFAULT_USER_SETTINGS when reading. */
    settings: jsonb('settings').$type<Partial<UserSettings>>().notNull().default({}),
    lastSeenAt: ts('last_seen_at'),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('users_username_uq').on(t.username),
    uniqueIndex('users_phone_uq').on(t.phone),
    index('users_display_name_idx').on(sql`lower(${t.displayName})`),
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
    sessionId: uuid('session_id').references(() => sessions.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('push_subscriptions_endpoint_uq').on(t.endpoint), index('push_subscriptions_user_idx').on(t.userId)],
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
    mimeType: text('mime_type').notNull(),
    fileName: text('file_name'),
    size: bigint('size', { mode: 'number' }).notNull(),
    width: integer('width'),
    height: integer('height'),
    durationMs: integer('duration_ms'),
    waveform: jsonb('waveform').$type<number[]>(),
    /** Storage key relative to the uploads directory (also the public URL path segment). */
    storageKey: text('storage_key').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('media_storage_key_uq').on(t.storageKey), index('media_uploader_idx').on(t.uploaderId)],
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
    inviteCode: text('invite_code').notNull(),
    /** The announcement group (a `group` chat with is_announcement = true). */
    announcementChatId: uuid('announcement_chat_id').references((): AnyPgColumn => chats.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('communities_invite_code_uq').on(t.inviteCode)],
);

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
  (t) => [primaryKey({ columns: [t.communityId, t.userId] }), index('community_members_user_idx').on(t.userId)],
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
    /** `directChatKey(a, b)` for direct chats; guarantees one chat per pair. */
    directKey: text('direct_key'),
    communityId: uuid('community_id').references((): AnyPgColumn => communities.id, { onDelete: 'set null' }),
    isAnnouncement: boolean('is_announcement').notNull().default(false),
    groupSettings: jsonb('group_settings').$type<GroupSettings>(),
    channelSettings: jsonb('channel_settings').$type<ChannelSettings>(),
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
    index('chats_type_idx').on(t.type),
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
    role: text('role').$type<MemberRole>().notNull().default('member'),
    addedBy: uuid('added_by').references(() => users.id, { onDelete: 'set null' }),
    joinedAt: ts('joined_at').notNull().defaultNow(),
    /** Messages with seq <= joined_seq predate this membership and are not visible. */
    joinedSeq: bigint('joined_seq', { mode: 'number' }).notNull().default(0),
    /** Set when the user left or was removed; history stays readable up to left_seq. */
    leftAt: ts('left_at'),
    leftSeq: bigint('left_seq', { mode: 'number' }),
    leftReason: text('left_reason').$type<'left' | 'removed'>(),
    lastReadSeq: bigint('last_read_seq', { mode: 'number' }).notNull().default(0),
    lastReadAt: ts('last_read_at'),
    lastDeliveredSeq: bigint('last_delivered_seq', { mode: 'number' }).notNull().default(0),
    lastDeliveredAt: ts('last_delivered_at'),
    /** "Clear chat": messages with seq <= cleared_seq are hidden for this member. */
    clearedSeq: bigint('cleared_seq', { mode: 'number' }).notNull().default(0),
    isPinned: boolean('is_pinned').notNull().default(false),
    pinnedAt: ts('pinned_at'),
    isArchived: boolean('is_archived').notNull().default(false),
    mutedUntil: ts('muted_until'),
    markedUnread: boolean('marked_unread').notNull().default(false),
    /** "Delete chat" for me: hidden from the list until a new message arrives. */
    hidden: boolean('hidden').notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.chatId, t.userId] }),
    index('chat_members_user_idx').on(t.userId),
    index('chat_members_chat_active_idx').on(t.chatId).where(sql`${t.leftAt} is null`),
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
    senderId: uuid('sender_id').references(() => users.id, { onDelete: 'set null' }),
    clientId: text('client_id'),
    type: text('type').$type<MessageType>().notNull(),
    text: text('text'),
    mediaId: uuid('media_id').references(() => media.id, { onDelete: 'set null' }),
    metadata: jsonb('metadata').$type<MessageMetadata>().notNull().default({}),
    replyToId: uuid('reply_to_id').references((): AnyPgColumn => messages.id, { onDelete: 'set null' }),
    forwardCount: integer('forward_count').notNull().default(0),
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
    index('messages_reply_to_idx').on(t.replyToId),
  ],
);

/** "Delete for me". */
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
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    pinnedBy: uuid('pinned_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.chatId, t.messageId] })],
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
    /** Audience snapshot at post time (resolved from the author's status privacy). */
    audience: uuid('audience').array().notNull().default(sql`'{}'::uuid[]`),
    createdAt: createdAt(),
    expiresAt: ts('expires_at').notNull(),
  },
  (t) => [index('statuses_user_expires_idx').on(t.userId, t.expiresAt), index('statuses_expires_idx').on(t.expiresAt)],
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
    initiatorId: uuid('initiator_id').references(() => users.id, { onDelete: 'set null' }),
    type: text('type').$type<CallType>().notNull(),
    isGroup: boolean('is_group').notNull().default(false),
    status: text('status').$type<CallStatus>().notNull().default('ringing'),
    /** The chat message that records this call in history. */
    messageId: uuid('message_id').references((): AnyPgColumn => messages.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    answeredAt: ts('answered_at'),
    endedAt: ts('ended_at'),
  },
  (t) => [index('calls_chat_idx').on(t.chatId, t.createdAt), index('calls_status_idx').on(t.status)],
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
    invitedAt: ts('invited_at').notNull().defaultNow(),
    joinedAt: ts('joined_at'),
    leftAt: ts('left_at'),
    /** Removed from this user's call log. */
    hiddenAt: ts('hidden_at'),
  },
  (t) => [primaryKey({ columns: [t.callId, t.userId] }), index('call_participants_user_idx').on(t.userId)],
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
