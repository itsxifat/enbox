/**
 * REST API contract: response envelopes and the route catalogue.
 *
 * Transport rules
 * - Base path `/api`. JSON bodies. Auth via `Authorization: Bearer <session token>`.
 * - Success: 2xx with the documented body (204 = empty, `R: void`).
 * - Errors: non-2xx with `ApiErrorBody`. Validation failures (body, query AND path params)
 *   are 400 `validation_error` with `details` = zod issues.
 * - Resources the caller may not see are 404 (never 403), so existence is not leaked.
 * - Mutations are REST; realtime fan-out happens over Socket.IO (see events.ts and the
 *   mutation → event matrix in docs/ARCHITECTURE.md). A client that performs a mutation also
 *   receives the resulting socket events and must dedupe (messages by `id`/`clientId`,
 *   everything else by id).
 * - Route registration: literal segments must be registered before param routes
 *   (`/users/search` before `/users/:userId`, `/messages/starred` before
 *   `/messages/:messageId`, `/channels/discover` before `/channels/:chatId`,
 *   `/calls/active`, `/calls/ice-servers` before `/calls/:callId`,
 *   `/chats/:chatId/media/counts` before `/chats/:chatId/media`, and in Spaces
 *   `/channels/positions` before `/channels/:chatId`, `/categories/positions` before
 *   `/categories/:categoryId`, `/roles/positions` before `/roles/:roleId`, `/members/me` and
 *   `/members/batch` before `/members/:userId`). The catalogue lists them in that order.
 */
import type {
  Call,
  CallLogEntry,
  ChannelDirectoryEntry,
  ChatMember,
  ChatSummary,
  Community,
  CommunityMember,
  Contact,
  IceServerConfig,
  InvitePreview,
  LinkPreview,
  MediaAttachment,
  Message,
  MessageInfo,
  MessageSearchResult,
  Presence,
  SessionInfo,
  Status,
  StatusFeedItem,
  StatusViewer,
  UserPublic,
  UserSelf,
  UserSettings,
  Space,
  SpaceAuditEntry,
  SpaceBan,
  SpaceCategory,
  SpaceInvite,
  VoiceState,
  SpaceMember,
  SpaceMemberPage,
  SpaceRole,
  RailEntry,
  UserProfile,
} from './models.js';
import type {
  AuditLogQuery,
  BanRequest,
  CategoryPositionsRequest,
  ChannelPositionsRequest,
  CloneSpaceChannelRequest,
  CreateCategoryRequest,
  CreateRoleRequest,
  CreateSpaceChannelRequest,
  CreateSpaceInviteRequest,
  CreateSpaceRequest,
  MembersQuery,
  OverwriteRequest,
  RolePositionsRequest,
  SpaceInvitesQuery,
  SpaceMembersBatchRequest,
  UpdateCategoryRequest,
  UpdateMemberRequest,
  UpdateMyMemberRequest,
  UpdateRoleRequest,
  UpdateSpaceChannelRequest,
  UpdateSpaceRequest,
  RailLayoutRequest,
  VoiceMoveRequest,
  UserNoteRequest,
  AddContactRequest,
  AddMembersRequest,
  CallLogQuery,
  ChangePasswordRequest,
  ChannelDiscoverQuery,
  ChatMediaQuery,
  CreateChannelRequest,
  CreateCommunityGroupRequest,
  CreateCommunityRequest,
  CreateDirectChatRequest,
  CreateGroupRequest,
  CreateStatusRequest,
  DeleteAccountRequest,
  DeleteMessageQuery,
  EditMessageRequest,
  ForwardRequest,
  LinkGroupsRequest,
  ListMessagesQuery,
  LoginRequest,
  PinMessageRequest,
  PollVoteRequest,
  PushSubscribeRequest,
  PushUnsubscribeRequest,
  ReactRequest,
  ReadRequest,
  RegisterRequest,
  SearchMessagesQuery,
  LinkPreviewQuery,
  SendMessageRequest,
  StarredMessagesQuery,
  SetChatThemeRequest,
  SetDisappearingRequest,
  SetRoleRequest,
  StatusReactRequest,
  TransferOwnershipRequest,
  UpdateAvailabilityRequest,
  UpdateChannelRequest,
  UpdateChatPrefsRequest,
  UpdateCommunityRequest,
  UpdateContactRequest,
  UpdateGroupRequest,
  UpdateGroupSettingsRequest,
  UpdatePresenceNoteRequest,
  UpdateProfileRequest,
  UpdateSettingsRequest,
  UploadMediaMeta,
  UserSearchQuery,
  UsernameAvailabilityQuery,
  UsersBatchRequest,
} from './schemas.js';

