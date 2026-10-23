/**
 * The push to talk shortcut recorder: records the next combination, a lone modifier once it is
 * let go, Escape stops without a change, keys reach nothing else while recording, × clears.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import type { KeyCombo } from '@/stores/ui';
import { ShortcutRecorder } from './ShortcutRecorder';

function Harness({
  initial = null,
  onChange,
}: {
  initial?: KeyCombo | null;
  onChange?: (c: KeyCombo | null) => void;
}) {
  const [value, setValue] = useState<KeyCombo | null>(initial);
  return (
    <ShortcutRecorder
      value={value}
      onChange={(c) => {
        setValue(c);
        onChange?.(c);
      }}
    />
  );
}

// On the page (the recorder hears them on the window, first).
const keydown = (code: string, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(document.body, { code, key: init.key ?? code, ...init });
const keyup = (code: string, init: KeyboardEventInit = {}) =>
  fireEvent.keyUp(document.body, { code, key: init.key ?? code, ...init });

describe('ShortcutRecorder', () => {
  it('records a combination: modifiers held, then a key', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    expect(screen.getByTestId('ptt-shortcut')).toHaveTextContent('No shortcut');
    fireEvent.click(screen.getByRole('button', { name: 'Record Keybind' }));
    expect(screen.getByTestId('ptt-shortcut')).toHaveTextContent(/press a key/i);
    keydown('ControlLeft', { key: 'Control', ctrlKey: true });
    keydown('ShiftLeft', { key: 'Shift', ctrlKey: true, shiftKey: true });
    keydown('KeyK', { key: 'K', ctrlKey: true, shiftKey: true });
    expect(onChange).toHaveBeenCalledWith({
      code: 'KeyK',
      key: 'K',
      ctrl: true,
      alt: false,
      shift: true,
      meta: false,
    });
    expect(screen.getByTestId('ptt-shortcut')).toHaveTextContent('CtrlShiftK');
    expect(screen.getByRole('button', { name: 'Edit Keybind' })).toBeInTheDocument();
  });

  it('a modifier pressed and let go on its own is the shortcut', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Record Keybind' }));
    keydown('AltRight', { key: 'Alt', altKey: true });
    expect(onChange).not.toHaveBeenCalled();
    keyup('AltRight', { key: 'Alt' });
    expect(onChange).toHaveBeenCalledWith({
      code: 'AltRight',
      key: 'Alt',
      ctrl: false,
      alt: false,
      shift: false,
      meta: false,
    });
    expect(screen.getByTestId('ptt-shortcut')).toHaveTextContent('Right Alt');
  });

  it('Escape stops recording and keeps the old shortcut; keys reach nothing else meanwhile', () => {
    const old: KeyCombo = {
      code: 'Backquote',
      key: '`',
      ctrl: false,
      alt: false,
      shift: false,
      meta: false,
    };
    const onChange = vi.fn();
    const outside = vi.fn();
    document.addEventListener('keydown', outside);
    render(<Harness initial={old} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Keybind' }));
    keydown('ShiftLeft', { key: 'Shift', shiftKey: true });
    keydown('Escape', { key: 'Escape' });
    expect(onChange).not.toHaveBeenCalled();
    expect(outside).not.toHaveBeenCalled();
    expect(screen.getByTestId('ptt-shortcut')).toHaveTextContent('`');
    // Not recording any more: keys go on as usual.
    keydown('KeyJ');
    expect(onChange).not.toHaveBeenCalled();
    expect(outside).toHaveBeenCalledTimes(1);
    document.removeEventListener('keydown', outside);
  });

  it('Stop Recording changes nothing; × clears the shortcut', () => {
    const old: KeyCombo = {
      code: 'F8',
      key: 'F8',
      ctrl: false,
      alt: false,
      shift: false,
      meta: false,
    };
    const onChange = vi.fn();
    render(<Harness initial={old} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Keybind' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop Recording' }));
    expect(screen.getByTestId('ptt-shortcut')).toHaveTextContent('F8');
    fireEvent.click(screen.getByRole('button', { name: 'Clear shortcut' }));
    expect(onChange).toHaveBeenCalledWith(null);
    expect(screen.getByTestId('ptt-shortcut')).toHaveTextContent('No shortcut');
  });
});
