/**
 * Wire models: the JSON shapes the server returns over REST and emits over Socket.IO.
 *
 * Conventions
 * - All ids are lowercase UUID strings. All timestamps are ISO-8601 strings (UTC, ms precision).
 * - Models are *viewer-specific* when noted (e.g. `ChatSummary` embeds the viewer's own
 *   unread count, permissions and preferences; `UserPublic` hides fields the viewer may not see).
 * - Every field is always present. `null` means "none" or "hidden from you" — privacy-gated
 *   values are sent as `null`, never omitted, so a later payload always overwrites them.
 * - The ONLY optional (`?`) fields are viewer-specific values that exist only in REST responses
 *   and are absent from viewer-neutral socket broadcasts: `Message.starred`,
 *   `Message.myReaction` and `Poll.myOptionIds`. When merging an incoming Message into a
 *   cached one, clients keep the cached values of these three when the incoming payload lacks
 *   them (note `myOptionIds` is nested: keep it when the incoming `poll` replaces the old one).
 *   Everything else from the incoming payload replaces the cached value.
 * - Full objects in `chat:upsert`, `community:upsert` and `me:updated` replace the cached copy.
 */

export type ID = string;
export type ISODate = string;

// ---------------------------------------------------------------------------
// Users, privacy, sessions
// ---------------------------------------------------------------------------

/** Who may see a piece of profile information. "contacts" = people the SUBJECT saved as contacts. */
export type PrivacyLevel = 'everyone' | 'contacts' | 'nobody';

/** Who a status update is shared with. */
export type StatusPrivacy = 'contacts' | 'contacts_except' | 'only_share_with';

/** Defaults: `DEFAULT_USER_SETTINGS` (constants.ts). Read through `resolveUserSettings()`. */
export interface UserSettings {
  /** Last seen timestamp visibility. */
  lastSeenVisibility: PrivacyLevel;
  /** 'same_as_last_seen' hides "online" from anyone who cannot see last seen. */
  onlineVisibility: 'everyone' | 'same_as_last_seen';
  profilePhotoVisibility: PrivacyLevel;
  aboutVisibility: PrivacyLevel;
  /**
   * Who may add me to groups/communities directly (others get me in `needsInvite` and must
   * send an invite link).
   */
  groupsAddPermission: PrivacyLevel;
  /**
   * Read receipts. When off, the user neither sends nor receives read receipts in direct
   * chats (group read receipts are always sent, as in WhatsApp), and their status views are
   * not shown to status authors.
   */
  readReceipts: boolean;
  /** Calls from people who are not in my contacts ring silently (logged as missed). */
  silenceUnknownCallers: boolean;
  statusPrivacy: StatusPrivacy;
  /** Contacts excluded when `statusPrivacy = 'contacts_except'` (non-contacts are dropped server-side). */
  statusExcludeUserIds: ID[];
  /** Contacts included when `statusPrivacy = 'only_share_with'` (non-contacts are dropped server-side). */
  statusOnlyShareWithUserIds: ID[];
  /** Default disappearing timer (seconds) for new direct chats and groups I create, null = off. */
  defaultDisappearingSeconds: number | null;
  /** Push/in-app notification toggles: direct chats, groups (incl. communities), calls. Channels never notify. */
  messageNotifications: boolean;
  groupNotifications: boolean;
  callNotifications: boolean;
  /** Include message text in notifications (off → body "New message"). */
  notificationPreviews: boolean;
}

/**
 * Another user's profile as seen by the viewer. Viewer-specific: fields hidden by the
 * subject's privacy settings (or because a block exists in either direction) are `null`.
 * A deleted account has `isDeleted: true`, displayName `DELETED_ACCOUNT_NAME` and all
 * optional profile data null.
 */
export interface UserPublic {
  id: ID;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  about: string | null;
  /** Visible only if the subject saved the viewer as a contact (and no block exists). */
  phone: string | null;
  /** `null` = the viewer may not see online status (or the account is deleted). */
  online: boolean | null;
  /** `null` = hidden, never seen, or currently online. */
  lastSeenAt: ISODate | null;
  /** Viewer has saved this user in their contacts. */
  isContact: boolean;
  /** The name the viewer saved this contact under (overrides displayName in UI). */
  contactName: string | null;
  /** The viewer has blocked this user. (Whether the subject blocked the viewer is never revealed.) */
  isBlocked: boolean;
  /** Account was deleted; render as "Deleted account". */
  isDeleted: boolean;
}

