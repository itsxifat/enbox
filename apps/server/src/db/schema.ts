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
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type {
  AutoModAction,
  AutoModTriggerMetadata,
  AutoModTriggerType,
  Availability,
  CallParticipantStatus,
  CallStatus,
  CallType,
  ChannelSettings,
  ChatRequestState,
  ChatTheme,
  ChatType,
  ForumSettings,
  ForumTag,
  ForwardSource,
  GroupSettings,
  MediaKind,
  MemberRole,
  MessageAuthorOverride,
  MessageEmbed,
  MessageType,
  NameStyle,
  NotifyLevel,
  RailEntry,
  ReportCategory,
  ReportEvidence,
  ReportStatus,
  ReportTarget,
  RoleColorStyle,
  OnboardingAnswers,
  ServerGuide,
  SpaceTagBadge,
  SharedChatTheme,
  SpaceEventEntity,
  SpaceEventStatus,
  SpaceOnboarding,
  SpaceTemplateSnapshot,
  StatusType,
  UserSettings,
  WebhookKind,
  WelcomeScreen,
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
    /** Two-factor (TOTP, RFC 6238): the base32 secret once enabled, else null. */
    totpSecret: text('totp_secret'),
    /** A secret being set up (confirmed by a first code, then moved to `totp_secret`). */
    totpPendingSecret: text('totp_pending_secret'),
    totpEnabledAt: ts('totp_enabled_at'),
    /** The last 30-second step a code was accepted for (a code works once). */
    totpLastStep: bigint('totp_last_step', { mode: 'number' }),
    about: text('about').notNull(),
    avatarMediaId: uuid('avatar_media_id').references((): AnyPgColumn => media.id, {
      onDelete: 'set null',
    }),
    /** Profile banner (static or animated image, 5:2). */
    bannerMediaId: uuid('banner_media_id').references((): AnyPgColumn => media.id, {
      onDelete: 'set null',
    }),
    pronouns: text('pronouns'),
    /** Multi-line profile bio; `about` stays the one-line status. */
    bio: text('bio').notNull().default(''),
    /** Lowercase `#rrggbb` or null (checked). */
    profileColor: text('profile_color'),
    accentColor: text('accent_color'),
    /** Cosmetics: catalogue ids from `@enbox/shared` cosmetics (validated on write), null = none. */
    avatarDecoration: text('avatar_decoration'),
    profileEffect: text('profile_effect'),
    nameplate: text('nameplate'),
    nameStyle: jsonb('name_style').$type<NameStyle>(),
    /** My Space rail order and folders (`RailEntry[]`), synced across devices. */
    railLayout: jsonb('rail_layout').$type<RailEntry[]>().notNull().default([]),
    /** The Space whose server tag I wear (cleared when I leave it). */
    tagSpaceId: uuid('tag_space_id').references((): AnyPgColumn => spaces.id, {
      onDelete: 'set null',
    }),
    /** Chosen availability; `effectiveAvailability()` reverts it to 'online' once `availability_until` passes. */
    availability: text('availability').$type<Availability>().notNull().default('online'),
    availabilityUntil: ts('availability_until'),
    /** Presence note ("status message"); all three null when unset, cleared by the presence-expiry job. */
    presenceNoteText: text('presence_note_text'),
    presenceNoteEmoji: text('presence_note_emoji'),
    presenceNoteExpiresAt: ts('presence_note_expires_at'),
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
    index('users_avatar_idx')
      .on(t.avatarMediaId)
      .where(sql`${t.avatarMediaId} is not null`),
    index('users_banner_idx')
      .on(t.bannerMediaId)
      .where(sql`${t.bannerMediaId} is not null`),
    /** Presence-expiry job scans. */
    index('users_availability_until_idx')
      .on(t.availabilityUntil)
      .where(sql`${t.availabilityUntil} is not null`),
    index('users_presence_note_expires_idx')
      .on(t.presenceNoteExpiresAt)
      .where(sql`${t.presenceNoteExpiresAt} is not null`),
    /** Wearers of a Space's tag (cleared when they leave it). */
    index('users_tag_space_idx')
      .on(t.tagSpaceId)
      .where(sql`${t.tagSpaceId} is not null`),
    check(
      'users_profile_color_ck',
      sql`${t.profileColor} is null or ${t.profileColor} ~ '^#[0-9a-f]{6}$'`,
    ),
    check(
      'users_accent_color_ck',
      sql`${t.accentColor} is null or ${t.accentColor} ~ '^#[0-9a-f]{6}$'`,
    ),
    check(
      'users_availability_ck',
      sql`${t.availability} in ('online', 'idle', 'dnd', 'invisible')`,
    ),
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
  (t) => [
    uniqueIndex('sessions_token_hash_uq').on(t.tokenHash),
    index('sessions_user_idx').on(t.userId),
  ],
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
  (t) => [
    primaryKey({ columns: [t.ownerId, t.contactId] }),
    index('contacts_contact_idx').on(t.contactId),
  ],
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
  (t) => [
    primaryKey({ columns: [t.blockerId, t.blockedId] }),
    index('blocks_blocked_idx').on(t.blockedId),
  ],
);

/** Two-factor backup codes (hashed; each works once). */
/** Users I ignore (silent: they're never told; their messages collapse, no pushes). */
export const userIgnores = pgTable(
  'user_ignores',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    ignoredId: uuid('ignored_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.ignoredId] }),
    index('user_ignores_ignored_idx').on(t.ignoredId),
  ],
);

/** Reports of messages, users and Spaces (Space content also reaches its moderators). */
export const reports = pgTable(
  'reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reporterId: uuid('reporter_id').references(() => users.id, { onDelete: 'set null' }),
    targetType: text('target_type').$type<ReportTarget>().notNull(),
    targetId: uuid('target_id').notNull(),
    /** The Space whose moderators see it (Space channels, Space members, the Space itself). */
    spaceId: uuid('space_id').references((): AnyPgColumn => spaces.id, { onDelete: 'cascade' }),
    category: text('category').$type<ReportCategory>().notNull(),
    details: text('details'),
    /** What was reported, as it was then. */
    evidence: jsonb('evidence').$type<ReportEvidence>().notNull().default({}),
    /** The reported message's files: media GC keeps them while the report exists. */
    mediaIds: uuid('media_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    status: text('status').$type<ReportStatus>().notNull().default('open'),
    createdAt: createdAt(),
    resolvedAt: ts('resolved_at'),
    resolvedBy: uuid('resolved_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    index('reports_space_idx')
      .on(t.spaceId, t.status, t.createdAt)
      .where(sql`${t.spaceId} is not null`),
    index('reports_reporter_idx').on(t.reporterId, t.createdAt),
    check('reports_target_ck', sql`${t.targetType} in ('message', 'user', 'space')`),
    check('reports_status_ck', sql`${t.status} in ('open', 'resolved', 'dismissed')`),
  ],
);

export const userBackupCodes = pgTable(
  'user_backup_codes',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    usedAt: ts('used_at'),
  },
  (t) => [primaryKey({ columns: [t.userId, t.codeHash] })],
);

