import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { Crown, Shield, Volume2 } from 'lucide-react';
import {
  PERM,
  activePresenceNote,
  hasPerm,
  userDisplayName,
  type ID,
  type Presence,
  type Space,
  type SpaceMember,
  type SpaceMemberPage,
} from '@enbox/shared';
import { Nameplate, StyledName } from '@/components/cosmetics';
import { ServerTagPill } from '@/components/cosmetics/TagPill/ServerTagPill';
import { Avatar, Menu, SearchInput, Spinner, type MenuAnchor } from '@/components/ui';
import { selfPresenceState } from '@/features/profile/model';
import { openProfile } from '@/features/profile/open';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { sessionEpoch } from '@/lib/session';
import { subscribeSpaceMembers } from '@/realtime/spaces';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { usePresence, useUser, useUsers } from '@/stores/users';
import { roleNameStyle, topColoredRole, topIconRole, useSpace, useSpaces } from '@/stores/spaces';
import { useVoice } from '@/stores/voice';
import { MemberActionsMenu } from './MemberActions';
import { openUserMenu } from '@/features/users/userMenu';
import { RoleIcon } from './RoleIcon';
import { withSpaceProfile } from './serverProfile/merge';

export type MemberListRow =
  | { kind: 'header'; key: string; label: string; count: number }
  | { kind: 'member'; key: string; member: SpaceMember };

/**
 * The member list's rows. `split` (a Space up to LARGE_SPACE_THRESHOLD, every member loaded):
 * online members under their highest hoisted role, the other online ones under "Online", then
 * everyone offline under "Offline". A large Space is paged by name with the rest unknown: its
 * hoisted roles and "Members", online or not.
 */
export function memberRows(
  space: Pick<Space, 'roles'>,
  members: readonly SpaceMember[],
  isOnline: (userId: ID) => boolean,
  split: boolean,
): MemberListRow[] {
  const hoisted = space.roles.filter((r) => r.hoist && !r.isDefault).sort((a, b) => b.position - a.position);
  const groups = new Map<ID, SpaceMember[]>();
  const rest: SpaceMember[] = [];
  const offline: SpaceMember[] = [];
  for (const m of members) {
    if (split && !isOnline(m.userId)) {
      offline.push(m);
      continue;
    }
    const top = hoisted.find((r) => m.roleIds.includes(r.id));
    if (!top) rest.push(m);
    else if (groups.has(top.id)) groups.get(top.id)!.push(m);
    else groups.set(top.id, [m]);
  }
  const out: MemberListRow[] = [];
  const section = (key: string, label: string, list: readonly SpaceMember[] | undefined) => {
    if (!list?.length) return;
    out.push({ kind: 'header', key: `h-${key}`, label, count: list.length });
    for (const m of list) out.push({ kind: 'member', key: m.userId, member: m });
  };
  for (const r of hoisted) section(r.id, r.name, groups.get(r.id));
  section('members', split ? 'Online' : 'Members', rest);
  section('offline', 'Offline', offline);
  return out;
}

/** Fresh presence for people already cached: theirs may be from long ago (the Online / Offline split). */
function refreshPresence(userIds: ID[]): void {
  const epoch = sessionEpoch();
  void api
    .post<Presence[]>('/api/users/presence', { userIds })
    .then((list) => {
      if (epoch !== sessionEpoch()) return;
      const { setPresence } = useUsers.getState();
      for (const p of list) setPresence(p);
    })
    .catch(() => undefined);
}

/** The voice channel of this Space someone is in (its name), and whether they stream there. */
function useVoiceIn(spaceId: ID, userId: ID): { channel: string; streaming: boolean } | null {
  const state = useVoice((s) => (s.byUser[userId]?.spaceId === spaceId ? s.byUser[userId] : undefined));
  const channel = useChats((s) => (state ? (s.byId[state.channelId]?.name ?? null) : null));
  return state && channel ? { channel, streaming: state.selfStream } : null;
}

/**
 * A member: avatar with presence, name in the role style, and a status line under it — the
 * voice channel they're in, else their custom status (none while offline).
 */
