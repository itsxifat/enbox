/**
 * REST API contract: response envelopes and the route catalogue.
 *
 * Transport rules
 * - Base path `/api`. JSON bodies. Auth via `Authorization: Bearer <session token>`.
 * - Success: 2xx with the documented body (204 = empty).
 * - Errors: non-2xx with `ApiErrorBody`. Validation failures are 400 with code
 *   `validation_error` and `details` = zod issues.
 * - Mutations are REST; realtime fan-out happens over Socket.IO (see events.ts). A client
 *   that performs a mutation also receives the resulting socket event and must dedupe
 *   (messages by `clientId`/`id`, everything else by id).
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
  MediaAttachment,
  Message,
  MessageInfo,
  MessageSearchResult,
  Poll,
  Presence,
  SessionInfo,
  Status,
  StatusFeedItem,
  StatusViewer,
  UserPublic,
  UserSelf,
  UserSettings,
} from './models.js';

export type ApiErrorCode =
  | 'validation_error'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'payload_too_large'
  | 'blocked'
  | 'privacy_restricted'
  | 'not_member'
  | 'limit_reached'
  | 'expired'
  | 'internal_error';

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

export interface MessagePage {
  messages: Message[];
  /** More messages exist in the requested direction. */
  hasMore: boolean;
}

export interface AddMembersResult {
  chat: ChatSummary;
  added: string[];
  /** Users whose privacy settings prevent direct adding; send them the invite link instead. */
  needsInvite: string[];
  /** Users that could not be added (blocked you, already members, deleted...). */
  failed: { userId: string; reason: string }[];
}

export interface StatusFeed {
  mine: Status[];
  updates: StatusFeedItem[];
}

export interface InviteJoinResult {
  kind: InvitePreview['kind'];
  /** Chat id for groups/channels, community id for communities. */
  id: string;
  chat?: ChatSummary;
  community?: Community;
}

/**
 * Route catalogue — the single source of truth for endpoint paths and their bodies.
 * `P` = path params, `Q` = query, `B` = body, `R` = response.
 * (Documentation-only type; nothing consumes it at runtime.)
 */
export interface ApiRoutes {
  // Health
  'GET /api/health': { R: { ok: true; version: string } };
  'GET /api/config': { R: { vapidPublicKey: string | null; maxUploadBytes: number; version: string } };

  // Auth & sessions
  'POST /api/auth/register': { B: import('./schemas.js').RegisterRequest; R: AuthResponse };
  'POST /api/auth/login': { B: import('./schemas.js').LoginRequest; R: AuthResponse };
  'POST /api/auth/logout': { R: void };
  'GET /api/auth/sessions': { R: SessionInfo[] };
  'DELETE /api/auth/sessions/:sessionId': { R: void };
  'DELETE /api/auth/sessions': { R: void } /* log out all other devices */;
  'POST /api/auth/change-password': { B: import('./schemas.js').ChangePasswordRequest; R: void };

  // Me
  'GET /api/me': { R: UserSelf };
  'PATCH /api/me': { B: import('./schemas.js').UpdateProfileRequest; R: UserSelf };
  'PATCH /api/me/settings': { B: import('./schemas.js').UpdateSettingsRequest; R: UserSettings };
  'DELETE /api/me': { B: import('./schemas.js').DeleteAccountRequest; R: void };

  // Users
  'GET /api/users/search': { Q: { q: string }; R: UserPublic[] };
  'GET /api/users/:userId': { R: UserPublic };
  'GET /api/users/by-username/:username': { R: UserPublic };
  'GET /api/users/:userId/common-groups': { R: ChatSummary[] };
  'POST /api/users/presence': { B: { userIds: string[] }; R: Presence[] };

