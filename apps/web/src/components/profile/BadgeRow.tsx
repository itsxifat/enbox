import type { ProfileBadge } from '@enbox/shared';
import { cn } from '@/lib/cn';
import { BadgeIcon } from './BadgeIcon';

export interface BadgeRowProps {
  /** `profileBadges(user)`, in display order. */
  badges: readonly ProfileBadge[];
  /** Space context: the owner's crown comes first. */
  owner?: boolean;
  size?: number;
  className?: string;
}

export const OWNER_BADGE: ProfileBadge = { id: 'space-owner', label: 'Space Owner' };

/**
 * A row of small badges, each focusable with its name as a tooltip (shown on hover and
 * keyboard focus, left-aligned so the first badge's tooltip stays inside a clipped card).
 */
export function BadgeRow({ badges, owner = false, size = 20, className }: BadgeRowProps) {
  const list = owner ? [OWNER_BADGE, ...badges] : badges;
  if (!list.length) return null;
  return (
    <ul className={cn('flex flex-wrap items-center gap-1', className)} aria-label="Badges" data-testid="badge-row">
      {list.map((b) => (
        <li key={b.id} className="group/badge relative flex">
          <span
            role="img"
            aria-label={b.label}
            tabIndex={0}
            data-badge={b.id}
            className="flex rounded-md p-0.5 outline-none hover:bg-hover focus-visible:outline-2 focus-visible:outline-brand"
          >
            <BadgeIcon id={b.id} size={size} />
          </span>
          <span
            aria-hidden
            className={cn(
              // Fixed dark colours: a theme overrides --fg/--surface inside the card.
              'pointer-events-none absolute bottom-full left-0 z-20 mb-1.5 rounded-lg bg-[#111214] px-2.5 py-1.5 text-xs font-medium whitespace-nowrap text-white opacity-0 shadow-elevated',
              'transition-opacity duration-150 group-focus-within/badge:opacity-100 group-hover/badge:opacity-100',
            )}
          >
            {b.label}
          </span>
        </li>
      ))}
    </ul>
  );
}
