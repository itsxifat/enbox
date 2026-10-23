/** The slash command list above the composer (Discord's built-in commands). */
import { SquareSlash } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { SlashCommand } from './commands';

export function CommandSuggestions({
  items,
  active,
  onPick,
  onHover,
  id,
}: {
  items: SlashCommand[];
  active: number;
  onPick: (c: SlashCommand) => void;
  onHover: (i: number) => void;
  id: string;
}) {
  if (!items.length) return null;
  return (
    <div
      className="absolute inset-x-2 bottom-full z-10 mb-1 overflow-hidden rounded-2xl border border-line bg-elevated shadow-elevated sm:inset-x-3"
      data-testid="slash-commands"
    >
      <p className="px-3 pt-2.5 pb-1 text-[12px] font-bold tracking-wide text-muted uppercase">
        Built-in
      </p>
      <ul
        id={id}
        role="listbox"
        aria-label="Commands"
        className="max-h-72 overflow-y-auto pb-1 scrollbar-thin"
      >
        {items.map((c, i) => (
          <li
            key={c.name}
            id={`${id}-${i}`}
            role="option"
            aria-selected={i === active}
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(c);
            }}
            onMouseEnter={() => onHover(i)}
            className={cn(
              'flex cursor-pointer items-center gap-3 px-3 py-2',
              i === active && 'bg-hover',
            )}
          >
            <span
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-ink"
              aria-hidden
            >
              <SquareSlash size={18} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] text-fg">
                <span className="font-semibold">/{c.name}</span>{' '}
                <span className="text-muted">{c.required ? c.option : `[${c.option}]`}</span>
              </span>
              <span className="block truncate text-[13px] text-muted">{c.description}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