export type ApiErrorCode =
  | 'validation_error' // 400
  | 'unauthorized' // 401
  | 'forbidden' // 403: not allowed (role/permissions, removed by an admin, ...)
  | 'blocked' // 403: YOU blocked this user ("Unblock to send")
  | 'privacy_restricted' // 403
  | 'not_member' // 403: former member / not in the chat
  | 'not_found' // 404: missing or not visible to you
  | 'conflict' // 409: state conflict (e.g. a live call exists → details { callId })
  | 'limit_reached' // 409: a product limit (MAX_* constant) would be exceeded
  | 'expired' // 410: edit/delete window passed, call already ended, status expired
  | 'payload_too_large' // 413
  | 'rate_limited' // 429
  | 'internal_error'; // 500

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: unknown;
  };
}

export interface AuthResponse {
  token: string;
  user: UserSelf;
}

/**
 * `GET /api/config`: server facts the SPA needs (push key, canonical origin, voice, limits).
 * `limits` are the shared MAX_* constants the server enforces, so a client explains the
 * server's limits, not its own build's.
 */
export interface ServerConfig {
  vapidPublicKey: string | null;
  /** Same as `limits.maxUploadBytes` (kept for older clients). */
  maxUploadBytes: number;
  version: string;
  /**
   * Canonical origin for invite/profile links (server PUBLIC_URL), no trailing slash; null
   * when the server has none configured — build links on the page's own origin then.
   */
  publicUrl: string | null;
  /** Voice channels (LiveKit) when configured: the signalling URL clients connect to. */
  voice: { url: string } | null;
  limits: {
    maxUploadBytes: number;
    maxAvatarBytes: number;
    maxAnimatedAvatarBytes: number;
    maxBannerBytes: number;
    maxWallpaperBytes: number;
  };
}

/**
 * `GET /api/auth/username-available`: whether `POST /api/auth/register` could take this
 * username right now (false when taken — deleted accounts included — or reserved). Advisory
 * only: registration still answers `409 conflict` when someone takes it first.
 */
export interface UsernameAvailability {
  available: boolean;
}

/**
 * `GET /api/chats/:chatId/media/counts`: how many messages each `GET /api/chats/:chatId/media`
 * kind would list in total (same kind definitions and visibility rules, no paging).
 */
export interface ChatMediaCounts {
  /** Images and videos. */
  media: number;
  /** Files and audio files. */
  docs: number;
  /** Messages whose text/caption contains a link. */
  links: number;
  /** Voice notes. */
  voice: number;
}

/** A page of chat history. See `listMessagesQuerySchema` for cursor semantics. */
export interface MessagePage {
  /** Ascending by seq. Seqs may have gaps (hidden, expired, pre-join messages). */
  messages: Message[];
  /** Older visible messages exist before the first one. */
  hasMoreBefore: boolean;
  /** Newer visible messages exist after the last one (false for the latest page). */
  hasMoreAfter: boolean;
  /**
   * Every user referenced by the page (senders, mentions, system actors/targets, reaction
   * userIds, poll voters, contact cards, call initiators — see `referencedUserIds()`), as
   * seen by the viewer. Clients upsert them into their user cache.
   */
  users: UserPublic[];
}

/** Why a user was not added. Blocks and privacy restrictions go to `needsInvite` instead (indistinguishable). */
export type AddMemberFailure = 'already_member' | 'not_found' | 'limit_reached';

export interface AddMembersResult {
  chat: ChatSummary;
  added: string[];
  /** Users whose privacy settings (or a block) prevent direct adding; send them the invite link instead. */
  needsInvite: string[];
  failed: { userId: string; reason: AddMemberFailure }[];
}

/** Result of `POST /api/communities/:communityId/members` (same rules as group adds). */
export interface CommunityAddMembersResult {
  community: Community;
  added: string[];
  needsInvite: string[];
  failed: { userId: string; reason: AddMemberFailure }[];
}

