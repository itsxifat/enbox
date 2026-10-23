/**
 * The Members page's bulk bar for the selected members: Kick, Ban (with a message deletion
 * window), Add Role, Remove Role (roles below my highest) and Time out, each confirmed with
 * the number of members. The server checks every member as if alone and lists refusals, which
 * the summary toast reports with the first reason.
 */
import { useState } from 'react';
import { Ban, ChevronDown, Clock, LogOut, ShieldMinus, ShieldPlus, X } from 'lucide-react';
import {
  PERM,
  hasPerm,
  highestRolePosition,
  type BulkMemberAction,
  type BulkMembersRequest,
  type BulkMembersResult,
  type ID,
  type Space,
} from '@enbox/shared';
import { Button, DropdownMenu, IconButton, confirm, toast } from '@/components/ui';
import { useMe } from '@/stores/auth';
import { bulkMembers } from './api';
import { BanDialog, KickDialog, TimeoutDialog } from './dialogs';

export const membersLabel = (n: number) => `${n.toLocaleString()} member${n === 1 ? '' : 's'}`;

const DONE: Record<BulkMemberAction, (n: string, role: string) => string> = {
  kick: (n) => `Kicked ${n}`,
  ban: (n) => `Banned ${n}`,
  timeout: (n) => `Timed out ${n}`,
  add_role: (n, role) => `Added ${role} to ${n}`,
  remove_role: (n, role) => `Removed ${role} from ${n}`,
};

const REFUSED: Record<BulkMemberAction, string> = {
  kick: 'kicked',
  ban: 'banned',
  timeout: 'timed out',
  add_role: 'given the role',
  remove_role: 'changed',
};

/** The toasts of a bulk result: what was done, then what was refused (with the first reason). */
export function reportBulk(action: BulkMemberAction, r: BulkMembersResult, roleName = 'the role') {
  if (r.ok.length) toast.success(DONE[action](membersLabel(r.ok.length), roleName));
  if (r.failed.length) {
    const reasons = [...new Set(r.failed.map((f) => f.reason))];
    toast.error(
      `${membersLabel(r.failed.length)} couldn’t be ${REFUSED[action]}: ${reasons[0]}${reasons.length > 1 ? ' (and other reasons)' : ''}`,
    );
  }
}

export function BulkBar({
  space,
  selected,
  onClear,
  onDone,
}: {
  space: Space;
  selected: ID[];
  onClear: () => void;
  /** After a bulk request (the page reloads its rows). */
  onDone: () => void;
}) {
  const me = useMe();
  const [dialog, setDialog] = useState<'kick' | 'ban' | 'timeout' | null>(null);
  const bits = space.myPermissions;
  const myTop = highestRolePosition(space.roles, space.me.roleIds, space.ownerId === me?.id);
  const roles = hasPerm(bits, PERM.MANAGE_ROLES)
    ? space.roles
        .filter((r) => !r.isDefault && r.position < myTop)
        .sort((a, b) => b.position - a.position)
    : [];
  const count = membersLabel(selected.length);

  const run = async (body: Omit<BulkMembersRequest, 'userIds'>, roleName?: string) => {
    const result = await bulkMembers(space.id, { ...body, userIds: selected });
    reportBulk(body.action, result, roleName);
    onDone();
  };

  const roleAction = (action: 'add_role' | 'remove_role', roleId: ID, roleName: string) =>
    void confirm({
      title:
        action === 'add_role'
          ? `Add ${roleName} to ${count}?`
          : `Remove ${roleName} from ${count}?`,
      confirmLabel: action === 'add_role' ? 'Add Role' : 'Remove Role',
    }).then(
      (ok) => ok && void run({ action, roleId }, roleName).catch((e: unknown) => toast.error(e)),
    );

  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-xl bg-surface px-3 py-2 shadow-elevated"
      role="toolbar"
      aria-label="Bulk actions"
    >
      <span className="mr-auto text-[14px] font-semibold">{count} selected</span>
      {hasPerm(bits, PERM.MODERATE_MEMBERS) ? (
        <Button size="sm" variant="secondary" leftIcon={Clock} onClick={() => setDialog('timeout')}>
          Time out
        </Button>
      ) : null}
      {roles.length ? (
        <>
          <DropdownMenu
            aria-label="Add Role"
            trigger={({ active: _active, ...p }) => (
              <Button
                {...p}
                size="sm"
                variant="secondary"
                leftIcon={ShieldPlus}
                rightIcon={ChevronDown}
              >
                Add Role
              </Button>
            )}
            items={roles.map((r) => ({
              label: r.name,
              onSelect: () => roleAction('add_role', r.id, r.name),
            }))}
          />
          <DropdownMenu
            aria-label="Remove Role"
            trigger={({ active: _active, ...p }) => (
              <Button
                {...p}
                size="sm"
                variant="secondary"
                leftIcon={ShieldMinus}
                rightIcon={ChevronDown}
              >
                Remove Role
              </Button>
            )}
            items={roles.map((r) => ({
              label: r.name,
              onSelect: () => roleAction('remove_role', r.id, r.name),
            }))}
          />
        </>
      ) : null}
      {hasPerm(bits, PERM.KICK_MEMBERS) ? (
        <Button size="sm" variant="secondary" leftIcon={LogOut} onClick={() => setDialog('kick')}>
          Kick
        </Button>
      ) : null}
      {hasPerm(bits, PERM.BAN_MEMBERS) ? (
        <Button size="sm" variant="danger" leftIcon={Ban} onClick={() => setDialog('ban')}>
          Ban
        </Button>
      ) : null}
      <IconButton icon={X} label="Clear selection" size="sm" onClick={onClear} />
      {dialog === 'kick' ? (
        <KickDialog
          subject={count}
          onClose={() => setDialog(null)}
          onKick={(reason) => run({ action: 'kick', reason })}
        />
      ) : null}
      {dialog === 'ban' ? (
        <BanDialog
          subject={count}
          onClose={() => setDialog(null)}
          onBan={(choice) => run({ action: 'ban', ...choice })}
        />
      ) : null}
      {dialog === 'timeout' ? (
        <TimeoutDialog
          subject={count}
          onClose={() => setDialog(null)}
          onTimeout={(durationSec, reason) => run({ action: 'timeout', durationSec, reason })}
        />
      ) : null}
    </div>
  );
}
