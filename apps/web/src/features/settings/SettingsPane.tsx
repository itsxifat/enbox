import { Suspense } from 'react';
import { Link, Navigate, Outlet, useLocation, useParams } from 'react-router';
import { ChevronRight, LogOut, X } from 'lucide-react';
import { activePresenceNote } from '@enbox/shared';
import { ICON_STROKE_ON_FILL } from '@/components/icons';
import { Avatar, PageSpinner, type IconType } from '@/components/ui';
import { PaneHeader } from '@/components/layout/PaneHeader';
import { SplitView } from '@/components/layout/SplitView';
import { selfPresenceState } from '@/features/profile/model';
import { openProfile } from '@/features/profile/open';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';
import { formatPresenceNote } from '@/lib/format';
import { useMe } from '@/stores/auth';
import { confirmLogout } from './account/AccountPage';
import { SettingsNav } from './search/SettingsNav';
import { SETTINGS_SECTIONS, settingsSection } from './sections';
import { useSettingsClose, useSettingsClosing } from './SettingsLayer';

/** Desktop opens on My Account (Discord). */
const DEFAULT_SECTION = 'account';

/**
 * The /settings route: the User Settings layer's body on desktop (AppShell draws the layer
 * around it), the settings list with full-screen pages on phones.
 */
export function SettingsRoot() {
  const desktop = useIsDesktop();
  return desktop ? <SettingsDesktop /> : <SplitView list={<SettingsPane />} />;
}

/** Discord's round ✕ with "ESC" under it, beside the content column. */
function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    // Centred on the page title's line (the column's pt-8 + half its h-12 header).
    <div className="flex shrink-0 flex-col items-center gap-1.5 pt-[38px] pr-6 pl-3">
      <button
        type="button"
        onClick={onClose}
        aria-label="Close settings"
        aria-keyshortcuts="Escape"
        className="flex size-9 items-center justify-center rounded-full border-2 border-subtle text-muted outline-none transition-colors hover:border-fg hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand active:translate-y-px"
        data-testid="settings-close"
      >
        <X size={18} strokeWidth={2.5} aria-hidden />
      </button>
      <span className="text-[13px] font-semibold text-muted" aria-hidden>
        ESC
      </span>
    </div>
  );
}

/**
 * Desktop body of the User Settings layer: the nav column on the app background (the darker
 * tone), then the open section in a card — a content column of ~740px (the profile editor's
 * two columns get more) with the ✕ beside it.
 */
export function SettingsDesktop() {
  const { section } = useParams();
  const location = useLocation();
  const close = useSettingsClose();
  const closing = useSettingsClosing();
  if (!section)
    return closing ? null : (
      <Navigate to={`/settings/${DEFAULT_SECTION}`} replace state={location.state} />
    );
  const wide = settingsSection(section)?.wide;
  return (
    <div className="flex min-h-0 min-w-0 flex-1 gap-[var(--pane-gap)]">
      <aside className="flex min-h-0 flex-[1_0_218px] justify-end overflow-y-auto scrollbar-thin">
        <SettingsNav active={section} />
      </aside>
      <div className="card-pane flex min-h-0 min-w-0 flex-[1_1_800px]">
        <div
          className={cn(
            'flex min-h-0 min-w-0 flex-1 flex-col pt-8',
            wide ? 'max-w-[1100px]' : 'max-w-[740px]',
          )}
          data-testid="settings-content"
        >
          <Suspense fallback={<PageSpinner />}>
            <Outlet />
          </Suspense>
        </div>
        {close ? <CloseButton onClose={close} /> : null}
      </div>
    </div>
  );
}

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
 * The phone settings list (/settings, opened from the You tab): my profile card, sections,
 * log out. The avatar on the profile card opens my profile card (availability, custom
 * status); the rest of the row goes to Settings → Profile.
 */
export function SettingsPane() {
  const me = useMe();
  const { section } = useParams();
  const note = activePresenceNote(me?.presenceNote);
  return (
    <>
      <PaneHeader title="Settings" large back="/you" />
      <nav aria-label="Settings" className="min-h-0 flex-1 overflow-y-auto pb-4 scrollbar-thin">
        {me ? (
          <div
            className={cn(
              'card-inset mx-2 mb-2 flex items-center gap-4 px-3 py-3 transition-colors hover:bg-hover',
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
        <ul className="card-inset mx-2 flex flex-col p-1">
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
        </ul>
        <ul className="card-inset mx-2 mt-2 flex flex-col p-1">
          <li>
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
