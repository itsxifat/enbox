/**
 * Apply a `TextEdit` to a textarea as one change: `execCommand('insertText')` keeps the
 * browser's undo stack (Ctrl/Cmd+Z takes the formatting back) and fires a normal `input`
 * event; where it is missing or does something else, the value is set the way React notices
 * (the native setter, then an `input` event). Then the edit's selection is set.
 */
import type { TextEdit } from './markdown';

function execInsert(edit: TextEdit): boolean {
  if (typeof document.execCommand !== 'function') return false;
  try {
    // An empty insert removes the range: `delete` does that in every browser.
    return edit.insert
      ? document.execCommand('insertText', false, edit.insert)
      : edit.start === edit.end || document.execCommand('delete', false);
  } catch {
    return false;
  }
}

export function applyTextEdit(el: HTMLTextAreaElement, edit: TextEdit): void {
  const next = el.value.slice(0, edit.start) + edit.insert + el.value.slice(edit.end);
  if (el.ownerDocument.activeElement !== el) el.focus({ preventScroll: true });
  el.setSelectionRange(edit.start, edit.end);
  if (!execInsert(edit) || el.value !== next) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (setter) setter.call(el, next);
    else el.value = next;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  el.setSelectionRange(edit.selStart, edit.selEnd);
}
