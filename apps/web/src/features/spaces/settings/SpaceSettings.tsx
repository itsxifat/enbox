import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { ArrowLeft, X } from 'lucide-react';
import { PERM, hasPerm, type Space } from '@enbox/shared';
import { Button, Field, IconButton, Input, PageSpinner, Switch, Textarea, confirm, toast } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { useMe } from '@/stores/auth';
import { useSpace, useSpaces } from '@/stores/spaces';
import { deleteSpace, updateSpace } from '../actions';
import { AuditLogPage, BansPage, InvitesPage, MembersPage } from './pages';
import { RolesPage } from './RolesPage';

interface Section {
  id: string;
  label: string;
  show: (space: Space, owner: boolean) => boolean;
  render: (space: Space) => ReactNode;
}

const SECTIONS: Section[] = [
  { id: 'overview', label: 'Overview', show: (s) => hasPerm(s.myPermissions, PERM.MANAGE_SPACE), render: (s) => <OverviewPage space={s} /> },
  { id: 'roles', label: 'Roles', show: (s) => hasPerm(s.myPermissions, PERM.MANAGE_ROLES), render: (s) => <RolesPage space={s} /> },
  {
    id: 'members',
    label: 'Members',
    show: (s) => [PERM.KICK_MEMBERS, PERM.BAN_MEMBERS, PERM.MANAGE_ROLES, PERM.MODERATE_MEMBERS, PERM.MANAGE_NICKNAMES].some((p) => hasPerm(s.myPermissions, p)),
    render: (s) => <MembersPage space={s} />,
  },
  { id: 'invites', label: 'Invites', show: (s) => hasPerm(s.myPermissions, PERM.CREATE_INVITE), render: (s) => <InvitesPage space={s} /> },
  { id: 'bans', label: 'Bans', show: (s) => hasPerm(s.myPermissions, PERM.BAN_MEMBERS), render: (s) => <BansPage space={s} /> },
  { id: 'audit-log', label: 'Audit log', show: (s) => hasPerm(s.myPermissions, PERM.VIEW_AUDIT_LOG), render: (s) => <AuditLogPage space={s} /> },
];

/** /spaces/:spaceId/settings/:section? — full-screen Space settings (Discord style). */
export function SpaceSettings() {
  const { spaceId, section } = useParams<{ spaceId: string; section?: string }>();
  const space = useSpace(spaceId);
  const loaded = useSpaces((s) => s.loaded);
  const me = useMe();
  const navigate = useNavigate();
  const desktop = useIsDesktop();
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
  const visible = SECTIONS.filter((s) => s.show(space, owner));
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
            onClick={() =>
              void confirm({
                title: `Delete ${space.name}?`,
                message: 'Every channel and message is deleted for everyone. This cannot be undone.',
                confirmLabel: 'Delete Space',
                danger: true,
              }).then(async (ok) => {
                if (!ok) return;
                try {
                  await deleteSpace(space.id);
                  navigate('/spaces', { replace: true });
                } catch (e) {
                  toast.error(e);
                }
              })
            }
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
            <h2 className="mb-6 text-[22px] font-bold">{current.label}</h2>
            {current.render(space)}
          </div>
          {desktop ? (
            <div className="absolute top-10 right-10">
              <IconButton icon={X} label="Close settings" variant="solid" onClick={close} />
            </div>
          ) : null}
        </main>
      ) : null}
    </div>
  );
}

function OverviewPage({ space }: { space: Space }) {
  const [name, setName] = useState(space.name);
  const [description, setDescription] = useState(space.description ?? '');
  const [discoverable, setDiscoverable] = useState(space.isDiscoverable);
  const [notify, setNotify] = useState(space.defaultNotifyLevel);
  const [busy, setBusy] = useState(false);
  const dirty =
    name.trim() !== space.name ||
    (description.trim() || null) !== space.description ||
    discoverable !== space.isDiscoverable ||
    notify !== space.defaultNotifyLevel;
  const save = async () => {
    setBusy(true);
    try {
      await updateSpace(space.id, {
        name: name.trim(),
        description: description.trim() || null,
        isDiscoverable: discoverable,
        defaultNotifyLevel: notify,
      });
      toast.success('Saved');
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-5">
      <Field label="Space name" htmlFor="sp-name">
        <Input id="sp-name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Description" htmlFor="sp-desc">
        <Textarea id="sp-desc" rows={3} value={description} maxLength={1000} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <div className="card-inset flex flex-col gap-1 p-2">
        <Switch
          checked={notify === 'all'}
          onChange={(v) => setNotify(v ? 'all' : 'mentions')}
          label="Notify members of every message"
          description="Off (recommended for big Spaces): only @mentions notify by default. Members can change it for themselves."
        />
        <Switch checked={discoverable} onChange={setDiscoverable} label="Listed in Space discovery" description="People can find and preview it." />
      </div>
      <div className="flex justify-end gap-2">
        <Button disabled={!dirty || !name.trim()} loading={busy} onClick={() => void save()}>
          Save changes
        </Button>
      </div>
    </div>
  );
}
