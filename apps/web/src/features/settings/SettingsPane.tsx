import { Link, useParams } from 'react-router';
import { ChevronRight, LogOut } from 'lucide-react';
import { Avatar } from '@/components/ui';
import { PaneHeader } from '@/components/layout/PaneHeader';
import { cn } from '@/lib/cn';
import { useMe } from '@/stores/auth';
import { confirmLogout } from './account/AccountPage';
import { SETTINGS_SECTIONS } from './sections';

/** Settings tab list (/settings): my profile card, sections, log out. */
export function SettingsPane() {
  const me = useMe();
  const { section } = useParams();
  return (
    <>
      <PaneHeader title="Settings" large />
      <nav aria-label="Settings" className="min-h-0 flex-1 overflow-y-auto pb-4 scrollbar-thin">
        {me ? (
          <Link
            to="/settings/profile"
            aria-current={section === 'profile' ? 'page' : undefined}
            className={cn(
              'mx-2 mb-2 flex items-center gap-4 rounded-2xl px-3 py-3 outline-none transition-colors hover:bg-hover focus-visible:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand',
              section === 'profile' && 'bg-selected hover:bg-selected',
            )}
            data-testid="settings-profile-card"
          >
            <Avatar src={me.avatarUrl} name={me.displayName} colorSeed={me.id} size="xl" />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-[19px] font-semibold text-fg">{me.displayName}</span>
              <span className="truncate text-[14px] text-muted">
                {me.about || `@${me.username}`}
              </span>
            </span>
            <ChevronRight size={18} className="shrink-0 text-subtle" aria-hidden />
          </Link>
        ) : null}
        <div className="mx-4 mb-2 h-px bg-line" />
        <ul className="flex flex-col px-2">
          {SETTINGS_SECTIONS.filter((s) => s.id !== 'profile').map((s) => {
            const active = section === s.id;
            return (
              <li key={s.id}>
                <Link
                  to={`/settings/${s.id}`}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-4 rounded-xl px-3 py-3 outline-none transition-colors hover:bg-hover focus-visible:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand',
                    active && 'bg-selected hover:bg-selected',
                  )}
                >
                  <span
                    className={cn(
                      'flex size-10 shrink-0 items-center justify-center rounded-full',
                      active ? 'bg-brand text-on-brand' : 'bg-surface-2 text-muted',
                    )}
                  >
                    <s.icon size={20} strokeWidth={1.8} aria-hidden />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-[16px] text-fg">{s.title}</span>
                    <span className="truncate text-[13.5px] text-muted">{s.description}</span>
                  </span>
                </Link>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              onClick={() => void confirmLogout()}
              className="flex w-full items-center gap-4 rounded-xl px-3 py-3 text-left outline-none transition-colors hover:bg-hover focus-visible:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-danger-soft text-danger">
                <LogOut size={20} strokeWidth={1.8} aria-hidden />
              </span>
              <span className="text-[16px] text-danger">Log out</span>
            </button>
          </li>
        </ul>
        <p className="mt-6 px-6 text-center text-[12px] text-subtle">
          Enbox · Your chats stay in sync across all your devices
        </p>
      </nav>
    </>
  );
}
