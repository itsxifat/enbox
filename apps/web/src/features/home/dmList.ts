import { useMemo } from 'react';
import type { ChatSummary } from '@enbox/shared';
import { compareChats, useSortedChats } from '@/stores/chats';

/** Most recent activity first; pins don't count (Discord's DM list has none). */
export function sortDms(chats: readonly ChatSummary[]): ChatSummary[] {
  return [...chats].sort((a, b) => compareChats(a, b, { ignorePinned: true }));
}

/** Home's "Direct Messages": every direct and group chat of the main list, by activity. */
export function useDmList(): ChatSummary[] {
  const chats = useSortedChats();
  return useMemo(() => sortDms(chats), [chats]);
}