/** The signed-in user's own profile. */
export interface UserSelf {
  id: ID;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  about: string;
  phone: string | null;
  createdAt: ISODate;
  /** Always complete (defaults merged). */
  settings: UserSettings;
}

export interface Contact {
  user: UserPublic;
  /** Saved name, null = use the user's display name. */
  name: string | null;
  createdAt: ISODate;
}

/** A signed-in device (WhatsApp "linked devices"). */
export interface SessionInfo {
  id: ID;
  deviceName: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: ISODate;
  lastActiveAt: ISODate;
  current: boolean;
}

/**
 * Presence of a user as seen by the viewer (per-viewer privacy). Hidden presence is sent as
 * `{ online: null, lastSeenAt: null }` — never omitted.
 */
export interface Presence {
  userId: ID;
  /** `null` = hidden from the viewer. */
  online: boolean | null;
  /** `null` = hidden, unknown, or currently online. */
  lastSeenAt: ISODate | null;
}

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

export type MediaKind = 'image' | 'video' | 'audio' | 'voice' | 'file';

export interface MediaAttachment {
  id: ID;
  kind: MediaKind;
  /** Absolute path on the API origin, e.g. `/uploads/2025/03/2f1c...e9.jpg`. */
  url: string;
  /** Client-generated JPEG/WebP thumbnail or video poster (≤ MAX_THUMBNAIL_BYTES), if uploaded. */
  thumbnailUrl: string | null;
  /** The sniffed MIME type (never the client's claim). */
  mimeType: string;
  /** Sanitised original file name (basename, no control/bidi chars, ≤ MAX_FILE_NAME_LENGTH). */
  fileName: string | null;
  size: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  /** Voice-note waveform: 0..1 amplitudes (≤ WAVEFORM_MAX_SAMPLES samples). */
  waveform: number[] | null;
}

// ---------------------------------------------------------------------------
// Chats
// ---------------------------------------------------------------------------

/**
 * - `direct`: 1:1 chat between two users (or a "Message yourself" chat with one member).
 * - `group`: multi-member chat (optionally linked to a community; one per community is
 *   the announcement group).
 * - `channel`: one-to-many broadcast. Only owner/admins post; followers read and react.
 */
export type ChatType = 'direct' | 'group' | 'channel';

/** A chat's kind for wording ("group" vs "channel" vs "community" texts). See `chatKindOf()`. */
export type ChatKind = 'direct' | 'group' | 'channel' | 'announcement';

export type MemberRole = 'owner' | 'admin' | 'member';

/**
 * Viewer's membership state. Former group members keep read-only access to history up to
 * their `left_seq`. (Channels have no former state: unfollowing removes the chat.)
 */
export type Membership = 'active' | 'left' | 'removed';

/** Groups only (fixed to ANNOUNCEMENT_GROUP_SETTINGS for community announcement groups). */
export interface GroupSettings {
  /** Only admins can send messages and start calls. */
  onlyAdminsCanSend: boolean;
  /** Only admins can change name, description, avatar and disappearing timer, and pin messages. */
  onlyAdminsCanEditInfo: boolean;
  /** Only admins can add members and see/share the invite link. */
  onlyAdminsCanAddMembers: boolean;
}

export interface ChannelSettings {
  /**
   * Public channels are listed in discovery, previewable and followable by id. Private
   * channels can only be joined through their invite link.
   */
  isPublic: boolean;
  /** Which reactions followers may use: all emoji, only QUICK_REACTIONS, or none. */
  reactions: 'all' | 'quick' | 'none';
}

/**
 * What the viewer may do in a chat, computed server-side with `computeChatPermissions()`
 * (utils.ts) — clients use this instead of re-implementing the matrix. All false for
 * former members. See docs/ARCHITECTURE.md "Permissions matrix".
 */
export interface ChatPermissions {
  /** Post messages (also gates forwarding into this chat). */
  canSend: boolean;
  /** Change name/description/avatar and the disappearing timer (direct chats: timer only). */
  canEditInfo: boolean;
  canAddMembers: boolean;
  canRemoveMembers: boolean;
  /** Promote/demote admins (channels: owner only). */
  canManageAdmins: boolean;
  canPin: boolean;
  /** Start a call (direct + group chats only). */
  canCall: boolean;
  /** See (`GET …/invite`) and share the invite link (groups: admins, or everyone when adding is open; channels: admins). */
  canInvite: boolean;
  /** Delete other people's messages for everyone (group/channel admins). */
  canDeleteForEveryoneAsAdmin: boolean;
  /** Leave (groups) / unfollow (channels). Direct chats and announcement groups: false. */
  canLeave: boolean;
  /** List members (`GET /api/chats/:chatId/members`). Channels and announcement groups: admins only. */
  canViewMembers: boolean;
}

