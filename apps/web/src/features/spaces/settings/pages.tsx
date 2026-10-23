import { useCallback, useEffect, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import {
  userDisplayName,
  type Space,
  type SpaceAuditEntry,
  type SpaceBan,
  type SpaceInvite,
  type SpaceMember,
  type SpaceMemberPage,
} from '@enbox/shared';
import { Avatar, Button, EmptyState, IconButton, SearchInput, Spinner, toast, type MenuAnchor } from '@/components/ui';
import { inviteUrl } from '@/features/groups/shared/share';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { api } from '@/lib/api';
import { useSpaces } from '@/stores/spaces';
import { useUser, useUsers } from '@/stores/users';
import { revokeInvite, unbanMember } from '../actions';
import { MemberActionsMenu } from '../MemberActions';

function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    setError(null);
    load()
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => reload(), [reload]);
  return { data, error, reload, setData };
}

function UserCell({ userId, nickname }: { userId: string; nickname?: string | null }) {
  const user = useUser(userId);
  const name = nickname || userDisplayName(user);
  return (
    <span className="flex min-w-0 items-center gap-3">
      <Avatar src={user?.avatarUrl} name={name} colorSeed={userId} size={32} decorative />
      <span className="min-w-0">
        <span className="block truncate font-medium">{name}</span>
        {user?.username ? <span className="block truncate text-[13px] text-muted">@{user.username}</span> : null}
      </span>
    </span>
  );
}

export function MembersPage({ space }: { space: Space }) {
  const [query, setQuery] = useState('');
  const q = useDebouncedValue(query.trim(), 250);
  const [menu, setMenu] = useState<{ member: SpaceMember; anchor: MenuAnchor } | null>(null);
  const { data, error } = useLoad(
    () => api.get<SpaceMemberPage>(`/api/spaces/${space.id}/members`, { query: { q: q || undefined, limit: 100 } }),
    [space.id, q],
  );
  const cached = useSpaces((s) => s.members[space.id]);
  useEffect(() => {
    if (!data) return;
    useSpaces.getState().upsertMembers(space.id, data.members);
    void useUsers
      .getState()
      .fetchUsers(data.members.map((m) => m.userId))
      .catch(() => undefined);
  }, [data, space.id]);
  const list = (data?.members ?? []).map((m) => cached?.[m.userId] ?? m);
  return (
    <div className="flex flex-col gap-4">
      <SearchInput value={query} onChange={setQuery} placeholder="Search members" aria-label="Search members" />
      {error ? <p className="text-danger">{error}</p> : null}
      {!data ? <Spinner /> : null}
      <div className="card-inset flex flex-col p-1">
        {list.map((m) => {
          return (
            <div key={m.userId} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-hover">
              <div className="min-w-0 flex-1">
                <UserCell userId={m.userId} nickname={m.nickname} />
              </div>
              <div className="hidden min-w-0 flex-wrap gap-1 sm:flex">
                {space.roles
                  .filter((r) => m.roleIds.includes(r.id))
                  .sort((a, b) => b.position - a.position)
                  .map((r) => (
                    <span key={r.id} className="flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[12px]">
                      <span className="size-2 rounded-full" style={{ background: r.color ?? 'var(--color-muted)' }} aria-hidden />
                      {r.name}
                    </span>
                  ))}
              </div>
              {m.timedOutUntil ? <span className="text-[12px] text-danger">Timed out</span> : null}
              <IconButton icon={MoreHorizontal} label="Member actions" variant="ghost" onClick={(e) => setMenu({ member: m, anchor: e.currentTarget })} />
            </div>
          );
        })}
        {data && list.length === 0 ? <p className="p-4 text-muted">No members match.</p> : null}
      </div>
      {data?.nextCursor ? <p className="text-[13px] text-muted">Showing the first 100 — search to find others.</p> : null}
      {menu ? <MemberActionsMenu space={space} member={menu.member} anchor={menu.anchor} onClose={() => setMenu(null)} /> : null}
    </div>
  );
}

export function InvitesPage({ space }: { space: Space }) {
  const { data, error, setData } = useLoad(() => api.get<SpaceInvite[]>(`/api/spaces/${space.id}/invites`), [space.id]);
  if (error) return <p className="text-danger">{error}</p>;
  if (!data) return <Spinner />;
  if (data.length === 0) return <EmptyState title="No active invites" description="Invite people from the Space menu → Invite People." />;
  return (
    <div className="card-inset flex flex-col p-1">
      {data.map((inv) => (
        <div key={inv.code} className="flex items-center gap-3 rounded-lg px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="truncate font-mono text-[13px]">{inviteUrl(inv.code)}</p>
            <p className="text-[13px] text-muted">
              {inv.uses}
              {inv.maxUses ? ` / ${inv.maxUses}` : ''} uses · {inv.expiresAt ? `expires ${new Date(inv.expiresAt).toLocaleString()}` : 'never expires'}
            </p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="text-danger"
            onClick={() =>
              void revokeInvite(space.id, inv.code)
                .then(() => setData(data.filter((x) => x.code !== inv.code)))
                .catch((e: unknown) => toast.error(e))
            }
          >
            Revoke
          </Button>
        </div>
      ))}
    </div>
  );
}

