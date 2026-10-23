/**
 * The shortcuts at the top of a Space's channel sidebar (Discord): Server Guide (while it is
 * on, with a progress ring until every to-do is done), Browse Channels, and Channels & Roles
 * (when the Space has onboarding). Opening a to-do's channel ticks it, once.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { ListChecks, Signpost, TextSearch, type LucideIcon } from 'lucide-react';
import type { ID, Space } from '@enbox/shared';
import { cn } from '@/lib/cn';
import { getCommunity, onboardingActive, peekCommunity } from '@/features/spaces/community/api';
import { guideProgress, visitedChannel } from './actions';

/** A small ring filling up with the to-dos done ("2 of 5"). */
export function ProgressRing({
  done,
  total,
  size = 18,
}: {
  done: number;
  total: number;
  size?: number;
}) {
  const r = (size - 4) / 2;
  const c = 2 * Math.PI * r;
  const share = total > 0 ? Math.min(1, done / total) : 0;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`${done} of ${total} done`}
      className="shrink-0 -rotate-90"
      data-testid="guide-progress-ring"
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth={3}
        className="stroke-line-strong"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth={3}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - share)}
        className="stroke-brand transition-[stroke-dashoffset] duration-300"
      />
    </svg>
  );
}

function TopLink({
  to,
  icon: Icon,
  label,
  active,
  children,
}: {
  to: string;
  icon: LucideIcon;
  label: string;
  active: boolean;
  children?: ReactNode;
}) {
  return (
    <Link
      to={to}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex h-9 items-center gap-1.5 rounded-lg px-2 text-[15px] transition-colors outline-none focus-visible:outline-2 focus-visible:outline-brand',
        active ? 'bg-selected font-semibold text-fg' : 'text-muted hover:bg-hover hover:text-fg',
      )}
    >
      <Icon size={18} className="shrink-0 opacity-70" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {children}
    </Link>
  );
}

/**
 * Whether the Space runs onboarding (its questions are what Channels & Roles changes): the
 * community settings, cached a minute and shared with the onboarding gate.
 */
function useHasOnboarding(spaceId: ID): boolean {
  const [known, setKnown] = useState<{ spaceId: ID; active: boolean } | null>(null);
  useEffect(() => {
    let live = true;
    getCommunity(spaceId)
      .then((c) => live && setKnown({ spaceId, active: onboardingActive(c?.onboarding) }))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [spaceId]);
  if (known?.spaceId === spaceId) return known.active;
  return onboardingActive(peekCommunity(spaceId)?.onboarding);
}

export function SidebarGuideLinks({ space }: { space: Space }) {
  const { pathname } = useLocation();
  const { chatId } = useParams<{ chatId?: string }>();
  const onboarding = useHasOnboarding(space.id);
  const guide = space.guide?.enabled ? space.guide : null;
  const { done, total } = guideProgress(guide, space.me.guideDone);

  // A to-do's channel is open: it counts as done.
  useEffect(() => {
    if (chatId) visitedChannel(space, chatId);
  }, [space, chatId]);

  const base = `/spaces/${space.id}`;
  return (
    <nav
      aria-label="Space shortcuts"
      className="flex shrink-0 flex-col gap-0.5 px-2 pb-1"
      data-testid="sidebar-guide-links"
    >
      {guide ? (
        <TopLink
          to={`${base}/guide`}
          icon={Signpost}
          label="Server Guide"
          active={pathname === `${base}/guide`}
        >
          {total > 0 && done < total ? <ProgressRing done={done} total={total} /> : null}
        </TopLink>
      ) : null}
      <TopLink
        to={`${base}/browse`}
        icon={TextSearch}
        label="Browse Channels"
        active={pathname === `${base}/browse`}
      />
      {onboarding ? (
        <TopLink
          to={`${base}/channels-roles`}
          icon={ListChecks}
          label="Channels & Roles"
          active={pathname === `${base}/channels-roles`}
        />
      ) : null}
    </nav>
  );
}
