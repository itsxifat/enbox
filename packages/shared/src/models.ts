/**
 * Wire models: the JSON shapes the server returns over REST and emits over Socket.IO.
 *
 * Conventions
 * - All ids are UUID strings. All timestamps are ISO-8601 strings (UTC).
 * - Models are *viewer-specific* when noted (e.g. `ChatSummary` embeds the viewer's own
 *   unread count and preferences, `UserPublic` hides fields the viewer may not see).
 * - Optional (`?`) fields may be omitted entirely. Clients merge partial updates with
 *   `{ ...previous, ...incoming }`, so omitted keys keep their previous value.
 */

export type ID = string;
export type ISODate = string;

// ---------------------------------------------------------------------------
// Users, privacy, sessions
// ---------------------------------------------------------------------------

/** Who may see a piece of profile information. */
export type PrivacyLevel = 'everyone' | 'contacts' | 'nobody';

/** Who a status update is shared with. */
export type StatusPrivacy = 'contacts' | 'contacts_except' | 'only_share_with';

export interface UserSettings {
  /** Last seen timestamp visibility. */
  lastSeenVisibility: PrivacyLevel;
  /** 'same_as_last_seen' hides "online" from anyone who cannot see last seen. */
  onlineVisibility: 'everyone' | 'same_as_last_seen';
  profilePhotoVisibility: PrivacyLevel;
  aboutVisibility: PrivacyLevel;
  /** Who may add me to groups directly (others must send an invite link). */
  groupsAddPermission: PrivacyLevel;
  /**
   * Read receipts. When off, the user neither sends nor receives read receipts in
   * direct chats (group read receipts are always sent, as in WhatsApp).
   */
  readReceipts: boolean;
  /** Calls from people who are not in my contacts ring silently (logged as missed). */
  silenceUnknownCallers: boolean;
  statusPrivacy: StatusPrivacy;
  /** Excluded users for 'contacts_except', included users for 'only_share_with'. */
  statusPrivacyUserIds: ID[];
  /** Default disappearing timer (seconds) for new chats, null = off. */
  defaultDisappearingSeconds: number | null;
  /** Push notification preferences. */
  messageNotifications: boolean;
  groupNotifications: boolean;
  callNotifications: boolean;
  /** Include message text in push notifications. */
  notificationPreviews: boolean;
}

/**
 * Another user's profile as seen by the viewer. Fields hidden by the subject's privacy
 * settings (or because the viewer is blocked) are returned as `null`.
 */
export interface UserPublic {
  id: ID;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  about: string | null;
  /** Phone is only visible to users the subject has saved as a contact. */
  phone: string | null;
  /** Present only when the viewer is allowed to see presence. */
  online?: boolean;
  lastSeenAt?: ISODate | null;
  /** Viewer has saved this user in their contacts. */
  isContact: boolean;
  /** The name the viewer saved this contact under (overrides displayName in UI). */
  contactName: string | null;
  /** The viewer has blocked this user. */
  isBlocked: boolean;
  /** Account was deleted; render as "Deleted account". */
  isDeleted?: boolean;
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

export interface Presence {
  userId: ID;
  online: boolean;
  lastSeenAt: ISODate | null;
}

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

export type MediaKind = 'image' | 'video' | 'audio' | 'voice' | 'file';

export interface MediaAttachment {
  id: ID;
  kind: MediaKind;
  /** Absolute path on the API origin, e.g. `/uploads/2f1c...e9.jpg`. */
  url: string;
  mimeType: string;
  fileName: string | null;
  size: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  /** Voice-note waveform: 0..1 amplitudes (≤ 64 samples). */
  waveform: number[] | null;
}

// ---------------------------------------------------------------------------
// Chats
// ---------------------------------------------------------------------------

/**
 * - `direct`: 1:1 chat between two users.
 * - `group`: multi-member chat (optionally linked to a community; one per community is
 *   the announcement group).
 * - `channel`: one-to-many broadcast. Only owner/admins post; followers read and react.
 */
export type ChatType = 'direct' | 'group' | 'channel';

export type MemberRole = 'owner' | 'admin' | 'member';

/** Viewer's membership state. Former members keep read-only access to history. */
export type Membership = 'active' | 'left' | 'removed';

export interface GroupSettings {
  /** Only admins can send messages ("announcement mode"). Always true for channels and community announcement groups. */
  onlyAdminsCanSend: boolean;
  /** Only admins can change name, description, avatar and disappearing timer. */
  onlyAdminsCanEditInfo: boolean;
  /** Only admins can add members (members can still share the invite link if they have it). */
  onlyAdminsCanAddMembers: boolean;
}

export interface ChannelSettings {
  /** Listed in channel discovery/search. */
  isPublic: boolean;
  /** Which reactions followers may use: all emoji or only QUICK_REACTIONS. */
  reactions: 'all' | 'quick' | 'none';
}

/**
 * A chat as it appears in the viewer's chat list. Viewer-specific.
 */
export interface ChatSummary {
  id: ID;
  type: ChatType;
  /** Group/channel name. For direct chats this is null — render `peer`. */
  name: string | null;
  description: string | null;
  avatarUrl: string | null;
  /** Direct chats only: the other participant. */
  peer: UserPublic | null;
  communityId: ID | null;
  /** This group is the community's announcement group. */
  isAnnouncement: boolean;
  /** Active members (channels: followers). */
  memberCount: number;
  /** Group settings (groups) — null for direct chats. */
  groupSettings: GroupSettings | null;
  /** Channel settings (channels) — null otherwise. */
  channelSettings: ChannelSettings | null;
  myRole: MemberRole;
  membership: Membership;
  /** Invite code, only included for members allowed to share it (admins, or anyone when adding is open). */
  inviteCode?: string | null;
  disappearingSeconds: number | null;

