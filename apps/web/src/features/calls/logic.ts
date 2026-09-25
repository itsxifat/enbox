/**
 * Pure call helpers (phase derivation, end-reason texts, call log grouping, missed-call
 * counts). No React, no stores — unit-tested in logic.test.ts.
 */
import {
  callOutcome,
  type Call,
  type CallLogEntry,
  type CallParticipant,
  type CallParticipantStatus,
  type ID,
} from '@enbox/shared';
import type { CallPhase, PeerConnectionState } from '@/stores/calls';

const PENDING: CallParticipantStatus[] = ['invited', 'ringing'];

export function isPendingStatus(s: CallParticipantStatus): boolean {
  return PENDING.includes(s);
}

export function isTerminal(call: Pick<Call, 'status'>): boolean {
  return call.status !== 'ringing' && call.status !== 'ongoing';
}

export function participantOf(
  call: Pick<Call, 'participants'>,
  userId: ID,
): CallParticipant | undefined {
  return call.participants.find((p) => p.userId === userId);
}

/** Other participants currently joined. */
export function joinedOthers(call: Pick<Call, 'participants'>, selfId: ID): CallParticipant[] {
  return call.participants.filter((p) => p.userId !== selfId && p.status === 'joined');
}

/** Other participants still being rung. */
export function pendingOthers(call: Pick<Call, 'participants'>, selfId: ID): CallParticipant[] {
  return call.participants.filter((p) => p.userId !== selfId && isPendingStatus(p.status));
}

export interface PhaseInput {
  call: Call;
  selfId: ID;
  connections: Record<ID, PeerConnectionState>;
  /** call:start / accept / join not acknowledged yet. */
  starting?: boolean;
  /** The socket is down (or a rejoin is in flight). */
  reconnecting?: boolean;
}

/**
 * The UI phase of the active call.
 * - terminal call → ended; socket down → reconnecting; before the ack → starting
 * - nobody else joined yet: ringing if an invitee's device rings, calling otherwise
 * - someone joined: connected once any peer connection is `connected`, else connecting
 */
export function derivePhase({
  call,
  selfId,
  connections,
  starting,
  reconnecting,
}: PhaseInput): CallPhase {
  if (isTerminal(call)) return 'ended';
  if (reconnecting) return 'reconnecting';
  if (starting) return 'starting';
  const joined = joinedOthers(call, selfId);
  if (joined.length === 0) {
    const pending = pendingOthers(call, selfId);
    if (pending.some((p) => p.status === 'ringing')) return 'ringing';
    if (pending.length > 0) return 'calling';
    return call.status === 'ongoing' ? 'connecting' : 'calling';
  }
  return joined.some((p) => connections[p.userId] === 'connected') ? 'connected' : 'connecting';
}

/** Some joined peers are connected but at least one link is struggling. */
export function hasPoorConnection(
  connections: Record<ID, PeerConnectionState>,
  peerIds: ID[],
): boolean {
  return peerIds.some((id) => connections[id] === 'disconnected' || connections[id] === 'failed');
}

/**
 * Text for the end-of-call screen, from my point of view: "Declined", "No answer", "Busy",
 * "Call ended", "Missed call"…
 */
export function endReasonText(
  call: Pick<Call, 'status' | 'initiatorId' | 'participants' | 'isGroup'>,
  selfId: ID,
): string {
  const outgoing = call.initiatorId === selfId;
  const invitees = call.participants.filter((p) => p.userId !== call.initiatorId);
  switch (call.status) {
    case 'declined':
      return outgoing ? 'Declined' : 'Call declined';
    case 'missed':
      if (outgoing) {
        return invitees.length > 0 && invitees.every((p) => p.status === 'busy')
          ? call.isGroup
            ? 'Everyone is on another call'
            : 'Busy'
          : 'No answer';
      }
      return 'Missed call';
    case 'cancelled':
      return outgoing ? 'Call cancelled' : 'Missed call';
    case 'ended':
      return 'Call ended';
    default:
      return 'Call ended';
  }
}

export type LogFilter = 'all' | 'missed';

export function isMissedEntry(e: Pick<CallLogEntry, 'direction' | 'outcome'>): boolean {
  return e.direction === 'incoming' && e.outcome === 'missed';
}

/** A run of consecutive log entries shown as one row ("Maya (3)"), like WhatsApp. */
export interface CallLogGroup {
  key: string;
  entries: CallLogEntry[];
  /** The newest entry of the group (drives the row). */
  head: CallLogEntry;
}

function sameLocalDay(a: string, b: string): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return (
    x.getFullYear() === y.getFullYear() &&
    x.getMonth() === y.getMonth() &&
    x.getDate() === y.getDate()
  );
}

/** Group consecutive entries of the same chat, direction and missed-ness on the same day. */
export function groupCallLog(entries: CallLogEntry[], filter: LogFilter = 'all'): CallLogGroup[] {
  const list = filter === 'missed' ? entries.filter(isMissedEntry) : entries;
  const out: CallLogGroup[] = [];
  for (const e of list) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.head.chat.id === e.chat.id &&
      prev.head.direction === e.direction &&
      isMissedEntry(prev.head) === isMissedEntry(e) &&
      prev.head.outcome !== 'ongoing' &&
      e.outcome !== 'ongoing' &&
      sameLocalDay(prev.head.call.createdAt, e.call.createdAt)
    ) {
      prev.entries.push(e);
      continue;
    }
    out.push({ key: e.call.id, entries: [e], head: e });
  }
  return out;
}

/** Missed incoming calls created after `since` (epoch ms) — the Calls tab badge. */
export function countMissedSince(entries: CallLogEntry[], since: number): number {
  return entries.filter((e) => isMissedEntry(e) && Date.parse(e.call.createdAt) > since).length;
}

/** Log entry for a call from my point of view (when the server log isn't refetched yet). */
export function logEntryFor(call: Call, selfId: ID, chat: CallLogEntry['chat']): CallLogEntry {
  const mine = participantOf(call, selfId);
  const { direction, outcome } = callOutcome(call, selfId, mine?.status ?? null);
  return { call, direction, outcome, chat };
}

/** "Voice call", "Group video call"… */
export function callKindLabel(call: Pick<Call, 'type' | 'isGroup'>): string {
  const base = call.type === 'video' ? 'video call' : 'voice call';
  return call.isGroup ? `Group ${base}` : base.charAt(0).toUpperCase() + base.slice(1);
}

/** Status line under the name while the call is not connected yet / connected. */
export function phaseLabel(
  phase: CallPhase,
  opts: { outgoing: boolean; isGroup: boolean },
): string {
  switch (phase) {
    case 'starting':
      return opts.outgoing ? 'Calling…' : 'Connecting…';
    case 'calling':
      return 'Calling…';
    case 'ringing':
      return 'Ringing…';
    case 'connecting':
      return 'Connecting…';
    case 'reconnecting':
      return 'Reconnecting…';
    case 'ended':
      return 'Call ended';
    default:
      return '';
  }
}

/** Grid columns for n tiles (phone portrait vs wide). */
export function gridColumns(n: number, wide: boolean): number {
  if (n <= 1) return 1;
  if (n === 2) return wide ? 2 : 1;
  if (n <= 4) return 2;
  if (n <= 6) return wide ? 3 : 2;
  return wide ? 4 : 2;
}