/**
 * A chat as it appears in the viewer's chat list. Viewer-specific (send per user, never to
 * a chat room). For former members (`membership !== 'active'`) every seq/message field is
 * clamped to their visible window (≤ left_seq).
 */
export interface ChatSummary {
  id: ID;
  type: ChatType;
  /** Group/channel name. For direct chats this is null — render `peer`. */
  name: string | null;
  description: string | null;
  avatarUrl: string | null;
  /** Direct chats only: the other participant (the viewer themself in a "Message yourself" chat). */
  peer: UserPublic | null;
  /** Groups only: the community this group is linked to. */
  communityId: ID | null;
  /** This group is the community's announcement group. */
  isAnnouncement: boolean;
  /** Active members (channels: followers, incl. owner/admins). */
  memberCount: number;
  /** Groups only; null for direct chats and channels. */
  groupSettings: GroupSettings | null;
  /** Channels only; null otherwise. */
  channelSettings: ChannelSettings | null;
  /** Viewer's role (former members: 'member'). */
  myRole: MemberRole;
  membership: Membership;
  permissions: ChatPermissions;
  /** Invite code when `permissions.canInvite`, else null. */
  inviteCode: string | null;
  disappearingSeconds: number | null;

  /** The last message VISIBLE to the viewer (null if none). */
  lastMessage: Message | null;
  /** Highest seq in the viewer's window: chat's last seq, or left_seq for former members. */
  lastSeq: number;
  /** Viewer's read position. */
  lastReadSeq: number;
  /** Visible messages with seq > lastReadSeq, not sent by the viewer, excluding `system` messages. */
  unreadCount: number;
  /** Unread (as above) messages whose `mentions` include the viewer. */
  unreadMentionCount: number;
  /**
   * Tick watermarks for the viewer's own messages: a message with `seq <= readWatermark`
   * has been read by every other active member (blue ticks), `seq <= deliveredWatermark`
   * delivered to all (double grey ticks). Min over the other active members; equals
   * `lastSeq` when there are none. Direct chats: `readWatermark` is 0 when either side has
   * read receipts disabled. Channels: both always 0 (no ticks).
   */
  readWatermark: number;
  deliveredWatermark: number;

  // Viewer preferences
  isPinned: boolean;
  isArchived: boolean;
  /** Muted until this time (MUTE_FOREVER_ISO for "always"), null = not muted. */
  mutedUntil: ISODate | null;
  markedUnread: boolean;

  createdAt: ISODate;
  /**
   * Who created the group/channel (announcement groups: the community's creator);
   * viewer-neutral. Always null for direct chats. A deleted creator keeps their id (render
   * with `UserPublic.isDeleted`); null when unknown.
   */
  createdBy: ID | null;
  /** lastMessage.createdAt, else when the viewer joined (former members: left_at); list sort key. */
  lastActivityAt: ISODate;
}