/** A pending friend request (accepting makes both users each other's contacts). */
export const friendRequests = pgTable(
  'friend_requests',
  {
    fromId: uuid('from_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    toId: uuid('to_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.fromId, t.toId] }),
    index('friend_requests_to_idx').on(t.toId, t.createdAt),
  ],
);

/** My private note about another user (shown only to me on their profile). */
export const userNotes = pgTable(
  'user_notes',
  {
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    note: text('note').notNull(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.ownerId, t.subjectId] }),
    index('user_notes_subject_idx').on(t.subjectId),
  ],
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
    uploaderId: uuid('uploader_id').references((): AnyPgColumn => users.id, {
      onDelete: 'set null',
    }),
    kind: text('kind').$type<MediaKind>().notNull(),
    /** Sniffed type (never the client's claim). */
    mimeType: text('mime_type').notNull(),
    /** Sanitised basename. */
    fileName: text('file_name'),
    size: bigint('size', { mode: 'number' }).notNull(),
    /** Server-verified for images (parsed from the file header); client-reported otherwise. */
    width: integer('width'),
    height: integer('height'),
    /** Multi-frame GIF/APNG/WebP (server-sniffed). `thumbnail_key` is then the required static poster. */
    animated: boolean('animated').notNull().default(false),
    frameCount: integer('frame_count'),
    /** Image metadata (EXIF/XMP/ICC/comments) was stripped server-side at upload. */
    metadataStripped: boolean('metadata_stripped').notNull().default(false),
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
// Link previews
// ---------------------------------------------------------------------------

/**
 * Cache of fetched link previews (services/linkPreviews.ts), one row per normalised link.
 * A row without title, description and image records a link that has no preview (retried
 * sooner than a real one is refreshed). `image_key` is a file under UPLOAD_DIR owned by the
 * row: the GC job deletes it with the row, a refresh replaces it.
 */
export const linkPreviews = pgTable(
  'link_previews',
  {
    url: text('url').primaryKey(),
    domain: text('domain'),
    siteName: text('site_name'),
    title: text('title'),
    description: text('description'),
    themeColor: text('theme_color'),
    imageKey: text('image_key'),
    imageWidth: integer('image_width'),
    imageHeight: integer('image_height'),
    fetchedAt: ts('fetched_at').notNull().defaultNow(),
  },
  (t) => [
    /** GC scans by age. */
    index('link_previews_fetched_idx').on(t.fetchedAt),
  ],
);

// ---------------------------------------------------------------------------
// Spaces (docs/design/spaces-at-scale.md "Data model")
// ---------------------------------------------------------------------------

/**
 * A Space (Discord "server"). Its channels are `chats` rows of type space_text/space_voice.
 * Access is COMPUTED from space_members + roles + channel overwrites (permissions.ts); a
 * channel's chat_members rows are only lazy per-viewer read state.
 */
export const spaces = pgTable(
  'spaces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description'),
    iconMediaId: uuid('icon_media_id').references(() => media.id, { onDelete: 'set null' }),
    bannerMediaId: uuid('banner_media_id').references(() => media.id, { onDelete: 'set null' }),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    systemChannelId: uuid('system_channel_id').references((): AnyPgColumn => chats.id, {
      onDelete: 'set null',
    }),
    rulesChannelId: uuid('rules_channel_id').references((): AnyPgColumn => chats.id, {
      onDelete: 'set null',
    }),
    afkChannelId: uuid('afk_channel_id').references((): AnyPgColumn => chats.id, {
      onDelete: 'set null',
    }),
    afkTimeoutSec: integer('afk_timeout_sec').notNull().default(300),
    defaultNotifyLevel: text('default_notify_level')
      .$type<'all' | 'mentions'>()
      .notNull()
      .default('mentions'),
    isDiscoverable: boolean('is_discoverable').notNull().default(false),
    /** Vanity invite code (shares the invite code space with chats and space_invites). */
    vanityCode: text('vanity_code'),
    /** Maintained in the join/leave transactions (under the Space row lock). */
    memberCount: integer('member_count').notNull().default(0),
    /** Bumped by every change that can alter permissions (roles, overwrites, member roles). */
    permVersion: integer('perm_version').notNull().default(0),
    /** The community this Space was converted from (conversion idempotency). */
    legacyCommunityId: uuid('legacy_community_id'),
    /** SPACE_SYSTEM_FLAGS bits: which system messages are suppressed in the system channel. */
    systemFlags: integer('system_flags').notNull().default(0),
    /** 0 none, 1 low (verified email), 2 medium (+5 min account), 3 high (+10 min member), 4 highest (phone). */
    verificationLevel: smallint('verification_level').notNull().default(0),
    /** 0 off, 1 members without roles, 2 everyone: scan media for explicit content. */
    explicitFilter: smallint('explicit_filter').notNull().default(0),
    /** Security actions: no invite joins until then (null = invites work). */
    invitesPausedUntil: ts('invites_paused_until'),
    /** Security actions: no new DMs between members who aren't friends until then. */
    dmsPausedUntil: ts('dms_paused_until'),
    /** Where raid and security alerts go. */
    safetyAlertsChannelId: uuid('safety_alerts_channel_id').references((): AnyPgColumn => chats.id, {
      onDelete: 'set null',
    }),
    raidAlerts: boolean('raid_alerts').notNull().default(true),
    /** The Server Guide (null = none). */
    guide: jsonb('guide').$type<ServerGuide>(),
    /** Discovery listing (with `is_discoverable`): DISCOVERY_CATEGORIES id and search tags. */
    discoveryCategory: text('discovery_category'),
    discoveryTags: text('discovery_tags').array().notNull().default(sql`'{}'::text[]`),
    /** Shown to new members on join (null = off). */
    welcomeScreen: jsonb('welcome_screen').$type<WelcomeScreen>(),
    /** Server tag members can wear next to their name: 2-4 letters, a badge and its colour. */
    tag: text('tag'),
    tagBadge: text('tag_badge').$type<SpaceTagBadge>(),
    tagColor: text('tag_color'),
    /** Onboarding questions that hand out roles (null = off). */
    onboarding: jsonb('onboarding').$type<SpaceOnboarding>(),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('spaces_vanity_code_uq').on(t.vanityCode),
    /** Discovery: the biggest discoverable Spaces first. */
    index('spaces_discovery_idx')
      .on(t.memberCount)
      .where(sql`${t.isDiscoverable}`),
    uniqueIndex('spaces_legacy_community_uq').on(t.legacyCommunityId),
    index('spaces_owner_idx').on(t.ownerId),
    index('spaces_icon_idx')
      .on(t.iconMediaId)
      .where(sql`${t.iconMediaId} is not null`),
    index('spaces_banner_idx')
      .on(t.bannerMediaId)
      .where(sql`${t.bannerMediaId} is not null`),
    index('spaces_discoverable_idx')
      .on(t.memberCount)
      .where(sql`${t.isDiscoverable}`),
    check('spaces_notify_ck', sql`${t.defaultNotifyLevel} in ('all', 'mentions')`),
    check(
      'spaces_tag_ck',
      sql`(${t.tag} is null) = (${t.tagBadge} is null) and (${t.tag} is null) = (${t.tagColor} is null) and (${t.tag} is null or char_length(${t.tag}) between 2 and 4) and (${t.tagColor} is null or ${t.tagColor} ~ '^#[0-9a-f]{6}$')`,
    ),
  ],
);

