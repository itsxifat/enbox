/**
 * Collectibles favourites (the heart on each card): item keys kept on this device in
 * localStorage. Every access is wrapped: private mode or disabled storage just means the
 * hearts don't survive a reload.
 */
import { create } from 'zustand';

export const FAVOURITES_KEY = 'enbox.collectibles.favourites';

export function readFavourites(): string[] {
  try {
    const raw = localStorage.getItem(FAVOURITES_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

function writeFavourites(keys: string[]): void {
  try {
    localStorage.setItem(FAVOURITES_KEY, JSON.stringify(keys));
  } catch {
    /* quota / disabled storage */
  }
}

interface FavouritesState {
  keys: string[];
  toggle(key: string): void;
  /** Re-read storage (another tab changed it, or tests). */
  reload(): void;
}

export const useFavourites = create<FavouritesState>((set, get) => ({
  keys: readFavourites(),
  toggle(key) {
    const keys = get().keys.includes(key)
      ? get().keys.filter((k) => k !== key)
      : [...get().keys, key];
    writeFavourites(keys);
    set({ keys });
  },
  reload() {
    set({ keys: readFavourites() });
  },
}));
