import { Suspense, useRef, useState } from 'react';
import { Ban, Clock, Crown, LogOut, Shield, ShieldCheck, User, UserPen } from 'lucide-react';
import {
  PERM,
  canActOn,
  hasPerm,
  highestRolePosition,
  userDisplayName,
  type Space,
  type SpaceMember,
} from '@enbox/shared';
import { Button, Checkbox, Field, Input, Menu, Modal, toast, type MenuAnchor, type MenuEntry } from '@/components/ui';
import { BanDialog, KickDialog, TimeoutDialog } from '@/features/moderation/dialogs';
import { openProfile } from '@/features/profile/open';
import { lazyNamed } from '@/lib/lazy';
import { useMe } from '@/stores/auth';
import { useUsers } from '@/stores/users';
import { banMember, kickMember, setMemberRole, transferOwnership, updateMember } from './actions';
import { copyIdItem, tidy } from './menus';

const ModViewPanel = lazyNamed(() => import('@/features/moderation/ModView'), 'ModViewPanel');

/** Any of these opens Mod View and the Members page (moderators). */
const MODERATOR_PERMS = [
  PERM.KICK_MEMBERS,
  PERM.BAN_MEMBERS,
  PERM.MODERATE_MEMBERS,
  PERM.MANAGE_ROLES,
  PERM.MANAGE_NICKNAMES,
];

function nameOf(member: SpaceMember): string {
  return member.nickname || userDisplayName(useUsers.getState().byId[member.userId]);
}

/** What I may do to a member (the server enforces the same rules). */
export function memberAbilities(space: Space, meId: string, member: SpaceMember) {
  const me = space.me;
  const myTop = highestRolePosition(space.roles, me.roleIds, space.ownerId === meId);
  const theirTop = highestRolePosition(space.roles, member.roleIds, space.ownerId === member.userId);
  const above = canActOn(myTop, theirTop, space.ownerId === member.userId) && member.userId !== meId;
  const bits = space.myPermissions;
  return {
    myTop,
    modView: MODERATOR_PERMS.some((p) => hasPerm(bits, p)),
    nickname: hasPerm(bits, PERM.MANAGE_NICKNAMES) && (above || member.userId === meId),
    roles: hasPerm(bits, PERM.MANAGE_ROLES),
    timeout: hasPerm(bits, PERM.MODERATE_MEMBERS) && above,
    kick: hasPerm(bits, PERM.KICK_MEMBERS) && above,
    ban: hasPerm(bits, PERM.BAN_MEMBERS) && above,
  };
}

/** The dialogs the member items open (`MemberDialog` renders them). */
export type MemberDialogKind = 'nickname' | 'roles' | 'timeout' | 'kick' | 'ban' | 'transfer' | 'modview';

/**
 * Roles ▸ of the user menu: every role but @everyone, highest first, as checkboxes; the ones
 * at or above my highest role are disabled (as in the roles dialog). Stays open while toggling.
 */
export function memberRoleEntries(space: Space, member: SpaceMember, myTop: number): MenuEntry[] {
  return space.roles
    .filter((r) => !r.isDefault)
    .sort((a, b) => b.position - a.position)
    .map((r) => {
      const has = member.roleIds.includes(r.id);
      return {
        label: (
          <span className="flex min-w-0 items-center gap-2">
            <span className="size-3 shrink-0 rounded-full" style={{ background: r.color ?? 'var(--color-muted)' }} aria-hidden />
            <span className="truncate">{r.name}</span>
          </span>
        ),
        checked: has,
        keepOpen: true,
        disabled: r.position >= myTop,
        onSelect: () => void setMemberRole(space.id, member.userId, r.id, !has).catch((e: unknown) => toast.error(e)),
      };
    });
}

/**
 * The member's Space items of a menu, as my permissions allow: Mod View, Change nickname, Roles,
 * Time out (or Remove timeout), Kick, Ban and, for the owner, Transfer Ownership. `open` shows
 * an item's dialog (`MemberDialog`). With `roles: 'submenu'` (the user menu) Roles ▸ lists the
 * roles as checkboxes instead of opening the roles dialog, after the moderation items as in
 * Discord's member menu.
 */
