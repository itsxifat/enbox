/**
 * Key combinations for push to talk (`DevicePrefs.pttShortcut`): recorded from key events,
 * matched against them and shown as text ("Ctrl + Shift + V", "Left Alt"). A combination is
 * one key with any of Ctrl, Alt, Shift and Meta held, or a modifier key on its own.
 */
import type { KeyCombo } from '@/stores/ui';

type KeyEventLike = Pick<
  KeyboardEvent,
  'code' | 'key' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'
>;
type Modifier = 'ctrl' | 'alt' | 'shift' | 'meta';

const MODIFIER_CODES: Record<string, Modifier> = {
  ControlLeft: 'ctrl',
  ControlRight: 'ctrl',
  AltLeft: 'alt',
  AltRight: 'alt',
  ShiftLeft: 'shift',
  ShiftRight: 'shift',
  MetaLeft: 'meta',
  MetaRight: 'meta',
  OSLeft: 'meta',
  OSRight: 'meta',
};

/** Ctrl, Alt, Shift or Meta (either side). */
export function isModifierCode(code: string): boolean {
  return code in MODIFIER_CODES;
}

/** The modifier flag a modifier key sets (`ShiftLeft` → 'shift'), else null. */
export function modifierOf(code: string): Modifier | null {
  return MODIFIER_CODES[code] ?? null;
}

/**
 * The combination a key press makes. A modifier key on its own records just that key (its own
 * flag left out), so "Left Ctrl" works as push to talk.
 */
export function comboFromEvent(e: KeyEventLike): KeyCombo {
  const own = modifierOf(e.code);
  return {
    code: e.code,
    key: e.key,
    ctrl: e.ctrlKey && own !== 'ctrl',
    alt: e.altKey && own !== 'alt',
    shift: e.shiftKey && own !== 'shift',
    meta: e.metaKey && own !== 'meta',
  };
}

/**
 * The key press starts `combo`: the same key with the same modifiers held. A lone modifier
 * combination matches its key whatever else is held.
 */
export function matchesCombo(e: KeyEventLike, combo: KeyCombo): boolean {
  if (e.code !== combo.code) return false;
  if (isModifierCode(combo.code) && !hasModifiers(combo)) return true;
  const got = comboFromEvent(e);
  return (
    got.ctrl === combo.ctrl &&
    got.alt === combo.alt &&
    got.shift === combo.shift &&
    got.meta === combo.meta
  );
}

/** Ctrl, Alt, Shift or Meta is part of the combination (besides its key). */
export function hasModifiers(combo: KeyCombo): boolean {
  return combo.ctrl || combo.alt || combo.shift || combo.meta;
}

/**
 * Releasing this key ends the combination: its own key, or one of the modifiers it needs.
 */
export function releasesCombo(e: Pick<KeyboardEvent, 'code'>, combo: KeyCombo): boolean {
  if (e.code === combo.code) return true;
  const mod = modifierOf(e.code);
  return !!mod && combo[mod];
}

function isMac(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform ?? '');
}

function modifierName(mod: Modifier): string {
  if (mod === 'ctrl') return 'Ctrl';
  if (mod === 'shift') return 'Shift';
  if (mod === 'alt') return isMac() ? 'Option' : 'Alt';
  return isMac() ? 'Cmd' : 'Meta';
}

const NAMED: Record<string, string> = {
  Space: 'Space',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  CapsLock: 'Caps Lock',
  PageUp: 'Page Up',
  PageDown: 'Page Down',
  ContextMenu: 'Menu',
};

/** A key's name: "V", "1", "F8", "Numpad 4", "Left Ctrl", "Space". */
export function keyLabel(code: string, key?: string): string {
  const mod = modifierOf(code);
  if (mod) {
    const side = /Right$/.test(code) ? 'Right' : 'Left';
    return `${side} ${modifierName(mod)}`;
  }
  if (/^Key[A-Z]$/.test(code)) return key && key.length === 1 ? key.toUpperCase() : code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return `Numpad ${code.slice(6)}`;
  if (/^F\d{1,2}$/.test(code)) return code;
  if (NAMED[code]) return NAMED[code];
  // Other keys: what they typed when recorded, else the code itself.
  if (key && key.length === 1) return key.toUpperCase();
  return code.replace(/([a-z])([A-Z])/g, '$1 $2');
}

/** "Ctrl + Shift + V"; a lone modifier is just its key ("Left Ctrl"). */
export function formatCombo(combo: KeyCombo): string {
  const parts = (['ctrl', 'alt', 'shift', 'meta'] as const)
    .filter((m) => combo[m])
    .map(modifierName);
  parts.push(keyLabel(combo.code, combo.key));
  return parts.join(' + ');
}

/** Input types that take no typing (their keys are free for push to talk). */
const NON_TEXT_INPUTS = [
  'button',
  'checkbox',
  'radio',
  'range',
  'submit',
  'reset',
  'color',
  'file',
];

/** Typing into a text field, a select or anything editable (push to talk keys type there). */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return tag === 'INPUT' && !NON_TEXT_INPUTS.includes((target as HTMLInputElement).type);
}
