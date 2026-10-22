/**
 * Recently used reactions (this device): the hover toolbar's and the long-press sheet's quick
 * reactions, most recent first, topped up with QUICK_REACTIONS. localStorage may be missing
 * or full (private mode): every access is wrapped and the defaults always work.
 */
import { QUICK_REACTIONS } from '@enbox/shared';
import { sameReaction } from './model';

const KEY = 'enbox:recent-reactions';
const KEEP = 12;
/** Longer than any emoji or custom emoji token: anything else is junk. */
const MAX_LENGTH = 80;

function readStored(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === 'string' && x.length <= MAX_LENGTH)
      : [];
  } catch {
    return [];
  }
}

/** The `n` most recent reactions, then the defaults. */
export function recentReactions(n: number): string[] {
  const out = readStored().slice(0, n);
  for (const e of QUICK_REACTIONS) {
    if (out.length >= n) break;
    if (!out.some((x) => sameReaction(x, e))) out.push(e);
  }
  return out;
}

/** Remember a reaction I just added (moves to the front). */
export function rememberReaction(emoji: string): void {
  try {
    const list = [emoji, ...readStored().filter((e) => !sameReaction(e, emoji))].slice(0, KEEP);
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage unavailable: the defaults stay.
  }
}