export function memberSpaceItems(
  space: Space,
  member: SpaceMember,
  meId: string,
  open: (dialog: MemberDialogKind) => void,
  opts: { roles?: 'dialog' | 'submenu' } = {},
): MenuEntry[] {
  const can = memberAbilities(space, meId, member);
  const name = nameOf(member);
  const timedOut = !!member.timedOutUntil && Date.parse(member.timedOutUntil) > Date.now();
  const roles = opts.roles === 'submenu' ? memberRoleEntries(space, member, can.myTop) : null;
  // Discord: only the owner, to someone else.
  const transfer = space.ownerId === meId && member.userId !== meId;
  const rolesItem: MenuEntry =
    can.roles &&
    (roles
      ? roles.length > 0 && { label: 'Roles', icon: Shield, submenu: roles }
      : { label: 'Roles', icon: Shield, onSelect: () => open('roles') });
  return [
    can.modView && { label: 'Mod View', icon: ShieldCheck, onSelect: () => open('modview') },
    can.nickname && { label: 'Change nickname', icon: UserPen, onSelect: () => open('nickname') },
    !roles && rolesItem,
    (can.timeout || can.kick || can.ban) && 'separator',
    can.timeout &&
      (timedOut
        ? {
            label: 'Remove timeout',
            icon: Clock,
            onSelect: () => void updateMember(space.id, member.userId, { timedOutUntil: null }).catch((e: unknown) => toast.error(e)),
          }
        : { label: `Time out ${name}`, icon: Clock, onSelect: () => open('timeout') }),
    can.kick && { label: `Kick ${name}`, icon: LogOut, danger: true, onSelect: () => open('kick') },
    can.ban && { label: `Ban ${name}`, icon: Ban, danger: true, onSelect: () => open('ban') },
    !!roles && 'separator',
    !!roles && rolesItem,
    transfer && 'separator',
    transfer && { label: 'Transfer Ownership', icon: Crown, danger: true, onSelect: () => open('transfer') },
  ];
}

/** The dialog a member item opened; `onClose` once it is done or dismissed. */
export function MemberDialog({
  space,
  member,
  dialog,
  onClose,
}: {
  space: Space;
  member: SpaceMember;
  dialog: MemberDialogKind;
  onClose: () => void;
}) {
  const me = useMe();
  const name = nameOf(member);
  switch (dialog) {
    case 'nickname':
      return <NicknameForMember space={space} member={member} onClose={onClose} />;
    case 'roles':
      return me ? (
        <RolesForMember space={space} member={member} myTop={memberAbilities(space, me.id, member).myTop} onClose={onClose} />
      ) : null;
    case 'timeout':
      return (
        <TimeoutDialog
          subject={name}
          onClose={onClose}
          onTimeout={async (seconds, reason) => {
            await updateMember(space.id, member.userId, {
              timedOutUntil: new Date(Date.now() + seconds * 1000).toISOString(),
              reason,
            });
            toast.success(`${name} is timed out`);
          }}
        />
      );
    case 'kick':
      return (
        <KickDialog
          subject={name}
          onClose={onClose}
          onKick={async (reason) => {
            await kickMember(space.id, member.userId, reason);
            toast.success(`${name} was kicked`);
          }}
        />
      );
    case 'ban':
      return (
        <BanDialog
          subject={name}
          onClose={onClose}
          onBan={async (choice) => {
            await banMember(space.id, member.userId, choice);
            toast.success(`${name} was banned`);
          }}
        />
      );
    case 'transfer':
      return <TransferDialog space={space} member={member} onClose={onClose} />;
    case 'modview':
      return (
        <Suspense fallback={null}>
          <ModViewPanel space={space} userId={member.userId} onClose={onClose} />
        </Suspense>
      );
  }
}

