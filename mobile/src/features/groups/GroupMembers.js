/** Group member rows, the per-member action menu and the full "Members" page (web GroupMembers.tsx). */
import { useCallback, useMemo, useRef, useState } from 'react';
import { FlatList, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Crown,
  Info,
  MessageCircle,
  ShieldCheck,
  ShieldMinus,
  UserMinus,
  Users,
} from 'lucide-react-native';
import { userDisplayName } from '@enbox/shared';
import { UserAvatar } from '@/components/common/avatars';
import { PaneHeader } from '@/components/layout/PaneHeader';
import {
  EmptyState,
  ListItemSkeleton,
  Menu,
  Press,
  SearchInput,
  T,
  confirm,
  measureAnchor,
  toast,
} from '@/components/ui';
import { openProfile } from '@/features/profile/open';
import { getMyId } from '@/stores/auth';
import { useTheme } from '@/theme';
import { canTransferGroupOwnership, roleLabel, sortMembers } from './members';
import { matchesUser } from './shared/candidates';
import {
  openDirectChat,
  removeGroupMember,
  setGroupRole,
  transferGroupOwnership,
} from './shared/chatActions';
import { RolePill } from './shared/InfoLayout';

export function MemberRow({ member, meId, kind = 'group', onPress, trailing }) {
  const { tw } = useTheme();
  const ref = useRef(null);
  const me = member.user.id === meId;
  const name = me ? 'You' : userDisplayName(member.user);
  const role = roleLabel(member.role, kind);
  const body = (
    <>
      <UserAvatar user={member.user} size="md" />
      <View style={tw`min-w-0 flex-1`}>
        <T numberOfLines={1} style={tw`text-[15.5px] font-medium`}>
          {name}
        </T>
        <T numberOfLines={1} style={tw`text-[13px] text-muted`}>
          {member.user.about || `@${member.user.username}`}
        </T>
      </View>
      {role ? <RolePill>{role}</RolePill> : null}
      {trailing}
    </>
  );
  const style = tw`flex-row items-center gap-3 px-5 py-2.5`;
  if (!onPress || me) return <View style={style}>{body}</View>;
  return (
    <Press
      ref={ref}
      style={style}
      onPress={async () => onPress((await measureAnchor(ref)) ?? { x: 0, y: 0 })}
    >
      {body}
    </Press>
  );
}

/** Tap a member → message / view / admin actions (per `chat.permissions`). */
export function useGroupMemberMenu(chat, onChanged) {
  const router = useRouter();
  const [state, setState] = useState(null);
  const close = useCallback(() => setState(null), []);
  const open = useCallback((member, anchor) => setState({ member, anchor }), []);

  const run = async (fn, done) => {
    try {
      await fn();
      toast.success(done);
      onChanged();
    } catch (e) {
      toast.error(e);
    }
  };

  const items = [];
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
            .then((c) => router.push(`/chats/${c.id}`))
            .catch((e) => toast.error(e));
        },
      },
      { label: `View ${first}`, icon: Info, onSelect: () => openProfile(u.id) },
    );
    const admin = [];
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
    <Menu open={!!state} anchor={state?.anchor ?? null} onClose={close} items={items} align="end" />
  );
  return { open, element };
}

export function MembersView({ chat, members, error, onBack, onChanged, header }) {
  const { tw } = useTheme();
  const [query, setQuery] = useState('');
  const meId = getMyId();
  const menu = useGroupMemberMenu(chat, onChanged);
  const list = useMemo(
    () => sortMembers(members ?? [], meId).filter((m) => matchesUser(m.user, query)),
    [members, meId, query],
  );
  return (
    <View style={tw`flex-1 bg-surface`}>
      <PaneHeader
        title="Members"
        subtitle={`${chat.memberCount} ${chat.memberCount === 1 ? 'member' : 'members'}`}
        back={onBack}
      >
        <SearchInput value={query} onChange={setQuery} placeholder="Search members" />
      </PaneHeader>
      {header}
      {members === null && !error ? (
        <ListItemSkeleton count={6} />
      ) : error ? (
        <EmptyState compact icon={Users} title="Couldn't load members" description={error} />
      ) : list.length ? (
        <FlatList
          data={list}
          keyExtractor={(m) => m.user.id}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item: m }) => (
            <MemberRow member={m} meId={meId} onPress={(a) => menu.open(m, a)} />
          )}
        />
      ) : (
        <EmptyState
          compact
          icon={Users}
          title="No matches"
          description={`No one matches “${query}”.`}
        />
      )}
      {menu.element}
    </View>
  );
}
