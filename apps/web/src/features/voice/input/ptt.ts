/**
 * Push to talk (Discord): the mic sends while the shortcut is held, and for the release delay
 * after it is let go. Keys are heard on the window, so it works while Enbox is focused (a web
 * page hears no keys meant for other apps). In a text field a plain key types instead: only a
 * combination with Ctrl, Alt or Meta, or a modifier key on its own, talks there. Leaving the
 * window or tab lets go at once (its key-up would never arrive).
 *
 *   const ptt = createPushToTalk({ shortcut: () => prefs.pttShortcut, releaseDelayMs: () => 20,
 *     onChange: (on) => gate(on) });
 *   ptt.dispose();
 */
import type { KeyCombo } from '@/stores/ui';
import {
  hasModifiers,
  isModifierCode,
  isTypingTarget,
  matchesCombo,
  releasesCombo,
} from './shortcut';

export interface PushToTalkOptions {
  /** The shortcut right now (read on every key, so a change applies at once). */
  shortcut: () => KeyCombo | null;
  releaseDelayMs: () => number;
  /** Sending started (true) or stopped (false). */
  onChange: (active: boolean) => void;
  /** Where keys are heard (default: the window). */
  target?: Window;
}

export interface PushToTalk {
  /** Sending: the shortcut is held, or its release delay runs. */
  readonly active: boolean;
  /** Stop listening (and stop sending). */
  dispose(): void;
}

/** A lone modifier key (no other key): it types nothing, so it talks in text fields too. */
function loneModifier(combo: KeyCombo): boolean {
  return isModifierCode(combo.code) && !hasModifiers(combo);
}

export function createPushToTalk(o: PushToTalkOptions): PushToTalk {
  const target = o.target ?? window;
  let held = false;
  let active = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const set = (next: boolean) => {
    if (active === next) return;
    active = next;
    o.onChange(next);
  };
  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const release = (delayMs: number) => {
    if (!held) return;
    held = false;
    clearTimer();
    if (delayMs > 0) {
      timer = setTimeout(() => {
        timer = null;
        set(false);
      }, delayMs);
    } else set(false);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const combo = o.shortcut();
    if (!combo || !matchesCombo(e, combo)) return;
    const lone = loneModifier(combo);
    if (!lone && isTypingTarget(e.target) && !(combo.ctrl || combo.alt || combo.meta)) return;
    // The shortcut is ours: no click on a focused button, no scrolling, no typing.
    if (!lone) e.preventDefault();
    if (held) return;
    held = true;
    clearTimer();
    set(true);
  };
  const onKeyUp = (e: KeyboardEvent) => {
    const combo = o.shortcut();
    if (held && combo && releasesCombo(e, combo)) release(Math.max(0, o.releaseDelayMs()));
  };
  const onBlur = () => release(0);
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') release(0);
  };

  // Capture: a field that stops its key events still lets push to talk hear them.
  target.addEventListener('keydown', onKeyDown, true);
  target.addEventListener('keyup', onKeyUp, true);
  target.addEventListener('blur', onBlur);
  document.addEventListener('visibilitychange', onVisibility);

  return {
    get active() {
      return active;
    },
    dispose() {
      target.removeEventListener('keydown', onKeyDown, true);
      target.removeEventListener('keyup', onKeyUp, true);
      target.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
      clearTimer();
      held = false;
      set(false);
    },
  };
}
