/**
 * Moderation wording and choices: timeout lengths, ban message deletion windows, pause
 * lengths, the Members page filters, key permissions for Mod View and its audit lines.
 */
import { BAN_DELETE_MESSAGE_OPTIONS, PAUSE_DURATIONS, PERM } from '@enbox/shared';

/** Discord's timeout lengths. */
export const TIMEOUT_CHOICES = [
  { seconds: 60, label: '60 seconds' },
  { seconds: 300, label: '5 minutes' },
  { seconds: 600, label: '10 minutes' },
  { seconds: 3600, label: '1 hour' },
  { seconds: 86_400, label: '1 day' },
  { seconds: 604_800, label: '1 week' },
] as const;

const DELETE_LABELS: Record<(typeof BAN_DELETE_MESSAGE_OPTIONS)[number], string> = {
  0: 'Don’t delete any',
  3600: 'Previous hour',
  86_400: 'Previous 24 hours',
  604_800: 'Previous 7 days',
};

/** "Delete message history" of a ban. */
export const BAN_DELETE_CHOICES = BAN_DELETE_MESSAGE_OPTIONS.map((seconds) => ({
  seconds,
  label: DELETE_LABELS[seconds],
}));

/** Pause Invites / Pause DMs lengths: "1 hour", "6 hours", "12 hours", "24 hours". */
export const PAUSE_CHOICES = PAUSE_DURATIONS.map((seconds) => {
  const hours = Math.round(seconds / 3600);
  return { seconds, label: `${hours} hour${hours === 1 ? '' : 's'}` };
});

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Members page "Joined" filter (`?joined=` deep links use the same ids). */
export const JOINED_FILTERS = [
  { id: 'any', label: 'Any time', ms: 0 },
  { id: '1h', label: 'Last hour', ms: HOUR },
  { id: '24h', label: 'Last 24 hours', ms: DAY },
  { id: '7d', label: 'Last 7 days', ms: 7 * DAY },
  { id: '30d', label: 'Last 30 days', ms: 30 * DAY },
] as const;
export type JoinedFilter = (typeof JOINED_FILTERS)[number]['id'];

/** Accounts younger than this are "New account" (raids). */
export const NEW_ACCOUNT_MS = 7 * DAY;

export function isNewAccount(createdAt: string, now = Date.now()): boolean {
  return now - Date.parse(createdAt) < NEW_ACCOUNT_MS;
}

export function isTimedOut(until: string | null | undefined, now = Date.now()): boolean {
  return !!until && Date.parse(until) > now;
}

/** "Just now", "5 minutes ago", "3 days ago", "2 years ago". */
export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  const unit = (n: number, what: string) => `${n} ${what}${n === 1 ? '' : 's'} ago`;
  if (s < 60) return 'Just now';
  if (s < 3600) return unit(Math.floor(s / 60), 'minute');
  if (s < 86_400) return unit(Math.floor(s / 3600), 'hour');
  if (s < 30 * 86_400) return unit(Math.floor(s / 86_400), 'day');
  if (s < 365 * 86_400) return unit(Math.floor(s / (30 * 86_400)), 'month');
  return unit(Math.floor(s / (365 * 86_400)), 'year');
}

/** A full date and time for tooltips. */
export function fullDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** "until 3:45 PM" today, else "until Oct 24, 3:45 PM". */
export function untilLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return sameDay
    ? `until ${time}`
    : `until ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`;
}

/** Mod View: the permissions worth a moderator's attention, strongest first. */
export const KEY_PERMISSIONS: { bit: number; label: string }[] = [
  { bit: PERM.ADMINISTRATOR, label: 'Administrator' },
  { bit: PERM.MANAGE_SPACE, label: 'Manage Space' },
  { bit: PERM.MANAGE_ROLES, label: 'Manage Roles' },
  { bit: PERM.MANAGE_CHANNELS, label: 'Manage Channels' },
  { bit: PERM.KICK_MEMBERS, label: 'Kick Members' },
  { bit: PERM.BAN_MEMBERS, label: 'Ban Members' },
  { bit: PERM.MODERATE_MEMBERS, label: 'Time out Members' },
  { bit: PERM.MANAGE_MESSAGES, label: 'Manage Messages' },
  { bit: PERM.MANAGE_NICKNAMES, label: 'Manage Nicknames' },
  { bit: PERM.MENTION_EVERYONE, label: 'Mention @everyone' },
  { bit: PERM.VIEW_AUDIT_LOG, label: 'View Audit Log' },
  { bit: PERM.MANAGE_WEBHOOKS, label: 'Manage Webhooks' },
  { bit: PERM.MANAGE_EMOJI, label: 'Manage Expressions' },
  { bit: PERM.MOVE_MEMBERS, label: 'Move Members' },
  { bit: PERM.MUTE_MEMBERS, label: 'Mute Members' },
  { bit: PERM.DEAFEN_MEMBERS, label: 'Deafen Members' },
];

/** Mod View's history: what happened to the member (audit actions about them). */
const HISTORY: Record<string, string> = {
  'member.join': 'Joined the Space',
  'member.leave': 'Left the Space',
  'member.kick': 'Kicked',
  'member.ban': 'Banned',
  'member.unban': 'Unbanned',
  'member.timeout': 'Timeout changed',
  'member.roles': 'Roles changed',
  'member.update': 'Member updated',
  'member.voice_disconnect': 'Disconnected from voice',
  'member.voice_move': 'Moved to another voice channel',
  'automod.block': 'AutoMod blocked a message',
  'automod.flag': 'AutoMod flagged a message',
  'automod.timeout': 'Timed out by AutoMod',
};

export function historyLabel(action: string): string {
  return HISTORY[action] ?? action;
}
