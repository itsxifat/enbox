/**
 * Message search state (features/search): what each scope's header box holds — kept while
 * moving between the channels of a Space, as Discord does — the recent searches per scope
 * (this device, cleared on logout) and the results' sort order.
 */
import { create } from 'zustand';
import { registerSessionReset } from '@/lib/session';
import { storage } from '@/lib/storage';
import type { ParsedQuery } from '@/features/search/query';
import type { SearchScope } from './sidePanel';

export type SearchSort = 'newest' | 'oldest';

/** Recent searches kept per scope. */
export const MAX_RECENT_SEARCHES = 5;

const RECENTS_KEY = 'enbox.search.recents';

/** `space:<id>` (one box for the whole Space) or `chat:<id>`. */
export function scopeKey(scope: SearchScope): string {
  return scope.kind === 'space' ? `space:${scope.spaceId}` : `chat:${scope.chatId}`;
}

interface SearchState {
  drafts: Record<string, ParsedQuery>;
  /** Canonical query strings, newest first. */
  recents: Record<string, string[]>;
  sort: SearchSort;
  setDraft(key: string, draft: ParsedQuery): void;
  remember(key: string, query: string): void;
  clearRecents(key: string): void;
  setSort(sort: SearchSort): void;
}

function loadRecents(): Record<string, string[]> {
  const raw = storage.getJSON<Record<string, unknown>>(RECENTS_KEY);
  const out: Record<string, string[]> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw))
    if (Array.isArray(v)) out[k] = v.filter((x): x is string => typeof x === 'string').slice(0, MAX_RECENT_SEARCHES);
  return out;
}

export const useSearch = create<SearchState>((set, get) => ({
  drafts: {},
  recents: loadRecents(),
  sort: 'newest',

  setDraft(key, draft) {
    set((s) => ({ drafts: { ...s.drafts, [key]: draft } }));
  },

  remember(key, query) {
    if (!query) return;
    const list = [query, ...(get().recents[key] ?? []).filter((q) => q !== query)].slice(0, MAX_RECENT_SEARCHES);
    const recents = { ...get().recents, [key]: list };
    set({ recents });
    storage.setJSON(RECENTS_KEY, recents);
  },

  clearRecents(key) {
    const recents = { ...get().recents };
    delete recents[key];
    set({ recents });
    storage.setJSON(RECENTS_KEY, recents);
  },

  setSort(sort) {
    set({ sort });
  },
}));

registerSessionReset(() => {
  storage.remove(RECENTS_KEY);
  useSearch.setState({ drafts: {}, recents: {}, sort: 'newest' });
});