export const spaceMembers = pgTable(
  'space_members',
  {
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    nickname: text('nickname'),
    /** lower(nickname or display name): the member list order (keyset paging). */
    sortName: text('sort_name').notNull(),
    joinedAt: ts('joined_at').notNull().defaultNow(),
    timedOutUntil: ts('timed_out_until'),
    serverMute: boolean('server_mute').notNull().default(false),
    serverDeaf: boolean('server_deaf').notNull().default(false),
    notifyLevel: text('notify_level').$type<NotifyLevel>(),
    mutedUntil: ts('muted_until'),
    suppressEveryone: boolean('suppress_everyone').notNull().default(false),
    suppressRoles: boolean('suppress_roles').notNull().default(false),
    /** Hide channels I muted from my sidebar. */
    hideMutedChannels: boolean('hide_muted_channels').notNull().default(false),
    /** Finished the Space's onboarding (or there was none when they joined). */
    onboardedAt: ts('onboarded_at'),
    /** Members of this Space may DM me (new memberships take `settings.allowSpaceDms`). */
    allowDms: boolean('allow_dms').notNull().default(true),
    /** My onboarding answers (prompt id → option ids); Channels & Roles changes them. */
    onboardingAnswers: jsonb('onboarding_answers').$type<OnboardingAnswers>(),
    /** Server Guide to-dos I did (their channel ids). */
    guideDone: uuid('guide_done')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    /** Per-Space profile: each null field falls back to the main profile. */
    avatarMediaId: uuid('avatar_media_id').references((): AnyPgColumn => media.id, {
      onDelete: 'set null',
    }),
    bannerMediaId: uuid('banner_media_id').references((): AnyPgColumn => media.id, {
      onDelete: 'set null',
    }),
    bio: text('bio'),
    pronouns: text('pronouns'),
    profileColor: text('profile_color'),
    accentColor: text('accent_color'),
    avatarDecoration: text('avatar_decoration'),
    profileEffect: text('profile_effect'),
    nameplate: text('nameplate'),
  },
  (t) => [
    primaryKey({ columns: [t.spaceId, t.userId] }),
    index('space_members_user_idx').on(t.userId),
    index('space_members_avatar_idx')
      .on(t.avatarMediaId)
      .where(sql`${t.avatarMediaId} is not null`),
    index('space_members_banner_idx')
      .on(t.bannerMediaId)
      .where(sql`${t.bannerMediaId} is not null`),
    index('space_members_sort_idx').on(t.spaceId, t.sortName, t.userId),
    index('space_members_sort_prefix_idx').on(t.spaceId, t.sortName.op('text_pattern_ops')),
    check(
      'space_members_notify_ck',
      sql`${t.notifyLevel} is null or ${t.notifyLevel} in ('all', 'mentions', 'none')`,
    ),
  ],
);

export const spaceRoles = pgTable(
  'space_roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color'),
    /** 0 = @everyone; unique per Space (reorders rewrite positions in one statement). */
    position: integer('position').notNull(),
    permissions: integer('permissions').notNull().default(0),
    hoist: boolean('hoist').notNull().default(false),
    mentionable: boolean('mentionable').notNull().default(false),
    isDefault: boolean('is_default').notNull().default(false),
    /** Role name style: `color` alone, a `color`→`color_secondary` gradient, or holographic. */
    colorStyle: text('color_style').$type<RoleColorStyle>().notNull().default('solid'),
    colorSecondary: text('color_secondary'),
    /** Role icon: a unicode emoji or an uploaded image (the image wins). */
    iconEmoji: text('icon_emoji'),
    iconMediaId: uuid('icon_media_id').references((): AnyPgColumn => media.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
  },
  (t) => [
    index('space_roles_space_idx').on(t.spaceId, t.position),
    index('space_roles_icon_idx')
      .on(t.iconMediaId)
      .where(sql`${t.iconMediaId} is not null`),
    check(
      'space_roles_color2_ck',
      sql`${t.colorSecondary} is null or ${t.colorSecondary} ~ '^#[0-9a-f]{6}$'`,
    ),
    check(
      'space_roles_style_ck',
      sql`${t.colorStyle} in ('solid', 'gradient', 'holographic')`,
    ),
    uniqueIndex('space_roles_default_uq')
      .on(t.spaceId)
      .where(sql`${t.isDefault}`),
    check('space_roles_color_ck', sql`${t.color} is null or ${t.color} ~ '^#[0-9a-f]{6}$'`),
    check('space_roles_perm_ck', sql`${t.permissions} >= 0`),
    check('space_roles_default_ck', sql`${t.isDefault} = (${t.position} = 0)`),
  ],
);

export const spaceMemberRoles = pgTable(
  'space_member_roles',
  {
    spaceId: uuid('space_id').notNull(),
    userId: uuid('user_id').notNull(),
    roleId: uuid('role_id')
      .notNull()
      .references(() => spaceRoles.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.spaceId, t.userId, t.roleId] }),
    index('space_member_roles_role_idx').on(t.roleId),
    foreignKey({
      columns: [t.spaceId, t.userId],
      foreignColumns: [spaceMembers.spaceId, spaceMembers.userId],
      name: 'space_member_roles_member_fk',
    }).onDelete('cascade'),
  ],
);

export const spaceCategories = pgTable(
  'space_categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    position: integer('position').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index('space_categories_space_idx').on(t.spaceId, t.position)],
);

