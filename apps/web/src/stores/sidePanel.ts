import { create } from 'zustand';
import type { ID } from '@enbox/shared';

/** What the search covers: a whole Space (optionally starting in one channel) or one DM / group. */
export type SearchScope = { kind: 'space'; spaceId: ID; channelId?: ID } | { kind: 'chat'; chatId: ID };

/**
 * The right-hand panel next to a conversation (Discord: a thread opens beside its channel,
 * search results replace the member list). Null: the default (the member list in Spaces).
 */
export type SidePanel =
  | { kind: 'thread'; threadId: ID; parentId: ID }
  | { kind: 'search'; scope: SearchScope; query: string }
  | null;

interface SidePanelState {
  panel: SidePanel;
  open(panel: Exclude<SidePanel, null>): void;
  close(): void;
}

export const useSidePanel = create<SidePanelState>((set) => ({
  panel: null,
  open: (panel) => set({ panel }),
  close: () => set({ panel: null }),
}));
