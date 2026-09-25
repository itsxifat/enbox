/** Group member rows, the per-member action menu and the full "Members" page. */
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import {
  Crown,
  Info,
  MessageCircle,
  ShieldCheck,
  ShieldMinus,
  UserMinus,
  Users,
} from 'lucide-react';
import { userDisplayName, type ChatMember, type ChatSummary, type ID } from '@enbox/shared';
import { UserAvatar } from '@/components/common/UserAvatar';
import { PaneHeader } from '@/components/layout/PaneHeader';
import { EmptyState, ListItemSkeleton, Menu, SearchInput, confirm, toast } from '@/components/ui';
import type { MenuAnchor, MenuEntry } from '@/components/ui';
import { cn } from '@/lib/cn';
import { getMyId } from '@/stores/auth';
import { canTransferGroupOwnership, roleLabel, sortMembers } from './members';
import {
  openDirectChat,
  removeGroupMember,
  setGroupRole,
  transferGroupOwnership,
} from './shared/chatActions';
import { matchesUser } from './shared/candidates';
import { RolePill } from './shared/InfoLayout';
import { afterPaint } from './shared/share';
import { UserProfileModal } from './shared/UserProfileModal';

export function MemberRow({
  member,
  meId,
  kind = 'group',
  onClick,
  trailing,
}: {
  member: Pick<ChatMember, 'user' | 'role'>;
  meId: ID | null;
  kind?: 'group' | 'channel' | 'community';
  onClick?: (anchor: HTMLElement) => void;
  trailing?: ReactNode;
}) {
  const me = member.user.id === meId;
  const name = me ? 'You' : userDisplayName(member.user);
  const role = roleLabel(member.role, kind);
  const body = (
    <>
      <UserAvatar user={member.user} size="md" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[15.5px] font-medium text-fg">{name}</span>
        <span className="truncate text-[13px] text-muted">
          {member.user.about || `@${member.user.username}`}
        </span>
      </span>
      {role ? <RolePill>{role}</RolePill> : null}
      {trailing}
    </>
  );
  const classes =
    'flex w-full items-center gap-3 px-5 py-2.5 text-left outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand';
  if (!onClick || me) return <div className={classes}>{body}</div>;
  return (
    <button
      type="button"
      className={cn(classes, 'transition-colors hover:bg-hover focus-visible:bg-hover')}
      onClick={(e) => onClick(e.currentTarget)}
      aria-haspopup="menu"
      data-testid={`member-${member.user.username}`}
    >
      {body}
    </button>
  );
}

/** Tap a member → message / view / admin actions (per `chat.permissions`). */
export function useGroupMemberMenu(chat: ChatSummary, onChanged: () => void) {
  const navigate = useNavigate();
  const [state, setState] = useState<{ member: ChatMember; anchor: MenuAnchor } | null>(null);
  const [profile, setProfile] = useState<ID | null>(null);
  const close = useCallback(() => setState(null), []);

  const open = useCallback(
    (member: ChatMember, anchor: HTMLElement) => afterPaint(() => setState({ member, anchor })),
    [],
  );

  const run = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      toast.success(done);
      onChanged();
    } catch (e) {
      toast.error(e);
    }
  };

  const items: MenuEntry[] = [];
  if (state) {
    const { member } = state;
    const u = member.user;
    const name = userDisplayName(u);
    const first = name.split(' ')[0];
    const p = chat.permissions;
    items.push(
      !u.isDeleted && {
        label: `Message ${first}`,
        icon: MessageCircle,
        onSelect: () => {
          void openDirectChat(u.id)
            .then((c) => navigate(`/chats/${c.id}`))
            .catch((e: unknown) => toast.error(e));
        },
      },
      { label: `View ${first}`, icon: Info, onSelect: () => setProfile(u.id) },
    );
    const admin: MenuEntry[] = [];
    if (p.canManageAdmins && member.role === 'member')
      admin.push({
        label: 'Make group admin',
        icon: ShieldCheck,
        onSelect: () =>
          void run(() => setGroupRole(chat.id, u.id, 'admin'), `${name} is now an admin`),
      });
    if (p.canManageAdmins && member.role === 'admin')
      admin.push({
        label: 'Dismiss as admin',
        icon: ShieldMinus,
        onSelect: () =>
          void run(() => setGroupRole(chat.id, u.id, 'member'), `${name} is no longer an admin`),
      });
    if (canTransferGroupOwnership(chat, u))
      admin.push({
        label: `Make ${first} the group owner`,
        icon: Crown,
        onSelect: () => {
          void confirm({
            title: `Transfer ownership to ${name}?`,
            message: `${name} will become the owner of “${chat.name}”. You'll stay in the group as an admin.`,
            confirmLabel: 'Transfer',
          }).then((ok) => {
            if (ok)
              void run(
                () => transferGroupOwnership(chat.id, u.id),
                `${name} is now the group owner`,
              );
          });
        },
      });
    if (p.canRemoveMembers && member.role !== 'owner')
      admin.push({
        label: `Remove ${first}`,
        icon: UserMinus,
        danger: true,
        onSelect: () => {
          void confirm({
            title: `Remove ${name} from “${chat.name}”?`,
            confirmLabel: 'Remove',
            danger: true,
          }).then((ok) => {
            if (ok) void run(() => removeGroupMember(chat.id, u.id), `${name} was removed`);
          });
        },
      });
    if (admin.length) items.push('separator', ...admin);
  }

  const element = (
    <>
      <Menu
        open={!!state}
        anchor={state?.anchor ?? null}
        onClose={close}
        items={items}
        align="end"
        aria-label="Member options"
      />
      <UserProfileModal userId={profile} onClose={() => setProfile(null)} />
    </>
  );
  return { open, element };
}

export function MembersView({
  chat,
  members,
  error,
  onBack,
  onChanged,
  header,
}: {
  chat: ChatSummary;
  members: ChatMember[] | null;
  error: string | null;
  onBack: () => void;
  onChanged: () => void;
  header?: ReactNode;
}) {
  const [query, setQuery] = useState('');
  const meId = getMyId();
  const menu = useGroupMemberMenu(chat, onChanged);
  const list = useMemo(
    () => sortMembers(members ?? [], meId).filter((m) => matchesUser(m.user, query)),
    [members, meId, query],
  );
  return (
    <div className="flex min-h-full flex-col bg-surface">
      <PaneHeader
        title="Members"
        subtitle={`${chat.memberCount} ${chat.memberCount === 1 ? 'member' : 'members'}`}
        back={onBack}
        border
      >
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search members"
          aria-label="Search members"
          autoFocus
        />
      </PaneHeader>
      {header}
      {members === null && !error ? (
        <ListItemSkeleton count={6} />
      ) : error ? (
        <EmptyState compact icon={Users} title="Couldn't load members" description={error} />
      ) : list.length ? (
        <ul aria-label="Members">
          {list.map((m) => (
            <li key={m.user.id}>
              <MemberRow member={m} meId={meId} onClick={(a) => menu.open(m, a)} />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          compact
          icon={Users}
          title="No matches"
          description={`No one matches “${query}”.`}
        />
      )}
      {menu.element}
    </div>
  );
}
