/**
 * Pure helpers shared by server and clients.
 */
import type { ChatSummary, ID, Message, SystemEvent, UserPublic } from './models.js';

/** Stable unique key for a direct chat between two users (order-independent). */
export function directChatKey(a: ID, b: ID): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

export function isMuted(mutedUntil: string | null | undefined, now: Date = new Date()): boolean {
  return !!mutedUntil && new Date(mutedUntil).getTime() > now.getTime();
}

/** Name to show for a user: saved contact name, then display name. */
export function userDisplayName(user: Pick<UserPublic, 'displayName' | 'contactName' | 'isDeleted'> | null | undefined): string {
  if (!user) return 'Unknown';
  if (user.isDeleted) return 'Deleted account';
  return user.contactName || user.displayName;
}

/** Title for a chat row/header. */
export function chatTitle(chat: Pick<ChatSummary, 'type' | 'name' | 'peer'>): string {
  if (chat.type === 'direct') return userDisplayName(chat.peer);
  return chat.name ?? 'Untitled';
}

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

export type TickStatus = 'pending' | 'sent' | 'delivered' | 'read';

/**
 * Tick status for one of the viewer's own messages. Messages without a server seq yet
 * (optimistic) are 'pending'.
 */
export function tickStatus(
  message: Pick<Message, 'seq'> & { pending?: boolean },
  chat: Pick<ChatSummary, 'readWatermark' | 'deliveredWatermark'>,
): TickStatus {
  if (message.pending || !message.seq) return 'pending';
  if (message.seq <= chat.readWatermark) return 'read';
  if (message.seq <= chat.deliveredWatermark) return 'delivered';
  return 'sent';
}

/** Human text for a system event. `nameOf` resolves user ids to names ("You" for the viewer). */
export function systemEventText(event: SystemEvent, nameOf: (id: ID) => string): string {
  const actor = nameOf(event.actorId);
  switch (event.kind) {
    case 'group_created':
      return `${actor} created group "${event.name}"`;
    case 'channel_created':
      return `${actor} created channel "${event.name}"`;
    case 'members_added':
      return `${actor} added ${event.userIds.map(nameOf).join(', ')}`;
    case 'member_removed':
      return `${actor} removed ${nameOf(event.userId)}`;
    case 'member_left':
      return `${actor} left`;
    case 'member_joined_via_link':
      return `${actor} joined using this group's invite link`;
    case 'admin_promoted':
      return `${actor} made ${nameOf(event.userId)} an admin`;
    case 'admin_demoted':
      return `${actor} dismissed ${nameOf(event.userId)} as admin`;
    case 'owner_transferred':
      return `${actor} transferred ownership to ${nameOf(event.userId)}`;
    case 'name_changed':
      return `${actor} changed the group name to "${event.name}"`;
    case 'description_changed':
      return `${actor} changed the group description`;
    case 'avatar_changed':
      return `${actor} changed the group icon`;
    case 'settings_changed': {
      const s = event.settings;
      if (s.onlyAdminsCanSend !== undefined)
        return s.onlyAdminsCanSend
          ? `${actor} changed settings so only admins can send messages`
          : `${actor} changed settings so all members can send messages`;
      if (s.onlyAdminsCanEditInfo !== undefined)
        return s.onlyAdminsCanEditInfo
          ? `${actor} changed settings so only admins can edit group info`
          : `${actor} changed settings so all members can edit group info`;
      if (s.onlyAdminsCanAddMembers !== undefined)
        return s.onlyAdminsCanAddMembers
          ? `${actor} changed settings so only admins can add members`
          : `${actor} changed settings so all members can add members`;
      return `${actor} changed the group settings`;
    }
    case 'disappearing_changed':
      return event.seconds
        ? `${actor} turned on disappearing messages (${formatTimer(event.seconds)})`
        : `${actor} turned off disappearing messages`;
    case 'invite_link_reset':
      return `${actor} reset the invite link`;
    case 'added_to_community':
      return `${actor} added this group to the community "${event.communityName}"`;
    case 'removed_from_community':
      return `${actor} removed this group from the community "${event.communityName}"`;
    case 'message_pinned':
      return `${actor} pinned a message`;
    case 'chat_started':
      return `${actor} started this chat`;
  }
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

/**
 * One-line preview of a message for chat lists and notifications (without sender prefix).
 */
export function messagePreviewText(message: Message, nameOf: (id: ID) => string = () => 'Someone'): string {
  if (message.deletedAt) return 'This message was deleted';
  const caption = message.text?.trim();
  switch (message.type) {
    case 'text':
      return caption ?? '';
    case 'image':
      return caption ? `📷 ${caption}` : '📷 Photo';
    case 'video':
      return caption ? `🎥 ${caption}` : '🎥 Video';
    case 'voice':
      return `🎤 Voice message (${formatDuration(message.media?.durationMs)})`;
    case 'audio':
      return `🎵 ${message.media?.fileName ?? 'Audio'}`;
    case 'file':
      return `📄 ${message.media?.fileName ?? 'Document'}`;
    case 'location':
      return `📍 ${message.location?.name ?? 'Location'}`;
    case 'contact':
      return `👤 ${message.contact?.name ?? 'Contact'}`;
    case 'poll':
      return `📊 ${message.poll?.question ?? 'Poll'}`;
    case 'call': {
      const c = message.call;
      const kind = c?.callType === 'video' ? 'Video call' : 'Voice call';
      if (!c) return kind;
      if (c.status === 'missed') return `Missed ${kind.toLowerCase()}`;
      if (c.status === 'declined') return `${kind} declined`;
      if (c.status === 'cancelled') return `Cancelled ${kind.toLowerCase()}`;
      if (c.status === 'ringing' || c.status === 'ongoing') return `${kind} in progress`;
      return c.durationSec ? `${kind} · ${formatDuration(c.durationSec * 1000)}` : kind;
    }
    case 'system':
      return message.system ? systemEventText(message.system, nameOf) : '';
  }
}

/** Truncate for previews/notifications without splitting surrogate pairs. */
export function truncate(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`;
}
