/**
 * An `automod_alert` system message (the rule's alert channel), Discord's AutoMod alert:
 * "AutoMod blocked / flagged a message in #channel", a card with the author and the message
 * as sent, the rule's name, and "Timeout member" for moderators who may (MODERATE_MEMBERS,
 * above them). SystemPill renders it for this kind.
 */
import { Clock, ShieldAlert } from 'lucide-react';
import { PERM, hasPerm, renderMentions, userDisplayName, type SystemEvent } from '@enbox/shared';
import { Avatar, Button, choose, toast } from '@/components/ui';
import { formatTime } from '@/lib/format';
import { useMe } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import type { ClientMessage } from '@/stores/messages';
import { useSpace, useSpaceAuthor, useSpaceMember } from '@/stores/spaces';
import { nameOf, useUser, useUsers } from '@/stores/users';
import { updateMember } from '../actions';
import { memberAbilities } from '../MemberActions';
import { AUTOMOD_TIMEOUTS } from './rules';

type AlertEvent = Extract<SystemEvent, { kind: 'automod_alert' }>;

export function AutoModAlertCard({ m, event }: { m: ClientMessage; event: AlertEvent }) {
  const spaceId = useChats((s) => s.byId[m.chatId]?.space?.spaceId ?? null);
  const channelName = useChats((s) => s.byId[event.channelId]?.name ?? null);
  const space = useSpace(spaceId);
  const me = useMe();
  const user = useUser(event.userId);
  const author = useSpaceAuthor(spaceId, event.userId);
  const member = useSpaceMember(spaceId, event.userId);
  // Mentions in the copy read as names once those profiles arrive.
  useUsers((s) => s.byId);
  const name = author?.nickname || userDisplayName(user);
  const roleName = (id: string) => space?.roles.find((r) => r.id === id)?.name ?? 'role';
  const content = renderMentions(event.content, (id) => nameOf(id), roleName);
  const blocked = event.action === 'blocked';
  const canTimeout =
    !!space &&
    !!me &&
    event.userId !== me.id &&
    event.userId !== space.ownerId &&
    (member ? memberAbilities(space, me.id, member).timeout : hasPerm(space.myPermissions, PERM.MODERATE_MEMBERS));

  const timeOut = () =>
    void choose({
      title: `Time out ${name}`,
      message: 'They can still read, but can’t send messages, react or talk until it ends.',
      options: AUTOMOD_TIMEOUTS.map((t) => ({ value: String(t.seconds), label: t.long })),
    }).then((v) => {
      const t = AUTOMOD_TIMEOUTS.find((x) => String(x.seconds) === v);
      if (!t || !space) return;
      void updateMember(space.id, event.userId, { timedOutUntil: new Date(Date.now() + t.seconds * 1000).toISOString() })
        .then(() => toast.success(`${name} is timed out for ${t.long}`))
        .catch((e: unknown) => toast.error(e));
    });

  return (
    <div className="flex items-start gap-3 px-3 py-1.5 lg:px-5" data-testid="automod-alert" data-action={event.action}>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-ink" aria-hidden>
        <ShieldAlert size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-1.5 text-[15px]">
          <span className="font-semibold text-fg">AutoMod</span>
          <span className="rounded-[4px] bg-brand px-1 text-[10px] leading-4 font-bold tracking-wide text-on-brand uppercase">
            System
          </span>
          <span className="text-[12px] text-subtle">{formatTime(m.createdAt)}</span>
        </p>
        <p className="text-[14px] text-muted">
          {blocked ? 'Blocked a message' : 'Flagged a message'} in{' '}
          <span className="font-medium text-fg">#{channelName ?? 'a channel'}</span>
        </p>
        <div
          className={`mt-1.5 max-w-xl rounded-lg border-l-4 bg-surface-2 px-3 py-2.5 ${blocked ? 'border-danger' : 'border-warning'}`}
        >
          <div className="flex items-center gap-2">
            <Avatar src={user?.avatarUrl} name={name} colorSeed={event.userId} size={20} decorative />
            <span className="truncate text-[14px] font-semibold" style={author?.color ? { color: author.color } : undefined}>
              {name}
            </span>
          </div>
          <blockquote className="mt-1 text-[14px] break-words whitespace-pre-wrap text-fg">{content}</blockquote>
          <p className="mt-2 text-[12px] text-subtle">
            Rule: <span className="font-medium text-muted">{event.ruleName}</span>
          </p>
        </div>
        {canTimeout ? (
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="soft" leftIcon={Clock} onClick={timeOut}>
              Timeout member
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
