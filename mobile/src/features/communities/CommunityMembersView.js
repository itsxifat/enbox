/**
 * Community members (web CommunityMembersView.tsx; owner/admins only): search, add members
 * (privacy-aware result), roles, remove, transfer ownership.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Crown,
  Info,
  MessageCircle,
  ShieldCheck,
  ShieldMinus,
  UserMinus,
  UserPlus,
  Users,
} from 'lucide-react-native';
import { userDisplayName } from '@enbox/shared';
import { ICON_STROKE_ON_FILL, Icon } from '@/components/icons';
import { PaneHeader } from '@/components/layout/PaneHeader';
import {
  Button,
  EmptyState,
  ListItemSkeleton,
  Menu,
  Press,
  SearchInput,
  T,
  confirm,
  toast,
} from '@/components/ui';
import { MemberRow } from '@/features/groups/GroupMembers';
import { sortMembers } from '@/features/groups/members';
import { AddResultModal, hasProblems } from '@/features/groups/shared/AddResultModal';
import { matchesUser } from '@/features/groups/shared/candidates';
import { openDirectChat } from '@/features/groups/shared/chatActions';
import { UserPicker } from '@/features/groups/shared/UserPicker';
import { openProfile } from '@/features/profile/open';
import { useBus } from '@/hooks/useBus';
import { errorMessage } from '@/lib/api';
import { getMyId } from '@/stores/auth';
import { useCommunities } from '@/stores/communities';
import { useTheme } from '@/theme';

export function CommunityMembersView({ community: c, onClose }) {
  const { tw, c: col } = useTheme();
  const router = useRouter();
  const [members, setMembers] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [menu, setMenu] = useState(null);
  const ctrl = useRef(null);
  const meId = getMyId();
  const store = useCommunities.getState;

  const reload = useCallback(() => {
    ctrl.current?.abort();
    const a = new AbortController();
    ctrl.current = a;
    store()
      .fetchMembers(c.id, a.signal)
      .then((list) => {
        if (a.signal.aborted) return;
        setMembers(list);
        setError(null);
      })
      .catch((e) => !a.signal.aborted && setError(errorMessage(e)));
  }, [c.id, store]);

  useEffect(() => {
    reload();
    return () => ctrl.current?.abort();
  }, [reload, c.memberCount]);
  useBus('chat:members-changed', ({ chatId }) => {
    if (chatId === c.announcementChatId) reload();
  });

  const list = useMemo(
    () => sortMembers(members ?? [], meId).filter((m) => matchesUser(m.user, query)),
    [members, meId, query],
  );

  const run = async (fn, done) => {
    try {
      await fn();
      toast.success(done);
      reload();
    } catch (e) {
      toast.error(e);
    }
  };

  const items = [];
  if (menu) {
    const u = menu.member.user;
    const name = userDisplayName(u);
    const first = name.split(' ')[0];
    const role = menu.member.role;
    items.push(
      !u.isDeleted && {
        label: `Message ${first}`,
        icon: MessageCircle,
        onSelect: () =>
          void openDirectChat(u.id)
            .then((chat) => router.push(`/chats/${chat.id}`))
            .catch((e) => toast.error(e)),
      },
      { label: `View ${first}`, icon: Info, onSelect: () => openProfile(u.id) },
    );
    const admin = [];
    if (role === 'member')
      admin.push({
        label: 'Make community admin',
        icon: ShieldCheck,
        onSelect: () => void run(() => store().setRole(c.id, u.id, 'admin'), `${name} is now an admin`),
      });
    if (role === 'admin')
      admin.push({
        label: 'Dismiss as admin',
        icon: ShieldMinus,
        onSelect: () =>
          void run(() => store().setRole(c.id, u.id, 'member'), `${name} is no longer an admin`),
      });
    if (c.myRole === 'owner' && !u.isDeleted)
      admin.push({
        label: `Make ${first} the owner`,
        icon: Crown,
        onSelect: () =>
          void confirm({
            title: `Transfer ownership to ${name}?`,
            message: `${name} will own “${c.name}”. You'll stay on as an admin.`,
            confirmLabel: 'Transfer',
          }).then((ok) => {
            if (ok)
              void run(() => store().transferOwnership(c.id, u.id), `${name} now owns the community`);
          }),
      });
    if (role !== 'owner')
      admin.push({
        label: `Remove ${first}`,
        icon: UserMinus,
        danger: true,
        onSelect: () =>
          void confirm({
            title: `Remove ${name} from “${c.name}”?`,
            message: 'They will also be removed from every group in the community.',
            confirmLabel: 'Remove',
            danger: true,
          }).then((ok) => {
            if (ok) void run(() => store().removeMember(c.id, u.id), `${name} was removed`);
          }),
      });
    if (admin.length) items.push('separator', ...admin);
  }

  if (adding)
    return (
      <AddCommunityMembers
        community={c}
        members={members}
        onBack={() => setAdding(false)}
        onDone={() => {
          setAdding(false);
          reload();
        }}
      />
    );

  return (
    <View style={tw`flex-1 bg-surface`}>
      <PaneHeader
        title="Members"
        subtitle={`${c.memberCount} ${c.memberCount === 1 ? 'member' : 'members'}`}
        back={onClose}
      >
        <SearchInput value={query} onChange={setQuery} placeholder="Search members" />
      </PaneHeader>
      {!query ? (
        <Press onPress={() => setAdding(true)} style={tw`flex-row items-center gap-3 px-5 py-2.5`}>
          <View style={tw`size-10 items-center justify-center rounded-full bg-brand`}>
            <Icon icon={UserPlus} size={20} strokeWidth={ICON_STROKE_ON_FILL} color={col['on-brand']} />
          </View>
          <T style={tw`text-[15.5px] font-medium`}>Add members</T>
        </Press>
      ) : null}
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
            <MemberRow
              member={m}
              meId={meId}
              kind="community"
              onPress={(anchor) => setMenu({ member: m, anchor })}
            />
          )}
        />
      ) : (
        <EmptyState compact icon={Users} title="No matches" description={`No one matches “${query}”.`} />
      )}
      <Menu
        open={!!menu}
        anchor={menu?.anchor ?? null}
        onClose={() => setMenu(null)}
        items={items}
        align="end"
      />
    </View>
  );
}

function AddCommunityMembers({ community: c, members, onBack, onDone }) {
  const { tw, shadow } = useTheme();
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const disabled = useMemo(
    () => new Map((members ?? []).map((m) => [m.user.id, 'Already in the community'])),
    [members],
  );
  const add = async () => {
    setBusy(true);
    try {
      const r = await useCommunities.getState().addMembers(
        c.id,
        selected.map((u) => u.id),
      );
      if (r.added.length)
        toast.success(r.added.length === 1 ? 'Member added' : `${r.added.length} members added`);
      if (hasProblems(r)) setResult(r);
      else onDone();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={tw`flex-1 bg-surface`}>
      <PaneHeader
        title="Add members"
        subtitle={selected.length ? `${selected.length} selected` : c.name}
        back={onBack}
      />
      <UserPicker
        selected={selected}
        onToggle={(u) =>
          setSelected((l) => (l.some((x) => x.id === u.id) ? l.filter((x) => x.id !== u.id) : [...l, u]))
        }
        query={query}
        onQueryChange={setQuery}
        disabled={disabled}
      />
      {selected.length ? (
        <View
          style={[
            tw`absolute inset-x-3 rounded-xl bg-surface-2 px-4 py-3`,
            { bottom: Math.max(12, insets.bottom) },
            shadow.elevated,
          ]}
        >
          <Button fullWidth size="lg" loading={busy} onPress={() => void add()} leftIcon={UserPlus}>
            {`Add ${
              selected.length === 1
                ? userDisplayName(selected[0]).split(' ')[0]
                : `${selected.length} people`
            }`}
          </Button>
        </View>
      ) : null}
      <AddResultModal
        result={result}
        name={c.name}
        kind="community"
        inviteCode={result?.community.inviteCode ?? c.inviteCode}
        onClose={() => {
          setResult(null);
          onDone();
        }}
      />
    </View>
  );
}
