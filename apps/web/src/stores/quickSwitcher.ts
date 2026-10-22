import { create } from 'zustand';

/** Whether the Quick Switcher (Ctrl+K) or the keyboard shortcuts sheet (Ctrl+/) is open. */
interface QuickSwitcherState {
  open: boolean;
  /** Prefilled query (e.g. '@' from "Find or start a conversation"). */
  initialQuery: string;
  shortcutsOpen: boolean;
  show(initialQuery?: string): void;
  hide(): void;
  toggle(): void;
  setShortcutsOpen(open: boolean): void;
}

export const useQuickSwitcher = create<QuickSwitcherState>((set, get) => ({
  open: false,
  initialQuery: '',
  shortcutsOpen: false,
  show: (initialQuery = '') => set({ open: true, initialQuery, shortcutsOpen: false }),
  hide: () => set({ open: false, initialQuery: '' }),
  toggle: () => (get().open ? get().hide() : get().show()),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen, open: false }),
}));
