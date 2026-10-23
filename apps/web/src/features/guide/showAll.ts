/**
 * "Show All Channels" per Space on this device (Browse Channels): the sidebar lists every
 * channel I can see, whatever my choices and the opt-in defaults say. A local preference.
 */
import { create } from 'zustand';
import type { ID } from '@enbox/shared';
import { storage } from '@/lib/storage';

const KEY = 'enbox.spaces.showAllChannels';

type BySpace = Record<ID, true>;

function read(): BySpace {
  const raw = storage.getJSON<unknown>(KEY);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter(([, on]) => on === true)) as BySpace;
}

const useShowAll = create<{ bySpace: BySpace }>(() => ({ bySpace: read() }));

export function useShowAllChannels(spaceId: ID | null | undefined): boolean {
  return useShowAll((s) => (spaceId ? !!s.bySpace[spaceId] : false));
}

export function setShowAllChannels(spaceId: ID, on: boolean): void {
  const next = { ...useShowAll.getState().bySpace };
  if (on) next[spaceId] = true;
  else delete next[spaceId];
  storage.setJSON(KEY, next);
  useShowAll.setState({ bySpace: next });
}
