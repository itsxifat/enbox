/**
 * The composer's "#channel" and ":emoji:" lists above the box (the look and keyboard of the
 * @mention list: the composer moves `active` with the arrows and picks with Enter or Tab).
 */
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface SuggestionRow {
  key: string;
  icon: ReactNode;
  label: ReactNode;
  /** Muted text on the right (a channel's category, a custom emoji's Space). */
  sub?: string | null;
}

export function SuggestionList({
  id,
  label,
  heading,
  rows,
  active,
  onPick,
  onHover,
}: {
  id: string;
  /** The listbox's accessible name. */
  label: string;
  heading: ReactNode;
  rows: SuggestionRow[];
  active: number;
  onPick: (i: number) => void;
  onHover: (i: number) => void;
}) {
  if (!rows.length) return null;
  return (
    <div className="absolute inset-x-2 bottom-full z-10 mb-1 overflow-hidden rounded-2xl border border-line bg-elevated shadow-elevated sm:inset-x-3">
      <p className="truncate px-3 pt-2.5 pb-1 text-[12px] font-bold tracking-wide text-muted uppercase">
        {heading}
      </p>
      <ul
        id={id}
        role="listbox"
        aria-label={label}
        className="max-h-64 overflow-y-auto pb-1 scrollbar-thin"
      >
        {rows.map((r, i) => (
          <li
            key={r.key}
            id={`${id}-${i}`}
            role="option"
            aria-selected={i === active}
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(i);
            }}
            onMouseEnter={() => onHover(i)}
            className={cn(
              'flex cursor-pointer items-center gap-3 px-3 py-1.5',
              i === active && 'bg-hover',
            )}
          >
            <span
              className="flex size-6 shrink-0 items-center justify-center text-muted"
              aria-hidden
            >
              {r.icon}
            </span>
            <span className="min-w-0 flex-1 truncate text-[15px] text-fg">{r.label}</span>
            {r.sub ? (
              <span className="shrink-0 truncate text-[12px] text-subtle">{r.sub}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
