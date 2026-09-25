/**
 * Pure helpers shared by server and clients. Where a helper encodes a product rule
 * (permissions, call outcome, mentions, edit/delete windows) the server MUST use it too, so
 * both sides agree.
 */
import {
  DEFAULT_GROUP_SETTINGS,
  DEFAULT_USER_SETTINGS,
  DELETE_FOR_EVERYONE_WINDOW_MS,
  EDIT_WINDOW_MS,
  MAX_MENTIONS,
} from './constants.js';
import type {
  CallDirection,
  CallMessagePayload,
  CallOutcome,
  CallParticipantStatus,
  ChatKind,
  ChatPermissions,
  ChatSummary,
  ID,
  Message,
  SystemEvent,
  UserPublic,
  UserSettings,
} from './models.js';

// ---------------------------------------------------------------------------
// Ids, users, chats
// ---------------------------------------------------------------------------

/**
 * Stable unique key for a direct chat between two users (order-independent, lowercase).
 * A "Message yourself" chat has key `<me>:<me>`.
 */
export function directChatKey(a: ID, b: ID): string {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? `${x}:${y}` : `${y}:${x}`;
}

/** Complete settings from the stored partial overrides. Server code reads settings ONLY through this. */
export function resolveUserSettings(
  stored: Partial<UserSettings> | null | undefined,
): UserSettings {
  return { ...DEFAULT_USER_SETTINGS, ...(stored ?? {}) };
}

export function isMuted(mutedUntil: string | null | undefined, now: Date = new Date()): boolean {
  return !!mutedUntil && new Date(mutedUntil).getTime() > now.getTime();
}

/** Name to show for a user: "Deleted account", saved contact name, then display name. */
export function userDisplayName(
  user:
    (Pick<UserPublic, 'displayName' | 'contactName'> & { isDeleted?: boolean }) | null | undefined,
): string {
  if (!user) return 'Unknown';
  if (user.isDeleted) return 'Deleted account';
  return user.contactName || user.displayName;
}

/** Title for a chat row/header. Pass `meId` to label the "Message yourself" chat. */
export function chatTitle(chat: Pick<ChatSummary, 'type' | 'name' | 'peer'>, meId?: ID): string {
  if (chat.type === 'direct') {
    const title = userDisplayName(chat.peer);
    return meId && chat.peer?.id === meId ? `${title} (You)` : title;
  }
  return chat.name ?? 'Untitled';
}

/** Wording kind of a chat (announcement groups speak about the "community"). */
export function chatKindOf(chat: Pick<ChatSummary, 'type' | 'isAnnouncement'>): ChatKind {
  if (chat.type === 'group' && chat.isAnnouncement) return 'announcement';
  return chat.type;
}

// ---------------------------------------------------------------------------
// Permissions matrix (docs/ARCHITECTURE.md "Permissions matrix")
// ---------------------------------------------------------------------------

const NO_PERMISSIONS: ChatPermissions = Object.freeze({
  canSend: false,
  canEditInfo: false,
  canAddMembers: false,
  canRemoveMembers: false,
  canManageAdmins: false,
  canPin: false,
  canCall: false,
  canInvite: false,
  canDeleteForEveryoneAsAdmin: false,
  canLeave: false,
  canViewMembers: false,
});

export type ChatPermissionInput = Pick<
  ChatSummary,
  'type' | 'isAnnouncement' | 'myRole' | 'membership' | 'groupSettings' | 'channelSettings'
> & { peer: Pick<UserPublic, 'id' | 'isBlocked' | 'isDeleted'> | null };

/**
 * The viewer's permissions in a chat — the single source of truth for `ChatSummary.permissions`
 * (server) and for recomputing it after `chat:updated` (clients). Server route guards must
 * agree with it. Everything is derived from ChatSummary fields:
 * - direct: `peer.isBlocked` (I blocked them) and `peer.isDeleted` disable sending/calling;
 *   whether the PEER blocked me is never revealed (my sends succeed but stay undelivered).
 * - former members (membership ≠ active) get no permissions.
 */
