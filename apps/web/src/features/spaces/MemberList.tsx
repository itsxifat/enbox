import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { Crown, Shield } from 'lucide-react';
import {
  PERM,
  hasPerm,
  userDisplayName,
  type ID,
  type Space,
  type SpaceMember,
  type SpaceMemberPage,
} from '@enbox/shared';
import { Nameplate, StyledName } from '@/components/cosmetics';
import { Avatar, Menu, SearchInput, Spinner, type MenuAnchor } from '@/components/ui';
import { openProfile } from '@/features/profile/open';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { subscribeSpaceMembers } from '@/realtime/spaces';
import { usePresence, useUser, useUsers } from '@/stores/users';
import { roleNameStyle, topColoredRole, topIconRole, useSpace, useSpaces } from '@/stores/spaces';
import { MemberActionsMenu } from './MemberActions';
import { RoleIcon } from './RoleIcon';
import { withSpaceProfile } from './serverProfile/merge';

type Row =
  | { kind: 'header'; key: string; label: string; count: number }
  | { kind: 'member'; key: string; member: SpaceMember };

export function MemberRow({ space, member, onMenu }: { space: Space; member: SpaceMember; onMenu: (m: SpaceMember, a: MenuAnchor) => void }) {
  const user = useUser(member.userId);
  const presence = usePresence(member.userId);
  const role = topColoredRole(space, member.roleIds);
  const iconRole = topIconRole(space, member.roleIds);
  const name = member.nickname || userDisplayName(user);
  // The per-Space profile (avatar, decoration, nameplate) wins over the main one.
  const shown = user ? withSpaceProfile(user, member, member.nickname) : null;
  const offline = !presence?.online;
  return (
    <button
      type="button"
      onClick={(e) => openProfile(member.userId, e.currentTarget, { spaceId: space.id })}
      onContextMenu={(e: MouseEvent) => {
        e.preventDefault();
        onMenu(member, { x: e.clientX, y: e.clientY });
      }}
      className={cn(
        'group/m relative flex h-11 w-full items-center gap-3 rounded-lg px-2 text-left transition-colors hover:bg-hover',
        offline && 'opacity-60 hover:opacity-100',
      )}
      data-testid="space-member-row"
      data-animate-avatars
    >
      {/* Behind the row's content, which is positioned (relative) to paint over it. */}
      <Nameplate id={shown?.nameplate} />
      <Avatar
        src={shown?.avatarUrl}
        animatedSrc={shown?.avatarAnimatedUrl}
        name={name}
        colorSeed={member.userId}
        size={32}
        presence={presence?.state ?? null}
        decoration={shown?.avatarDecoration}
        decorative
      />
      <span className="relative flex min-w-0 flex-1 items-center gap-1 text-[15px] font-medium">
        <StyledName name={name} style={user?.nameStyle} role={role ? roleNameStyle(role) : null} mode="full" className="truncate" />
        <RoleIcon role={iconRole} size={16} />
      </span>
      {space.ownerId === member.userId ? <Crown size={14} className="relative shrink-0 text-warning" aria-label="Owner" /> : null}
      {member.timedOutUntil ? <Shield size={14} className="relative shrink-0 text-danger" aria-label="Timed out" /> : null}
    </button>
  );
}

/**
 * Member list of a Space. Paged by display name (keyset; `GET /spaces/:id/members`), grouped by
 * hoisted roles. Presence is subscribed for the rendered rows only (usePresence per row), so
 * a 250k-member Space costs what is on screen.
 */