export interface StatusFeed {
  /** My live statuses, oldest first. */
  mine: Status[];
  /** Other users' live statuses visible to me; unviewed first, then by lastUpdatedAt desc. */
  updates: StatusFeedItem[];
}

export interface InviteJoinResult {
  kind: InvitePreview['kind'];
  /** Chat id for groups/channels, community id for communities. */
  id: string;
  /** Set for groups and channels. */
  chat: ChatSummary | null;
  /** Set for communities, and for groups linked to a community. */
  community: Community | null;
  /** Set for Spaces. */
  space?: Space | null;
  /** Spaces: the channel to open (the invite's channel, or the first one I can see). */
  channelId?: string | null;
}

/** `GET /api/spaces/:spaceId` with the channels I can see (ChatSummary per channel). */
export interface SpaceDetail {
  space: Space;
  channels: ChatSummary[];
}

/** `GET /api/channels/:chatId`: a public channel (or one you follow) with its latest posts. */
export interface ChannelPreview {
  channel: ChannelDirectoryEntry;
  /** Latest page, ascending by seq (same serialization as for followers). */
  messages: Message[];
  /**
   * Every user referenced by `messages` (system actors, mentions, contact cards, … — see
   * `referencedUserIds()`; post senders are always null in channels), as seen by the viewer,
   * like `MessagePage.users`.
   */
  users: UserPublic[];
}

/**
 * Route catalogue — the single source of truth for endpoint paths and their bodies.
 * `Q` = query, `B` = body, `R` = response. Path params are validated with
 * `idParamSchema(...)` / `inviteParamsSchema` / `usernameParamsSchema`.
 * (Documentation-only type; nothing consumes it at runtime.)
 */
export interface ApiRoutes {
  // Health
  'GET /api/health': { R: { ok: true; version: string } };
  'GET /api/config': { R: ServerConfig };

  // Auth & sessions
  'GET /api/auth/username-available': {
    Q: UsernameAvailabilityQuery;
    R: UsernameAvailability;
  } /* public, per-IP rate-limited; malformed → 400 */;
  'POST /api/auth/register': { B: RegisterRequest; R: AuthResponse };
  'POST /api/auth/login': { B: LoginRequest; R: AuthResponse };
  'POST /api/auth/logout': {
    R: void;
  } /* deletes the current session (push subscriptions cascade) */;
  'GET /api/auth/sessions': { R: SessionInfo[] };
  'DELETE /api/auth/sessions': { R: void } /* log out all OTHER devices */;
  'DELETE /api/auth/sessions/:sessionId': {
    R: void;
  } /* own sessions only (else 404); current = logout */;
  'POST /api/auth/change-password': {
    B: ChangePasswordRequest;
    R: void;
  } /* also revokes all other sessions */;

  // Me
  'GET /api/me': { R: UserSelf };
  'PATCH /api/me': { B: UpdateProfileRequest; R: UserSelf };
  'PATCH /api/me/settings': { B: UpdateSettingsRequest; R: UserSettings };
  'PUT /api/me/rail-layout': { B: RailLayoutRequest; R: RailEntry[] } /* me:updated → my devices */;
  'PUT /api/me/presence': {
    B: UpdateAvailabilityRequest;
    R: UserSelf;
  } /* availability choice; emits presence:update + me:updated only, never user:changed */;
  'PUT /api/me/presence-note': {
    B: UpdatePresenceNoteRequest;
    R: UserSelf;
  } /* replaces the note; same fan-out as /presence */;
  'DELETE /api/me/presence-note': { R: UserSelf } /* clears it (idempotent) */;
  'DELETE /api/me': {
    B: DeleteAccountRequest;
    R: void;
  } /* soft delete, see ARCHITECTURE "Account deletion" */;

  // Users
  'GET /api/users/search': {
    Q: UserSearchQuery;
    R: UserPublic[];
  } /* ≤ USER_SEARCH_LIMIT, rate-limited */;
  'GET /api/users/by-username/:username': { R: UserPublic };
  'POST /api/users/batch': {
    B: UsersBatchRequest;
    R: UserPublic[];
  } /* unknown ids omitted; deleted users included (isDeleted) */;
  'POST /api/users/presence': {
    B: UsersBatchRequest;
    R: Presence[];
  } /* one entry per known id; hidden = online null */;
  'GET /api/users/:userId': { R: UserPublic };
  'GET /api/users/:userId/profile': { R: UserProfile } /* full profile: mutuals, my note */;
  'PUT /api/users/:userId/note': { B: UserNoteRequest; R: { note: string | null } };
  'GET /api/users/:userId/common-groups': {
    R: ChatSummary[];
  } /* active groups shared with that user (no channels) */;

