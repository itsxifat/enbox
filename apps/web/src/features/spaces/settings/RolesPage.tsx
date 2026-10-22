import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import {
  PERM,
  canManageRole,
  grantableBits,
  hasPerm,
  highestRolePosition,
  isSpaceAdmin,
  type Space,
  type SpaceRole,
} from '@enbox/shared';
import { Button, Field, IconButton, Input, Switch, confirm, toast } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useMe } from '@/stores/auth';
import { createRole, deleteRole, reorderRoles, updateRole } from '../actions';
import { PERMISSION_GROUPS } from '../permissionLabels';

const COLORS = ['#1abc9c', '#2ecc71', '#3498db', '#9b59b6', '#e91e63', '#f1c40f', '#e67e22', '#e74c3c', '#95a5a6', '#607d8b', '#5865f2', '#eb459e'];

export function RolesPage({ space }: { space: Space }) {
  const me = useMe();
  const roles = useMemo(() => [...space.roles].sort((a, b) => b.position - a.position), [space.roles]);
  const [selectedId, setSelectedId] = useState<string>(roles[0]?.id ?? '');
  const selected = roles.find((r) => r.id === selectedId) ?? roles[0];
  const myTop = highestRolePosition(space.roles, space.me.roleIds, space.ownerId === me?.id);
  const [busy, setBusy] = useState(false);

  const add = async () => {
    setBusy(true);
    try {
      const r = await createRole(space.id, { name: 'new role', color: COLORS[roles.length % COLORS.length] });
      setSelectedId(r.id);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const move = async (role: SpaceRole, dir: -1 | 1) => {
    const order = roles.filter((r) => !r.isDefault).map((r) => r.id);
    const i = order.indexOf(role.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j]!, order[i]!];
    try {
      await reorderRoles(space.id, order);
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <div className="flex shrink-0 flex-col gap-1 lg:w-56">
        <Button leftIcon={Plus} variant="soft" loading={busy} onClick={() => void add()} className="mb-2" data-testid="create-role">
          Create role
        </Button>
        {roles.map((r, i) => {
          const manageable = r.isDefault || canManageRole(myTop, r.position);
          return (
            <div key={r.id} className="group/role flex items-center gap-1">
              <button
                type="button"
                onClick={() => setSelectedId(r.id)}
                className={cn('flex min-w-0 flex-1 items-center gap-2 rounded-lg px-3 py-2 text-left text-[15px]', selected?.id === r.id ? 'bg-selected font-semibold' : 'hover:bg-hover')}
              >
                <span className="size-3 shrink-0 rounded-full" style={{ background: r.color ?? 'var(--color-muted)' }} aria-hidden />
                <span className="truncate">{r.name}</span>
              </button>
              {!r.isDefault && manageable ? (
                <div className="flex opacity-0 group-hover/role:opacity-100 focus-within:opacity-100">
                  <IconButton icon={ArrowUp} label={`Move ${r.name} up`} size="xs" variant="ghost" disabled={i === 0 || !canManageRole(myTop, roles[i - 1]!.position)} onClick={() => void move(r, -1)} />
                  <IconButton icon={ArrowDown} label={`Move ${r.name} down`} size="xs" variant="ghost" disabled={roles[i + 1]?.isDefault !== false} onClick={() => void move(r, 1)} />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="min-w-0 flex-1">
        {selected ? <RoleEditor key={selected.id} space={space} role={selected} myTop={myTop} /> : null}
      </div>
    </div>
  );
}

function RoleEditor({ space, role, myTop }: { space: Space; role: SpaceRole; myTop: number }) {
  const [name, setName] = useState(role.name);
  const [color, setColor] = useState<string | null>(role.color);
  const [hoist, setHoist] = useState(role.hoist);
  const [mentionable, setMentionable] = useState(role.mentionable);
  const [perms, setPerms] = useState(role.permissions);
  const [busy, setBusy] = useState(false);
  useEffect(() => setPerms(role.permissions), [role.permissions]);
  const editable = role.isDefault ? hasPerm(space.myPermissions, PERM.MANAGE_ROLES) : canManageRole(myTop, role.position);
  const grantable = grantableBits(space.myPermissions);
  const dirty = name !== role.name || color !== role.color || hoist !== role.hoist || mentionable !== role.mentionable || perms !== role.permissions;

  const save = async () => {
    setBusy(true);
    try {
      await updateRole(space.id, role.id, {
        ...(role.isDefault ? {} : { name: name.trim() || role.name, color, hoist }),
        mentionable,
        permissions: perms,
      });
      toast.success('Role saved');
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {!editable ? (
        <p className="card-inset p-3 text-[14px] text-muted">You can only edit roles below your highest role.</p>
      ) : null}
      {!role.isDefault ? (
        <>
          <Field label="Role name" htmlFor="role-name">
            <Input id="role-name" value={name} maxLength={100} disabled={!editable} onChange={(e) => setName(e.target.value)} />
          </Field>
          <div>
            <p className="mb-2 text-[14px] font-medium">Role colour</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" aria-label="Default colour" aria-pressed={color === null} disabled={!editable} onClick={() => setColor(null)} className={cn('size-9 rounded-lg border-2 bg-surface-2', color === null ? 'border-fg' : 'border-transparent')} />
              {COLORS.map((c) => (
                <button key={c} type="button" aria-label={c} aria-pressed={color === c} disabled={!editable} onClick={() => setColor(c)} className={cn('size-9 rounded-lg border-2', color === c ? 'border-fg' : 'border-transparent')} style={{ background: c }} />
              ))}
            </div>
          </div>
        </>
      ) : (
        <p className="text-[14px] text-muted">@everyone: what every member can do. Roles add to it.</p>
      )}
      <div className="card-inset flex flex-col gap-1 p-2">
        {!role.isDefault ? (
          <Switch checked={hoist} onChange={setHoist} disabled={!editable} label="Show members separately" description="Members with this role get their own group in the member list." />
        ) : null}
        <Switch checked={mentionable} onChange={setMentionable} disabled={!editable} label={role.isDefault ? 'Anyone can use @everyone' : `Anyone can @mention this role`} description={role.isDefault ? 'Otherwise only members with “Mention @everyone” can.' : 'Otherwise only members with “Mention @everyone” can.'} />
      </div>
      {PERMISSION_GROUPS.map((g) => (
        <section key={g.title}>
          <h3 className="mb-1 text-[12px] font-bold tracking-wide text-muted uppercase">{g.title}</h3>
          <div className="card-inset flex flex-col gap-1 p-2">
            {g.items.map((p) => (
              <Switch
                key={p.bit}
                checked={(perms & p.bit) !== 0}
                disabled={!editable || (!isSpaceAdmin(space.myPermissions) && (grantable & p.bit) === 0)}
                onChange={(on) => setPerms((v) => (on ? v | p.bit : v & ~p.bit))}
                label={p.label}
                description={p.description}
              />
            ))}
          </div>
        </section>
      ))}
      <div className="sticky bottom-4 flex justify-end gap-2">
        {!role.isDefault && editable ? (
          <Button
            variant="ghost"
            leftIcon={Trash2}
            className="mr-auto text-danger"
            onClick={() =>
              void confirm({ title: `Delete ${role.name}?`, message: 'Members lose its permissions.', confirmLabel: 'Delete role', danger: true }).then(
                (ok) => ok && void deleteRole(space.id, role.id).catch((e: unknown) => toast.error(e)),
              )
            }
          >
            Delete role
          </Button>
        ) : null}
        <Button variant="ghost" disabled={!dirty} onClick={() => { setName(role.name); setColor(role.color); setHoist(role.hoist); setMentionable(role.mentionable); setPerms(role.permissions); }}>
          Reset
        </Button>
        <Button disabled={!dirty || !editable} loading={busy} onClick={() => void save()} data-testid="save-role">
          Save changes
        </Button>
      </div>
    </div>
  );
}
