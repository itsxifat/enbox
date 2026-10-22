import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { ArrowLeft, X } from 'lucide-react';
import type { Space } from '@enbox/shared';
import { IconButton, PageSpinner } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { useMe } from '@/stores/auth';
import { useSpace, useSpaces } from '@/stores/spaces';
import { DeleteSpaceDialog } from './DeleteSpaceDialog';
import { OverviewPage } from './OverviewPage';
import { AuditLogPage, BansPage, InvitesPage, MembersPage } from './pages';
import { RolesPage } from './RolesPage';
import { SafetyPage } from './SafetyPage';
import { visibleSettingsSections, type SettingsSectionId } from './sections';

const PAGES: Record<SettingsSectionId, (space: Space) => ReactNode> = {
  overview: (s) => <OverviewPage space={s} />,
  safety: (s) => <SafetyPage space={s} />,
  roles: (s) => <RolesPage space={s} />,
  members: (s) => <MembersPage space={s} />,
  invites: (s) => <InvitesPage space={s} />,
  bans: (s) => <BansPage space={s} />,
  'audit-log': (s) => <AuditLogPage space={s} />,
};

/** /spaces/:spaceId/settings/:section? — full-screen Space settings (Discord style). */
export function SpaceSettings() {
  const { spaceId, section } = useParams<{ spaceId: string; section?: string }>();
  const space = useSpace(spaceId);
  const loaded = useSpaces((s) => s.loaded);
  const me = useMe();
  const navigate = useNavigate();
  const desktop = useIsDesktop();
  const [deleting, setDeleting] = useState(false);
  const close = () => navigate(`/spaces/${spaceId}`);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('[role="dialog"][aria-modal="true"]')) close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!space) return loaded ? <Navigate to="/spaces" replace /> : <PageSpinner />;
  const owner = space.ownerId === me?.id;
  const visible = visibleSettingsSections(space);
  const current = visible.find((s) => s.id === section) ?? (desktop ? visible[0] : undefined);

  const nav = (
    <nav aria-label="Space settings" className="flex w-full flex-col gap-0.5 p-3 lg:w-60">
      <p className="truncate px-3 pt-2 pb-1 text-[12px] font-bold tracking-wide text-muted uppercase">{space.name}</p>
      {visible.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => navigate(`/spaces/${space.id}/settings/${s.id}`)}
          aria-current={current?.id === s.id ? 'page' : undefined}
          className={cn('rounded-lg px-3 py-2 text-left text-[15px]', current?.id === s.id ? 'bg-selected font-semibold' : 'text-muted hover:bg-hover hover:text-fg')}
        >
          {s.label}
        </button>
      ))}
      {owner ? (
        <>
          <div className="my-2 h-px bg-line" aria-hidden />
          <button
            type="button"
            className="rounded-lg px-3 py-2 text-left text-[15px] text-danger hover:bg-danger-soft"
            onClick={() => setDeleting(true)}
          >
            Delete Space
          </button>
        </>
      ) : null}
    </nav>
  );

  return (
    <div className="fixed inset-0 z-30 flex bg-app pt-[env(safe-area-inset-top)]" role="dialog" aria-modal="false" aria-label={`${space.name} settings`}>
      {desktop || !current ? (
        <aside className="flex shrink-0 justify-end overflow-y-auto bg-surface lg:w-[min(40vw,420px)]">
          <div className="flex w-full flex-col lg:w-auto">
            {!desktop ? (
              <div className="flex items-center gap-2 px-2 pt-2">
                <IconButton icon={ArrowLeft} label="Back" variant="ghost" onClick={close} />
                <h1 className="font-bold">Space settings</h1>
              </div>
            ) : null}
            {nav}
          </div>
        </aside>
      ) : null}
      {current ? (
        <main className="relative flex min-w-0 flex-1 flex-col overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-4 py-6 lg:px-10 lg:py-14">
            {!desktop ? (
              <div className="mb-4 flex items-center gap-2">
                <IconButton icon={ArrowLeft} label="Back" variant="ghost" onClick={() => navigate(`/spaces/${space.id}/settings`)} />
              </div>
            ) : null}
            <h2 className="mb-6 text-[22px] font-bold">{current.id === 'overview' ? 'Space Overview' : current.label}</h2>
            {PAGES[current.id](space)}
          </div>
          {desktop ? (
            <div className="absolute top-10 right-10">
              <IconButton icon={X} label="Close settings" variant="solid" onClick={close} />
            </div>
          ) : null}
        </main>
      ) : null}
      {deleting ? <DeleteSpaceDialog space={space} onClose={() => setDeleting(false)} /> : null}
    </div>
  );
}