export function computeChatPermissions(chat: ChatPermissionInput, viewerId: ID): ChatPermissions {
  if (chat.membership !== 'active') return { ...NO_PERMISSIONS };
  const admin = chat.myRole === 'owner' || chat.myRole === 'admin';

  if (chat.type === 'direct') {
    const self = chat.peer?.id === viewerId;
    const canSend = !chat.peer?.isBlocked && !chat.peer?.isDeleted;
    return {
      ...NO_PERMISSIONS,
      canSend,
      canEditInfo: canSend,
      canPin: true,
      canCall: canSend && !self,
      canViewMembers: true,
    };
  }

  if (chat.type === 'channel') {
    // Followers share public channels by id (discovery/preview links); invite links are for admins.
    return {
      ...NO_PERMISSIONS,
      canSend: admin,
      canEditInfo: admin,
      canManageAdmins: chat.myRole === 'owner',
      canPin: admin,
      canInvite: admin,
      canDeleteForEveryoneAsAdmin: admin,
      canLeave: chat.myRole !== 'owner',
      canViewMembers: admin,
    };
  }

  if (chat.isAnnouncement) {
    // Managed through the community: only posting/pinning/moderation happen in the chat.
    return {
      ...NO_PERMISSIONS,
      canSend: admin,
      canPin: admin,
      canCall: admin,
      canDeleteForEveryoneAsAdmin: admin,
      canViewMembers: admin,
    };
  }

  const gs = chat.groupSettings ?? DEFAULT_GROUP_SETTINGS;
  const canSend = !gs.onlyAdminsCanSend || admin;
  const canEditInfo = !gs.onlyAdminsCanEditInfo || admin;
  const canAddMembers = !gs.onlyAdminsCanAddMembers || admin;
  return {
    canSend,
    canEditInfo,
    canAddMembers,
    canRemoveMembers: admin,
    canManageAdmins: admin,
    canPin: canEditInfo,
    canCall: canSend,
    canInvite: canAddMembers,
    canDeleteForEveryoneAsAdmin: admin,
    canLeave: true,
    canViewMembers: true,
  };
}

const EDITABLE_TYPES = new Set<Message['type']>([
  'text',
  'image',
  'video',
  'audio',
  'voice',
  'file',
]);

/**
 * Whether the viewer may edit a message now: text or caption only, within EDIT_WINDOW_MS;
 * the sender in direct/group chats, any channel admin for channel posts.
 */
export function canEditMessage(
  message: Pick<Message, 'type' | 'senderId' | 'deletedAt' | 'createdAt'>,
  chat: Pick<ChatSummary, 'type' | 'permissions'>,
  viewerId: ID,
  now: number = Date.now(),
): boolean {
  if (message.deletedAt || !EDITABLE_TYPES.has(message.type)) return false;
  if (now - Date.parse(message.createdAt) > EDIT_WINDOW_MS) return false;
  return chat.type === 'channel'
    ? chat.permissions.canSend
    : message.senderId === viewerId && chat.permissions.canSend;
}

/**
 * Whether the viewer may delete a message for everyone: the sender within
 * DELETE_FOR_EVERYONE_WINDOW_MS, or group/channel admins at any time. Never system/call messages.
 */
export function canDeleteForEveryone(
  message: Pick<Message, 'type' | 'senderId' | 'deletedAt' | 'createdAt'>,
  chat: Pick<ChatSummary, 'type' | 'membership' | 'permissions'>,
  viewerId: ID,
  now: number = Date.now(),
): boolean {
  if (message.deletedAt || message.type === 'system' || message.type === 'call') return false;
  if (chat.membership !== 'active') return false;
  if (chat.permissions.canDeleteForEveryoneAsAdmin) return true;
  return (
    message.senderId === viewerId &&
    now - Date.parse(message.createdAt) <= DELETE_FOR_EVERYONE_WINDOW_MS
  );
}

// ---------------------------------------------------------------------------
// Mentions: `@{<lowercase uuid>}` tokens inside message text
// ---------------------------------------------------------------------------

const MENTION_PATTERN = '@\\{([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\\}';

/** The token to insert into text for mentioning a user. */
export function mentionToken(userId: ID): string {
  return `@{${userId.toLowerCase()}}`;
}

/** Distinct mentioned ids in order of appearance (at most `max`). The server keeps only active members. */
export function extractMentionIds(
  text: string | null | undefined,
  max: number = MAX_MENTIONS,
): ID[] {
  if (!text) return [];
  const out: ID[] = [];
  for (const m of text.matchAll(new RegExp(MENTION_PATTERN, 'g'))) {
    const id = m[1]!;
    if (!out.includes(id)) out.push(id);
    if (out.length >= max) break;
  }
  return out;
}

/** Replace mention tokens with `@Name` (for previews, notifications, search snippets). */
export function renderMentions(text: string, nameOf: (id: ID) => string): string {
  return text.replace(new RegExp(MENTION_PATTERN, 'g'), (_, id: string) => `@${nameOf(id)}`);
}

export type TextSegment = { type: 'text'; text: string } | { type: 'mention'; userId: ID };

/** Split text into plain and mention segments (for rendering highlighted, tappable mentions). */
export function parseMentions(text: string): TextSegment[] {
  const out: TextSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(new RegExp(MENTION_PATTERN, 'g'))) {
    if (m.index! > last) out.push({ type: 'text', text: text.slice(last, m.index) });
    out.push({ type: 'mention', userId: m[1]! });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) });
  return out;
}

