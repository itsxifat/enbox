/**
 * Mod View: a member's moderation panel (a right-side sheet), opened from the Members page and
 * the member menu. Their profile, member since and account age, roles (added and removed
 * inline below my highest role), the key permissions they hold, their newest messages in the
 * channels I can see (Jump), how many they sent in 30 days, what happened to them (the audit
 * entries about them), their voice channel (Disconnect) and the actions: time out (or remove
 * it), kick and ban, each with a reason. The server enforces every rule again.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Ban, Clock, Crown, LogOut, Plus, Volume2, X } from 'lucide-react';
import { PhoneOffIcon } from '@/components/icons';
import {
  PERM,
  computeBasePermissions,
  hasPerm,
  messagePreviewText,
  userDisplayName,
  type ID,
  type ModView,
  type Space,
} from '@enbox/shared';
import { Avatar, Button, DropdownMenu, Sheet, Spinner, toast } from '@/components/ui';
import { jumpToMention } from '@/features/inbox/lib';
import { memberAbilities } from '@/features/spaces/MemberActions';
import { banMember, kickMember, setMemberRole, updateMember } from '@/features/spaces/actions';
import { disconnectVoiceMember } from '@/features/voice/actions';
import { errorMessage } from '@/lib/api';
import { formatTime } from '@/lib/format';
import { useMe } from '@/stores/auth';
import { getChat, useChats } from '@/stores/chats';
import { useSpaceMember, useSpaces } from '@/stores/spaces';
import { nameOf, useUser, useUsers } from '@/stores/users';
import { loadModView, toSpaceMember } from './api';
import { BanDialog, KickDialog, TimeoutDialog } from './dialogs';
import { KEY_PERMISSIONS, fullDate, historyLabel, isTimedOut, timeAgo, untilLabel } from './labels';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card-inset flex flex-col gap-2 p-3" aria-label={title}>
      <h3 className="section-label">{title}</h3>
      {children}
    </section>
  );
}

export function ModViewPanel({
  space,
  userId,
  onClose,
}: {
  space: Space;
  userId: ID;
  onClose: () => void;
}) {
  const me = useMe();
  const navigate = useNavigate();
  const [view, setView] = useState<ModView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [dialog, setDialog] = useState<'timeout' | 'kick' | 'ban' | null>(null);
  const [voiceChannelId, setVoiceChannelId] = useState<ID | null>(null);
  const cached = useSpaceMember(space.id, userId);
  const user = useUser(userId);
  const chatsById = useChats((s) => s.byId);
  useUsers((s) => s.byId); // audit actors' names

  useEffect(() => {
    let live = true;
    setError(null);
    loadModView(space.id, userId)
      .then((v) => {
        if (!live) return;
        setView(v);
        setVoiceChannelId(v.voiceChannelId);
        useUsers.getState().upsertUsers([v.member.user]);
        useSpaces.getState().upsertMembers(space.id, [toSpaceMember(v.member)]);
        const actors = v.auditEntries.map((e) => e.actorId).filter((x): x is string => !!x);
        if (actors.length)
          void useUsers
            .getState()
            .fetchUsers(actors)
            .catch(() => undefined);
        // Channel and thread names for the messages (a few at most).
        for (const id of new Set(v.recentMessages.map((m) => m.chatId)))
          if (!getChat(id))
            void useChats
              .getState()
              .refreshChat(id)
              .catch(() => undefined);
      })
      .catch((e: unknown) => live && setError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, [space.id, userId, attempt]);

  const member = cached ?? (view ? toSpaceMember(view.member) : null);
  const profile = user ?? view?.member.user ?? null;
  const name = member?.nickname || userDisplayName(profile);
  const isOwner = space.ownerId === userId;
  const can = me && member ? memberAbilities(space, me.id, member) : null;
  const bits = useMemo(() => {
    const everyone = space.roles.find((r) => r.isDefault);
    if (!member || !everyone) return 0;
    return computeBasePermissions({
      ownerId: space.ownerId,
      viewerId: userId,
      everyoneRoleId: everyone.id,
      roles: space.roles,
      memberRoleIds: member.roleIds,
    });
  }, [member, space.ownerId, space.roles, userId]);
  // Administrators hold every bit: that one says it all.
  const held = KEY_PERMISSIONS.filter((p) =>
    hasPerm(bits, PERM.ADMINISTRATOR) ? p.bit === PERM.ADMINISTRATOR : hasPerm(bits, p.bit),
  );
  const roles = space.roles
    .filter((r) => !r.isDefault && member?.roleIds.includes(r.id))
    .sort((a, b) => b.position - a.position);
  const manageable = (position: number) => !!can?.roles && position < can.myTop;
  const addable = space.roles
    .filter((r) => !r.isDefault && !member?.roleIds.includes(r.id) && manageable(r.position))
    .sort((a, b) => b.position - a.position);
  const timedOut = isTimedOut(member?.timedOutUntil);
  const canDisconnect = hasPerm(space.myPermissions, PERM.MOVE_MEMBERS);

  const toggleRole = (roleId: ID, on: boolean) =>
    void setMemberRole(space.id, userId, roleId, on).catch((e: unknown) => toast.error(e));

  const jump = async (m: ModView['recentMessages'][number]) => {
    const chat =
      getChat(m.chatId) ??
      (await useChats
        .getState()
        .refreshChat(m.chatId)
        .catch(() => null));
    onClose();
    await jumpToMention(
      {
        message: m,
        chat: {
          id: m.chatId,
          type: chat?.type ?? 'space_text',
          name: chat?.name ?? null,
          spaceId: space.id,
          spaceName: space.name,
          spaceIconUrl: null,
          parentName: null,
        },
      },
      navigate,
    );
  };

  const header = profile ? (
    <div className="flex items-center gap-3 px-1">
      <Avatar
        src={member?.avatarUrl ?? profile.avatarUrl}
        name={name}
        colorSeed={userId}
        size={56}
        decorative
      />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate text-[17px] font-bold">
          <span className="truncate">{name}</span>
          {isOwner ? (
            <Crown size={15} className="shrink-0 text-warning" aria-label="Owner" />
          ) : null}
        </p>
        <p className="truncate text-[13px] text-muted">@{profile.username}</p>
        {timedOut && member?.timedOutUntil ? (
          <p className="mt-0.5 text-[12px] font-medium text-danger">
            Timed out {untilLabel(member.timedOutUntil)}
          </p>
        ) : null}
      </div>
    </div>
  ) : null;

  return (
    <Sheet open onClose={onClose} title="Mod View" aria-label={`Mod View: ${name}`}>
      <div className="flex flex-col gap-3 p-3" data-testid="mod-view">
        {error ? (
          <div className="flex flex-col items-start gap-2 p-2">
            <p className="text-danger">{error}</p>
            <Button size="sm" variant="soft" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </Button>
          </div>
        ) : !view || !member ? (
          <Spinner />
        ) : (
          <>
            {header}
            <div className="grid grid-cols-2 gap-3">
              <Section title="Member since">
                <p className="text-[14px]" title={fullDate(member.joinedAt)}>
                  {timeAgo(member.joinedAt)}
                </p>
              </Section>
              <Section title="Joined Enbox">
                <p className="text-[14px]" title={fullDate(view.member.accountCreatedAt)}>
                  {timeAgo(view.member.accountCreatedAt)}
                </p>
              </Section>
            </div>

            <Section title="Roles">
              <div className="flex flex-wrap gap-1.5">
                {roles.map((r) => (
                  <span
                    key={r.id}
                    className="flex items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-[12px]"
                  >
                    <span
                      className="size-2 rounded-full"
                      style={{ background: r.color ?? 'var(--color-muted)' }}
                      aria-hidden
                    />
                    {r.name}
                    {manageable(r.position) ? (
                      <button
                        type="button"
                        className="rounded-full text-muted hover:text-fg"
                        aria-label={`Remove ${r.name}`}
                        onClick={() => toggleRole(r.id, false)}
                      >
                        <X size={12} aria-hidden />
                      </button>
                    ) : null}
                  </span>
                ))}
                {roles.length === 0 ? <p className="text-[13px] text-muted">No roles</p> : null}
                {addable.length ? (
                  <DropdownMenu
                    aria-label="Add a role"
                    trigger={({ active: _active, ...p }) => (
                      <button
                        {...p}
                        type="button"
                        className="flex items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-[12px] text-muted hover:text-fg"
                      >
                        <Plus size={12} aria-hidden /> Add role
                      </button>
                    )}
                    items={addable.map((r) => ({
                      label: r.name,
                      onSelect: () => toggleRole(r.id, true),
                    }))}
                  />
                ) : null}
              </div>
            </Section>

            <Section title="Permissions">
              {isOwner ? (
                <p className="text-[13px] text-muted">The owner can do everything.</p>
              ) : held.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {held.map((p) => (
                    <span
                      key={p.bit}
                      className={`rounded-full px-2 py-0.5 text-[12px] ${p.bit === PERM.ADMINISTRATOR ? 'bg-danger-soft text-danger' : 'bg-surface'}`}
                    >
                      {p.label}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-[13px] text-muted">No moderation or management permissions.</p>
              )}
            </Section>

            {voiceChannelId ? (
              <Section title="Voice">
                <div className="flex items-center gap-2">
                  <Volume2 size={16} className="text-muted" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-[14px]">
                    {chatsById[voiceChannelId]?.name ?? 'A voice channel'}
                  </span>
                  {canDisconnect ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      leftIcon={PhoneOffIcon}
                      onClick={() =>
                        void disconnectVoiceMember(space.id, userId)
                          .then(() => setVoiceChannelId(null))
                          .catch((e: unknown) => toast.error(e))
                      }
                    >
                      Disconnect
                    </Button>
                  ) : null}
                </div>
              </Section>
            ) : null}

            <Section title="Messages">
              <p className="text-[13px] text-muted">
                {view.messageCount30d === 1
                  ? '1 message in the last 30 days'
                  : `${view.messageCount30d.toLocaleString()} messages in the last 30 days`}
              </p>
              {view.recentMessages.length === 0 ? (
                <p className="text-[13px] text-muted">No messages in channels you can see.</p>
              ) : (
                <ul className="flex flex-col gap-1" aria-label="Recent messages">
                  {view.recentMessages.map((m) => (
                    <li
                      key={m.id}
                      className="flex items-start gap-2 rounded-lg bg-surface px-2.5 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px] text-subtle">
                          #{chatsById[m.chatId]?.name ?? 'channel'} ·{' '}
                          <span title={fullDate(m.createdAt)}>{formatTime(m.createdAt)}</span>
                        </p>
                        <p className="line-clamp-3 text-[14px] break-words text-fg">
                          {messagePreviewText(m, (id) => nameOf(id))}
                        </p>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => void jump(m)}>
                        Jump
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="History">
              {view.auditEntries.length === 0 ? (
                <p className="text-[13px] text-muted">Nothing recorded yet.</p>
              ) : (
                <ul className="flex flex-col gap-1.5" aria-label="History">
                  {view.auditEntries.map((e, i) => (
                    <li key={`${e.createdAt}-${i}`} className="text-[13px]">
                      <span className="font-medium text-fg">{historyLabel(e.action)}</span>
                      {e.actorId && e.actorId !== userId ? (
                        <span className="text-muted"> by {nameOf(e.actorId)}</span>
                      ) : null}
                      <span className="text-subtle" title={fullDate(e.createdAt)}>
                        {' '}
                        · {timeAgo(e.createdAt)}
                      </span>
                      {e.reason ? <p className="text-muted">Reason: {e.reason}</p> : null}
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            {can && (can.timeout || can.kick || can.ban) ? (
              <div className="flex flex-wrap gap-2 pt-1">
                {can.timeout ? (
                  timedOut ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      leftIcon={Clock}
                      onClick={() =>
                        void updateMember(space.id, userId, { timedOutUntil: null })
                          .then(() => toast.success(`${name}’s timeout was removed`))
                          .catch((e: unknown) => toast.error(e))
                      }
                    >
                      Remove timeout
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      leftIcon={Clock}
                      onClick={() => setDialog('timeout')}
                    >
                      Time out
                    </Button>
                  )
                ) : null}
                {can.kick ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    leftIcon={LogOut}
                    onClick={() => setDialog('kick')}
                  >
                    Kick
                  </Button>
                ) : null}
                {can.ban ? (
                  <Button
                    size="sm"
                    variant="danger"
                    leftIcon={Ban}
                    onClick={() => setDialog('ban')}
                  >
                    Ban
                  </Button>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </div>
      {dialog === 'timeout' ? (
        <TimeoutDialog
          subject={name}
          onClose={() => setDialog(null)}
          onTimeout={async (seconds, reason) => {
            await updateMember(space.id, userId, {
              timedOutUntil: new Date(Date.now() + seconds * 1000).toISOString(),
              reason,
            });
            toast.success(`${name} is timed out`);
            setAttempt((n) => n + 1);
          }}
        />
      ) : null}
      {dialog === 'kick' ? (
        <KickDialog
          subject={name}
          onClose={() => setDialog(null)}
          onKick={async (reason) => {
            await kickMember(space.id, userId, reason);
            toast.success(`${name} was kicked`);
            onClose();
          }}
        />
      ) : null}
      {dialog === 'ban' ? (
        <BanDialog
          subject={name}
          onClose={() => setDialog(null)}
          onBan={async (choice) => {
            await banMember(space.id, userId, choice);
            toast.success(`${name} was banned`);
            onClose();
          }}
        />
      ) : null}
    </Sheet>
  );
}