/** Evaluated channel overwrites (permissions.ts). */
export const spaceChannelOverwrites = pgTable(
  'space_channel_overwrites',
  {
    chatId: uuid('chat_id')
      .notNull()
      .references((): AnyPgColumn => chats.id, { onDelete: 'cascade' }),
    targetType: text('target_type').$type<'role' | 'member'>().notNull(),
    targetId: uuid('target_id').notNull(),
    allow: integer('allow').notNull().default(0),
    deny: integer('deny').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.chatId, t.targetType, t.targetId] }),
    index('space_channel_overwrites_target_idx').on(t.targetId),
    check('space_channel_overwrites_type_ck', sql`${t.targetType} in ('role', 'member')`),
    check('space_channel_overwrites_bits_ck', sql`(${t.allow} & ${t.deny}) = 0`),
  ],
);

/**
 * Who is in which voice channel (Discord voice states): one row per account, so joining
 * another channel moves you. Truth for sidebars and permission checks; the media server
 * (LiveKit) is reconciled against it by the jobs leader.
 */
export const voiceStates = pgTable(
  'voice_states',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    /** Socket that joined (a new join from another device takes over). */
    socketId: text('socket_id').notNull(),
    nodeId: text('node_id').notNull(),
    selfMute: boolean('self_mute').notNull().default(false),
    selfDeaf: boolean('self_deaf').notNull().default(false),
    selfVideo: boolean('self_video').notNull().default(false),
    selfStream: boolean('self_stream').notNull().default(false),
    /** Stage channels: in the audience (can't speak until a moderator invites them up). */
    suppressed: boolean('suppressed').notNull().default(false),
    /** Stage channels: a raised hand (null = none). */
    requestToSpeakAt: ts('request_to_speak_at'),
    joinedAt: ts('joined_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('voice_states_channel_idx').on(t.channelId),
    index('voice_states_space_idx').on(t.spaceId),
    index('voice_states_node_idx').on(t.nodeId),
  ],
);

/** Category overwrites: templates copied to channels on create and sync, never evaluated. */
export const spaceCategoryOverwrites = pgTable(
  'space_category_overwrites',
  {
    categoryId: uuid('category_id')
      .notNull()
      .references(() => spaceCategories.id, { onDelete: 'cascade' }),
    targetType: text('target_type').$type<'role' | 'member'>().notNull(),
    targetId: uuid('target_id').notNull(),
    allow: integer('allow').notNull().default(0),
    deny: integer('deny').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.categoryId, t.targetType, t.targetId] }),
    check('space_category_overwrites_type_ck', sql`${t.targetType} in ('role', 'member')`),
    check('space_category_overwrites_bits_ck', sql`(${t.allow} & ${t.deny}) = 0`),
  ],
);

export const spaceBans = pgTable(
  'space_bans',
  {
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    bannedBy: uuid('banned_by').references(() => users.id, { onDelete: 'set null' }),
    reason: text('reason'),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.spaceId, t.userId] })],
);

/** Stickers of a Space (usable everywhere by its members: perks are free). */
export const spaceStickers = pgTable(
  'space_stickers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    /** The related emoji (suggestions and accessibility). */
    emoji: text('emoji'),
    mediaId: uuid('media_id')
      .notNull()
      .references((): AnyPgColumn => media.id, { onDelete: 'cascade' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('space_stickers_name_uq').on(t.spaceId, sql`lower(${t.name})`),
    index('space_stickers_media_idx').on(t.mediaId),
  ],
);

/** Soundboard sounds of a Space (played in its voice channels). */
export const spaceSounds = pgTable(
  'space_sounds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    emoji: text('emoji'),
    /** 0..1 playback volume. */
    volume: real('volume').notNull().default(1),
    mediaId: uuid('media_id')
      .notNull()
      .references((): AnyPgColumn => media.id, { onDelete: 'cascade' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('space_sounds_space_idx').on(t.spaceId),
    index('space_sounds_media_idx').on(t.mediaId),
    check('space_sounds_volume_ck', sql`${t.volume} between 0 and 1`),
  ],
);

/** A scheduled event of a Space (in a voice channel or somewhere else). */
export const spaceEvents = pgTable(
  'space_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    /** Voice events: the voice channel. */
    channelId: uuid('channel_id').references((): AnyPgColumn => chats.id, { onDelete: 'set null' }),
    creatorId: uuid('creator_id').references(() => users.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    description: text('description'),
    entityType: text('entity_type').$type<SpaceEventEntity>().notNull(),
    /** External events: where (a place or a link). */
    location: text('location'),
    startAt: ts('start_at').notNull(),
    endAt: ts('end_at'),
    status: text('status').$type<SpaceEventStatus>().notNull().default('scheduled'),
    imageMediaId: uuid('image_media_id').references((): AnyPgColumn => media.id, {
      onDelete: 'set null',
    }),
    /** Maintained with the interest rows (same transaction). */
    interestedCount: integer('interested_count').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('space_events_space_idx').on(t.spaceId, t.startAt),
    /** The events job: what starts or ends soon. */
    index('space_events_open_idx')
      .on(t.startAt)
      .where(sql`${t.status} in ('scheduled', 'active')`),
    index('space_events_image_idx')
      .on(t.imageMediaId)
      .where(sql`${t.imageMediaId} is not null`),
    check('space_events_entity_ck', sql`${t.entityType} in ('voice', 'external')`),
    check(
      'space_events_status_ck',
      sql`${t.status} in ('scheduled', 'active', 'completed', 'canceled')`,
    ),
  ],
);

export const spaceEventInterests = pgTable(
  'space_event_interests',
  {
    eventId: uuid('event_id')
      .notNull()
      .references(() => spaceEvents.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.userId] }),
    index('space_event_interests_user_idx').on(t.userId),
  ],
);

/** AutoMod rules of a Space (checked on every send in its channels). */
export const automodRules = pgTable(
  'automod_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    triggerType: text('trigger_type').$type<AutoModTriggerType>().notNull(),
    triggerMetadata: jsonb('trigger_metadata').$type<AutoModTriggerMetadata>().notNull().default({}),
    actions: jsonb('actions').$type<AutoModAction[]>().notNull().default([]),
    enabled: boolean('enabled').notNull().default(true),
    exemptRoleIds: uuid('exempt_role_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    exemptChannelIds: uuid('exempt_channel_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    creatorId: uuid('creator_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('automod_rules_space_idx').on(t.spaceId),
    check(
      'automod_rules_trigger_ck',
      sql`${t.triggerType} in ('keyword', 'spam_links', 'mention_spam', 'preset')`,
    ),
  ],
);

/** Custom emoji of a Space (usable everywhere by its members: perks are free). */
export const spaceEmojis = pgTable(
  'space_emojis',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    /** CUSTOM_EMOJI_NAME_REGEX; unique per Space, case-insensitively. */
    name: text('name').notNull(),
    mediaId: uuid('media_id')
      .notNull()
      .references((): AnyPgColumn => media.id, { onDelete: 'cascade' }),
    animated: boolean('animated').notNull().default(false),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('space_emojis_name_uq').on(t.spaceId, sql`lower(${t.name})`),
    index('space_emojis_media_idx').on(t.mediaId),
    check('space_emojis_name_ck', sql`${t.name} ~ '^[A-Za-z0-9_]{2,32}$'`),
  ],
);

