import { NavLink, useLocation } from 'react-router';
import { cn } from '@/lib/cn';
import { Avatar, Badge } from '@/components/ui';
import { LogoMark } from '@/components/common/Logo';
import { selfPresenceState } from '@/features/profile/model';
import { openProfile } from '@/features/profile/open';
import { useMe } from '@/stores/auth';
import { TABS, activeTab } from './tabs';
import { tabBadgeText, useTabBadges } from './useTabBadges';

/** Desktop (≥ lg) left navigation rail. The avatar at the bottom opens my own profile card. */
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
        title={t.label}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'group/tab relative flex size-11 items-center justify-center rounded-2xl transition-colors duration-150',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
          active ? 'bg-brand-soft text-brand-ink' : 'text-muted hover:bg-hover hover:text-fg',
        )}
      >
        {/* Current-page marker on the rail's edge. */}
        <span
          aria-hidden
          className={cn(
            'absolute top-1/2 -left-3 h-5 w-1 -translate-y-1/2 rounded-r-full bg-brand transition-transform duration-200',
            active ? 'scale-y-100' : 'scale-y-0',
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
            className="absolute -top-1 -right-1.5 ring-2 ring-app"
          />
        ) : badge?.dot ? (
          <Badge dot className="absolute top-1.5 right-1.5 ring-2 ring-app" />
        ) : null}
      </NavLink>
    );
  };

  return (
    <nav
      aria-label="Main"
      className="flex w-[68px] shrink-0 flex-col items-center gap-1 border-r border-line bg-app py-3"
    >
      <div className="mb-3 flex size-11 items-center justify-center">
        <LogoMark size={34} />
      </div>
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
        className="mt-1 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        data-testid="nav-self-avatar"
      >
        <Avatar
          src={me?.avatarUrl}
          animatedSrc={me?.avatarAnimatedUrl}
          name={me?.displayName ?? 'Me'}
          colorSeed={me?.id}
          size={36}
          presence={me ? selfPresenceState(me) : null}
        />
      </button>
    </nav>
  );
}