export interface ChatMember {
  user: UserPublic;
  role: MemberRole;
  joinedAt: ISODate;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export type MessageType =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'voice'
  | 'file'
  | 'location'
  | 'contact'
  | 'poll'
  | 'system'
  | 'call';

export interface LocationPayload {
  latitude: number;
  longitude: number;
  name: string | null;
  address: string | null;
}

/**
 * A shared contact card. With `userId`, the server fills name/username/phone from the user
 * (phone only if the sender may see it) — cards cannot be spoofed. Without `userId` it is
 * plain data and clients must not link it to an account.
 */
export interface ContactCardPayload {
  userId: ID | null;
  name: string;
  username: string | null;
  phone: string | null;
}

export interface PollOption {
  id: string;
  text: string;
  voteCount: number;
  /** Voters. Always [] in channels (anonymous; use voteCount). */
  voterIds: ID[];
}

export interface Poll {
  question: string;
  options: PollOption[];
  allowMultiple: boolean;
  /** Distinct users who voted on at least one option. */
  totalVoters: number;
  /** Viewer's selected option ids. Viewer-specific: REST responses only (see models header). */
  myOptionIds?: string[];
}

/**
 * System messages. Wording: `systemEventText(event, nameOf, chatKind)`. Channels only get
 * `channel_created`, `name_changed`, `description_changed`, `avatar_changed`; announcement
 * groups get no join/leave/add/remove messages.
 */
export type SystemEvent =
  | { kind: 'group_created'; actorId: ID; name: string }
  | { kind: 'channel_created'; actorId: ID; name: string }
  /** First message of a community's announcement group. */
  | { kind: 'community_created'; actorId: ID; name: string }
  | { kind: 'members_added'; actorId: ID; userIds: ID[] }
  | { kind: 'member_removed'; actorId: ID; userId: ID }
  | { kind: 'member_left'; actorId: ID }
  | { kind: 'member_joined_via_link'; actorId: ID }
  /** Joined a linked group from the community page. */
  | { kind: 'member_joined'; actorId: ID }
  | { kind: 'admin_promoted'; actorId: ID; userId: ID }
  | { kind: 'admin_demoted'; actorId: ID; userId: ID }
  /** Deliberate transfer by the owner. */
  | { kind: 'owner_transferred'; actorId: ID; userId: ID }
  /** Automatic succession after the owner left or deleted their account (no actor). */
  | { kind: 'owner_changed'; userId: ID }
  | { kind: 'name_changed'; actorId: ID; name: string }
  | { kind: 'description_changed'; actorId: ID }
  | { kind: 'avatar_changed'; actorId: ID }
  /** Exactly one changed group setting per message (one message per changed key). */
  | { kind: 'settings_changed'; actorId: ID; setting: keyof GroupSettings; value: boolean }
  | { kind: 'disappearing_changed'; actorId: ID; seconds: number | null }
  | { kind: 'invite_link_reset'; actorId: ID }
  | { kind: 'added_to_community'; actorId: ID; communityId: ID; communityName: string }
  /** Unlinked by an admin, or the community was deactivated. */
  | { kind: 'removed_from_community'; actorId: ID; communityId: ID; communityName: string }
  | { kind: 'message_pinned'; actorId: ID; messageId: ID };

export type SystemEventKind = SystemEvent['kind'];

export type CallType = 'audio' | 'video';

/**
 * Payload of a `call` message: the chat-history record of a call. The message's `senderId`
 * is the initiator; it is updated (`message:updated`) at every call status transition.
 * Per-viewer meaning (incoming/outgoing/missed) comes from `callOutcome()` (utils.ts).
 */
export interface CallMessagePayload {
  callId: ID;
  callType: CallType;
  isGroup: boolean;
  initiatorId: ID;
  /** Current (or final) call status. */
  status: CallStatus;
  /** Set once the call ended after being answered. */
  durationSec: number | null;
}

/**
 * Quote of a replied-to message, computed when the reply is READ (never a stale snapshot).
 * Usually the same chat; for "reply privately" it is a group message quoted in the direct
 * chat with its sender (`chatId` then differs from the reply's chat).
 */
export interface MessagePreview {
  id: ID;
  chatId: ID;
  /** Jump target: `GET /api/chats/:chatId/messages?around=<seq>`. */
  seq: number;
  senderId: ID | null;
  type: MessageType;
  /** Text or caption (mention tokens kept), truncated to ~200 chars. Null if deleted or none. */
  text: string | null;
  media: Pick<
    MediaAttachment,
    'id' | 'kind' | 'url' | 'thumbnailUrl' | 'mimeType' | 'fileName' | 'durationMs'
  > | null;
  /** The original was deleted for everyone (content fields are null). */
  deleted: boolean;
}

/**
 * The status update a message replies to. Only statusId/authorId/type are stored; the rest
 * is resolved at read time while the status exists.
 */
export interface StatusReplyPayload {
  statusId: ID;
  authorId: ID;
  type: StatusType;
  /** False once the status was deleted or expired: render "Status unavailable"; content fields are null. */
  available: boolean;
  text: string | null;
  backgroundColor: string | null;
  font: number | null;
  /** Thumbnail (else full URL) of a media status. */
  mediaUrl: string | null;
}

export interface ReactionSummary {
  emoji: string;
  count: number;
  /** Reacting users. Always [] in channels (anonymous; use count). */
  userIds: ID[];
}

/**
 * A chat message. Viewer-neutral except the optional fields (REST only). Mentions are
 * encoded in `text` as `@{<uuid>}` tokens (see utils `renderMentions`).
 */
export interface Message {
  id: ID;
  chatId: ID;
  /** Per-chat, strictly increasing sequence number. Gaps are possible (purges, hidden messages). */
  seq: number;
  /** Client-generated id used for optimistic UI and idempotent retries. */
  clientId: string | null;
  /**
   * Null for system messages, and for every message in channels (posts show the channel
   * identity). Deleted accounts keep their id (`UserPublic.isDeleted`).
   */
  senderId: ID | null;
  type: MessageType;
  /** Message text, or the caption for media. Null for deleted messages and non-text types. */
  text: string | null;
  media: MediaAttachment | null;
  location: LocationPayload | null;
  contact: ContactCardPayload | null;
  poll: Poll | null;
  system: SystemEvent | null;
  call: CallMessagePayload | null;
  statusReply: StatusReplyPayload | null;
  /** Null when not a reply, or when the original was purged (expired/deleted row). */
  replyTo: MessagePreview | null;
  /** How many times the content has been forwarded (0 = original). */
  forwardCount: number;
  /** Mentioned user ids, derived by the server from the text's tokens (active members only, ≤ MAX_MENTIONS). */
  mentions: ID[];
  reactions: ReactionSummary[];
  editedAt: ISODate | null;
  /** Deleted for everyone: content fields are nulled and the UI shows a tombstone. */
  deletedAt: ISODate | null;
  /** Disappearing messages: hidden after this time and purged shortly after. */
  expiresAt: ISODate | null;
  createdAt: ISODate;
  /** Viewer starred this message. Viewer-specific: REST responses only. */
  starred?: boolean;
  /** Viewer's own reaction (null = none). Viewer-specific: REST responses only. */
  myReaction?: string | null;
}

/**
 * WhatsApp-style message info (sender only; not available in channels). Lists the other
 * members for whom the message is visible. `at` is approximate: the time the member's
 * watermark last advanced past the message (null if unknown).
 */
export interface MessageInfo {
  messageId: ID;
  readBy: { user: UserPublic; at: ISODate | null }[];
  deliveredTo: { user: UserPublic; at: ISODate | null }[];
  pending: UserPublic[];
}

/** Search hit for global message search and the starred list. */
export interface MessageSearchResult {
  message: Message;
  chat: Pick<ChatSummary, 'id' | 'type' | 'name' | 'avatarUrl' | 'peer'>;
}

// ---------------------------------------------------------------------------
// Communities & channels
// ---------------------------------------------------------------------------

export interface CommunityGroup {
  chatId: ID;
  name: string;
  description: string | null;
  avatarUrl: string | null;
  memberCount: number;
  isAnnouncement: boolean;
  /** Viewer is an active member of this group. */
  isMember: boolean;
}

/** A community as seen by one of its members (non-members get 404; previews use InvitePreview). */
export interface Community {
  id: ID;
  name: string;
  description: string | null;
  avatarUrl: string | null;
  createdBy: ID | null;
  createdAt: ISODate;
  memberCount: number;
  myRole: MemberRole;
  announcementChatId: ID;
  groups: CommunityGroup[];
  /** Invite code for community owner/admins, else null. */
  inviteCode: string | null;
}

export interface CommunityMember {
  user: UserPublic;
  role: MemberRole;
  joinedAt: ISODate;
}

/** A channel as listed in discovery / shown in a channel preview. */
export interface ChannelDirectoryEntry {
  id: ID;
  name: string;
  description: string | null;
  avatarUrl: string | null;
  followerCount: number;
  isFollowing: boolean;
  isPublic: boolean;
  createdAt: ISODate;
}

/** Preview returned for an invite link before joining. */
export interface InvitePreview {
  code: string;
  kind: 'group' | 'community' | 'channel';
  /** Chat id for groups/channels, community id for communities. */
  id: ID;
  name: string;
  description: string | null;
  avatarUrl: string | null;
  memberCount: number;
  /** Groups linked to a community: joining also makes you a community member. */
  communityId: ID | null;
  communityName: string | null;
  /** Viewer is already an active member / follower. */
  isMember: boolean;
  /** `POST /api/invites/:code/join` would succeed (false when already a member). */
  canJoin: boolean;
  /** Human-readable reason when `canJoin` is false and the viewer is not a member (e.g. removed by an admin, full). */
  reason: string | null;
}

// ---------------------------------------------------------------------------
// Status updates (stories)
// ---------------------------------------------------------------------------

export type StatusType = 'text' | 'image' | 'video';

export interface Status {
  id: ID;
  userId: ID;
  type: StatusType;
  /** Text for text statuses, caption for media statuses. */
  text: string | null;
  backgroundColor: string | null;
  /** Font index 0..STATUS_FONT_COUNT-1 for text statuses. */
  font: number | null;
  media: MediaAttachment | null;
  createdAt: ISODate;
  expiresAt: ISODate;
  /** Viewer has seen it (always true for own statuses). */
  viewed: boolean;
  /** Author only: number of viewers shown in the viewer list; null for everyone else. */
  viewCount: number | null;
}

export interface StatusFeedItem {
  user: UserPublic;
  statuses: Status[];
  allViewed: boolean;
  lastUpdatedAt: ISODate;
}

export interface StatusViewer {
  user: UserPublic;
  viewedAt: ISODate;
  reaction: string | null;
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

/**
 * Call state machine (see docs/ARCHITECTURE.md "Calls"):
 * - `ringing`: created; nobody but the initiator has joined yet.
 * - `ongoing`: at least one invitee joined (`answeredAt` set).
 * - terminal: `ended` (was answered), `missed` (nobody answered in time / everyone busy),
 *   `declined` (every invitee declined), `cancelled` (initiator left or was lost before any answer).
 * At most one `ringing`/`ongoing` call exists per chat.
 */
export type CallStatus = 'ringing' | 'ongoing' | 'ended' | 'missed' | 'declined' | 'cancelled';

/**
 * Participant transitions: invited → ringing (a device acked) → joined | declined | missed;
 * joined → left; group calls: left → joined (`call:join`); declined | missed | busy | left →
 * invited (`call:invite`). When the call ends, invited/ringing → missed and joined → left.
 */
export type CallParticipantStatus =
  | 'invited' // notified, no device acknowledged yet
  | 'ringing' // a device is ringing
  | 'joined' // in the call (the initiator is joined from call:start)
  | 'left' // was in the call and left
  | 'declined'
  | 'missed'
  | 'busy'; // was already joined in another call; not rung

export interface CallParticipant {
  userId: ID;
  status: CallParticipantStatus;
  joinedAt: ISODate | null;
  leftAt: ISODate | null;
  audioMuted: boolean;
  videoOff: boolean;
  screenSharing: boolean;
}

export interface Call {
  id: ID;
  chatId: ID;
  /** Initial intent only; never changes (video can be toggled in any call). */
  type: CallType;
  isGroup: boolean;
  initiatorId: ID;
  status: CallStatus;
  createdAt: ISODate;
  answeredAt: ISODate | null;
  endedAt: ISODate | null;
  durationSec: number | null;
  /** Participants visible to the viewer (a callee who blocked the caller is never listed to themselves). */
  participants: CallParticipant[];
}

export type CallDirection = 'incoming' | 'outgoing';
export type CallOutcome =
  'answered' | 'missed' | 'declined' | 'cancelled' | 'unanswered' | 'ongoing';

/** Row in the Calls tab (direction/outcome from `callOutcome()`). */
export interface CallLogEntry {
  call: Call;
  direction: CallDirection;
  outcome: CallOutcome;
  chat: Pick<ChatSummary, 'id' | 'type' | 'name' | 'avatarUrl' | 'peer'>;
}

/** WebRTC signaling payloads relayed between call participants. */
export type CallSignal =
  | { type: 'offer'; sdp: string }
  | { type: 'answer'; sdp: string }
  | { type: 'candidate'; candidate: RTCIceCandidateJSON | null };

/** Structural copy of the DOM `RTCIceCandidateInit` so the server needn't depend on DOM types. */
export interface RTCIceCandidateJSON {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

// ---------------------------------------------------------------------------
// Web push
// ---------------------------------------------------------------------------

/**
 * JSON body of a Web Push message (server → service worker). Rules: docs/ARCHITECTURE.md "Push".
 * - `message`: tag `chat:<chatId>`, url `/chats/<chatId>`.
 * - `call`: incoming call (urgency high, TTL = ring timeout), tag `call:<callId>`.
 * - `call_cancel`: the ring stopped (answered/declined elsewhere, cancelled, timed out) —
 *   the SW closes notification `call:<callId>` and, if `body` is set, shows it (e.g. "Missed call").
 * - `dismiss`: the chat was read on another device — the SW closes notification `tag`.
 */
export interface PushPayload {
  type: 'message' | 'call' | 'call_cancel' | 'dismiss';
  title: string;
  body: string;
  tag: string;
  /** In-app path to open on click. */
  url: string;
  icon?: string;
  chatId?: ID;
  callId?: ID;
  /** Show without sound/vibration. */
  silent?: boolean;
}
