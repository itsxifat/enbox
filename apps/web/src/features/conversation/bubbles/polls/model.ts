/**
 * Polls with an end, pure helpers (the server's rules: apps/server/src/modules/messages/
 * polls.ts): whether a poll ended, its countdown, winners and shares, who may end it and the
 * duration labels of the poll forms.
 */
import {
  PERM,
  hasPerm,
  isSpaceChatType,
  type ChatSummary,
  type ID,
  type Poll,
} from '@enbox/shared';
import type { ClientMessage } from '@/stores/messages';
import { isActionable } from '../../actions';

/** "1 hour" … "24 hours", "3 days", "1 week", "2 weeks" (POLL_DURATIONS_HOURS). */
export function pollDurationLabel(hours: number): string {
  if (hours % 168 === 0) return hours === 168 ? '1 week' : `${hours / 168} weeks`;
  if (hours > 24 && hours % 24 === 0) return `${hours / 24} days`;
  return hours === 1 ? '1 hour' : `${hours} hours`;
}

/** Voting is over: the server closed it, or its end passed (before that update arrives). */
export function pollEnded(poll: Pick<Poll, 'endsAt' | 'closedAt'>, now = Date.now()): boolean {
  return !!poll.closedAt || (!!poll.endsAt && Date.parse(poll.endsAt) <= now);
}

/** The countdown: "2d left", "5h left", "12m left", "<1m left". */
export function timeLeftLabel(endsAt: string, now = Date.now()): string {
  const minutes = Math.floor((Date.parse(endsAt) - now) / 60_000);
  if (minutes < 1) return '<1m left';
  if (minutes < 60) return `${minutes}m left`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h left` : `${Math.floor(hours / 24)}d left`;
}

/** Milliseconds until the countdown's minute changes, or the poll ends (0 = ended). */
export function nextTickIn(endsAt: string, now = Date.now()): number {
  const left = Date.parse(endsAt) - now;
  return left <= 0 ? 0 : (left % 60_000) + 1;
}

/** "1 vote", "3 votes". */
export function votesLabel(n: number): string {
  return `${n.toLocaleString()} ${n === 1 ? 'vote' : 'votes'}`;
}

/** A share of the voters in whole percent. */
export function percentOf(votes: number, voters: number): number {
  return voters ? Math.round((votes / voters) * 100) : 0;
}

/** The answers with the most votes (several on a tie, none without votes). */
export function winningOptionIds(poll: Pick<Poll, 'options'>): Set<string> {
  const top = Math.max(0, ...poll.options.map((o) => o.voteCount));
  return new Set(top ? poll.options.filter((o) => o.voteCount === top).map((o) => o.id) : []);
}

/** Voters are named in direct chats and groups; channels and Spaces show counts only. */
export function listsVoters(chat: Pick<ChatSummary, 'type'>): boolean {
  return chat.type === 'direct' || chat.type === 'group';
}

/**
 * End Poll Now, while the poll is open: its sender — a broadcast channel's admins who post,
 * for its polls — or MANAGE_MESSAGES in a Space channel. The server checks the same.
 */
export function canEndPoll(
  chat: ChatSummary,
  m: ClientMessage,
  me: ID | null | undefined,
  now = Date.now(),
): boolean {
  if (m.type !== 'poll' || !m.poll || !isActionable(m) || m.deletedAt) return false;
  if (chat.membership !== 'active' || pollEnded(m.poll, now)) return false;
  if (chat.type === 'channel') return chat.permissions.canSend;
  if (me && m.senderId === me) return true;
  return isSpaceChatType(chat.type) && hasPerm(chat.spacePermissions, PERM.MANAGE_MESSAGES);
}
