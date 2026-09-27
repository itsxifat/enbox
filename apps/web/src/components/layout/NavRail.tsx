import { NavLink, useLocation } from 'react-router';
import { cn } from '@/lib/cn';
import { Avatar, Badge } from '@/components/ui';
import { LogoMark } from '@/components/common/Logo';
import { selfPresenceState } from '@/features/profile/model';
import { openProfile } from '@/features/profile/open';
import { useMe } from '@/stores/auth';
import { TABS, activeTab } from './tabs';
import { tabBadgeText, useTabBadges } from './useTabBadges';

/** Hover / focus tooltip to the right of a rail item (the rail is a card, so it can't clip). */
const TIP =
  'pointer-events-none absolute top-1/2 left-full z-50 ml-3 -translate-y-1/2 rounded-lg bg-fg px-2.5 py-1.5 text-[13px] font-semibold whitespace-nowrap text-surface opacity-0 shadow-elevated transition-opacity duration-100 group-hover/tab:opacity-100 group-focus-visible/tab:opacity-100';

/**
 * Desktop (≥ lg) left navigation rail, Discord style: a card of 44px icon tiles that round
 * off and fill on hover / when current, with a pill indicator on the left edge. The avatar at
 * the bottom opens my own profile card.
 */
export function NavRail() {
  const { pathname } = useLocation();
  const current = activeTab(pathname);
  const badges = useTabBadges();
  const me = useMe();
  const main = TABS.filter((t) => t.id !== 'settings');
  const settings = TABS.find((t) => t.id === 'settings')!;

  const item = (t: (typeof TABS)[number]) => {
    const active = current === t.id;
    const badge = badges[t.id];
    // The link's aria-label replaces its content, so the badge is spoken through it.
    const badgeText = tabBadgeText(t.id, badge);
    return (
      <NavLink
        key={t.id}
        to={t.path}
        aria-label={badgeText ? `${t.label}, ${badgeText}` : t.label}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'group/tab relative flex size-11 items-center justify-center transition-[border-radius,background-color,color] duration-200 outline-none',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
          active
            ? 'rounded-2xl bg-brand text-on-brand'
            : 'rounded-2xl bg-surface-2 text-muted hover:rounded-xl hover:bg-brand hover:text-on-brand',
        )}
      >
        {/* Discord pill on the rail's edge: tall when current, a nub on hover. */}
        <span
          aria-hidden
          className={cn(
            'absolute top-1/2 -left-3 w-1 -translate-y-1/2 rounded-r-full bg-fg transition-[height,opacity] duration-200',
            active ? 'h-8 opacity-100' : 'h-2 opacity-0 group-hover/tab:opacity-100',
          )}
        />
        {active ? (
          <t.activeIcon size={24} className="animate-icon-pop" aria-hidden />
        ) : (
          <t.icon
            size={24}
            className="transition-transform duration-150 group-active/tab:scale-90"
            aria-hidden
          />
        )}
        {badge?.count ? (
          <Badge
            count={badge.count}
            size="sm"
            tone="danger"
            className="absolute -right-1 -bottom-1 ring-[3px] ring-surface"
          />
        ) : badge?.dot ? (
          <Badge
            dot
            tone="danger"
            className="absolute -right-0.5 -bottom-0.5 ring-[3px] ring-surface"
          />
        ) : null}
        <span role="tooltip" className={TIP}>
          {t.label}
        </span>
      </NavLink>
    );
  };

  return (
    <nav
      aria-label="Main"
      className="card-pane flex w-[72px] shrink-0 flex-col items-center gap-2 py-3 overflow-visible!"
    >
      <div className="mb-1 flex size-11 items-center justify-center">
        <LogoMark size={34} />
      </div>
      <div className="mx-auto mb-1 h-0.5 w-8 rounded-full bg-line-strong" aria-hidden />
      {main.map(item)}
      <div className="flex-1" />
      {item(settings)}
      {/* My profile card: availability, custom status, Edit profile. */}
      <button
        type="button"
        aria-label="Your profile"
        aria-haspopup="dialog"
        title="Your profile"
        onClick={(e) => me && openProfile(me.id, e.currentTarget)}
        className="mt-1 rounded-full ring-2 ring-transparent transition-[box-shadow] hover:ring-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        data-testid="nav-self-avatar"
      >
        <Avatar
          src={me?.avatarUrl}
          animatedSrc={me?.avatarAnimatedUrl}
          name={me?.displayName ?? 'Me'}
          colorSeed={me?.id}
          size={40}
          presence={me ? selfPresenceState(me) : null}
        />
      </button>
    </nav>
  );
}