  lastMessage: Message | null;
  /** Highest message sequence number in the chat. */
  lastSeq: number;
  /** Viewer's read position. */
  lastReadSeq: number;
  unreadCount: number;
  unreadMentionCount: number;
  /**
   * Tick watermarks for the viewer's own messages: a message with `seq <= readWatermark`
   * has been read by every other active member (blue ticks), `seq <= deliveredWatermark`
   * delivered to all (double grey ticks). For direct chats, `readWatermark` is 0 when
   * either side has read receipts disabled. Channels always report 0.
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
  /** Last activity (last message or creation), used for sorting. */
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

/** A shared contact card. */
export interface ContactCardPayload {
  userId: ID | null;
  name: string;
  username: string | null;
  phone: string | null;
}

export interface PollOption {
  id: string;
  text: string;
  voterIds: ID[];
}

export interface Poll {
  question: string;
  options: PollOption[];
  allowMultiple: boolean;
  /** Distinct users who voted on at least one option. */
  totalVoters: number;
}

export type SystemEvent =
  | { kind: 'group_created'; actorId: ID; name: string }
  | { kind: 'channel_created'; actorId: ID; name: string }
  | { kind: 'members_added'; actorId: ID; userIds: ID[] }
  | { kind: 'member_removed'; actorId: ID; userId: ID }
  | { kind: 'member_left'; actorId: ID }
  | { kind: 'member_joined_via_link'; actorId: ID }
  | { kind: 'admin_promoted'; actorId: ID; userId: ID }
  | { kind: 'admin_demoted'; actorId: ID; userId: ID }
  | { kind: 'owner_transferred'; actorId: ID; userId: ID }
  | { kind: 'name_changed'; actorId: ID; name: string }
  | { kind: 'description_changed'; actorId: ID }
  | { kind: 'avatar_changed'; actorId: ID }
  | { kind: 'settings_changed'; actorId: ID; settings: Partial<GroupSettings> }
  | { kind: 'disappearing_changed'; actorId: ID; seconds: number | null }
  | { kind: 'invite_link_reset'; actorId: ID }
  | { kind: 'added_to_community'; actorId: ID; communityId: ID; communityName: string }
  | { kind: 'removed_from_community'; actorId: ID; communityId: ID; communityName: string }
  | { kind: 'message_pinned'; actorId: ID; messageId: ID }
  | { kind: 'chat_started'; actorId: ID };

export type CallType = 'audio' | 'video';

/** Payload of a `call` message: the chat-history record of a call. */
export interface CallMessagePayload {
  callId: ID;
  callType: CallType;
  isGroup: boolean;
  /** Final (or current) call status. */
  status: CallStatus;
  durationSec: number | null;
}

/** Snapshot of a replied-to or forwarded-from message shown in a quote bubble. */
export interface MessagePreview {
  id: ID;
  senderId: ID | null;
  type: MessageType;
  /** Text or caption, truncated to ~200 chars. Null if deleted. */
  text: string | null;
  /** First media thumbnail/url, if any. */
  media: Pick<MediaAttachment, 'id' | 'kind' | 'url' | 'mimeType' | 'fileName' | 'durationMs'> | null;
  deleted: boolean;
}

/** Snapshot of the status update a message replies to. */
export interface StatusReplyPayload {
  statusId: ID;
  authorId: ID;
  type: StatusType;
  text: string | null;
  backgroundColor: string | null;
  mediaUrl: string | null;
}

export interface ReactionSummary {
  emoji: string;
  count: number;
  userIds: ID[];
}

export interface Message {
  id: ID;
  chatId: ID;
  /** Per-chat, strictly increasing sequence number (1, 2, 3, ...). */
  seq: number;
  /** Client-generated id used for optimistic UI and idempotent retries. */
  clientId: string | null;
  /** Null for system messages and for deleted accounts. */
  senderId: ID | null;
  type: MessageType;
  /** Message text, or the caption for media. Null for deleted messages. */
  text: string | null;
  media: MediaAttachment | null;
  location: LocationPayload | null;
  contact: ContactCardPayload | null;
  poll: Poll | null;
  system: SystemEvent | null;
  call: CallMessagePayload | null;
  statusReply: StatusReplyPayload | null;
  replyTo: MessagePreview | null;
  /** How many times the content has been forwarded (0 = original). */
  forwardCount: number;
  /** Mentioned user ids (@mentions). */
  mentions: ID[];
  reactions: ReactionSummary[];
  editedAt: ISODate | null;
  /** Deleted for everyone: content fields are nulled and the UI shows a tombstone. */
  deletedAt: ISODate | null;
  /** Disappearing messages: hidden and purged after this time. */
  expiresAt: ISODate | null;
  createdAt: ISODate;
  /** Viewer starred this message. Only present in viewer-specific REST responses. */
  starred?: boolean;
}

/** WhatsApp-style message info (who read / who it was delivered to). */
export interface MessageInfo {
  messageId: ID;
  readBy: { user: UserPublic; at: ISODate | null }[];
  deliveredTo: { user: UserPublic; at: ISODate | null }[];
  pending: UserPublic[];
}

/** Search hit for global message search. */
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

export interface Community {
  id: ID;
  name: string;
  description: string | null;
  avatarUrl: string | null;
  createdBy: ID | null;
  createdAt: ISODate;
  memberCount: number;
  /** Viewer's role, null when viewing via an invite preview. */
  myRole: MemberRole | null;
  announcementChatId: ID;
  groups: CommunityGroup[];
  /** Only included for community admins. */
  inviteCode?: string | null;
}

export interface CommunityMember {
  user: UserPublic;
  role: MemberRole;
  joinedAt: ISODate;
}

/** A channel as listed in channel discovery. */
export interface ChannelDirectoryEntry {
  id: ID;
  name: string;
  description: string | null;
  avatarUrl: string | null;
  followerCount: number;
  isFollowing: boolean;
  createdAt: ISODate;
}

/** Preview returned for an invite link before joining. */
export interface InvitePreview {
  code: string;
  kind: 'group' | 'community' | 'channel';
  id: ID;
  name: string;
  description: string | null;
  avatarUrl: string | null;
  memberCount: number;
  /** Viewer is already a member / follower. */
  isMember: boolean;
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
  /** Only present on the author's own statuses. */
  viewCount?: number;
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
 * - `ringing`: created, nobody but the initiator has joined yet.
 * - `ongoing`: at least two participants are connected.
 * - terminal: `ended` (was answered), `missed` (nobody answered in time),
 *   `declined` (1:1 callee declined), `cancelled` (caller hung up before answer),
 *   `failed` (could not be established).
 */
export type CallStatus = 'ringing' | 'ongoing' | 'ended' | 'missed' | 'declined' | 'cancelled' | 'failed';

export type CallParticipantStatus =
  | 'invited' // notified, no device acknowledged yet
  | 'ringing' // a device is ringing
  | 'joined' // in the call
  | 'left' // was in the call and left
  | 'declined'
  | 'missed'
  | 'busy'; // already in another call

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
  type: CallType;
  isGroup: boolean;
  initiatorId: ID | null;
  status: CallStatus;
  createdAt: ISODate;
  answeredAt: ISODate | null;
  endedAt: ISODate | null;
  durationSec: number | null;
  participants: CallParticipant[];
}

export type CallDirection = 'incoming' | 'outgoing';
export type CallOutcome = 'answered' | 'missed' | 'declined' | 'cancelled' | 'unanswered' | 'ongoing';

/** Row in the Calls tab. */
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
