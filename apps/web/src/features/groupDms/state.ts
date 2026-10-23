/**
 * Group DM UI state shared by the conversation header, its menu and the panels it opens:
 * which chat's member list is open, and the "Add Friends to DM" picker (with its anchor).
 */
import { create } from 'zustand';
import type { ID } from '@enbox/shared';
import type { PopoverAnchor } from '@/components/ui';
import { registerSessionReset } from '@/lib/session';

interface GroupDmUiState {
  /** The chat whose member list is open (one at a time). */
  membersOf: ID | null;
  /** The picker opened from a chat's header (or its menu, on phones). */
  picker: { chatId: ID; anchor: PopoverAnchor } | null;
  toggleMembers(chatId: ID): void;
  closeMembers(): void;
  openPicker(chatId: ID, anchor: PopoverAnchor): void;
  closePicker(): void;
}

export const useGroupDmUi = create<GroupDmUiState>((set, get) => ({
  membersOf: null,
  picker: null,
  toggleMembers: (chatId) => set({ membersOf: get().membersOf === chatId ? null : chatId }),
  closeMembers: () => set({ membersOf: null }),
  openPicker: (chatId, anchor) => set({ picker: { chatId, anchor } }),
  closePicker: () => set({ picker: null }),
}));

registerSessionReset(() => useGroupDmUi.setState({ membersOf: null, picker: null }));
