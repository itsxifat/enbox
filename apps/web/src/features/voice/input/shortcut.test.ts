/**
 * Push to talk key combinations: recorded from key events (a lone modifier keeps just its key),
 * matched (same key, same modifiers; a lone modifier whatever else is held), released by their
 * key or a modifier they need, shown as text; typing targets.
 */
import { describe, expect, it } from 'vitest';
import type { KeyCombo } from '@/stores/ui';
import {
  comboFromEvent,
  formatCombo,
  isTypingTarget,
  keyLabel,
  matchesCombo,
  releasesCombo,
} from './shortcut';

const key = (code: string, p: Partial<KeyboardEventInit> = {}) =>
  new KeyboardEvent('keydown', { code, key: p.key ?? code, ...p });

const ctrlShiftV: KeyCombo = {
  code: 'KeyV',
  key: 'V',
  ctrl: true,
  alt: false,
  shift: true,
  meta: false,
};
const leftCtrl: KeyCombo = {
  code: 'ControlLeft',
  key: 'Control',
  ctrl: false,
  alt: false,
  shift: false,
  meta: false,
};

describe('push to talk shortcuts', () => {
  it('records the key with the modifiers held; a lone modifier drops its own flag', () => {
    expect(comboFromEvent(key('KeyV', { key: 'V', ctrlKey: true, shiftKey: true }))).toEqual(
      ctrlShiftV,
    );
    expect(comboFromEvent(key('ControlLeft', { key: 'Control', ctrlKey: true }))).toEqual(leftCtrl);
  });

  it('matches the same key with exactly its modifiers', () => {
    expect(matchesCombo(key('KeyV', { ctrlKey: true, shiftKey: true }), ctrlShiftV)).toBe(true);
    expect(matchesCombo(key('KeyV', { ctrlKey: true }), ctrlShiftV)).toBe(false);
    expect(
      matchesCombo(key('KeyV', { ctrlKey: true, shiftKey: true, altKey: true }), ctrlShiftV),
    ).toBe(false);
    expect(matchesCombo(key('KeyB', { ctrlKey: true, shiftKey: true }), ctrlShiftV)).toBe(false);
  });

  it('a lone modifier matches its key whatever else is held', () => {
    expect(matchesCombo(key('ControlLeft', { ctrlKey: true }), leftCtrl)).toBe(true);
    expect(matchesCombo(key('ControlLeft', { ctrlKey: true, shiftKey: true }), leftCtrl)).toBe(
      true,
    );
    expect(matchesCombo(key('ControlRight', { ctrlKey: true }), leftCtrl)).toBe(false);
  });

  it('is released by its key or a modifier it needs, not by others', () => {
    expect(releasesCombo({ code: 'KeyV' }, ctrlShiftV)).toBe(true);
    expect(releasesCombo({ code: 'ShiftRight' }, ctrlShiftV)).toBe(true);
    expect(releasesCombo({ code: 'ControlLeft' }, ctrlShiftV)).toBe(true);
    expect(releasesCombo({ code: 'AltLeft' }, ctrlShiftV)).toBe(false);
    expect(releasesCombo({ code: 'KeyB' }, ctrlShiftV)).toBe(false);
    expect(releasesCombo({ code: 'ControlLeft' }, leftCtrl)).toBe(true);
  });

  it('shows as text', () => {
    expect(formatCombo(ctrlShiftV)).toBe('Ctrl + Shift + V');
    expect(formatCombo(leftCtrl)).toBe('Left Ctrl');
    expect(keyLabel('Backquote', '`')).toBe('`');
    expect(keyLabel('Digit4', '$')).toBe('4');
    expect(keyLabel('F8')).toBe('F8');
    expect(keyLabel('Numpad5', '5')).toBe('Numpad 5');
    expect(keyLabel('ShiftRight', 'Shift')).toBe('Right Shift');
    // A letter shows what it typed when recorded (keyboard layouts).
    expect(keyLabel('KeyQ', 'a')).toBe('A');
  });

  it('knows where keys type', () => {
    const text = document.createElement('input');
    const range = Object.assign(document.createElement('input'), { type: 'range' });
    const area = document.createElement('textarea');
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    expect(isTypingTarget(text)).toBe(true);
    expect(isTypingTarget(area)).toBe(true);
    expect(isTypingTarget(range)).toBe(false);
    expect(isTypingTarget(document.createElement('button'))).toBe(false);
    expect(isTypingTarget(document.body)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
    // jsdom: contentEditable is reflected through isContentEditable only when supported.
    if (editable.isContentEditable) expect(isTypingTarget(editable)).toBe(true);
  });
});
