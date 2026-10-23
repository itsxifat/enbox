/**
 * Formatting shortcuts of the message box: Ctrl/Cmd+B bold, Ctrl/Cmd+I italic, Ctrl/Cmd+U
 * underline, Ctrl/Cmd+Shift+X strikethrough. App-wide shortcuts (quickSwitcher/
 * KeyboardShortcuts.tsx, the Inbox's Ctrl/Cmd+I) skip a key press the box already handled.
 */
import type { InlineFormat } from './markdown';

export const IS_MAC =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** "Ctrl" or "⌘", for labels. */
export const MOD_KEY = IS_MAC ? '⌘' : 'Ctrl';

interface KeyLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** The format a key press asks for, else null (letters by position on non-Latin layouts). */
export function shortcutFormat(e: KeyLike, mac = IS_MAC): InlineFormat | null {
  const mod = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (!mod || e.altKey) return null;
  const k = /^[a-z]$/i.test(e.key) ? e.key.toLowerCase() : e.code.replace(/^Key/, '').toLowerCase();
  if (e.shiftKey) return k === 'x' ? 'strike' : null;
  return k === 'b' ? 'bold' : k === 'i' ? 'italic' : k === 'u' ? 'underline' : null;
}
