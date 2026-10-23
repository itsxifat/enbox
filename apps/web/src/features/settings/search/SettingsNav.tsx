/**
 * The User Settings layer's left column (desktop): a search box, then USER SETTINGS, APP
 * SETTINGS and the last block (Help, the red Log Out). Sections switch in place — a replace
 * that keeps the layer's background state — so Esc / ✕ and the browser's Back leave settings
 * instead of stepping through every section visited.
 */
import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { LogOut, Search, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useQuickSwitcher } from '@/stores/quickSwitcher';
import { confirmLogout } from '../account/AccountPage';
import { filterSettingsNav, type SettingsNavGroup, type SettingsNavItem } from './navModel';

const ITEM =
  'mb-0.5 flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[16px] leading-5 font-medium outline-none transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand';

function runAction(item: SettingsNavItem): void {
  if (item.action === 'keybinds') useQuickSwitcher.getState().setShortcutsOpen(true);
  else if (item.action === 'logout') void confirmLogout();
}

function NavItem({ item, active }: { item: SettingsNavItem; active: boolean }) {
  const location = useLocation();
  if (item.to)
    return (
      <Link
        to={item.to}
        replace
        state={location.state}
        aria-current={active ? 'page' : undefined}
        className={cn(
          ITEM,
          active ? 'bg-selected text-fg' : 'text-muted hover:bg-hover hover:text-fg',
        )}
      >
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
      </Link>
    );
  return (
    <button
      type="button"
      onClick={() => runAction(item)}
      className={cn(
        ITEM,
        item.danger ? 'text-danger hover:bg-hover' : 'text-muted hover:bg-hover hover:text-fg',
      )}
    >
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.action === 'logout' ? <LogOut size={16} className="shrink-0" aria-hidden /> : null}
    </button>
  );
}

function NavGroup({ group, active }: { group: SettingsNavGroup; active: string | undefined }) {
  const headingId = useId();
  return (
    <div
      role="group"
      aria-labelledby={group.title ? headingId : undefined}
      aria-label={group.title ? undefined : 'More'}
      className="mt-5 first:mt-0"
      data-testid={`settings-nav-${group.id}`}
    >
      {group.title ? (
        <h2
          id={headingId}
          className="px-2.5 pb-1.5 text-[12px] font-bold tracking-wide text-muted uppercase"
        >
          {group.title}
        </h2>
      ) : null}
      {group.items.map((item) => (
        <NavItem key={item.key} item={item} active={item.key === active} />
      ))}
    </div>
  );
}

export function SettingsNav({ active }: { active: string | undefined }) {
  const [query, setQuery] = useState('');
  const groups = useMemo(() => filterSettingsNav(query), [query]);
  const navigate = useNavigate();
  const location = useLocation();
  const count = groups.reduce((n, g) => n + g.items.length, 0);
  const searching = query.trim().length > 0;

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape' && query) {
      // Clears the search first; the next Escape closes settings.
      e.stopPropagation();
      e.preventDefault();
      setQuery('');
    } else if (e.key === 'Enter' && searching) {
      const first = groups[0]?.items[0];
      if (!first) return;
      e.preventDefault();
      setQuery('');
      if (first.to) void navigate(first.to, { replace: true, state: location.state });
      else runAction(first);
    }
  };

  return (
    <nav
      aria-label="Settings"
      className="flex w-[218px] shrink-0 flex-col pt-[52px] pr-1.5 pb-14 pl-5"
      data-testid="settings-nav"
    >
      <div className="relative mb-4">
        <input
          type="search"
          role="searchbox"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search"
          aria-label="Search settings"
          autoComplete="off"
          spellCheck={false}
          className="h-8 w-full rounded-md bg-surface-2 pr-8 pl-2.5 text-[14px] text-fg outline-none placeholder:text-subtle focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand [&::-webkit-search-cancel-button]:hidden"
        />
        {query ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => setQuery('')}
            className="absolute top-1/2 right-1.5 flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted hover:text-fg"
          >
            <X size={14} aria-hidden />
          </button>
        ) : (
          <Search
            size={16}
            className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-subtle"
            aria-hidden
          />
        )}
      </div>
      <span className="sr-only" role="status">
        {searching ? `${count} result${count === 1 ? '' : 's'}` : ''}
      </span>
      {groups.length ? (
        groups.map((g) => <NavGroup key={g.id} group={g} active={active} />)
      ) : (
        <p className="px-2.5 py-2 text-[14px] text-muted" data-testid="settings-nav-empty">
          No settings match “{query.trim()}”.
        </p>
      )}
    </nav>
  );
}