/**
 * Every user id a message references (sender, mentions, system actors/targets, reactions,
 * poll voters, contact card, call initiator, quoted sender, status author). The server
 * side-loads these in `MessagePage.users`; clients batch-fetch unknown ones.
 */
export function referencedUserIds(message: Message): ID[] {
  const ids = new Set<ID>();
  const add = (id: ID | null | undefined) => {
    if (id) ids.add(id);
  };
  add(message.senderId);
  message.mentions.forEach(add);
  const s = message.system;
  if (s) {
    if ('actorId' in s) add(s.actorId);
    if ('userId' in s) add(s.userId);
    if ('userIds' in s) s.userIds.forEach(add);
  }
  for (const r of message.reactions) r.userIds.forEach(add);
  for (const o of message.poll?.options ?? []) o.voterIds.forEach(add);
  add(message.contact?.userId);
  add(message.call?.initiatorId);
  add(message.replyTo?.senderId);
  add(message.statusReply?.authorId);
  return [...ids];
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** "m:ss" or "h:mm:ss". */
export function formatDuration(ms: number | null | undefined): string {
  const total = Math.max(0, Math.round((ms ?? 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

export function formatTimer(seconds: number): string {
  const day = 24 * 60 * 60;
  if (seconds % day === 0) {
    const d = seconds / day;
    return d === 1 ? '24 hours' : `${d} days`;
  }
  if (seconds % 3600 === 0) return `${seconds / 3600} hours`;
  return `${Math.round(seconds / 60)} minutes`;
}

/** Truncate for previews/notifications without splitting surrogate pairs. */
export function truncate(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`;
}

// ---------------------------------------------------------------------------
// Ticks
// ---------------------------------------------------------------------------

export type TickStatus = 'pending' | 'sent' | 'delivered' | 'read';

/**
 * Tick status for one of the viewer's own messages, or null when no ticks are shown
 * (channels, system and call messages). Messages without a server seq yet (optimistic)
 * are 'pending'.
 */
export function tickStatus(
  message: Pick<Message, 'seq' | 'type'> & { pending?: boolean },
  chat: Pick<ChatSummary, 'type' | 'readWatermark' | 'deliveredWatermark'>,
): TickStatus | null {
  if (chat.type === 'channel' || message.type === 'system' || message.type === 'call') return null;
  if (message.pending || !message.seq) return 'pending';
  if (message.seq <= chat.readWatermark) return 'read';
  if (message.seq <= chat.deliveredWatermark) return 'delivered';
  return 'sent';
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

/**
 * Per-viewer direction/outcome of a call (call log rows and call-message previews). Pass the
 * viewer's own participant status when known (call log); without it, an answered group
 * call reads as 'answered' for every non-initiator.
 */
export function callOutcome(
  call: Pick<CallMessagePayload, 'initiatorId' | 'status'>,
  viewerId: ID | null | undefined,
  myStatus?: CallParticipantStatus | null,
): { direction: CallDirection; outcome: CallOutcome } {
  const direction: CallDirection =
    viewerId && call.initiatorId === viewerId ? 'outgoing' : 'incoming';
  if (call.status === 'ringing' || call.status === 'ongoing')
    return { direction, outcome: 'ongoing' };
  if (direction === 'outgoing') {
    const outcome: CallOutcome =
      call.status === 'ended'
        ? 'answered'
        : call.status === 'missed'
          ? 'unanswered'
          : call.status === 'declined'
            ? 'declined'
            : 'cancelled';
    return { direction, outcome };
  }
  if (myStatus) {
    if (myStatus === 'joined' || myStatus === 'left') return { direction, outcome: 'answered' };
    if (myStatus === 'declined') return { direction, outcome: 'declined' };
    return { direction, outcome: 'missed' };
  }
  const outcome: CallOutcome =
    call.status === 'ended' ? 'answered' : call.status === 'declined' ? 'declined' : 'missed';
  return { direction, outcome };
}

// ---------------------------------------------------------------------------
// Human texts
// ---------------------------------------------------------------------------

function chatNoun(kind: ChatKind): string {
  return kind === 'channel' ? 'channel' : kind === 'announcement' ? 'community' : 'group';
}

/**
 * Human text for a system event. `nameOf` resolves user ids to names ("You" for the viewer);
 * `kind` picks the wording ("group", "channel" or "community" for announcement groups).
 */
export function systemEventText(
  event: SystemEvent,
  nameOf: (id: ID) => string,
  kind: ChatKind = 'group',
): string {
  const noun = chatNoun(kind);
  if (event.kind === 'owner_changed') return `The ${noun} owner is now ${nameOf(event.userId)}`;
  const actor = nameOf(event.actorId);
  switch (event.kind) {
    case 'group_created':
      return `${actor} created group "${event.name}"`;
    case 'channel_created':
      return `${actor} created channel "${event.name}"`;
    case 'community_created':
      return `${actor} created community "${event.name}"`;
    case 'members_added':
      return `${actor} added ${event.userIds.map(nameOf).join(', ')}`;
    case 'member_removed':
      return `${actor} removed ${nameOf(event.userId)}`;
    case 'member_left':
      return `${actor} left`;
    case 'member_joined_via_link':
      return `${actor} joined using this ${noun}'s invite link`;
    case 'member_joined':
      return `${actor} joined from the community`;
    case 'admin_promoted':
      return `${actor} made ${nameOf(event.userId)} an admin`;
    case 'admin_demoted':
      return `${actor} dismissed ${nameOf(event.userId)} as admin`;
    case 'owner_transferred':
      return `${actor} transferred ownership to ${nameOf(event.userId)}`;
    case 'name_changed':
      return `${actor} changed the ${noun} name to "${event.name}"`;
    case 'description_changed':
      return `${actor} changed the ${noun} description`;
    case 'avatar_changed':
      return `${actor} changed the ${noun} icon`;
    case 'settings_changed':
      switch (event.setting) {
        case 'onlyAdminsCanSend':
          return event.value
            ? `${actor} changed settings so only admins can send messages`
            : `${actor} changed settings so all members can send messages`;
        case 'onlyAdminsCanEditInfo':
          return event.value
            ? `${actor} changed settings so only admins can edit ${noun} info`
            : `${actor} changed settings so all members can edit ${noun} info`;
        case 'onlyAdminsCanAddMembers':
          return event.value
            ? `${actor} changed settings so only admins can add members`
            : `${actor} changed settings so all members can add members`;
      }
      return `${actor} changed the ${noun} settings`;
    case 'disappearing_changed':
      return event.seconds
        ? `${actor} turned on disappearing messages (${formatTimer(event.seconds)})`
        : `${actor} turned off disappearing messages`;
    case 'invite_link_reset':
      return `${actor} reset this ${noun}'s invite link`;
    case 'added_to_community':
      return `${actor} added this group to the community "${event.communityName}"`;
    case 'removed_from_community':
      return `${actor} removed this group from the community "${event.communityName}"`;
    case 'message_pinned':
      return `${actor} pinned a message`;
  }
}

function callText(call: CallMessagePayload, viewerId: ID | undefined): string {
  const base = call.callType === 'video' ? 'Video call' : 'Voice call';
  const kind = call.isGroup ? `Group ${base.toLowerCase()}` : base;
  const { direction, outcome } = callOutcome(call, viewerId);
  switch (outcome) {
    case 'ongoing':
      return `${kind} in progress`;
    case 'answered':
      return call.durationSec ? `${kind} · ${formatDuration(call.durationSec * 1000)}` : kind;
    case 'unanswered':
      return `${kind} · No answer`;
    case 'declined':
      return direction === 'outgoing' ? `${kind} · Declined` : `Declined ${kind.toLowerCase()}`;
    case 'cancelled':
      return `Cancelled ${kind.toLowerCase()}`;
    case 'missed':
      return `Missed ${kind.toLowerCase()}`;
  }
}

/**
 * One-line preview of a message for chat lists and notifications (without sender prefix).
 * Mention tokens are rendered as `@Name`. `viewerId` personalises call and deletion texts;
 * `chatKind` picks system-message wording.
 */
export function messagePreviewText(
  message: Message,
  nameOf: (id: ID) => string = () => 'Someone',
  opts: { viewerId?: ID; chatKind?: ChatKind } = {},
): string {
  if (message.deletedAt) {
    return opts.viewerId && message.senderId === opts.viewerId
      ? 'You deleted this message'
      : 'This message was deleted';
  }
  const caption = message.text ? renderMentions(message.text, nameOf).trim() : '';
  switch (message.type) {
    case 'text':
      return caption;
    case 'image':
      return caption ? `📷 ${caption}` : '📷 Photo';
    case 'video':
      return caption ? `🎥 ${caption}` : '🎥 Video';
    case 'voice':
      return `🎤 Voice message (${formatDuration(message.media?.durationMs)})`;
    case 'audio':
      return `🎵 ${caption || message.media?.fileName || 'Audio'}`;
    case 'file':
      return `📄 ${caption || message.media?.fileName || 'Document'}`;
    case 'location':
      return `📍 ${message.location?.name ?? 'Location'}`;
    case 'contact':
      return `👤 ${message.contact?.name ?? 'Contact'}`;
    case 'poll':
      return `📊 ${message.poll?.question ?? 'Poll'}`;
    case 'call':
      return message.call ? callText(message.call, opts.viewerId) : 'Call';
    case 'system':
      return message.system ? systemEventText(message.system, nameOf, opts.chatKind) : '';
  }
}
