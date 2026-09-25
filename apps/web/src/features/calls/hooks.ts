/**
 * Public hooks of the calls feature for other features (documented in apps/web/README.md):
 * - `useActiveCallForChat(chatId)`  live call of a chat + my relation to it (join banners)
 * - `useMissedCallsCount()`         Calls tab badge (missed calls since the last visit)
 * - `markCallsVisited()`            reset that badge (the Calls tab does it while open)
 */
import { useEffect, useSyncExternalStore } from 'react';
import type { Call, ID } from '@enbox/shared';
import { storage } from '@/lib/storage';
import { useMe } from '@/stores/auth';
import { useCalls } from '@/stores/calls';
import { useChats } from '@/stores/chats';
import { countMissedSince, isPendingStatus, joinedOthers, participantOf } from './logic';

export interface ChatCallState {
  /** The chat's live (ringing/ongoing) call, if any. */
  call: Call | null;
  /** I'm in it on this device. */
  inCallHere: boolean;
  /** I'm joined from another device/tab. */
  inCallElsewhere: boolean;
  /** It is ringing me. */
  ringingMe: boolean;
  /** I could join it now (group calls). */
  canJoin: boolean;
  /** Joined participants (including me when joined). */
  joinedCount: number;
}

export function useActiveCallForChat(chatId: ID | null | undefined): ChatCallState {
  const me = useMe()?.id;
  const call = useCalls((s) => (chatId ? (s.liveCalls[chatId] ?? null) : null));
  const active = useCalls((s) => s.active);
  // Former members can't join (the server answers 403 not_member).
  const formerMember = useChats((s) => {
    const chat = chatId ? s.byId[chatId] : undefined;
    return !!chat && chat.membership !== 'active';
  });
  const inCallHere =
    !!active && active.phase !== 'ended' && !!chatId && active.call.chatId === chatId;
  const mine = call && me ? participantOf(call, me) : undefined;
  const inCallElsewhere = !inCallHere && mine?.status === 'joined';
  const ringingMe = !!mine && isPendingStatus(mine.status);
  const joinedCount = call
    ? joinedOthers(call, me ?? '').length + (mine?.status === 'joined' ? 1 : 0)
    : 0;
  return {
    call,
    inCallHere,
    inCallElsewhere,
    ringingMe,
    canJoin:
      !!call &&
      call.isGroup &&
      !formerMember &&
      !inCallHere &&
      !inCallElsewhere &&
      joinedCount > 0,
    joinedCount,
  };
}

// ---------------------------------------------------------------------------
// Missed calls badge
// ---------------------------------------------------------------------------

const VISIT_KEY = 'enbox.calls.lastVisit';
const visitListeners = new Set<() => void>();

function lastVisit(): number {
  const raw = storage.get(VISIT_KEY);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : 0;
}

/** Mark every call so far as seen (Calls tab opened). */
export function markCallsVisited(at: number = Date.now()): void {
  if (at <= lastVisit()) return;
  storage.set(VISIT_KEY, String(at));
  for (const l of [...visitListeners]) l();
}

function subscribeVisit(fn: () => void): () => void {
  visitListeners.add(fn);
  const onStorage = (e: StorageEvent) => {
    if (e.key === VISIT_KEY) fn();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    visitListeners.delete(fn);
    window.removeEventListener('storage', onStorage);
  };
}

/**
 * Missed incoming calls since the Calls tab was last opened (localStorage timestamp), from
 * the call log's first page (loaded on connect). For the nav badge:
 * `calls: missed ? { count: missed } : undefined` in `useTabBadges()`.
 */
export function useMissedCallsCount(): number {
  const since = useSyncExternalStore(subscribeVisit, lastVisit, () => 0);
  const entries = useCalls((s) => s.log.entries);
  return countMissedSince(entries, since);
}

/** Keep the badge cleared while the Calls tab is mounted (and when new entries arrive). */
export function useMarkCallsVisited(): void {
  const entries = useCalls((s) => s.log.entries);
  useEffect(() => {
    markCallsVisited();
  }, [entries]);
}
