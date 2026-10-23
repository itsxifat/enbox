import { Link, useLocation } from 'react-router';
import { cn } from '@/lib/cn';
import { Avatar, Badge } from '@/components/ui';
import { selfPresenceState } from '@/features/profile/model';
import { spaceMemory } from '@/features/spaces/actions';
import { useMe } from '@/stores/auth';
import { useSpaceList } from '@/stores/spaces';
import { TABS, activeTab, type TabDef } from './tabs';
import { tabBadgeText, useTabBadges } from './useTabBadges';

/** Servers opens the last Space visited (Discord mobile), else the rail and its welcome. */
function useServersPath(): string {
  const spaces = useSpaceList();
  const last = spaceMemory.lastSpace();
  return last && spaces.some((s) => s.id === last) ? `/spaces/${last}` : '/spaces';
}

/** The You tab wears my avatar (ringed while current) with my availability. */
function TabGlyph({ tab, active }: { tab: TabDef; active: boolean }) {
  const me = useMe();
  if (tab.id === 'you' && me)
    return (
      <span
        className={cn(
          'flex rounded-full ring-2 transition-shadow',
          active ? 'ring-brand-ink' : 'ring-transparent',
        )}
        data-testid="you-tab-avatar"
      >
        <Avatar
          src={me.avatarUrl}
          name={me.displayName}
          colorSeed={me.id}
          size={24}
          presence={selfPresenceState(me)}
          decorative
        />
      </span>
    );
  return active ? (
    <tab.activeIcon size={24} className="animate-icon-pop" aria-hidden />
  ) : (
    <tab.icon size={24} aria-hidden />
  );
}

/**
 * Phone bottom tab bar (hidden on detail routes and on desktop): a floating rounded card
 * with a margin above the safe area, not a full-width strip with a top border. Servers (the
 * rail and a Space's channels), Messages (DMs), Notifications (the Inbox) and You.
 */
export function BottomTabs() {
  const { pathname } = useLocation();
  const current = activeTab(pathname);
  const badges = useTabBadges();
  const serversPath = useServersPath();
  return (
    <nav
      aria-label="Main"
      className="shrink-0 bg-app px-3 pt-2 pb-[max(12px,env(safe-area-inset-bottom))]"
    >
      <ul className="mx-auto flex max-w-xl items-stretch justify-around rounded-2xl bg-surface px-1 shadow-elevated">
        {TABS.map((t) => {
          const active = current === t.id;
          const badge = badges[t.id];
          const badgeText = tabBadgeText(t.id, badge);
          return (
            <li key={t.id} className="min-w-0 flex-1">
              {/* A Link, not NavLink: a tab is current for all its prefixes (`activeTab`). */}
              <Link
                to={t.id === 'servers' ? serversPath : t.path}
                aria-current={active ? 'page' : undefined}
                className="group flex flex-col items-center gap-1 pt-2 pb-2 outline-none"
                data-testid={`tab-${t.id}`}
              >
                <span
                  className={cn(
                    'relative flex h-8 w-16 items-center justify-center rounded-full transition-colors duration-200',
                    'group-focus-visible:outline-2 group-focus-visible:outline-brand',
                    active ? 'bg-brand-soft text-brand-ink' : 'text-muted group-active:bg-hover',
                  )}
                >
                  <TabGlyph tab={t} active={active} />
                  {badge?.count ? (
                    <Badge
                      count={badge.count}
                      size="sm"
                      tone="danger"
                      className="absolute -top-1 left-[34px] ring-2 ring-surface"
                      label={badgeText ?? undefined}
                    />
                  ) : badge?.dot ? (
                    <Badge
                      dot
                      tone="danger"
                      className="absolute top-0.5 right-[18px] ring-2 ring-surface"
                      label={badgeText ?? undefined}
                    />
                  ) : null}
                </span>
                <span
                  className={cn(
                    'max-w-full truncate px-0.5 text-[12px] leading-none transition-colors',
                    active ? 'font-semibold text-fg' : 'font-medium text-muted',
                  )}
                >
                  {t.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