  // Contacts & blocks
  'GET /api/contacts': { R: Contact[] };
  'POST /api/contacts': { B: AddContactRequest; R: Contact };
  'PATCH /api/contacts/:userId': { B: UpdateContactRequest; R: Contact };
  'DELETE /api/contacts/:userId': { R: void };
  'GET /api/blocks': { R: UserPublic[] };
  'PUT /api/blocks/:userId': { R: void };
  'DELETE /api/blocks/:userId': { R: void };

  // Media
  /** multipart/form-data: `file` part (+ optional `thumbnail` part) + `UploadMediaMeta` fields. */
  'POST /api/media': {
    B: { multipart: UploadMediaMeta & { file: 'binary'; thumbnail?: 'binary' } };
    R: MediaAttachment;
  };

  // Chats (viewer-specific ChatSummary)
  'GET /api/chats': {
    R: ChatSummary[];
  } /* all chats incl. archived & left groups; excludes hidden (deleted-for-me) */;
  'POST /api/chats/direct': {
    B: CreateDirectChatRequest;
    R: ChatSummary;
  } /* idempotent; userId = me → "Message yourself" */;
  'GET /api/chats/:chatId': {
    R: ChatSummary;
  } /* 404 unless you have a (non-hidden) membership row */;
  'PATCH /api/chats/:chatId/prefs': { B: UpdateChatPrefsRequest; R: ChatSummary };
  'POST /api/chats/:chatId/read': { B: ReadRequest; R: void };
  'POST /api/chats/:chatId/clear': { R: void } /* clear history for me */;
  'DELETE /api/chats/:chatId': {
    R: void;
  } /* delete chat for me (clears + hides); groups only after leaving */;
  'PUT /api/chats/:chatId/disappearing': { B: SetDisappearingRequest; R: ChatSummary };
  'PUT /api/chats/:chatId/theme': {
    B: SetChatThemeRequest;
    R: ChatSummary;
  } /* canEditInfo; shared theme (built-in wallpapers only); sys theme_changed + chat:updated */;
  'GET /api/chats/:chatId/members': {
    R: ChatMember[];
  } /* active members; requires permissions.canViewMembers */;
  'GET /api/chats/:chatId/media/counts': {
    R: ChatMediaCounts;
  } /* totals per media kind, same visibility as /media */;
  'GET /api/chats/:chatId/media': { Q: ChatMediaQuery; R: Message[] } /* newest first */;
  'GET /api/chats/:chatId/pins': {
    R: Message[];
  } /* oldest pin first, visible ones; former members: [] */;
  'POST /api/chats/:chatId/pins': { B: PinMessageRequest; R: Message[] };
  'DELETE /api/chats/:chatId/pins/:messageId': { R: Message[] };

  // Messages
  'GET /api/chats/:chatId/messages': { Q: ListMessagesQuery; R: MessagePage };
  'POST /api/chats/:chatId/messages': {
    B: SendMessageRequest;
    R: Message;
  } /* 201 created; 200 = existing (same clientId) */;
  'GET /api/messages/starred': {
    Q: StarredMessagesQuery;
    R: MessageSearchResult[];
  } /* newest star first; ?chatId= one chat */;
  'POST /api/messages/forward': { B: ForwardRequest; R: Message[] };
  'PATCH /api/messages/:messageId': { B: EditMessageRequest; R: Message };
  'DELETE /api/messages/:messageId': { Q: DeleteMessageQuery; R: void };
  'PUT /api/messages/:messageId/reaction': { B: ReactRequest; R: Message };
  'DELETE /api/messages/:messageId/reaction': { R: Message };
  'PUT /api/messages/:messageId/star': { R: void };
  'DELETE /api/messages/:messageId/star': { R: void };
  'GET /api/messages/:messageId/info': { R: MessageInfo } /* sender only; 404 in channels */;
  'PUT /api/messages/:messageId/vote': { B: PollVoteRequest; R: Message };
  'GET /api/search/messages': { Q: SearchMessagesQuery; R: MessageSearchResult[] };
  'GET /api/link-preview': {
    Q: LinkPreviewQuery;
    R: { preview: LinkPreview | null };
  } /* null: no preview (not a page, unreachable, private address) */;