export const spaceInvites = pgTable(
  'space_invites',
  {
    /** Unique across chats.invite_code, communities.invite_code and spaces.vanity_code. */
    code: text('code').primaryKey(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    channelId: uuid('channel_id').references((): AnyPgColumn => chats.id, {
      onDelete: 'set null',
    }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    /** 0 = unlimited. */
    maxUses: integer('max_uses').notNull().default(0),
    uses: integer('uses').notNull().default(0),
    expiresAt: ts('expires_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('space_invites_space_idx').on(t.spaceId),
    index('space_invites_expires_idx')
      .on(t.expiresAt)
      .where(sql`${t.expiresAt} is not null`),
  ],
);

export const spaceAuditLog = pgTable(
  'space_audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: uuid('target_id'),
    changes: jsonb('changes').$type<Record<string, unknown>>(),
    reason: text('reason'),
    createdAt: createdAt(),
  },
  (t) => [
    index('space_audit_log_space_idx').on(t.spaceId, t.createdAt),
    /** Mod View: what happened to one member. */
    index('space_audit_log_target_idx')
      .on(t.spaceId, t.targetId, t.createdAt)
      .where(sql`${t.targetId} is not null`),
    index('space_audit_log_created_idx').on(t.createdAt),
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
    announcementChatId: uuid('announcement_chat_id').references((): AnyPgColumn => chats.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('communities_invite_code_uq').on(t.inviteCode),
    index('communities_avatar_idx')
      .on(t.avatarMediaId)
      .where(sql`${t.avatarMediaId} is not null`),
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
    uniqueIndex('community_members_owner_uq')
      .on(t.communityId)
      .where(sql`${t.role} = 'owner'`),
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
    communityId: uuid('community_id').references((): AnyPgColumn => communities.id, {
      onDelete: 'set null',
    }),
    isAnnouncement: boolean('is_announcement').notNull().default(false),
    /** A group DM (Discord): up to GROUP_DM_MAX_MEMBERS, no admins, the owner removes. */
    isGroupDm: boolean('is_group_dm').notNull().default(false),
    /** Space text channels: an announcement channel (Publish, Follow). */
    isNews: boolean('is_news').notNull().default(false),
    /** Browse Channels: hidden from members' sidebars until they show it. */
    optIn: boolean('opt_in').notNull().default(false),
    /** Voice and Stage channels: "Set a channel status" (cleared when the channel empties). */
    voiceStatus: text('voice_status'),
    /** Groups only, always complete (DEFAULT_GROUP_SETTINGS merged at creation). */
    groupSettings: jsonb('group_settings').$type<GroupSettings>(),
    /** Channels only, always complete (DEFAULT_CHANNEL_SETTINGS merged at creation). */
    channelSettings: jsonb('channel_settings').$type<ChannelSettings>(),
    /** Groups and channels (not announcement groups); unique across communities.invite_code too. */
    inviteCode: text('invite_code'),
    disappearingSeconds: integer('disappearing_seconds'),
    /**
     * Shared theme every member sees (`PUT /chats/:id/theme`, canEditInfo); enum ids + lowercase
     * hex only, zod-validated, preset wallpapers only. Null = none.
     */
    theme: jsonb('theme').$type<SharedChatTheme>(),
    /** Space channels (space_text/space_voice) only. */
    spaceId: uuid('space_id').references((): AnyPgColumn => spaces.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id').references((): AnyPgColumn => spaceCategories.id, {
      onDelete: 'set null',
    }),
    position: integer('position'),
    topic: text('topic'),
    slowmodeSeconds: integer('slowmode_seconds').notNull().default(0),
    nsfw: boolean('nsfw').notNull().default(false),
    /** Voice channels: max participants (null = none). */
    userLimit: integer('user_limit'),
    /** Voice channels: audio bitrate in bit/s (null = VOICE_DEFAULT_BITRATE). */
    bitrate: integer('bitrate'),
    /** The channel's overwrites equal its category's. */
    permissionsSynced: boolean('permissions_synced').notNull().default(true),
    /** Threads (space_thread): the channel they belong to (they take its permissions). */
    parentId: uuid('parent_id').references((): AnyPgColumn => chats.id, { onDelete: 'cascade' }),
    /** A thread started from a message (one thread per message). */
    threadStarterId: uuid('thread_starter_id').references((): AnyPgColumn => messages.id, {
      onDelete: 'set null',
    }),
    threadArchivedAt: ts('thread_archived_at'),
    /** Locked: only MANAGE_MESSAGES members send or unarchive. */
    threadLocked: boolean('thread_locked').notNull().default(false),
    /** Archive after this much inactivity (THREAD_AUTO_ARCHIVE_MINUTES). */
    threadAutoArchiveMinutes: integer('thread_auto_archive_minutes'),
    threadMessageCount: integer('thread_message_count').notNull().default(0),
    /** Forum channels: the post tags and the forum's options. */
    forumTags: jsonb('forum_tags').$type<ForumTag[]>(),
    forumSettings: jsonb('forum_settings').$type<ForumSettings>(),
    /** Forum posts (threads of a forum): the forum tag ids they wear. */
    appliedTags: text('applied_tags').array().notNull().default(sql`'{}'::text[]`),
    /** Forum posts: pinned to the top of the forum (one per forum). */
    threadPinned: boolean('thread_pinned').notNull().default(false),
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
    uniqueIndex('chats_community_announcement_uq')
      .on(t.communityId)
      .where(sql`${t.isAnnouncement}`),
    /** Channel discovery. */
    index('chats_channels_idx')
      .on(t.createdAt)
      .where(sql`${t.type} = 'channel'`),
    index('chats_avatar_idx')
      .on(t.avatarMediaId)
      .where(sql`${t.avatarMediaId} is not null`),
    /** A Space's channels in order. */
    index('chats_space_idx')
      .on(t.spaceId, t.position)
      .where(sql`${t.spaceId} is not null`),
    check('chats_news_ck', sql`not ${t.isNews} or ${t.type} = 'space_text'`),
    check(
      'chats_voice_status_ck',
      sql`${t.voiceStatus} is null or ${t.type} in ('space_voice', 'space_stage')`,
    ),
    check(
      'chats_type_ck',
      sql`${t.type} in ('direct', 'group', 'channel', 'space_text', 'space_voice', 'space_thread', 'space_forum', 'space_stage')`,
    ),
    check(
      'chats_space_ck',
      sql`(${t.spaceId} is not null) = (${t.type} in ('space_text', 'space_voice', 'space_thread', 'space_forum', 'space_stage'))`,
    ),
    check('chats_thread_ck', sql`(${t.parentId} is not null) = (${t.type} = 'space_thread')`),
    /** A channel's threads, most recent first. */
    index('chats_parent_idx')
      .on(t.parentId, t.lastMessageAt)
      .where(sql`${t.parentId} is not null`),
    uniqueIndex('chats_thread_starter_uq')
      .on(t.threadStarterId)
      .where(sql`${t.threadStarterId} is not null`),
    /** One pinned post per forum. */
    uniqueIndex('chats_thread_pinned_uq')
      .on(t.parentId)
      .where(sql`${t.threadPinned}`),
    /** Auto-archive sweep of open threads. */
    index('chats_thread_open_idx')
      .on(t.lastMessageAt)
      .where(sql`${t.type} = 'space_thread' and ${t.threadArchivedAt} is null`),
    check(
      'chats_space_cols_ck',
      sql`${t.type} in ('space_text', 'space_voice', 'space_forum', 'space_stage') or (${t.categoryId} is null and ${t.position} is null and ${t.topic} is null and ${t.userLimit} is null)`,
    ),
    check(
      'chats_space_invite_ck',
      sql`${t.type} not in ('space_text', 'space_voice', 'space_thread', 'space_forum', 'space_stage') or ${t.inviteCode} is null`,
    ),
    check('chats_slowmode_ck', sql`${t.slowmodeSeconds} between 0 and 21600`),
    check('chats_direct_key_ck', sql`(${t.type} = 'direct') = (${t.directKey} is not null)`),
    check('chats_group_settings_ck', sql`(${t.type} = 'group') = (${t.groupSettings} is not null)`),
    check(
      'chats_channel_settings_ck',
      sql`(${t.type} = 'channel') = (${t.channelSettings} is not null)`,
    ),
    check('chats_community_ck', sql`${t.communityId} is null or ${t.type} = 'group'`),
    check(
      'chats_announcement_ck',
      sql`not ${t.isAnnouncement} or (${t.communityId} is not null and ${t.inviteCode} is null)`,
    ),
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
    /**
     * My private look of this chat (`PATCH /chats/:id/prefs`, synced to my devices only), over
     * `chats.theme`. Kept on rejoin like the other prefs; channel rows are deleted on unfollow,
     * so a follower's theme/wallpaper are lost with them. Enum ids + lowercase hex only.
     */
    theme: jsonb('theme').$type<ChatTheme>(),
    /** My wallpaper upload (image or short video; `ChatTheme.wallpaper = { kind: 'media' }` shows it). */
    wallpaperMediaId: uuid('wallpaper_media_id').references(() => media.id, {
      onDelete: 'set null',
    }),
    /** Space channels: my notification level here (null = my Space default). */
    notifyLevel: text('notify_level').$type<NotifyLevel>(),
    /** Space channels: my last message here (slowmode). */
    lastSentAt: ts('last_sent_at'),
    /**
     * Direct chats: a message request for me (`pending` until I accept or reply, `ignored`
     * once declined): out of my chat list, no unreads, no pushes. Null = an ordinary chat.
     */
    requestState: text('request_state').$type<ChatRequestState>(),
  },
  (t) => [
    primaryKey({ columns: [t.chatId, t.userId] }),
    index('chat_members_user_idx').on(t.userId),
    /** My Message Requests list. */
    index('chat_members_requests_idx')
      .on(t.userId, t.requestState)
      .where(sql`${t.requestState} is not null`),
    check(
      'chat_members_request_ck',
      sql`${t.requestState} is null or ${t.requestState} in ('pending', 'ignored')`,
    ),
    index('chat_members_wallpaper_idx')
      .on(t.wallpaperMediaId)
      .where(sql`${t.wallpaperMediaId} is not null`),
    index('chat_members_user_active_idx')
      .on(t.userId)
      .where(sql`${t.leftAt} is null`),
    index('chat_members_chat_active_idx')
      .on(t.chatId)
      .where(sql`${t.leftAt} is null`),
    /** Space channels: rows that start after some history (converted channels; message:updated). */
    index('chat_members_joined_seq_idx')
      .on(t.chatId, t.joinedSeq)
      .where(sql`${t.joinedSeq} > 0`),
    /** Exactly one active owner per group/channel. */
    uniqueIndex('chat_members_owner_uq')
      .on(t.chatId)
      .where(sql`${t.role} = 'owner' and ${t.leftAt} is null`),
    check(
      'chat_members_left_ck',
      sql`(${t.leftAt} is null) = (${t.leftSeq} is null) and (${t.leftAt} is null) = (${t.leftReason} is null)`,
    ),
    check('chat_members_left_role_ck', sql`${t.leftAt} is null or ${t.role} = 'member'`),
  ],
);

/** Posts and threads I follow: they show in my sidebar under their channel. */
export const threadFollows = pgTable(
  'thread_follows',
  {
    threadId: uuid('thread_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** The thread's Space (my followed list per Space). */
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.threadId, t.userId] }),
    index('thread_follows_user_idx').on(t.userId, t.spaceId),
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
    /** A sticker message: the sticker (its image is `media_id`, so old clients show it). */
    stickerId: uuid('sticker_id').references((): AnyPgColumn => spaceStickers.id, {
      onDelete: 'set null',
    }),
    /** Posted by a webhook (incoming, or a follower webhook delivering a crosspost). */
    webhookId: uuid('webhook_id').references((): AnyPgColumn => webhooks.id, {
      onDelete: 'set null',
    }),
    /** Who it shows as when no user sent it (snapshot at send time). */
    authorOverride: jsonb('author_override').$type<MessageAuthorOverride>(),
    /** Rich embeds (webhooks). */
    embeds: jsonb('embeds').$type<MessageEmbed[]>().notNull().default([]),
    /** MESSAGE_FLAGS bits. */
    flags: integer('flags').notNull().default(0),
    /** A crosspost: the published original (edits and deletes follow it). */
    crosspostOf: uuid('crosspost_of').references((): AnyPgColumn => messages.id, {
      onDelete: 'set null',
    }),
    metadata: jsonb('metadata').$type<MessageMetadata>().notNull().default({}),
    replyToId: uuid('reply_to_id').references((): AnyPgColumn => messages.id, {
      onDelete: 'set null',
    }),
    forwardCount: integer('forward_count').notNull().default(0),
    /** A forwarded copy: the original (ids and time; clients resolve names they can see). */
    forwardedFrom: jsonb('forwarded_from').$type<ForwardSource>(),
    /** Polls: voting closes then (null = never) and when it did (the result was posted). */
    pollEndsAt: ts('poll_ends_at'),
    pollClosedAt: ts('poll_closed_at'),
    /** Derived from the text's mention tokens (active members, ≤ MAX_MENTIONS). */
    mentions: uuid('mentions')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    /** Space channels: @everyone/@here (allowed for the sender). */
    mentionEveryone: boolean('mention_everyone').notNull().default(false),
    /** Space channels: mentioned roles. */
    mentionRoleIds: uuid('mention_role_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
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
    /** Mod View: a member's latest messages. */
    index('messages_sender_created_idx').on(t.senderId, t.createdAt),
    /** The poll closer's sweep: open polls with an end time. */
    index('messages_poll_open_idx')
      .on(t.pollEndsAt)
      .where(sql`${t.pollEndsAt} is not null and ${t.pollClosedAt} is null`),
    /** Unread mention counts of space channels scan only messages that mention someone. */
    index('messages_mentions_idx')
      .on(t.chatId, t.seq)
      .where(
        sql`${t.mentionEveryone} or ${t.mentions} <> '{}'::uuid[] or ${t.mentionRoleIds} <> '{}'::uuid[]`,
      ),
    /** Inbox: messages that mention a given user (`mentions @> array[me]`). */
    index('messages_mentions_gin').using('gin', t.mentions),
    index('messages_expires_idx')
      .on(t.expiresAt)
      .where(sql`${t.expiresAt} is not null`),
    index('messages_reply_to_idx')
      .on(t.replyToId)
      .where(sql`${t.replyToId} is not null`),
    index('messages_media_idx')
      .on(t.mediaId)
      .where(sql`${t.mediaId} is not null`),
    /** Deleting a sticker sets its messages' `sticker_id` to null. */
    index('messages_sticker_idx')
      .on(t.stickerId)
      .where(sql`${t.stickerId} is not null`),
    /** Deleting an original finds its crossposts. */
    index('messages_crosspost_of_idx')
      .on(t.crosspostOf)
      .where(sql`${t.crosspostOf} is not null`),
    index('messages_webhook_idx')
      .on(t.webhookId)
      .where(sql`${t.webhookId} is not null`),
    /** System messages have no sender; every other message has a user or an author override. */
    check(
      'messages_system_sender_ck',
      sql`(${t.type} = 'system') = (${t.senderId} is null and ${t.authorOverride} is null)`,
    ),
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
  (t) => [
    primaryKey({ columns: [t.userId, t.messageId] }),
    index('message_hidden_message_idx').on(t.messageId),
  ],
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
    /** A unicode emoji, or a custom emoji token `<:name:id>` / `<a:name:id>`. */
    emoji: text('emoji').notNull(),
    /** The custom emoji's id (no FK: a reaction outlives a deleted emoji, as a name). */
    emojiId: uuid('emoji_id'),
    /** A super reaction (one of each kind per user and emoji). */
    burst: boolean('burst').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    /** Several reactions per user (one per emoji and kind). */
    primaryKey({ columns: [t.messageId, t.userId, t.emoji, t.burst] }),
    /** Reactor lists per emoji, oldest first. */
    index('message_reactions_emoji_idx').on(t.messageId, t.emoji, t.createdAt),
  ],
);

/**
 * Every attachment of a message in order (position 0 is also `messages.media_id`, which old
 * clients read). Alt text per file.
 */
export const messageAttachments = pgTable(
  'message_attachments',
  {
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    position: smallint('position').notNull(),
    mediaId: uuid('media_id')
      .notNull()
      .references(() => media.id, { onDelete: 'cascade' }),
    /** Alt text (≤ MAX_ALT_TEXT_LENGTH). */
    description: text('description'),
  },
  (t) => [
    primaryKey({ columns: [t.messageId, t.position] }),
    index('message_attachments_media_idx').on(t.mediaId),
  ],
);

/** Webhooks of Space text channels: incoming (a secret URL posts) or follower (crossposts). */
export const webhooks = pgTable(
  'webhooks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    spaceId: uuid('space_id')
      .notNull()
      .references((): AnyPgColumn => spaces.id, { onDelete: 'cascade' }),
    channelId: uuid('channel_id')
      .notNull()
      .references((): AnyPgColumn => chats.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<WebhookKind>().notNull().default('incoming'),
    name: text('name').notNull(),
    avatarMediaId: uuid('avatar_media_id').references((): AnyPgColumn => media.id, {
      onDelete: 'set null',
    }),
    /** sha256 of the URL's secret (incoming webhooks; null for follower webhooks). */
    tokenHash: text('token_hash'),
    /** Follower webhooks: the announcement channel they deliver from. */
    sourceChannelId: uuid('source_channel_id').references((): AnyPgColumn => chats.id, {
      onDelete: 'cascade',
    }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('webhooks_channel_idx').on(t.channelId),
    index('webhooks_space_idx').on(t.spaceId),
    index('webhooks_source_idx')
      .on(t.sourceChannelId)
      .where(sql`${t.sourceChannelId} is not null`),
    index('webhooks_avatar_idx')
      .on(t.avatarMediaId)
      .where(sql`${t.avatarMediaId} is not null`),
    check('webhooks_kind_ck', sql`${t.kind} in ('incoming', 'follower')`),
    check(
      'webhooks_follower_ck',
      sql`(${t.kind} = 'follower') = (${t.sourceChannelId} is not null)`,
    ),
  ],
);

/** An announcement channel followed into another channel (delivered by a follower webhook). */
export const channelFollows = pgTable(
  'channel_follows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceChannelId: uuid('source_channel_id')
      .notNull()
      .references((): AnyPgColumn => chats.id, { onDelete: 'cascade' }),
    targetChannelId: uuid('target_channel_id')
      .notNull()
      .references((): AnyPgColumn => chats.id, { onDelete: 'cascade' }),
    webhookId: uuid('webhook_id').references((): AnyPgColumn => webhooks.id, {
      onDelete: 'set null',
    }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('channel_follows_pair_uq').on(t.sourceChannelId, t.targetChannelId),
    index('channel_follows_target_idx').on(t.targetChannelId),
  ],
);

/** Space templates: a snapshot of roles and channels anyone with the code can build from. */
export const spaceTemplates = pgTable(
  'space_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull(),
    sourceSpaceId: uuid('source_space_id').references((): AnyPgColumn => spaces.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    description: text('description'),
    snapshot: jsonb('snapshot').$type<SpaceTemplateSnapshot>().notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    usageCount: integer('usage_count').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('space_templates_code_uq').on(t.code),
    index('space_templates_source_idx').on(t.sourceSpaceId),
  ],
);

/** My Browse Channels choices that differ from a channel's default (opt-in or not). */
export const spaceMemberChannels = pgTable(
  'space_member_channels',
  {
    spaceId: uuid('space_id')
      .notNull()
      .references((): AnyPgColumn => spaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    channelId: uuid('channel_id')
      .notNull()
      .references((): AnyPgColumn => chats.id, { onDelete: 'cascade' }),
    shown: boolean('shown').notNull(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.channelId] }),
    index('space_member_channels_space_idx').on(t.spaceId, t.userId),
  ],
);

/** Space insights: one row per Space per UTC day, counted as things happen. */
export const spaceStatsDaily = pgTable(
  'space_stats_daily',
  {
    spaceId: uuid('space_id')
      .notNull()
      .references((): AnyPgColumn => spaces.id, { onDelete: 'cascade' }),
    day: date('day').notNull(),
    messages: integer('messages').notNull().default(0),
    joins: integer('joins').notNull().default(0),
    leaves: integer('leaves').notNull().default(0),
    voiceMinutes: integer('voice_minutes').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.spaceId, t.day] })],
);

