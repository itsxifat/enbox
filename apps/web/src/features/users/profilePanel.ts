/**
 * The DM profile panel's toggle (Discord's "Show User Profile" in a DM header): open by
 * default, remembered on this device (`enbox.dmProfilePanel`). It shows on wide windows only
 * (`DM_PROFILE_QUERY`), where the header offers the toggle.
 */
import { create } from 'zustand';
import type { ChatSummary, ID } from '@enbox/shared';
import { storage } from '@/lib/storage';

const KEY = 'enbox.dmProfilePanel';
/** Room for the conversation (≥ ~540px of messages) and the 340px panel beside it. */
export const DM_PROFILE_QUERY = '(min-width: 1240px)';

interface DmProfilePanelState {
  open: boolean;
  toggle(): void;
}

export const useDmProfilePanel = create<DmProfilePanelState>((set, get) => ({
  open: storage.get(KEY) !== '0',
  toggle() {
    const open = !get().open;
    storage.set(KEY, open ? '1' : '0');
    set({ open });
  },
}));

/** The person a DM's profile panel shows: the peer of a one-to-one DM (not me, not deleted). */
export function dmProfilePeer(chat: ChatSummary, meId: ID | null | undefined): ID | null {
  const peer = chat.type === 'direct' && !chat.isGroupDm ? chat.peer : null;
  return peer && peer.id !== meId && !peer.isDeleted ? peer.id : null;
}