  // Groups (type 'group', NOT announcement groups — those are managed via /communities)
  'POST /api/groups': { B: CreateGroupRequest; R: AddMembersResult };
  'PATCH /api/groups/:chatId': { B: UpdateGroupRequest; R: ChatSummary };
  'PATCH /api/groups/:chatId/settings': { B: UpdateGroupSettingsRequest; R: ChatSummary };
  'POST /api/groups/:chatId/members': { B: AddMembersRequest; R: AddMembersResult };
  'DELETE /api/groups/:chatId/members/:userId': { R: void };
  'PUT /api/groups/:chatId/members/:userId/role': { B: SetRoleRequest; R: void };
  'POST /api/groups/:chatId/transfer-ownership': { B: TransferOwnershipRequest; R: void };
  'POST /api/groups/:chatId/leave': { R: void };
  'GET /api/groups/:chatId/invite': { R: { code: string } } /* requires permissions.canInvite */;
  'POST /api/groups/:chatId/invite/reset': { R: { code: string } } /* admins */;

  // Invites (groups, communities and channels; codes are unique across both tables)
  'GET /api/invites/:code': { R: InvitePreview };
  'POST /api/invites/:code/join': { R: InviteJoinResult };

  // Communities (404 for non-members; previews go through /invites)
  'GET /api/communities': { R: Community[] };
  'POST /api/communities': { B: CreateCommunityRequest; R: Community };
  'GET /api/communities/:communityId': { R: Community };
  'PATCH /api/communities/:communityId': {
    B: UpdateCommunityRequest;
    R: Community;
  } /* also renames the announcement group */;
  'DELETE /api/communities/:communityId': {
    R: void;
  } /* owner deactivates: groups unlinked, announcement group deleted */;
  'POST /api/communities/:communityId/groups': {
    B: CreateCommunityGroupRequest;
    R: AddMembersResult;
  };
  'POST /api/communities/:communityId/groups/link': { B: LinkGroupsRequest; R: Community };
  'DELETE /api/communities/:communityId/groups/:chatId': {
    R: Community;
  } /* unlink (not the announcement group) */;
  'POST /api/communities/:communityId/groups/:chatId/join': { R: ChatSummary };
  'GET /api/communities/:communityId/members': { R: CommunityMember[] } /* owner/admins only */;
  'POST /api/communities/:communityId/members': {
    B: AddMembersRequest;
    R: CommunityAddMembersResult;
  };
  'DELETE /api/communities/:communityId/members/:userId': {
    R: void;
  } /* also removes from every linked group */;
  'PUT /api/communities/:communityId/members/:userId/role': { B: SetRoleRequest; R: void };
  'POST /api/communities/:communityId/transfer-ownership': { B: TransferOwnershipRequest; R: void };
  'POST /api/communities/:communityId/leave': {
    R: void;
  } /* leaves the community and all its groups */;
  'GET /api/communities/:communityId/invite': { R: { code: string } } /* owner/admins */;
  'POST /api/communities/:communityId/invite/reset': { R: { code: string } } /* owner/admins */;

