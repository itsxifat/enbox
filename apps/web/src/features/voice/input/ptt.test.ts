/**
 * Push to talk: sends while the shortcut is held and for the release delay after; key repeat
 * and other keys change nothing; a plain key types in text fields (combinations with Ctrl /
 * Alt / Meta and lone modifiers talk there); leaving the window lets go at once; the shortcut
 * and delay are read live; dispose stops it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KeyCombo } from '@/stores/ui';
import { createPushToTalk, type PushToTalk } from './ptt';

const backquote: KeyCombo = {
  code: 'Backquote',
  key: '`',
  ctrl: false,
  alt: false,
  shift: false,
  meta: false,
};
const ctrlSpace: KeyCombo = {
  code: 'Space',
  key: ' ',
  ctrl: true,
  alt: false,
  shift: false,
  meta: false,
};
const leftAlt: KeyCombo = {
  code: 'AltLeft',
  key: 'Alt',
  ctrl: false,
  alt: false,
  shift: false,
  meta: false,
};

function press(code: string, init: KeyboardEventInit = {}, target: EventTarget = window) {
  const e = new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
}
function release(code: string, init: KeyboardEventInit = {}, target: EventTarget = window) {
  target.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true, ...init }));
}

describe('push to talk', () => {
  let shortcut: KeyCombo | null;
  let delay: number;
  let changes: boolean[];
  let ptt: PushToTalk;

  beforeEach(() => {
    vi.useFakeTimers();
    shortcut = backquote;
    delay = 200;
    changes = [];
    ptt = createPushToTalk({
      shortcut: () => shortcut,
      releaseDelayMs: () => delay,
      onChange: (on) => changes.push(on),
    });
  });
  afterEach(() => {
    ptt.dispose();
    document.body.replaceChildren();
    vi.useRealTimers();
  });

  it('sends while held and for the release delay after', () => {
    const e = press('Backquote');
    expect(ptt.active).toBe(true);
    expect(changes).toEqual([true]);
    // Ours: no typing, no clicking a focused button.
    expect(e.defaultPrevented).toBe(true);
    press('Backquote', { repeat: true });
    press('KeyA');
    expect(changes).toEqual([true]);
    release('Backquote');
    expect(ptt.active).toBe(true);
    vi.advanceTimersByTime(199);
    expect(ptt.active).toBe(true);
    vi.advanceTimersByTime(1);
    expect(ptt.active).toBe(false);
    expect(changes).toEqual([true, false]);
  });

  it('pressed again during the release delay it keeps sending', () => {
    press('Backquote');
    release('Backquote');
    vi.advanceTimersByTime(100);
    press('Backquote');
    vi.advanceTimersByTime(500);
    expect(ptt.active).toBe(true);
    release('Backquote');
    vi.advanceTimersByTime(200);
    expect(changes).toEqual([true, false]);
  });

  it('no delay: stops at once; the delay is read when the key is let go', () => {
    delay = 0;
    press('Backquote');
    release('Backquote');
    expect(ptt.active).toBe(false);
  });

  it('a plain key types in a text field; a Ctrl combination and a lone modifier talk there', () => {
    const input = document.body.appendChild(document.createElement('input'));
    const typed = press('Backquote', {}, input);
    expect(ptt.active).toBe(false);
    expect(typed.defaultPrevented).toBe(false);

    shortcut = ctrlSpace;
    press('Space', { ctrlKey: true }, input);
    expect(ptt.active).toBe(true);
    // Letting go of the modifier first ends it too.
    release('ControlLeft', {}, input);
    vi.advanceTimersByTime(200);
    expect(ptt.active).toBe(false);

    shortcut = leftAlt;
    const alt = press('AltLeft', { altKey: true }, input);
    expect(ptt.active).toBe(true);
    expect(alt.defaultPrevented).toBe(false);
    release('AltLeft', {}, input);
    vi.advanceTimersByTime(200);
    expect(ptt.active).toBe(false);
  });

  it('the shortcut needs its modifiers', () => {
    shortcut = ctrlSpace;
    press('Space');
    expect(ptt.active).toBe(false);
    press('Space', { ctrlKey: true, shiftKey: true });
    expect(ptt.active).toBe(false);
  });

  it('leaving the window or tab lets go at once', () => {
    press('Backquote');
    window.dispatchEvent(new Event('blur'));
    expect(ptt.active).toBe(false);
    press('Backquote');
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(ptt.active).toBe(false);
    delete (document as { visibilityState?: unknown }).visibilityState;
  });

  it('no shortcut: nothing talks; dispose stops sending and listening', () => {
    shortcut = null;
    press('Backquote');
    expect(ptt.active).toBe(false);
    shortcut = backquote;
    press('Backquote');
    ptt.dispose();
    expect(ptt.active).toBe(false);
    expect(changes).toEqual([true, false]);
    press('Backquote');
    expect(changes).toEqual([true, false]);
  });
});
