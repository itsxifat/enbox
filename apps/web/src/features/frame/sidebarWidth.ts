/**
 * The desktop sidebar's width (Home's DM list and a Space's channel list share it), dragged
 * at its right edge and remembered on this device. null: each sidebar's own default.
 */
import { create } from 'zustand';
import { storage } from '@/lib/storage';

export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 400;

const KEY = 'enbox.frame.sidebarWidth';

export function clampSidebarWidth(px: number): number {
  return Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, px)));
}

function stored(): number | null {
  const raw = storage.get(KEY);
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) ? clampSidebarWidth(n) : null;
}

interface SidebarWidthState {
  width: number | null;
  /** Live while dragging; `persist` once it is let go. null resets to the default. */
  setWidth(px: number | null, opts?: { persist?: boolean }): void;
}

export const useSidebarWidth = create<SidebarWidthState>((set) => ({
  width: stored(),
  setWidth(px, { persist = true } = {}) {
    const width = px === null ? null : clampSidebarWidth(px);
    set({ width });
    if (!persist) return;
    if (width === null) storage.remove(KEY);
    else storage.set(KEY, String(width));
  },
}));