  // Spaces (docs/design/spaces-at-scale.md; 404 for non-members, 403 for missing bits)
  'GET /api/spaces': { R: Space[] } /* my Spaces with unread/mention aggregates */;
  'POST /api/spaces': { B: CreateSpaceRequest; R: SpaceDetail } /* #general + General voice */;
  'GET /api/spaces/:spaceId': { R: SpaceDetail };
  'PATCH /api/spaces/:spaceId': { B: UpdateSpaceRequest; R: Space } /* MANAGE_SPACE */;
  'DELETE /api/spaces/:spaceId': { R: void } /* owner */;
  'POST /api/spaces/:spaceId/leave': { R: void } /* not the owner */;
  'POST /api/spaces/:spaceId/read': {
    R: void;
  } /* every channel I can see: chat:read per channel, then space:upsert → me */;
  'POST /api/spaces/:spaceId/transfer-ownership': { B: TransferOwnershipRequest; R: Space };
  'GET /api/spaces/:spaceId/channels': { R: ChatSummary[] } /* those I can see */;
  'POST /api/spaces/:spaceId/channels': {
    B: CreateSpaceChannelRequest;
    R: ChatSummary;
  } /* MANAGE_CHANNELS */;
  'PATCH /api/spaces/:spaceId/channels/positions': {
    B: ChannelPositionsRequest;
    R: void;
  } /* MANAGE_CHANNELS */;
  'PATCH /api/spaces/:spaceId/channels/:chatId': {
    B: UpdateSpaceChannelRequest;
    R: ChatSummary;
  } /* MANAGE_CHANNELS in the channel */;
  'DELETE /api/spaces/:spaceId/channels/:chatId': { R: void } /* MANAGE_CHANNELS */;
  'PUT /api/spaces/:spaceId/channels/:chatId/overwrites/:targetType/:targetId': {
    B: OverwriteRequest;
    R: ChatSummary;
  } /* MANAGE_ROLES in the channel */;
  'DELETE /api/spaces/:spaceId/channels/:chatId/overwrites/:targetType/:targetId': {
    R: ChatSummary;
  };
  'POST /api/spaces/:spaceId/channels/:chatId/sync': {
    R: ChatSummary;
  } /* copy the category's overwrites */;
  'POST /api/spaces/:spaceId/channels/:chatId/clone': {
    B: CloneSpaceChannelRequest;
    R: ChatSummary;
  } /* MANAGE_CHANNELS: same type, topic, settings, category and overwrites */;
  'POST /api/spaces/:spaceId/categories': {
    B: CreateCategoryRequest;
    R: SpaceCategory;
  } /* MANAGE_CHANNELS */;
  'PATCH /api/spaces/:spaceId/categories/positions': { B: CategoryPositionsRequest; R: void };
  'PATCH /api/spaces/:spaceId/categories/:categoryId': {
    B: UpdateCategoryRequest;
    R: SpaceCategory;
  };
  'DELETE /api/spaces/:spaceId/categories/:categoryId': {
    R: void;
  } /* its channels become uncategorised */;
  'PUT /api/spaces/:spaceId/categories/:categoryId/overwrites/:targetType/:targetId': {
    B: OverwriteRequest;
    R: SpaceCategory;
  } /* also updates its synced channels */;
  'DELETE /api/spaces/:spaceId/categories/:categoryId/overwrites/:targetType/:targetId': {
    R: SpaceCategory;
  };
  'GET /api/spaces/:spaceId/roles': { R: SpaceRole[] };
  'POST /api/spaces/:spaceId/roles': { B: CreateRoleRequest; R: SpaceRole } /* MANAGE_ROLES */;
  'PATCH /api/spaces/:spaceId/roles/positions': { B: RolePositionsRequest; R: SpaceRole[] };
  'PATCH /api/spaces/:spaceId/roles/:roleId': { B: UpdateRoleRequest; R: SpaceRole };
  'DELETE /api/spaces/:spaceId/roles/:roleId': { R: void } /* not @everyone */;
  'GET /api/spaces/:spaceId/members': {
    Q: MembersQuery;
    R: SpaceMemberPage;
  } /* sorted by display name */;
  'GET /api/spaces/:spaceId/members/me': { R: Space };
  'PATCH /api/spaces/:spaceId/members/me': {
    B: UpdateMyMemberRequest;
    R: Space;
  } /* nickname needs CHANGE_NICKNAME */;
  'POST /api/spaces/:spaceId/members/batch': {
    B: SpaceMembersBatchRequest;
    R: SpaceMember[];
  } /* members among the ids */;
  'GET /api/spaces/:spaceId/members/:userId': { R: SpaceMember };
  'PATCH /api/spaces/:spaceId/members/:userId': {
    B: UpdateMemberRequest;
    R: SpaceMember;
  } /* nickname: MANAGE_NICKNAMES, roles: MANAGE_ROLES, timeout: MODERATE_MEMBERS, mute/deaf: MUTE/DEAFEN_MEMBERS */;
  'DELETE /api/spaces/:spaceId/members/:userId': { R: void } /* kick: KICK_MEMBERS */;
  'PUT /api/spaces/:spaceId/members/:userId/roles/:roleId': { R: SpaceMember };
  'DELETE /api/spaces/:spaceId/members/:userId/roles/:roleId': { R: SpaceMember };
  'GET /api/spaces/:spaceId/bans': { R: SpaceBan[] } /* BAN_MEMBERS */;
  'GET /api/spaces/:spaceId/voice-states': { R: VoiceState[] } /* the voice channels I can see */;
  'POST /api/spaces/:spaceId/voice-states/:userId/disconnect': { R: void } /* MOVE_MEMBERS */;
  'POST /api/spaces/:spaceId/voice-states/:userId/move': {
    B: VoiceMoveRequest;
    R: void;
  } /* MOVE_MEMBERS + CONNECT on the target; voice:moved → the member's voice socket */;
  'PUT /api/spaces/:spaceId/bans/:userId': { B: BanRequest; R: void } /* BAN_MEMBERS */;
  'DELETE /api/spaces/:spaceId/bans/:userId': { R: void };
  'GET /api/spaces/:spaceId/invites': {
    Q: SpaceInvitesQuery;
    R: SpaceInvite[];
  } /* MANAGE_SPACE (or MANAGE_CHANNELS in ?channelId): all; else mine */;
  'POST /api/spaces/:spaceId/invites': {
    B: CreateSpaceInviteRequest;
    R: SpaceInvite;
  } /* CREATE_INVITE */;
  'DELETE /api/spaces/:spaceId/invites/:code': {
    R: void;
  } /* mine, MANAGE_SPACE, or MANAGE_CHANNELS in the invite's channel */;
  'GET /api/spaces/:spaceId/audit-log': {
    Q: AuditLogQuery;
    R: SpaceAuditEntry[];
  } /* VIEW_AUDIT_LOG, newest first */;