export function BansPage({ space }: { space: Space }) {
  const { data, error, setData } = useLoad(() => api.get<SpaceBan[]>(`/api/spaces/${space.id}/bans`), [space.id]);
  if (error) return <p className="text-danger">{error}</p>;
  if (!data) return <Spinner />;
  if (data.length === 0) return <EmptyState title="No bans" description="Banned members show up here." />;
  return (
    <div className="card-inset flex flex-col p-1">
      {data.map((b) => (
        <div key={b.user.id} className="flex items-center gap-3 rounded-lg px-3 py-2">
          <div className="min-w-0 flex-1">
            <UserCell userId={b.user.id} />
            {b.reason ? <p className="mt-1 text-[13px] text-muted">Reason: {b.reason}</p> : null}
          </div>
          <Button
            size="sm"
            variant="soft"
            onClick={() =>
              void unbanMember(space.id, b.user.id)
                .then(() => setData(data.filter((x) => x.user.id !== b.user.id)))
                .catch((e: unknown) => toast.error(e))
            }
          >
            Unban
          </Button>
        </div>
      ))}
    </div>
  );
}

const ACTIONS: Record<string, string> = {
  'space.create': 'created the Space',
  'space.update': 'updated the Space',
  'space.transfer': 'transferred ownership',
  'space.converted': 'converted the community into a Space',
  'space.migrated': 'created the Space from a community',
  'space.discovery.update': 'updated the discovery listing',
  'space.welcome_screen.update': 'updated the welcome screen',
  'space.onboarding.update': 'updated onboarding',
  'channel.create': 'created a channel',
  'channel.update': 'updated a channel',
  'channel.delete': 'deleted a channel',
  'channel.clone': 'cloned a channel',
  'channel.reorder': 'reordered channels',
  'channel.sync': 'synced channel permissions',
  'channel.overwrite.update': 'changed channel permissions',
  'channel.overwrite.delete': 'removed channel permissions',
  'category.create': 'created a category',
  'category.update': 'renamed a category',
  'category.delete': 'deleted a category',
  'category.overwrite.update': 'changed category permissions',
  'role.create': 'created a role',
  'role.update': 'updated a role',
  'role.delete': 'deleted a role',
  'role.reorder': 'reordered roles',
  'member.update': 'updated a member',
  'member.roles': 'changed a member’s roles',
  'member.timeout': 'timed out a member',
  'member.kick': 'kicked a member',
  'member.ban': 'banned a member',
  'member.unban': 'unbanned a member',
  'member.voice_disconnect': 'disconnected a member from voice',
  'member.voice_move': 'moved a member to another voice channel',
  'event.create': 'created an event',
  'event.update': 'updated an event',
  'event.delete': 'deleted an event',
  'invite.create': 'created an invite',
  'invite.delete': 'revoked an invite',
  'emoji.create': 'added an emoji',
  'emoji.update': 'renamed an emoji',
  'emoji.delete': 'deleted an emoji',
  'automod.rule.create': 'created an AutoMod rule',
  'automod.rule.update': 'updated an AutoMod rule',
  'automod.rule.delete': 'deleted an AutoMod rule',
  'automod.block': 'blocked a message from',
  'automod.flag': 'flagged a message from',
  'automod.timeout': 'timed out',
};

function AuditRow({ e }: { e: SpaceAuditEntry }) {
  const actor = useUser(e.actorId);
  const target = useUser(e.targetType === 'member' ? e.targetId : null);
  return (
    <div className="flex items-start gap-3 rounded-lg px-3 py-2.5">
      <Avatar src={actor?.avatarUrl} name={userDisplayName(actor)} colorSeed={e.actorId ?? 'system'} size={32} decorative />
      <div className="min-w-0 flex-1 text-[14px]">
        <p>
          <span className="font-semibold">{e.actorId ? userDisplayName(actor) : e.action.startsWith('automod.') ? 'AutoMod' : 'Enbox'}</span> {ACTIONS[e.action] ?? e.action}
          {target ? (
            <>
              {' '}
              <span className="font-semibold">{userDisplayName(target)}</span>
            </>
          ) : null}
        </p>
        {e.reason ? <p className="text-muted">Reason: {e.reason}</p> : null}
        <p className="text-[12px] text-subtle">{new Date(e.createdAt).toLocaleString()}</p>
      </div>
    </div>
  );
}

export function AuditLogPage({ space }: { space: Space }) {
  const { data, error } = useLoad(() => api.get<SpaceAuditEntry[]>(`/api/spaces/${space.id}/audit-log`, { query: { limit: 100 } }), [space.id]);
  useEffect(() => {
    if (data)
      void useUsers
        .getState()
        .fetchUsers(data.flatMap((e) => [e.actorId, e.targetType === 'member' ? e.targetId : null]).filter((x): x is string => !!x))
        .catch(() => undefined);
  }, [data]);
  if (error) return <p className="text-danger">{error}</p>;
  if (!data) return <Spinner />;
  return (
    <div className="card-inset flex flex-col p-1">
      {data.map((e) => (
        <AuditRow key={e.id} e={e} />
      ))}
    </div>
  );
}
