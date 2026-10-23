/**
 * What's New: whether the changelog modal is open, and which entry this device saw last.
 * `openWhatsNew()` opens it from anywhere (the title bar, the Help page); WhatsNewHost opens it
 * on its own once after an update.
 */
import { create } from 'zustand';
import { storage } from '@/lib/storage';

/** The newest changelog entry (changelog.ts): bump both with every entry (whatsNew.test.tsx checks). */
export const WHATS_NEW_VERSION = 13;
export const WHATS_NEW_DATE = '2026-10-23';

const SEEN_KEY = 'enbox.whatsNew.seen';

interface WhatsNewState {
  open: boolean;
  /** Entries newer than this one are marked new (null: none, e.g. opened by hand). */
  since: number | null;
}

export const useWhatsNew = create<WhatsNewState>(() => ({ open: false, since: null }));

export function openWhatsNew(since: number | null = null): void {
  useWhatsNew.setState({ open: true, since });
}

export function closeWhatsNew(): void {
  useWhatsNew.setState({ open: false, since: null });
}

/** The newest entry this device has seen (null: never opened, or from before What's New). */
export function seenWhatsNew(): number | null {
  const n = Number(storage.get(SEEN_KEY));
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function markWhatsNewSeen(version = WHATS_NEW_VERSION): void {
  storage.set(SEEN_KEY, String(version));
}

/**
 * Open it on its own: after an update (an older entry was seen), or the first time for an
 * account made before the newest entry. A newer account has nothing new to read.
 */
export function shouldShowWhatsNew(
  seen: number | null,
  accountCreatedAt: string | null | undefined,
  version = WHATS_NEW_VERSION,
  date = WHATS_NEW_DATE,
): boolean {
  if (seen !== null) return seen < version;
  return !!accountCreatedAt && accountCreatedAt.slice(0, 10) < date;
}
