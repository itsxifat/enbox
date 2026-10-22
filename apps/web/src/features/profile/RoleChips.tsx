import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { Space, SpaceMember } from '@enbox/shared';
import { DropdownMenu, toast } from '@/components/ui';
import { setMemberRole } from '@/features/spaces/actions';
import { memberAbilities } from '@/features/spaces/MemberActions';
import { RoleIcon } from '@/features/spaces/RoleIcon';
import { cn } from '@/lib/cn';
import { useMe } from '@/stores/auth';

/**
 * A member's roles in a Space as chips (highest first, @everyone left out). With
 * MANAGE_ROLES, the colour dot of a role below mine turns into an × on hover (remove), and a
 * + chip adds one of the roles I may give.
 */
export function RoleChips({
  space,
  member,
  className,
  labelClassName,
}: {
  space: Space;
  member: SpaceMember;
  className?: string;
  labelClassName?: string;
}) {
  const me = useMe();
  const [busy, setBusy] = useState<string | null>(null);
  const can = me ? memberAbilities(space, me.id, member) : null;
  const byPosition = [...space.roles]
    .filter((r) => !r.isDefault)
    .sort((a, b) => b.position - a.position);
  const roles = byPosition.filter((r) => member.roleIds.includes(r.id));
  const editable = (position: number) => !!can?.roles && position < can.myTop;
  const addable = byPosition.filter((r) => !member.roleIds.includes(r.id) && editable(r.position));
  if (!roles.length && !addable.length) return null;

  const toggle = async (roleId: string, on: boolean) => {
    setBusy(roleId);
    try {
      await setMemberRole(space.id, member.userId, roleId, on);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className={className} data-testid="card-roles">
      <h3 className={cn('section-label mb-1.5', labelClassName)}>{roles.length === 1 ? 'Role' : 'Roles'}</h3>
      <ul className="flex flex-wrap gap-1">
        {roles.map((r) => {
          const dot = { background: r.color ?? 'var(--subtle)' };
          return (
            <li
              key={r.id}
              className="inline-flex h-6 max-w-full items-center gap-1.5 rounded-md bg-surface-2 px-1.5 text-[12px] font-medium text-fg"
            >
              {editable(r.position) ? (
                <button
                  type="button"
                  aria-label={`Remove role ${r.name}`}
                  disabled={busy === r.id}
                  onClick={() => void toggle(r.id, false)}
                  className="group/role flex size-3 shrink-0 items-center justify-center rounded-full outline-none focus-visible:outline-2 focus-visible:outline-brand"
                  style={dot}
                >
                  <X
                    size={10}
                    strokeWidth={3}
                    className="text-white opacity-0 group-hover/role:opacity-100 group-focus-visible/role:opacity-100"
                    aria-hidden
                  />
                </button>
              ) : (
                <span aria-hidden className="size-3 shrink-0 rounded-full" style={dot} />
              )}
              <RoleIcon role={r} size={14} />
              <span className="truncate">{r.name}</span>
            </li>
          );
        })}
        {addable.length ? (
          <li>
            <DropdownMenu
              aria-label="Add role"
              align="start"
              items={addable.map((r) => ({
                label: (
                  <span className="flex items-center gap-2">
                    <span aria-hidden className="size-3 rounded-full" style={{ background: r.color ?? 'var(--subtle)' }} />
                    {r.name}
                  </span>
                ),
                disabled: busy === r.id,
                onSelect: () => void toggle(r.id, true),
              }))}
              trigger={({ active, ...p }) => (
                <button
                  {...p}
                  data-active={active || undefined}
                  type="button"
                  aria-label="Add role"
                  title="Add role"
                  className="flex size-6 items-center justify-center rounded-md bg-surface-2 text-muted outline-none hover:text-fg focus-visible:outline-2 focus-visible:outline-brand"
                >
                  <Plus size={14} aria-hidden />
                </button>
              )}
            />
          </li>
        ) : null}
      </ul>
    </section>
  );
}
