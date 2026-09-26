import { Link, useParams } from 'react-router';
import { ChevronRight, LogOut } from 'lucide-react';
import { activePresenceNote } from '@enbox/shared';
import { ICON_STROKE_ON_FILL } from '@/components/icons';
import { Avatar, type IconType } from '@/components/ui';
import { PaneHeader } from '@/components/layout/PaneHeader';
import { selfPresenceState } from '@/features/profile/model';
import { openProfile } from '@/features/profile/open';
import { cn } from '@/lib/cn';
import { formatPresenceNote } from '@/lib/format';
import { useMe } from '@/stores/auth';
import { confirmLogout } from './account/AccountPage';
import { SETTINGS_SECTIONS } from './sections';

const ROW =
  'flex items-center gap-4 rounded-xl px-3 py-2.5 outline-none transition-colors hover:bg-hover focus-visible:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand';

/** iOS-style colored tile behind a white section icon. */
function IconTile({ icon: Icon, color }: { icon: IconType; color: string }) {
  return (
    <span
      className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-linear-to-b from-white/15 to-transparent text-white shadow-[inset_0_0_0_0.5px_rgb(0_0_0/0.12)]"
      style={{ backgroundColor: color }}
    >
      <Icon size={20} strokeWidth={ICON_STROKE_ON_FILL} aria-hidden />
    </span>
  );
}

/**
 * Settings tab list (/settings): my profile card, sections, log out. The avatar on the
 * profile card opens my profile card (availability, custom status) — the way phones, which
 * have no nav rail, reach it; the rest of the row goes to Settings → Profile.
 */
export function SettingsPane() {
  const me = useMe();
  const { section } = useParams();
  const note = activePresenceNote(me?.presenceNote);
  return (
    <>
      <PaneHeader title="Settings" large />
      <nav aria-label="Settings" className="min-h-0 flex-1 overflow-y-auto pb-4 scrollbar-thin">
        {me ? (
          <div
            className={cn(
              'mx-2 mb-2 flex items-center gap-4 rounded-2xl px-3 py-3 transition-colors hover:bg-hover',
              section === 'profile' && 'bg-selected hover:bg-selected',
            )}
            data-testid="settings-profile-card"
          >
            <button
              type="button"
              aria-label="Your profile card"
              aria-haspopup="dialog"
              onClick={(e) => openProfile(me.id, e.currentTarget)}
              className="shrink-0 rounded-full outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              data-testid="settings-self-avatar"
            >
              <Avatar
                src={me.avatarUrl}
                animatedSrc={me.avatarAnimatedUrl}
                name={me.displayName}
                colorSeed={me.id}
                size="xl"
                presence={selfPresenceState(me)}
              />
            </button>
            <Link
              to="/settings/profile"
              aria-current={section === 'profile' ? 'page' : undefined}
              className="flex min-w-0 flex-1 items-center gap-4 rounded-xl outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[19px] font-semibold text-fg">{me.displayName}</span>
                <span className="truncate text-[14px] text-muted">
                  {note ? formatPresenceNote(note) : me.about || `@${me.username}`}
                </span>
              </span>
              <ChevronRight size={18} className="shrink-0 text-subtle" aria-hidden />
            </Link>
          </div>
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
                  className={cn(ROW, active && 'bg-selected hover:bg-selected')}
                >
                  <IconTile icon={s.icon} color={s.tint} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-[16px] text-fg">{s.title}</span>
                    <span className="truncate text-[13.5px] text-muted">{s.description}</span>
                  </span>
                  <ChevronRight
                    size={18}
                    className={cn('shrink-0', active ? 'text-brand-ink' : 'text-subtle')}
                    aria-hidden
                  />
                </Link>
              </li>
            );
          })}
          <li className="mt-2 border-t border-line pt-2">
            <button
              type="button"
              onClick={() => void confirmLogout()}
              className={cn(ROW, 'w-full text-left')}
            >
              <IconTile icon={LogOut} color="var(--danger-fill)" />
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