/** Space insights: messages per channel per UTC day (top channels). */
export const spaceChannelStatsDaily = pgTable(
  'space_channel_stats_daily',
  {
    spaceId: uuid('space_id')
      .notNull()
      .references((): AnyPgColumn => spaces.id, { onDelete: 'cascade' }),
    channelId: uuid('channel_id')
      .notNull()
      .references((): AnyPgColumn => chats.id, { onDelete: 'cascade' }),
    day: date('day').notNull(),
    messages: integer('messages').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.channelId, t.day] }),
    index('space_channel_stats_space_idx').on(t.spaceId, t.day),
  ],
);

/** Space insights: who was active (sent a message or was in voice) per UTC day. */
export const spaceActiveDaily = pgTable(
  'space_active_daily',
  {
    spaceId: uuid('space_id')
      .notNull()
      .references((): AnyPgColumn => spaces.id, { onDelete: 'cascade' }),
    day: date('day').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.spaceId, t.day, t.userId] })],
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
  (t) => [
    primaryKey({ columns: [t.userId, t.messageId] }),
    index('starred_messages_message_idx').on(t.messageId),
  ],
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
  (t) => [
    primaryKey({ columns: [t.chatId, t.messageId] }),
    index('chat_pins_message_idx').on(t.messageId),
  ],
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
    audience: uuid('audience')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    createdAt: createdAt(),
    expiresAt: ts('expires_at').notNull(),
  },
  (t) => [
    index('statuses_user_expires_idx').on(t.userId, t.expiresAt),
    index('statuses_expires_idx').on(t.expiresAt),
    /** Feed lookup: `audience @> ARRAY[$viewer]::uuid[]`. */
    index('statuses_audience_gin').using('gin', t.audience),
    index('statuses_media_idx')
      .on(t.mediaId)
      .where(sql`${t.mediaId} is not null`),
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
  (t) => [
    primaryKey({ columns: [t.statusId, t.viewerId] }),
    index('status_views_viewer_idx').on(t.viewerId),
  ],
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
    messageId: uuid('message_id').references((): AnyPgColumn => messages.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
    answeredAt: ts('answered_at'),
    endedAt: ts('ended_at'),
  },
  (t) => [
    index('calls_chat_idx').on(t.chatId, t.createdAt),
    /** One live call per chat (also serializes concurrent call:start). */
    uniqueIndex('calls_chat_live_uq')
      .on(t.chatId)
      .where(sql`${t.status} in ('ringing', 'ongoing')`),
    /** Timeout job and crash recovery. */
    index('calls_live_idx')
      .on(t.createdAt)
      .where(sql`${t.status} in ('ringing', 'ongoing')`),
    index('calls_message_idx')
      .on(t.messageId)
      .where(sql`${t.messageId} is not null`),
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
    /**
     * The joined participant's call socket and the cluster node it is connected to (docs
     * "Cluster" → "Calls"); both null while disconnected/not joined. A participant bound to a
     * dead node is treated as disconnected by the leader's calls sweep.
     */
    socketId: text('socket_id'),
    nodeId: text('node_id'),
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
    uniqueIndex('call_participants_one_joined_uq')
      .on(t.userId)
      .where(sql`${t.status} = 'joined'`),
  ],
);

