/**
 * The right-click menu of someone in voice (the occupant rows, the voice tiles, the Stage):
 * the menu `items` the caller builds (profile, Stage seats, moderation…) with Discord's audio
 * section after the first one — a "User Volume" slider (0-200%) and "Mute", a mute only I
 * hear, both kept on this device (userAudio.ts). My own entry has no audio section: it is then
 * the plain `Menu`.
 *
 * `Menu` rows are buttons, which cannot hold a slider, so this one is a popover with the same
 * rows: ↑/↓ move between them, → or Enter opens a submenu (a `Menu` beside the row), Escape
 * closes.
 */
import { useId, useState, type KeyboardEvent } from 'react';
import { Check, ChevronRight, VolumeX } from 'lucide-react';
import { Menu, Popover, type MenuAnchor, type MenuEntry, type MenuItem } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useAuth } from '@/stores/auth';
import { VOLUME_MAX, setUserMuted, setUserVolume, useUserAudio } from './userAudio';

export interface VoiceUserMenuProps {
  open: boolean;
  anchor: MenuAnchor | null;
  onClose: () => void;
  /** Whose menu it is (the audio section is for everyone but me). */
  userId: string | null | undefined;
  items: MenuEntry[];
  'aria-label'?: string;
}

const ROW = cn(
  'flex w-full items-center gap-3 px-4 py-2.5 text-left text-[15px] outline-none',
  'hover:bg-hover focus-visible:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand disabled:opacity-45',
);
const ROW_SELECTOR = '[role^="menuitem"]:not([disabled])';

export function VoiceUserMenu({ userId, ...props }: VoiceUserMenuProps) {
  const me = useAuth((s) => s.user?.id);
  if (!userId || userId === me)
    return (
      <Menu
        open={props.open}
        onClose={props.onClose}
        anchor={props.anchor}
        items={props.items}
        aria-label={props['aria-label']}
      />
    );
  return <AudioMenu userId={userId} {...props} />;
}

function AudioMenu({
  open,
  anchor,
  onClose,
  userId,
  items,
  'aria-label': label,
}: Omit<VoiceUserMenuProps, 'userId'> & { userId: string }) {
  const entries = items.filter((e): e is MenuItem | 'separator' => !!e);
  const [first, ...rest] = entries;
  // ↑/↓/Home/End move between the rows of every list here (the slider keeps its own keys;
  // a submenu's keys are its own: it is another layer).
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const target = e.target as HTMLElement;
    if (!e.currentTarget.contains(target) || target.tagName === 'INPUT') return;
    e.preventDefault();
    const rows = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>(ROW_SELECTOR));
    const i = rows.indexOf(document.activeElement as HTMLButtonElement);
    const at = e.key === 'Home' ? 0 : e.key === 'End' ? -1 : i + (e.key === 'ArrowDown' ? 1 : -1);
    rows[(at + rows.length) % rows.length]?.focus();
  };
  return (
    <Popover
      open={open && !!anchor}
      anchor={anchor}
      onClose={onClose}
      placement="bottom"
      align="start"
      aria-label={label}
      className="min-w-56 max-w-[min(20rem,calc(100vw-16px))] py-1.5"
    >
      <div onKeyDown={onKeyDown}>
        <Rows entries={first ? [first] : []} onDone={onClose} />
        <AudioSection userId={userId} />
        <Rows entries={rest} onDone={onClose} />
      </div>
    </Popover>
  );
}