export function MemberList({ spaceId, inSheet = false }: { spaceId: ID; inSheet?: boolean }) {
  const space = useSpace(spaceId);
  const [query, setQuery] = useState('');
  const q = useDebouncedValue(query.trim(), 250);
  const [members, setMembers] = useState<SpaceMember[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<{ member: SpaceMember; anchor: MenuAnchor } | null>(null);
  const seq = useRef(0);
  const cached = useSpaces((s) => s.members[spaceId]);

  const load = useCallback(
    async (reset: boolean) => {
      const mine = ++seq.current;
      setBusy(true);
      try {
        const page = await api.get<SpaceMemberPage>(`/api/spaces/${spaceId}/members`, {
          query: { limit: 100, q: q || undefined, after: reset ? undefined : (cursor ?? undefined) },
        });
        if (mine !== seq.current) return;
        useSpaces.getState().upsertMembers(spaceId, page.members);
        void useUsers
          .getState()
          .fetchUsers(page.members.map((m) => m.userId))
          .catch(() => undefined);
        setMembers((cur) => (reset ? page.members : [...cur, ...page.members]));
        setCursor(page.nextCursor);
        setDone(!page.nextCursor);
      } catch {
        if (mine === seq.current) setDone(true);
      } finally {
        if (mine === seq.current) setBusy(false);
      }
    },
    [spaceId, q, cursor],
  );

  // New Space or search: start over.
  useEffect(() => {
    setMembers([]);
    setCursor(null);
    setDone(false);
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId, q]);

  useEffect(() => {
    subscribeSpaceMembers(spaceId);
    return () => subscribeSpaceMembers(null);
  }, [spaceId]);

  // Live updates (role changes, nicknames, joins/leaves) through the members cache.
  const live = useMemo(() => {
    if (!cached) return members;
    const out = members.filter((m) => cached[m.userId]).map((m) => cached[m.userId] ?? m);
    if (!q && done) for (const m of Object.values(cached)) if (!out.some((x) => x.userId === m.userId)) out.push(m);
    return out;
  }, [members, cached, q, done]);

  const rows = useMemo<Row[]>(() => {
    if (!space) return [];
    const hoisted = space.roles.filter((r) => r.hoist && !r.isDefault).sort((a, b) => b.position - a.position);
    const groups = new Map<ID, SpaceMember[]>();
    const rest: SpaceMember[] = [];
    for (const m of live) {
      const top = hoisted.find((r) => m.roleIds.includes(r.id));
      if (top) groups.set(top.id, [...(groups.get(top.id) ?? []), m]);
      else rest.push(m);
    }
    const out: Row[] = [];
    for (const r of hoisted) {
      const list = groups.get(r.id);
      if (!list?.length) continue;
      out.push({ kind: 'header', key: `h-${r.id}`, label: r.name, count: list.length });
      for (const m of list) out.push({ kind: 'member', key: m.userId, member: m });
    }
    if (rest.length) {
      out.push({ kind: 'header', key: 'h-members', label: 'Members', count: rest.length });
      for (const m of rest) out.push({ kind: 'member', key: m.userId, member: m });
    }
    return out;
  }, [live, space]);

  if (!space) return null;
  const canModerate = [PERM.KICK_MEMBERS, PERM.BAN_MEMBERS, PERM.MANAGE_ROLES, PERM.MODERATE_MEMBERS, PERM.MANAGE_NICKNAMES].some((p) =>
    hasPerm(space.myPermissions, p),
  );

  return (
    <aside
      aria-label="Members"
      className={cn('flex min-h-0 flex-col', inSheet ? 'h-[80dvh]' : 'card-pane w-[260px] shrink-0')}
      data-testid="space-member-list"
    >
      <div className="px-3 pt-3 pb-2">
        <SearchInput value={query} onChange={setQuery} placeholder={`Search ${space.memberCount.toLocaleString()} members`} aria-label="Search members" />
      </div>
      <div className="min-h-0 flex-1 px-1.5">
        <Virtuoso
          data={rows}
          computeItemKey={(_, r) => r.key}
          endReached={() => {
            if (!done && !busy) void load(false);
          }}
          itemContent={(_, r) =>
            r.kind === 'header' ? (
              <div className="px-2 pt-4 pb-1 text-[12px] font-bold tracking-wide text-muted uppercase">
                {r.label} — {r.count}
              </div>
            ) : (
              <MemberRow space={space} member={r.member} onMenu={(member, anchor) => setMenu({ member, anchor })} />
            )
          }
          components={{
            Footer: () => (busy ? <div className="flex justify-center py-3"><Spinner size={20} /></div> : null),
          }}
        />
      </div>
      {menu && canModerate ? (
        <MemberActionsMenu space={space} member={menu.member} anchor={menu.anchor} onClose={() => setMenu(null)} />
      ) : (
        <Menu open={false} onClose={() => setMenu(null)} anchor={null} items={[]} />
      )}
    </aside>
  );
}