  // Contacts & blocks
  'GET /api/contacts': { R: Contact[] };
  'POST /api/contacts': { B: import('./schemas.js').AddContactRequest; R: Contact };
  'PATCH /api/contacts/:userId': { B: import('./schemas.js').UpdateContactRequest; R: Contact };
  'DELETE /api/contacts/:userId': { R: void };
  'GET /api/blocks': { R: UserPublic[] };
  'PUT /api/blocks/:userId': { R: void };
  'DELETE /api/blocks/:userId': { R: void };

  // Media
  'POST /api/media': { B: 'multipart/form-data: file + uploadMediaMetaSchema fields'; R: MediaAttachment };

  // Chats
  'GET /api/chats': { R: ChatSummary[] } /* all chats incl. archived & left; excludes hidden (deleted-for-me) */;
  'GET /api/chats/:chatId': { R: ChatSummary };
  'POST /api/chats/direct': { B: import('./schemas.js').CreateDirectChatRequest; R: ChatSummary };
  'PATCH /api/chats/:chatId/prefs': { B: import('./schemas.js').UpdateChatPrefsRequest; R: ChatSummary };
  'POST /api/chats/:chatId/read': { B: { seq: number }; R: void };
  'POST /api/chats/:chatId/clear': { R: void } /* clear history for me */;
  'DELETE /api/chats/:chatId': { R: void } /* delete/hide chat for me (groups: only after leaving) */;
  'PUT /api/chats/:chatId/disappearing': { B: import('./schemas.js').SetDisappearingRequest; R: ChatSummary };
  'GET /api/chats/:chatId/members': { R: ChatMember[] };
  'GET /api/chats/:chatId/media': { Q: import('./schemas.js').ChatMediaQuery; R: Message[] };
  'GET /api/chats/:chatId/pins': { R: Message[] };
  'POST /api/chats/:chatId/pins': { B: import('./schemas.js').PinMessageRequest; R: Message[] };
  'DELETE /api/chats/:chatId/pins/:messageId': { R: Message[] };

  // Messages
  'GET /api/chats/:chatId/messages': { Q: import('./schemas.js').ListMessagesQuery; R: MessagePage };
  'POST /api/chats/:chatId/messages': { B: import('./schemas.js').SendMessageRequest; R: Message };
  'PATCH /api/messages/:messageId': { B: import('./schemas.js').EditMessageRequest; R: Message };
  'DELETE /api/messages/:messageId': { Q: { for?: 'me' | 'everyone' }; R: void };
  'PUT /api/messages/:messageId/reaction': { B: import('./schemas.js').ReactRequest; R: Message };
  'DELETE /api/messages/:messageId/reaction': { R: Message };
  'PUT /api/messages/:messageId/star': { R: void };
  'DELETE /api/messages/:messageId/star': { R: void };
  'GET /api/messages/starred': { R: MessageSearchResult[] };
  'GET /api/messages/:messageId/info': { R: MessageInfo };
  'POST /api/messages/forward': { B: import('./schemas.js').ForwardRequest; R: Message[] };
  'PUT /api/messages/:messageId/vote': { B: import('./schemas.js').PollVoteRequest; R: Poll };
  'GET /api/search/messages': { Q: import('./schemas.js').SearchMessagesQuery; R: MessageSearchResult[] };

  // Groups
  'POST /api/groups': { B: import('./schemas.js').CreateGroupRequest; R: ChatSummary };
  'PATCH /api/groups/:chatId': { B: import('./schemas.js').UpdateGroupRequest; R: ChatSummary };
  'PATCH /api/groups/:chatId/settings': { B: import('./schemas.js').UpdateGroupSettingsRequest; R: ChatSummary };
  'POST /api/groups/:chatId/members': { B: import('./schemas.js').AddMembersRequest; R: AddMembersResult };
  'DELETE /api/groups/:chatId/members/:userId': { R: void };
  'PUT /api/groups/:chatId/members/:userId/role': { B: import('./schemas.js').SetRoleRequest; R: void };
  'POST /api/groups/:chatId/transfer-ownership': { B: import('./schemas.js').TransferOwnershipRequest; R: void };
  'POST /api/groups/:chatId/leave': { R: void };
  'GET /api/groups/:chatId/invite': { R: { code: string } };
  'POST /api/groups/:chatId/invite/reset': { R: { code: string } };