/** The member menu of the moderation pages: Profile, the member's Space items, Copy User ID. */
export function MemberActionsMenu({
  space,
  member,
  anchor,
  onClose,
}: {
  space: Space;
  member: SpaceMember;
  anchor: MenuAnchor;
  onClose: () => void;
}) {
  const me = useMe();
  const [dialog, setDialog] = useState<MemberDialogKind | null>(null);
  // An item that opens a dialog keeps this mounted (the menu hides) until the dialog closes.
  const opening = useRef(false);
  const open = (d: MemberDialogKind) => {
    opening.current = true;
    setDialog(d);
  };
  const name = nameOf(member);
  // Developer Mode.
  const copy = copyIdItem(member.userId, 'User');

  const items: MenuEntry[] = me
    ? tidy([
        { label: 'Profile', icon: User, onSelect: () => openProfile(member.userId, null, { spaceId: space.id }) },
        ...memberSpaceItems(space, member, me.id, open),
        'separator',
        copy,
      ])
    : [];

  return (
    <>
      <Menu
        open={!dialog}
        onClose={onClose}
        // Items run after this: close unless one of them opened a dialog.
        onItemSelected={() =>
          queueMicrotask(() => {
            if (!opening.current) onClose();
          })
        }
        anchor={anchor}
        items={items}
        aria-label={`${name} actions`}
      />
      {dialog ? <MemberDialog space={space} member={member} dialog={dialog} onClose={onClose} /> : null}
    </>
  );
}

function NicknameForMember({ space, member, onClose }: { space: Space; member: SpaceMember; onClose: () => void }) {
  const [value, setValue] = useState(member.nickname ?? '');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await updateMember(space.id, member.userId, { nickname: value.trim() || null });
      onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title="Change nickname" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={() => void save()}>Save</Button></>}>
      <Field label="Nickname" hint="Leave empty to show their name.">
        <Input value={value} maxLength={32} onChange={(e) => setValue(e.target.value)} autoFocus />
      </Field>
    </Modal>
  );
}

function RolesForMember({ space, member, myTop, onClose }: { space: Space; member: SpaceMember; myTop: number; onClose: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [roleIds, setRoleIds] = useState(member.roleIds);
  const roles = space.roles.filter((r) => !r.isDefault).sort((a, b) => b.position - a.position);
  const toggle = async (roleId: string, on: boolean) => {
    setBusy(roleId);
    try {
      await setMemberRole(space.id, member.userId, roleId, on);
      setRoleIds((ids) => (on ? [...ids, roleId] : ids.filter((x) => x !== roleId)));
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Modal open onClose={onClose} title={`Roles of ${nameOf(member)}`} footer={<Button onClick={onClose}>Done</Button>}>
      {roles.length === 0 ? <p className="text-sm text-muted">This Space has no roles yet. Create them in Space settings → Roles.</p> : null}
      <div className="flex flex-col gap-1">
        {roles.map((r) => (
          <Checkbox
            key={r.id}
            checked={roleIds.includes(r.id)}
            disabled={r.position >= myTop || busy === r.id}
            onChange={(on) => void toggle(r.id, on)}
            label={
              <span className="flex items-center gap-2">
                <span className="size-3 rounded-full" style={{ background: r.color ?? 'var(--color-muted)' }} aria-hidden />
                {r.name}
              </span>
            }
          />
        ))}
      </div>
    </Modal>
  );
}

/** Discord's Transfer Ownership: the owner acknowledges that the Space becomes theirs. */
function TransferDialog({ space, member, onClose }: { space: Space; member: SpaceMember; onClose: () => void }) {
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const name = nameOf(member);
  const transfer = async () => {
    setBusy(true);
    try {
      await transferOwnership(space.id, member.userId);
      toast.success(`${name} now owns ${space.name}`);
      onClose();
    } catch (e) {
      toast.error(e);
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Transfer Ownership"
      description={`${name} becomes the owner of ${space.name}. Only they can transfer it back or delete the Space.`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="danger" loading={busy} disabled={!ack} onClick={() => void transfer()}>Transfer Ownership</Button></>}
    >
      <Checkbox
        checked={ack}
        onChange={setAck}
        label={`I acknowledge that by transferring ownership of this Space to ${name}, it officially belongs to them.`}
      />
    </Modal>
  );
}
