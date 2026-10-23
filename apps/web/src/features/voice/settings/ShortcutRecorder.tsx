/**
 * The push to talk shortcut (Discord's keybind recorder): "Record Keybind" takes the next key
 * combination — hold any of Ctrl, Alt, Shift and Meta, then press a key; a modifier pressed and
 * let go on its own is a shortcut too. Escape stops recording without a change. While it
 * records, keys reach nothing else. The shortcut shows as keys; × clears it.
 */
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Button, IconButton } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { KeyCombo } from '@/stores/ui';
import { comboFromEvent, formatCombo, isModifierCode } from '../input/shortcut';

export function ShortcutRecorder({
  value,
  onChange,
}: {
  value: KeyCombo | null;
  onChange: (combo: KeyCombo | null) => void;
}) {
  const [recording, setRecording] = useState(false);
  // The latest callback, without restarting a recording in progress.
  const changed = useRef(onChange);
  useEffect(() => {
    changed.current = onChange;
  });

  useEffect(() => {
    if (!recording) return;
    // The modifier pressed last, while no other key came: let go, it is the shortcut.
    let modifier: KeyboardEvent | null = null;
    const done = (combo: KeyCombo | null) => {
      if (combo) changed.current(combo);
      setRecording(false);
    };
    const down = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      if (e.code === 'Escape') return done(null);
      if (isModifierCode(e.code)) modifier = e;
      else done(comboFromEvent(e));
    };
    const up = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (modifier && e.code === modifier.code) done(comboFromEvent(modifier));
    };
    // Capture on the window: before any other handler, so nothing else acts on these keys.
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
    };
  }, [recording]);

  return (
    <div className="flex items-center gap-2">
      <div
        aria-live="polite"
        className={cn(
          'flex h-10 min-w-0 flex-1 items-center gap-1 overflow-hidden rounded-lg bg-surface-2 px-3 text-[14px]',
          recording && 'ring-2 ring-danger',
        )}
        data-testid="ptt-shortcut"
      >
        {recording ? (
          <span className="truncate text-fg">Press a key or combination…</span>
        ) : value ? (
          formatCombo(value)
            .split(' + ')
            .map((k, i) => (
              <kbd
                key={i}
                className="shrink-0 rounded-md bg-surface px-1.5 py-0.5 font-sans text-[13px] font-semibold text-fg shadow-sm"
              >
                {k}
              </kbd>
            ))
        ) : (
          <span className="truncate text-muted">No shortcut</span>
        )}
      </div>
      <Button
        size="sm"
        variant={recording ? 'danger' : 'secondary'}
        onClick={() => setRecording((r) => !r)}
        data-testid="ptt-record"
      >
        {recording ? 'Stop Recording' : value ? 'Edit Keybind' : 'Record Keybind'}
      </Button>
      {value && !recording ? (
        <IconButton icon={X} label="Clear shortcut" size="sm" onClick={() => onChange(null)} />
      ) : null}
    </div>
  );
}