export function MemberRow({ space, member, onMenu }: { space: Space; member: SpaceMember; onMenu: (m: SpaceMember, a: MenuAnchor) => void }) {
  const user = useUser(member.userId);
  const presence = usePresence(member.userId);
  const voice = useVoiceIn(space.id, member.userId);
  const role = topColoredRole(space, member.roleIds);
  const iconRole = topIconRole(space, member.roleIds);
  const name = member.nickname || userDisplayName(user);
  // The per-Space profile (avatar, decoration, nameplate) wins over the main one.
  const shown = user ? withSpaceProfile(user, member, member.nickname) : null;
  const offline = !presence?.online;
  const note = offline ? null : activePresenceNote(presence?.note);
  const status = voice
    ? `${voice.streaming ? 'Streaming in' : 'In'} ${voice.channel}`
    : note
      ? [note.emoji, note.text].filter(Boolean).join(' ')
      : null;
  return (
    <button
      type="button"
      onClick={(e) => openProfile(member.userId, e.currentTarget, { spaceId: space.id })}
      onContextMenu={(e: MouseEvent) => {
        e.preventDefault();
        const at = { x: e.clientX, y: e.clientY };
        if (!openUserMenu(member.userId, at, { spaceId: space.id })) onMenu(member, at);
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
      <span className="relative flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-1 text-[15px] leading-5 font-medium">
          <StyledName name={name} style={user?.nameStyle} role={role ? roleNameStyle(role) : null} mode="full" className="truncate" />
          <RoleIcon role={iconRole} size={16} />
          <ServerTagPill userId={member.userId} tag={user?.spaceTag ?? null} />
        </span>
        {status ? (
          <span className="flex min-w-0 items-center gap-1 text-[12px] leading-4 text-muted" data-testid="member-status">
            {voice ? <Volume2 size={12} className="shrink-0" aria-hidden /> : null}
            <span className="truncate">{status}</span>
          </span>
        ) : null}
      </span>
      {space.ownerId === member.userId ? <Crown size={14} className="relative shrink-0 text-warning" aria-label="Owner" /> : null}
      {member.timedOutUntil ? <Shield size={14} className="relative shrink-0 text-danger" aria-label="Timed out" /> : null}
    </button>
  );
}

/**
 * Member list of a Space. Paged by display name (keyset; `GET /spaces/:id/members`). Up to
 * LARGE_SPACE_THRESHOLD members every page loads, and the list splits into the hoisted roles,
 * Online and Offline (presence as loaded; rows on screen subscribe and stay live). A large
 * Space pages as it scrolls and keeps the hoisted roles and "Members", offline rows dimmed.
 * Presence is subscribed for the rendered rows only (usePresence per row), so a 250k-member
 * Space costs what is on screen.
 */
export function MemberList({ spaceId, inSheet = false }: { spaceId: ID; inSheet?: boolean }) {
  const space = useSpace(spaceId);
  const split = !!space && !space.large;
  const [query, setQuery] = useState('');
  const q = useDebouncedValue(query.trim(), 250);
  const [members, setMembers] = useState<SpaceMember[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<{ member: SpaceMember; anchor: MenuAnchor } | null>(null);
  const seq = useRef(0);
  const cached = useSpaces((s) => s.members[spaceId]);
  const me = useAuth((s) => s.user);

  /** Load from `after` (null: start over); a small Space goes on until every page is in. */
  const load = useCallback(
    async (after: string | null) => {
      const mine = ++seq.current;
      setBusy(true);
      let from = after;
      try {
        do {
          const page = await api.get<SpaceMemberPage>(`/api/spaces/${spaceId}/members`, {
            query: { limit: 100, q: q || undefined, after: from ?? undefined },
          });
          if (mine !== seq.current) return;
          const ids = page.members.map((m) => m.userId);
          const known = ids.filter((id) => useUsers.getState().byId[id]);
          useSpaces.getState().upsertMembers(spaceId, page.members);
          void useUsers
            .getState()
            .fetchUsers(ids)
            .catch(() => undefined);
          if (split && known.length) refreshPresence(known);
          const appended = from !== null;
          setMembers((cur) => (appended ? [...cur, ...page.members] : page.members));
          from = page.nextCursor;
          setCursor(from);
          setDone(!from);
        } while (split && from);
      } catch {
        if (mine === seq.current) setDone(true);
      } finally {
        if (mine === seq.current) setBusy(false);
      }
    },
    [spaceId, q, split],
  );

  // New Space or search: start over (the pages still coming for the old one are dropped).
  useEffect(() => {
    setMembers([]);
    setCursor(null);
    setDone(false);
    void load(null);
    const runs = seq;
    return () => {
      runs.current++;
    };
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
    if (!q && done) {
      const listed = new Set(out.map((m) => m.userId));
      for (const m of Object.values(cached)) if (!listed.has(m.userId)) out.push(m);
    }
    return out;
  }, [members, cached, q, done]);

  // Who is online, as one string: the rows regroup only when that changes. I count as online
  // unless I'm invisible.
  const meOnline = !!me && selfPresenceState(me) !== 'offline';
  const onlineKey = useUsers((s) =>
    split
      ? live
          .filter((m) => (m.userId === me?.id ? meOnline : !!s.presence[m.userId]?.online))
          .map((m) => m.userId)
          .join(',')
      : '',
  );

  const rows = useMemo<MemberListRow[]>(() => {
    if (!space) return [];
    const online = new Set(onlineKey.split(','));
    return memberRows(space, live, (id) => online.has(id), split);
  }, [live, space, onlineKey, split]);

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
            if (!done && !busy) void load(cursor);
          }}
          itemContent={(_, r) =>
            r.kind === 'header' ? (
              <div className="px-2 pt-4 pb-1 text-[12px] font-bold tracking-wide text-muted uppercase" data-testid="member-group">
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