/** "User Volume" and "Mute" (only I hear it). */
function AudioSection({ userId }: { userId: string }) {
  const { volume, muted } = useUserAudio(userId);
  const id = useId();
  const pct = Math.round(volume * 100);
  return (
    <div role="group" aria-label="Audio" data-testid="voice-user-audio">
      <div role="separator" className="my-1.5 h-px bg-line" />
      <div className="px-4 pt-1.5 pb-1">
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor={id} className="text-[13px] font-semibold text-muted">
            User Volume
          </label>
          <span className="text-[12px] text-muted tabular-nums">{pct}%</span>
        </div>
        <input
          id={id}
          type="range"
          min={0}
          max={VOLUME_MAX * 100}
          step={1}
          value={pct}
          aria-valuetext={`${pct}%`}
          onChange={(e) => setUserVolume(userId, Number(e.target.value) / 100)}
          className="mt-1 h-1.5 w-full cursor-pointer accent-[var(--brand)]"
          data-testid="user-volume"
        />
      </div>
      <div role="menu" aria-label="Mute">
        <button
          type="button"
          role="menuitemcheckbox"
          aria-checked={muted}
          onClick={() => setUserMuted(userId, !muted)}
          className={cn(ROW, 'text-fg')}
        >
          <VolumeX size={20} className="text-muted" aria-hidden />
          <span className="min-w-0 flex-1 truncate">Mute</span>
          <CheckBox checked={muted} />
        </button>
      </div>
    </div>
  );
}

/** Menu rows like `Menu`'s (submenus open a `Menu` beside the row). */
function Rows({ entries, onDone }: { entries: (MenuItem | 'separator')[]; onDone: () => void }) {
  const [sub, setSub] = useState<{ index: number; el: HTMLElement } | null>(null);
  if (!entries.length) return null;
  // → opens the submenu of the row (its keys stay in it: another layer, not in this list).
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' || !e.currentTarget.contains(e.target as Node)) return;
    const el = e.target as HTMLElement;
    const index = Number(el.dataset.subIndex ?? NaN);
    if (Number.isNaN(index)) return;
    e.preventDefault();
    setSub({ index, el });
  };
  const open = sub ? entries[sub.index] : undefined;
  return (
    <div role="menu" onKeyDown={onKeyDown}>
      {entries.map((entry, idx) => {
        if (entry === 'separator')
          return <div key={`sep-${idx}`} role="separator" className="my-1.5 h-px bg-line" />;
        const hasSub = !!entry.submenu?.some(Boolean);
        const checkable = entry.checked !== undefined;
        return (
          <button
            key={idx}
            type="button"
            role={checkable ? (entry.radio ? 'menuitemradio' : 'menuitemcheckbox') : 'menuitem'}
            aria-checked={checkable ? entry.checked : undefined}
            aria-haspopup={hasSub ? 'menu' : undefined}
            aria-expanded={hasSub ? sub?.index === idx : undefined}
            data-sub-index={hasSub ? idx : undefined}
            disabled={entry.disabled}
            onClick={(e) => {
              if (hasSub) {
                const el = e.currentTarget;
                setSub((s) => (s?.index === idx ? null : { index: idx, el }));
                return;
              }
              if (!entry.keepOpen) onDone();
              entry.onSelect?.();
            }}
            className={cn(
              ROW,
              entry.danger ? 'text-danger' : 'text-fg',
              sub?.index === idx && 'bg-hover',
            )}
          >
            {entry.icon ? (
              <entry.icon size={20} className={entry.danger ? '' : 'text-muted'} aria-hidden />
            ) : null}
            <span className="min-w-0 flex-1">
              <span className="block truncate">{entry.label}</span>
              {entry.description ? (
                <span className="block truncate text-[12px] text-muted">{entry.description}</span>
              ) : null}
            </span>
            {entry.hint ? <span className="text-xs text-subtle">{entry.hint}</span> : null}
            {checkable ? <CheckBox checked={!!entry.checked} /> : null}
            {hasSub ? <ChevronRight size={16} className="shrink-0 text-muted" aria-hidden /> : null}
          </button>
        );
      })}
      {sub && open && open !== 'separator' && open.submenu ? (
        <Menu
          open
          nested
          side="right"
          anchor={sub.el}
          items={open.submenu}
          onClose={() => setSub(null)}
          onItemSelected={onDone}
          aria-label={typeof open.label === 'string' ? open.label : undefined}
        />
      ) : null}
    </div>
  );
}

function CheckBox({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-5 shrink-0 items-center justify-center rounded-md border-2',
        checked ? 'border-brand bg-brand text-on-brand' : 'border-line-strong',
      )}
    >
      {checked ? <Check size={14} strokeWidth={3} /> : null}
    </span>
  );
}
