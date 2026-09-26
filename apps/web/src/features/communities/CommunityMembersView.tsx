/**
 * Community members (owner/admins only): search, add members (privacy-aware result), roles,
 * remove, transfer ownership. Refreshes on `chat:members-changed` of the announcement group
 * (sent to its admins) and when the member count changes.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Crown,
  Info,
  MessageCircle,
  ShieldCheck,
  ShieldMinus,
  UserMinus,
  UserPlus,
  Users,
} from 'lucide-react';
import {
  userDisplayName,
  type Community,
  type CommunityAddMembersResult,
  type CommunityMember,
  type ID,
  type UserPublic,
} from '@enbox/shared';
import { ICON_STROKE_ON_FILL } from '@/components/icons';
import { PaneHeader } from '@/components/layout/PaneHeader';
import {
  Button,
  EmptyState,
  ListItemSkeleton,
  Menu,
  SearchInput,
  confirm,
  toast,
  type MenuAnchor,
  type MenuEntry,
} from '@/components/ui';
import { MemberRow } from '@/features/groups/GroupMembers';
import { sortMembers } from '@/features/groups/members';
import { AddResultModal, hasProblems } from '@/features/groups/shared/AddResultModal';
import { matchesUser } from '@/features/groups/shared/candidates';
import { openDirectChat } from '@/features/groups/shared/chatActions';
import { afterPaint } from '@/features/groups/shared/share';
import { UserPicker } from '@/features/groups/shared/UserPicker';
import { UserProfileModal } from '@/features/groups/shared/UserProfileModal';
import { useBus } from '@/hooks/useBus';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { errorMessage } from '@/lib/api';
import { getMyId } from '@/stores/auth';
import { useCommunities } from '@/stores/communities';

export function CommunityMembersView({
  community: c,
  onClose,
}: {
  community: Community;
  onClose: () => void;
}) {
  const desktop = useIsDesktop();
  const navigate = useNavigate();
  const [members, setMembers] = useState<CommunityMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [menu, setMenu] = useState<{ member: CommunityMember; anchor: MenuAnchor } | null>(null);
  const [profile, setProfile] = useState<ID | null>(null);
  const ctrl = useRef<AbortController | null>(null);
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
      .catch((e: unknown) => !a.signal.aborted && setError(errorMessage(e)));
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

  const run = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      toast.success(done);
      reload();
    } catch (e) {
      toast.error(e);
    }
  };

  const items: MenuEntry[] = [];
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
            .then((chat) => navigate(`/chats/${chat.id}`))
            .catch((e: unknown) => toast.error(e)),
      },
      { label: `View ${first}`, icon: Info, onSelect: () => setProfile(u.id) },
    );
    const admin: MenuEntry[] = [];
    if (role === 'member')
      admin.push({
        label: 'Make community admin',
        icon: ShieldCheck,
        onSelect: () =>
          void run(() => store().setRole(c.id, u.id, 'admin'), `${name} is now an admin`),
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
              void run(
                () => store().transferOwnership(c.id, u.id),
                `${name} now owns the community`,
              );
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
    <div className="flex min-h-full flex-col bg-surface">
      <PaneHeader
        title="Members"
        subtitle={`${c.memberCount} ${c.memberCount === 1 ? 'member' : 'members'}`}
        back={onClose}
        backIcon={desktop ? 'close' : 'arrow'}
        border
      >
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search members"
          aria-label="Search members"
        />
      </PaneHeader>
      {!query ? (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex w-full items-center gap-3 px-5 py-2.5 text-left hover:bg-hover"
        >
          <span className="flex size-10 items-center justify-center rounded-full bg-brand text-on-brand">
            <UserPlus size={20} strokeWidth={ICON_STROKE_ON_FILL} aria-hidden />
          </span>
          <span className="text-[15.5px] font-medium text-fg">Add members</span>
        </button>
      ) : null}
      {members === null && !error ? (
        <ListItemSkeleton count={6} />
      ) : error ? (
        <EmptyState compact icon={Users} title="Couldn't load members" description={error} />
      ) : list.length ? (
        <ul aria-label="Members">
          {list.map((m) => (
            <li key={m.user.id}>
              <MemberRow
                member={m}
                meId={meId}
                kind="community"
                onClick={(anchor) => afterPaint(() => setMenu({ member: m, anchor }))}
              />
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
      <Menu
        open={!!menu}
        anchor={menu?.anchor ?? null}
        onClose={() => setMenu(null)}
        items={items}
        align="end"
        aria-label="Member options"
      />
      <UserProfileModal userId={profile} onClose={() => setProfile(null)} />
    </div>
  );
}

function AddCommunityMembers({
  community: c,
  members,
  onBack,
  onDone,
}: {
  community: Community;
  members: CommunityMember[] | null;
  onBack: () => void;
  onDone: () => void;
}) {
  const [selected, setSelected] = useState<UserPublic[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CommunityAddMembersResult | null>(null);
  const disabled = useMemo(
    () => new Map((members ?? []).map((m) => [m.user.id, 'Already in the community'] as const)),
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
    <div className="relative flex h-full min-h-full flex-col bg-surface">
      <PaneHeader
        title="Add members"
        subtitle={selected.length ? `${selected.length} selected` : c.name}
        back={onBack}
        border
      />
      <UserPicker
        selected={selected}
        onToggle={(u) =>
          setSelected((l) =>
            l.some((x) => x.id === u.id) ? l.filter((x) => x.id !== u.id) : [...l, u],
          )
        }
        query={query}
        onQueryChange={setQuery}
        disabled={disabled}
        autoFocus
      />
      {selected.length ? (
        <div className="absolute inset-x-0 bottom-0 border-t border-line bg-surface px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">
          <Button fullWidth size="lg" loading={busy} onClick={() => void add()} leftIcon={UserPlus}>
            Add{' '}
            {selected.length === 1
              ? userDisplayName(selected[0]).split(' ')[0]
              : `${selected.length} people`}
          </Button>
        </div>
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
    </div>
  );
}
