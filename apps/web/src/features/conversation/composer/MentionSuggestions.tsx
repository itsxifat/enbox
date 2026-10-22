/** @mention suggestions above the composer (group members; Space members, roles, @everyone/@here). */
import { AtSign, Shield } from 'lucide-react';
import { UserAvatar } from '@/components/common/UserAvatar';
import type { MentionCandidate } from '@/features/spaces/mentions';
import { cn } from '@/lib/cn';

export function MentionSuggestions({
  items,
  active,
  onPick,
  onHover,
  id,
}: {
  items: MentionCandidate[];
  active: number;
  onPick: (c: MentionCandidate) => void;
  onHover: (i: number) => void;
  id: string;
}) {
  if (!items.length) return null;
  return (
    <div className="absolute inset-x-2 bottom-full z-10 mb-1 overflow-hidden rounded-2xl border border-line bg-elevated shadow-elevated sm:inset-x-3">
      <ul
        id={id}
        role="listbox"
        aria-label="Mention someone"
        className="max-h-64 overflow-y-auto py-1 scrollbar-thin"
      >
        {items.map((c, i) => (
          <li
            key={c.key}
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
            {c.user ? (
              <UserAvatar user={c.user} size="sm" />
            ) : (
              <span
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-2"
                style={c.color ? { color: c.color } : undefined}
                aria-hidden
              >
                {c.sub === 'Role' ? <Shield size={16} /> : <AtSign size={16} />}
              </span>
            )}
            <span
              className="min-w-0 flex-1 truncate text-[15px] text-fg"
              style={c.color ? { color: c.color } : undefined}
            >
              {c.user ? c.name : `@${c.name}`}
            </span>
            {c.sub ? <span className="shrink-0 truncate text-[13px] text-subtle">{c.sub}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