  // Invites (groups, communities, channels share one code space)
  'GET /api/invites/:code': { R: InvitePreview };
  'POST /api/invites/:code/join': { R: InviteJoinResult };

  // Communities
  'GET /api/communities': { R: Community[] };
  'POST /api/communities': { B: import('./schemas.js').CreateCommunityRequest; R: Community };
  'GET /api/communities/:communityId': { R: Community };
  'PATCH /api/communities/:communityId': { B: import('./schemas.js').UpdateCommunityRequest; R: Community };
  'DELETE /api/communities/:communityId': { R: void } /* owner deactivates: groups are unlinked */;
  'POST /api/communities/:communityId/groups': { B: import('./schemas.js').CreateCommunityGroupRequest; R: Community };
  'POST /api/communities/:communityId/groups/link': { B: import('./schemas.js').LinkGroupsRequest; R: Community };
  'DELETE /api/communities/:communityId/groups/:chatId': { R: Community } /* unlink */;
  'POST /api/communities/:communityId/groups/:chatId/join': { R: ChatSummary };
  'GET /api/communities/:communityId/members': { R: CommunityMember[] };
  'POST /api/communities/:communityId/members': { B: import('./schemas.js').AddMembersRequest; R: Community };
  'DELETE /api/communities/:communityId/members/:userId': { R: void };
  'PUT /api/communities/:communityId/members/:userId/role': { B: import('./schemas.js').SetRoleRequest; R: void };
  'POST /api/communities/:communityId/leave': { R: void };
  'GET /api/communities/:communityId/invite': { R: { code: string } };
  'POST /api/communities/:communityId/invite/reset': { R: { code: string } };

  // Channels
  'POST /api/channels': { B: import('./schemas.js').CreateChannelRequest; R: ChatSummary };
  'GET /api/channels/discover': { Q: { q?: string; limit?: number }; R: ChannelDirectoryEntry[] };
  'PATCH /api/channels/:chatId': { B: import('./schemas.js').UpdateChannelRequest; R: ChatSummary };
  'PUT /api/channels/:chatId/follow': { R: ChatSummary };
  'DELETE /api/channels/:chatId/follow': { R: void };
  'PUT /api/channels/:chatId/admins/:userId': { R: void };
  'DELETE /api/channels/:chatId/admins/:userId': { R: void };
  'DELETE /api/channels/:chatId': { R: void } /* owner deletes channel */;

  // Status
  'GET /api/status/feed': { R: StatusFeed };
  'POST /api/status': { B: import('./schemas.js').CreateStatusRequest; R: Status };
  'DELETE /api/status/:statusId': { R: void };
  'POST /api/status/:statusId/view': { R: void };
  'PUT /api/status/:statusId/reaction': { B: import('./schemas.js').StatusReactRequest; R: void };
  'GET /api/status/:statusId/viewers': { R: StatusViewer[] };

  // Calls
  'GET /api/calls': { Q: import('./schemas.js').CallLogQuery; R: CallLogEntry[] };
  'GET /api/calls/active': { R: Call[] } /* ongoing calls in my chats (joinable group calls) */;
  'GET /api/calls/ice-servers': { R: { iceServers: IceServerConfig[]; ttlSec: number } };
  'DELETE /api/calls/:callId': { R: void } /* remove from my call log */;
  'DELETE /api/calls': { R: void } /* clear my call log */;

  // Web push
  'POST /api/push/subscriptions': { B: import('./schemas.js').PushSubscribeRequest; R: void };
  'DELETE /api/push/subscriptions': { B: { endpoint: string }; R: void };
}