// ---------------------------------------------------------------------------
// Cluster
// ---------------------------------------------------------------------------

/**
 * Live Enbox processes (docs "Cluster"): each node upserts its row every CLUSTER_HEARTBEAT_MS
 * and deletes it on graceful shutdown; a row older than CLUSTER_NODE_TTL_MS is a dead node.
 */
export const clusterNodes = pgTable(
  'cluster_nodes',
  {
    id: text('id').primaryKey(),
    startedAt: ts('started_at').notNull().defaultNow(),
    heartbeatAt: ts('heartbeat_at').notNull().defaultNow(),
  },
  (t) => [index('cluster_nodes_heartbeat_idx').on(t.heartbeatAt)],
);

// ---------------------------------------------------------------------------
// Relations (for the relational query API: db.query.*)
// ---------------------------------------------------------------------------

export const usersRelations = relations(users, ({ one, many }) => ({
  avatar: one(media, { fields: [users.avatarMediaId], references: [media.id] }),
  banner: one(media, { fields: [users.bannerMediaId], references: [media.id] }),
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
  wallpaper: one(media, { fields: [chatMembers.wallpaperMediaId], references: [media.id] }),
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
  community: one(communities, {
    fields: [communityMembers.communityId],
    references: [communities.id],
  }),
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
export type LinkPreviewRow = typeof linkPreviews.$inferSelect;
export type SpaceRow = typeof spaces.$inferSelect;
export type SpaceMemberRow = typeof spaceMembers.$inferSelect;
export type SpaceRoleRow = typeof spaceRoles.$inferSelect;
export type SpaceCategoryRow = typeof spaceCategories.$inferSelect;
export type SpaceInviteRow = typeof spaceInvites.$inferSelect;
export type SpaceOverwriteRow = typeof spaceChannelOverwrites.$inferSelect;
