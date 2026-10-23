import { useCallback, useEffect, useState } from 'react';
import {
  userDisplayName,
  type Space,
  type SpaceAuditEntry,
  type SpaceBan,
  type SpaceInvite,
} from '@enbox/shared';
import { Avatar, Button, EmptyState, Spinner, toast } from '@/components/ui';
import { shownInviteUrl, useHideInvites } from '@/features/groups/shared/share';
import { api } from '@/lib/api';
import { useUser, useUsers } from '@/stores/users';
import { revokeInvite, unbanMember } from '../actions';

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

// The Members page lives in features/moderation (MembersPage).

export function InvitesPage({ space }: { space: Space }) {
  const { data, error, setData } = useLoad(() => api.get<SpaceInvite[]>(`/api/spaces/${space.id}/invites`), [space.id]);
  const hideInvites = useHideInvites();
  if (error) return <p className="text-danger">{error}</p>;
  if (!data) return <Spinner />;
  if (data.length === 0) return <EmptyState title="No active invites" description="Invite people from the Space menu → Invite People." />;
  return (
    <div className="card-inset flex flex-col p-1">
      {data.map((inv) => (
        <div key={inv.code} className="flex items-center gap-3 rounded-lg px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="truncate font-mono text-[13px]">{shownInviteUrl(inv.code, hideInvites)}</p>
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
  'member.join': 'joined the Space',
  'member.leave': 'left the Space',
  'space.security': 'changed the security actions',
  'space.guide': 'updated the Server Guide',
  'space.tag': 'changed the Space tag',
  'thread.update': 'updated a thread',
  'thread.delete': 'deleted a thread',
  'thread.pin': 'pinned a post',
  'thread.unpin': 'unpinned a post',
  'event.create': 'created an event',
  'event.update': 'updated an event',
  'event.delete': 'deleted an event',
  'invite.create': 'created an invite',
  'invite.delete': 'revoked an invite',
  'emoji.create': 'added an emoji',
  'emoji.update': 'renamed an emoji',
  'emoji.delete': 'deleted an emoji',
  'sticker.create': 'added a sticker',
  'sticker.update': 'edited a sticker',
  'sticker.delete': 'deleted a sticker',
  'sound.create': 'added a soundboard sound',
  'sound.update': 'edited a soundboard sound',
  'sound.delete': 'deleted a soundboard sound',
  'webhook.create': 'created a webhook',
  'webhook.update': 'edited a webhook',
  'webhook.delete': 'deleted a webhook',
  'channel.follow': 'followed an announcement channel',
  'channel.unfollow': 'unfollowed an announcement channel',
  'message.publish': 'published a message',
  'template.create': 'created a Space template',
  'template.update': 'edited the Space template',
  'template.sync': 'synced the Space template',
  'template.delete': 'deleted the Space template',
  'report.resolve': 'resolved a report',
  'report.dismiss': 'dismissed a report',
  'report.reopen': 'reopened a report',
  'automod.rule.create': 'created an AutoMod rule',
  'automod.rule.update': 'updated an AutoMod rule',
  'automod.rule.delete': 'deleted an AutoMod rule',
  'automod.block': 'blocked a message from',
  'automod.flag': 'flagged a message from',
  'automod.timeout': 'timed out',
};

function AuditRow({ e }: { e: SpaceAuditEntry }) {
  const actor = useUser(e.actorId);
  // Joins and leaves are their own actor: the name once.
  const target = useUser(e.targetType === 'member' && e.targetId !== e.actorId ? e.targetId : null);
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
