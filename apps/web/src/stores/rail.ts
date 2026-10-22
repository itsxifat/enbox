/**
 * The Space rail's order and folders (Discord's server list), synced across my devices.
 *
 * - `layout`: my `RailEntry[]` (`UserSelf.railLayout`). Edits apply at once and are saved
 *   500ms after the last one (`PUT /api/me/rail-layout`); a refused save reverts to the
 *   server's copy (rate-limited or offline: kept and retried later). The profile from
 *   `useAuth` (`GET /api/me`, `me:updated` from my other devices) replaces it whenever no
 *   save is waiting, so devices converge.
 * - `open`: the folders expanded on this device (localStorage; folders start closed).
 *
 * The layout logic is pure and unit-tested: `railItems` resolves it against my Spaces (Spaces
 * missing from it show on top, newest join first; a folder left with one Space dissolves),
 * `applyRailDrop` is one drag (reorder, make a folder, add to or take out of one),
 * `moveInRail` the keyboard move (Alt+Shift+↑/↓).
 */
import { useMemo } from 'react';
import { create } from 'zustand';
import type { ID, RailEntry, RailFolder, Space } from '@enbox/shared';
import { ApiError, api } from '@/lib/api';
import { registerSessionReset, sessionEpoch } from '@/lib/session';
import { storage } from '@/lib/storage';
import { useAuth } from './auth';
import { useChats } from './chats';
import { computeSpaceBadges, useSpaceList, useSpaces } from './spaces';
import { toast } from './ui';

// ---------------------------------------------------------------------------
// Pure layout logic
// ---------------------------------------------------------------------------

/** A resolved rail item. */
export type RailItem =
  | { kind: 'space'; space: Space }
  | { kind: 'folder'; folder: RailFolder; spaces: Space[] };

/** Where a dragged Space or folder lands. */
export type RailDrop =
  /** Next to a Space (top level or in a folder) or a folder. */
  | { kind: 'before' | 'after'; targetId: string }
  /** Onto a top-level Space: the two make a new folder. */
  | { kind: 'combine'; spaceId: ID }
  /** Into a folder, at `index` (default: the end). */
  | { kind: 'into'; folderId: string; index?: number }
  /** After everything (the rail's end). */
  | { kind: 'end' };

/** The key of an entry: its Space or folder id. */
export function entryKey(e: RailEntry): string {
  return e.kind === 'space' ? e.id : e.folder.id;
}

