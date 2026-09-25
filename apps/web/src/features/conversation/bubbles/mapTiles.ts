/**
 * Location previews load their OpenStreetMap tile only after the viewer asks for it ("Show
 * map"): fetching it tells a third party the viewer's IP address and roughly where the shared
 * location is (a zoom-15 tile is ~1 km), so it never happens just by opening a chat. The
 * choice is remembered per tile for this session (in memory only; cleared on logout).
 */
import { useCallback, useSyncExternalStore } from 'react';
import { registerSessionReset } from '@/lib/session';

const revealed = new Set<string>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of [...listeners]) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function tileKey(t: { x: number; y: number; z: number }): string {
  return `${t.z}/${t.x}/${t.y}`;
}

export function isTileRevealed(key: string): boolean {
  return revealed.has(key);
}

export function revealTile(key: string): void {
  if (revealed.has(key)) return;
  revealed.add(key);
  emit();
}

/** [revealed, reveal] for one tile. */
export function useTileRevealed(key: string): [boolean, () => void] {
  const shown = useSyncExternalStore(
    subscribe,
    () => revealed.has(key),
    () => false,
  );
  const reveal = useCallback(() => revealTile(key), [key]);
  return [shown, reveal];
}

registerSessionReset(() => {
  if (!revealed.size) return;
  revealed.clear();
  emit();
});
