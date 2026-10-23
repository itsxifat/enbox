import { Suspense, useState } from 'react';
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
import { copyIdItem } from './menus';

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
  const [dialog, setDialog] = useState<
    'nickname' | 'roles' | 'timeout' | 'kick' | 'ban' | 'transfer' | 'modview' | null
  >(null);
  const can = me ? memberAbilities(space, me.id, member) : null;
  const name = nameOf(member);
  // Developer Mode.
  const copy = copyIdItem(member.userId, 'User');
  const timedOut = !!member.timedOutUntil && Date.parse(member.timedOutUntil) > Date.now();

  const items: MenuEntry[] = can
    ? [
        { label: 'Profile', icon: User, onSelect: () => openProfile(member.userId, null, { spaceId: space.id }) },
        can.modView && { label: 'Mod View', icon: ShieldCheck, onSelect: () => setDialog('modview') },
        can.nickname && { label: 'Change nickname', icon: UserPen, onSelect: () => setDialog('nickname') },
        can.roles && { label: 'Roles', icon: Shield, onSelect: () => setDialog('roles') },
        (can.timeout || can.kick || can.ban) && 'separator',
        can.timeout &&
          (timedOut
            ? {
                label: 'Remove timeout',
                icon: Clock,
                onSelect: () => void updateMember(space.id, member.userId, { timedOutUntil: null }).catch((e: unknown) => toast.error(e)),
              }
            : { label: `Time out ${name}`, icon: Clock, onSelect: () => setDialog('timeout') }),
        can.kick && { label: `Kick ${name}`, icon: LogOut, danger: true, onSelect: () => setDialog('kick') },
        can.ban && { label: `Ban ${name}`, icon: Ban, danger: true, onSelect: () => setDialog('ban') },
        // Discord: only the owner, to someone else.
        space.ownerId === me?.id && member.userId !== me?.id && 'separator',
        space.ownerId === me?.id &&
          member.userId !== me?.id && { label: 'Transfer Ownership', icon: Crown, danger: true, onSelect: () => setDialog('transfer') },
        copy && 'separator',
        copy,
      ]
    : [];

  return (
    <>
      <Menu open={!dialog} onClose={onClose} anchor={anchor} items={items} aria-label={`${name} actions`} />
      {dialog === 'nickname' ? <NicknameForMember space={space} member={member} onClose={onClose} /> : null}
      {dialog === 'roles' && can ? <RolesForMember space={space} member={member} myTop={can.myTop} onClose={onClose} /> : null}
      {dialog === 'timeout' ? (
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
      ) : null}
      {dialog === 'kick' ? (
        <KickDialog
          subject={name}
          onClose={onClose}
          onKick={async (reason) => {
            await kickMember(space.id, member.userId, reason);
            toast.success(`${name} was kicked`);
          }}
        />
      ) : null}
      {dialog === 'ban' ? (
        <BanDialog
          subject={name}
          onClose={onClose}
          onBan={async (choice) => {
            await banMember(space.id, member.userId, choice);
            toast.success(`${name} was banned`);
          }}
        />
      ) : null}
      {dialog === 'transfer' ? <TransferDialog space={space} member={member} onClose={onClose} /> : null}
      {dialog === 'modview' ? (
        <Suspense fallback={null}>
          <ModViewPanel space={space} userId={member.userId} onClose={onClose} />
        </Suspense>
      ) : null}
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