/** A new folder id (client-made, unique within my layout). */
export function newFolderId(): string {
  return `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function clone(layout: readonly RailEntry[]): RailEntry[] {
  return layout.map((e) => (e.kind === 'space' ? { ...e } : { kind: 'folder', folder: { ...e.folder, spaceIds: [...e.folder.spaceIds] } }));
}

/** Folders left empty go; a folder left with one Space dissolves into it. */
export function tidyRail(layout: readonly RailEntry[]): RailEntry[] {
  const out: RailEntry[] = [];
  for (const e of layout) {
    if (e.kind === 'space') out.push(e);
    else if (e.folder.spaceIds.length === 1) out.push({ kind: 'space', id: e.folder.spaceIds[0]! });
    else if (e.folder.spaceIds.length > 1) out.push(e);
  }
  return out;
}

/**
 * My layout over exactly my Spaces: unknown or repeated ids drop, Spaces missing from it go
 * on top (newest join first), single-Space folders dissolve.
 */
export function normalizeRail(layout: readonly RailEntry[] | undefined, spaces: readonly Space[]): RailEntry[] {
  const known = new Set(spaces.map((s) => s.id));
  const seen = new Set<ID>();
  const keep = (id: ID) => known.has(id) && !seen.has(id) && !!seen.add(id);
  const placed: RailEntry[] = [];
  for (const e of layout ?? []) {
    if (e.kind === 'space') {
      if (keep(e.id)) placed.push({ kind: 'space', id: e.id });
    } else {
      placed.push({ kind: 'folder', folder: { ...e.folder, spaceIds: e.folder.spaceIds.filter(keep) } });
    }
  }
  const missing = spaces
    .filter((s) => !seen.has(s.id))
    .sort((a, b) => b.me.joinedAt.localeCompare(a.me.joinedAt) || (a.id < b.id ? -1 : 1))
    .map((s): RailEntry => ({ kind: 'space', id: s.id }));
  return tidyRail([...missing, ...placed]);
}

/** The rail to render: `normalizeRail` with the Spaces themselves. */
export function railItems(layout: readonly RailEntry[] | undefined, spaces: readonly Space[]): RailItem[] {
  const byId = new Map(spaces.map((s) => [s.id, s]));
  return normalizeRail(layout, spaces).map((e): RailItem =>
    e.kind === 'space'
      ? { kind: 'space', space: byId.get(e.id)! }
      : { kind: 'folder', folder: e.folder, spaces: e.folder.spaceIds.map((id) => byId.get(id)!) },
  );
}

/** Where a Space is: its top-level index, or its folder and index in it. */
function locate(layout: readonly RailEntry[], id: string): { index: number; folder: RailFolder | null; inFolder: number } | null {
  for (let i = 0; i < layout.length; i++) {
    const e = layout[i]!;
    if (entryKey(e) === id) return { index: i, folder: null, inFolder: -1 };
    if (e.kind === 'folder') {
      const j = e.folder.spaceIds.indexOf(id);
      if (j >= 0) return { index: i, folder: e.folder, inFolder: j };
    }
  }
  return null;
}

/**
 * One drop (Discord's rail drag) on a normalised layout: a Space moves next to another one
 * (in its folder, if it is in one), onto a top-level Space (a new folder of the two), into a
 * folder or to the end; a folder moves between top-level items (never into another folder).
 * A folder the Space left with one Space dissolves. Returns `layout` itself for a no-op.
 */
export function applyRailDrop(
  layout: readonly RailEntry[],
  dragId: string,
  drop: RailDrop,
  makeId: () => string = newFolderId,
): RailEntry[] {
  const entries = clone(layout);
  const from = locate(entries, dragId);
  if (!from) return layout as RailEntry[];
  const targetId =
    drop.kind === 'before' || drop.kind === 'after' ? drop.targetId : drop.kind === 'combine' ? drop.spaceId : drop.kind === 'into' ? drop.folderId : null;
  if (targetId === dragId) return layout as RailEntry[];

  // A folder: between top-level items (a target inside a folder stands for its folder).
  if (from.folder === null && entries[from.index]!.kind === 'folder') {
    const [moved] = entries.splice(from.index, 1);
    if (drop.kind === 'end') {
      entries.push(moved!);
      return tidyRail(entries);
    }
    const at = locate(entries, targetId!);
    if (!at) return layout as RailEntry[];
    entries.splice(drop.kind === 'after' ? at.index + 1 : at.index, 0, moved!);
    return tidyRail(entries);
  }

  // A Space: out of where it is (its folder may dissolve once tidied), then in.
  if (from.folder) from.folder.spaceIds.splice(from.inFolder, 1);
  else entries.splice(from.index, 1);
  const space: RailEntry = { kind: 'space', id: dragId };
  if (drop.kind === 'end') {
    entries.push(space);
    return tidyRail(entries);
  }
  if (drop.kind === 'into') {
    const folder = entries.find((e): e is Extract<RailEntry, { kind: 'folder' }> => e.kind === 'folder' && e.folder.id === drop.folderId);
    if (!folder) return layout as RailEntry[];
    const ids = folder.folder.spaceIds;
    ids.splice(Math.max(0, Math.min(drop.index ?? ids.length, ids.length)), 0, dragId);
    return tidyRail(entries);
  }
  const at = locate(entries, targetId!);
  if (!at) return layout as RailEntry[];
  const after = drop.kind !== 'before';
  if (at.folder) {
    // Next to a Space in a folder (dropping onto it adds after it: folders do not nest).
    at.folder.spaceIds.splice(at.inFolder + (after ? 1 : 0), 0, dragId);
  } else if (drop.kind === 'combine' && entries[at.index]!.kind === 'space') {
    entries[at.index] = { kind: 'folder', folder: { id: makeId(), name: null, color: null, spaceIds: [targetId!, dragId] } };
  } else if (drop.kind === 'combine') {
    // Onto a folder: into it.
    (entries[at.index] as Extract<RailEntry, { kind: 'folder' }>).folder.spaceIds.push(dragId);
  } else {
    entries.splice(at.index + (after ? 1 : 0), 0, space);
  }
  return tidyRail(entries);
}

/**
 * The keyboard move (Alt+Shift+↑/↓) of a Space or folder by one place: a top-level item swaps
 * with its neighbour (a folder counts as one item); a Space in a folder swaps inside it, and
 * past its first or last place leaves the folder. Returns `layout` itself when it can't move.
 */
export function moveInRail(layout: readonly RailEntry[], id: string, dir: -1 | 1): RailEntry[] {
  const entries = clone(layout);
  const at = locate(entries, id);
  if (!at) return layout as RailEntry[];
  if (at.folder) {
    const ids = at.folder.spaceIds;
    const j = at.inFolder + dir;
    if (j >= 0 && j < ids.length) {
      [ids[at.inFolder], ids[j]] = [ids[j]!, ids[at.inFolder]!];
      return entries;
    }
    ids.splice(at.inFolder, 1);
    entries.splice(dir < 0 ? at.index : at.index + 1, 0, { kind: 'space', id });
    return tidyRail(entries);
  }
  const j = at.index + dir;
  if (j < 0 || j >= entries.length) return layout as RailEntry[];
  [entries[at.index], entries[j]] = [entries[j]!, entries[at.index]!];
  return entries;
}

/** Rename or recolour a folder. */
export function updateRailFolder(
  layout: readonly RailEntry[],
  folderId: string,
  patch: Partial<Pick<RailFolder, 'name' | 'color'>>,
): RailEntry[] {
  return layout.map((e) => (e.kind === 'folder' && e.folder.id === folderId ? { kind: 'folder', folder: { ...e.folder, ...patch } } : e));
}

export function sameRail(a: readonly RailEntry[] | undefined, b: readonly RailEntry[] | undefined): boolean {
  return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const OPEN_KEY = 'enbox.rail.openFolders';
const SAVE_DELAY_MS = 500;

export interface RailState {
  /** My layout (local edits included before they are saved). */
  layout: RailEntry[];
  /** Folder ids expanded on this device. */
  open: Record<string, true>;
  /** Apply a new layout at once and save it (debounced). */
  setLayout(next: RailEntry[]): void;
  /** Expand or close a folder (toggles without `open`). */
  toggleFolder(id: string, open?: boolean): void;
}

/** Retry delays of a save that hit the rate limit or the network (then the last one). */
const RETRY_MS = [5_000, 15_000, 30_000, 60_000];

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let inflight = 0;
let retries = 0;
/** A save is waiting or running: the server's copy is older than mine. */
const busy = () => saveTimer !== null || inflight > 0;
const serverLayout = () => useAuth.getState().user?.railLayout ?? [];
const storedOpen = () => storage.getJSON<Record<string, true>>(OPEN_KEY) ?? {};

function schedule(ms: number): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void flush(), ms);
}

async function flush(): Promise<void> {
  saveTimer = null;
  const epoch = sessionEpoch();
  const items = useRail.getState().layout;
  inflight += 1;
  let saved: RailEntry[] | null = null;
  let error: unknown = null;
  try {
    saved = await api.put<RailEntry[]>('/api/me/rail-layout', { items });
  } catch (e) {
    error = e;
  }
  if (epoch !== sessionEpoch()) return;
  inflight -= 1;
  if (saved) {
    retries = 0;
    // The cached profile follows (and, with no newer edit waiting, the rail adopts the
    // server's cleaned copy through the subscription below).
    useAuth.getState().patchUser({ railLayout: saved });
    return;
  }
  // Too many saves in a row, or offline: keep my order and try again a little later.
  if (error instanceof ApiError && (error.status === 429 || error.isNetworkError)) {
    if (!saveTimer) schedule(RETRY_MS[Math.min(retries, RETRY_MS.length - 1)]!);
    retries += 1;
    return;
  }
  retries = 0;
  toast.error(error);
  if (!busy()) useRail.setState({ layout: serverLayout() });
}

export const useRail = create<RailState>((set, get) => ({
  layout: serverLayout(),
  open: storedOpen(),

  setLayout(next) {
    if (sameRail(next, get().layout)) return;
    set({ layout: next });
    schedule(SAVE_DELAY_MS);
  },

  toggleFolder(id, open) {
    const cur = { ...get().open };
    const next = open ?? !cur[id];
    if (next) cur[id] = true;
    else delete cur[id];
    storage.setJSON(OPEN_KEY, cur);
    set({ open: cur });
  },
}));

// My profile (boot, `GET /api/me`, `me:updated` from another device) is the server's copy.
useAuth.subscribe((s, prev) => {
  const next = s.user?.railLayout;
  if (next === prev.user?.railLayout || busy()) return;
  if (!sameRail(next, useRail.getState().layout)) useRail.setState({ layout: next ?? [] });
});

registerSessionReset(() => {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  inflight = 0;
  retries = 0;
  useRail.setState({ layout: serverLayout(), open: storedOpen() });
});

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

/** The rail in order: my Spaces and folders. */
export function useRailItems(): RailItem[] {
  const spaces = useSpaceList();
  const layout = useRail((s) => s.layout);
  return useMemo(() => railItems(layout, spaces), [layout, spaces]);
}

/** A folder's badge: unread when one of its Spaces is, their mentions summed (`computeSpaceBadges`). */
export function useFolderBadge(spaces: readonly Space[]): { unread: boolean; mentions: number } {
  const byId = useChats((s) => s.byId);
  const loaded = useSpaces((s) => s.channelsLoaded);
  return useMemo(() => {
    let unread = false;
    let mentions = 0;
    for (const b of computeSpaceBadges(spaces, byId, loaded).values()) {
      unread ||= b.unread;
      mentions += b.mentions;
    }
    return { unread, mentions };
  }, [byId, loaded, spaces]);
}