  // Channels (type 'channel')
  'POST /api/channels': { B: CreateChannelRequest; R: ChatSummary };
  'GET /api/channels/discover': {
    Q: ChannelDiscoverQuery;
    R: ChannelDirectoryEntry[];
  } /* public channels only */;
  'GET /api/channels/:chatId': {
    R: ChannelPreview;
  } /* public channels, or channels you follow; else 404 */;
  'PATCH /api/channels/:chatId': { B: UpdateChannelRequest; R: ChatSummary } /* admins */;
  'DELETE /api/channels/:chatId': { R: void } /* owner deletes the channel */;
  'PUT /api/channels/:chatId/follow': {
    R: ChatSummary;
  } /* public channels only (private: invite link) */;
  'DELETE /api/channels/:chatId/follow': {
    R: void;
  } /* unfollow: the chat disappears; owner → 409 */;
  'PUT /api/channels/:chatId/admins/:userId': { R: void } /* owner only; target must follow */;
  'DELETE /api/channels/:chatId/admins/:userId': { R: void } /* owner only */;
  'GET /api/channels/:chatId/invite': { R: { code: string } } /* requires permissions.canInvite */;
  'POST /api/channels/:chatId/invite/reset': { R: { code: string } } /* owner/admins */;
  'POST /api/channels/:chatId/transfer-ownership': {
    B: TransferOwnershipRequest;
    R: void;
  } /* owner → an admin */;

  // Status
  'GET /api/status/feed': { R: StatusFeed };
  'POST /api/status': { B: CreateStatusRequest; R: Status };
  'DELETE /api/status/:statusId': { R: void };
  'POST /api/status/:statusId/view': { R: void };
  'PUT /api/status/:statusId/reaction': { B: StatusReactRequest; R: void };
  'GET /api/status/:statusId/viewers': { R: StatusViewer[] } /* author only */;

  // Calls
  'GET /api/calls': { Q: CallLogQuery; R: CallLogEntry[] } /* my call log, newest first */;
  'GET /api/calls/active': {
    R: Call[];
  } /* ringing/ongoing calls in my active chats, incl. calls ringing me */;
  'GET /api/calls/ice-servers': { R: { iceServers: IceServerConfig[]; ttlSec: number } };
  'GET /api/calls/:callId': {
    R: CallLogEntry;
  } /* a call I participate in and haven't removed from my log; else 404 */;
  'DELETE /api/calls': { R: void } /* clear my call log */;
  'DELETE /api/calls/:callId': { R: void } /* remove from my call log */;

  // Web push
  'POST /api/push/subscriptions': {
    B: PushSubscribeRequest;
    R: void;
  } /* upsert by endpoint, bound to this session */;
  'DELETE /api/push/subscriptions': {
    B: PushUnsubscribeRequest;
    R: void;
  } /* only my own subscription */;
}
