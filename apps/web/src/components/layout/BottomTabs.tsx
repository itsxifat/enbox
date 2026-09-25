import { NavLink, useLocation } from 'react-router';
import { cn } from '@/lib/cn';
import { Badge } from '@/components/ui';
import { TABS, activeTab } from './tabs';
import { tabBadgeText, useTabBadges } from './useTabBadges';

/** Phone bottom tab bar (hidden on detail routes and on desktop). */
export function BottomTabs() {
  const { pathname } = useLocation();
  const current = activeTab(pathname);
  const badges = useTabBadges();
  return (
    <nav aria-label="Main" className="shrink-0 border-t border-line bg-surface pb-safe">
      <ul className="mx-auto flex max-w-xl items-stretch justify-around px-1">
        {TABS.map((t) => {
          const active = current === t.id;
          const badge = badges[t.id];
          const badgeText = tabBadgeText(t.id, badge);
          return (
            <li key={t.id} className="flex-1">
              <NavLink
                to={t.path}
                aria-current={active ? 'page' : undefined}
                className="group flex flex-col items-center gap-1 pt-2 pb-2 outline-none"
              >
                <span
                  className={cn(
                    'relative flex h-8 w-14 items-center justify-center rounded-full transition-colors duration-200',
                    'group-focus-visible:outline-2 group-focus-visible:outline-brand',
                    active ? 'bg-brand-soft text-brand-ink' : 'text-muted',
                  )}
                >
                  <t.icon size={22} strokeWidth={active ? 2.2 : 1.9} aria-hidden />
                  {badge?.count ? (
                    <Badge
                      count={badge.count}
                      size="sm"
                      className="absolute -top-1 left-[30px] ring-2 ring-surface"
                      label={badgeText ?? undefined}
                    />
                  ) : badge?.dot ? (
                    <Badge
                      dot
                      className="absolute top-0.5 right-3 ring-2 ring-surface"
                      label={badgeText ?? undefined}
                    />
                  ) : null}
                </span>
                <span
                  className={cn(
                    'text-[12px] leading-none',
                    active ? 'font-semibold text-fg' : 'font-medium text-muted',
                  )}
                >
                  {t.label}
                </span>
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
