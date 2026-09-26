/**
 * Call info (/calls/:callId): who, when, how long, the related calls of the same log group,
 * participants of group calls, and actions (message, call back, remove from log).
 * A call that isn't in the loaded log pages (deep link, older page, log still loading) is
 * fetched on its own with `GET /api/calls/:callId`.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { MessageCircle, Trash2 } from 'lucide-react';
import {
  chatTitle,
  type CallLogEntry,
  type CallParticipant,
  type CallParticipantStatus,
} from '@enbox/shared';
import { UserAvatar } from '@/components/common/UserAvatar';
import { PhoneIcon, PhoneMissedIcon, VideoIcon } from '@/components/icons';
import { PaneHeader } from '@/components/layout/PaneHeader';
import {
  EmptyState,
  IconButton,
  ListItem,
  ListSection,
  PageSpinner,
  confirm,
} from '@/components/ui';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { ApiError, api, type ApiResponse } from '@/lib/api';
import { formatDaySeparator, formatTime } from '@/lib/format';
import { useCalls } from '@/stores/calls';
import { useUserName } from '@/stores/users';
import { callKindLabel, groupCallLog } from './logic';
import { CallChatAvatar, DirectionIcon, durationText, outcomeText, removeEntries } from './ui/log';
import { useChats } from '@/stores/chats';
import { canCallBack } from './callBack';

const STATUS_TEXT: Record<CallParticipantStatus, string> = {
  joined: 'In the call',
  left: 'Joined',
  invited: 'Invited',
  ringing: 'Ringing',
  declined: 'Declined',
  missed: 'No answer',
  busy: 'On another call',
};

function ParticipantRow({ p, initiatorId }: { p: CallParticipant; initiatorId: string }) {
  const name = useUserName(p.userId);
  const status = p.userId === initiatorId ? 'Started the call' : STATUS_TEXT[p.status];
  return (
    <ListItem
      dense
      divider={false}
      leading={<UserAvatar userId={p.userId} size="md" />}
      title={name}
      subtitle={status}
    />
  );
}

type Fetched =
  | { callId: string; state: 'loading' }
  | { callId: string; state: 'ok'; entry: CallLogEntry }
  | { callId: string; state: 'missing' };

/** One log entry by id, for calls that aren't in the loaded log pages. */
function useCallEntry(callId: string | undefined, skip: boolean): Fetched | null {
  const [fetched, setFetched] = useState<Fetched | null>(null);
  useEffect(() => {
    if (!callId || skip) return;
    let alive = true;
    setFetched({ callId, state: 'loading' });
    api
      .get<ApiResponse<'GET /api/calls/:callId'>>(`/api/calls/${encodeURIComponent(callId)}`)
      .then((entry) => alive && setFetched({ callId, state: 'ok', entry }))
      .catch((e: unknown) => {
        if (!alive) return;
        // 404: not mine, removed from my log, or unknown. Anything else: show "not found" too
        // (the log below still loads, and a later visit retries).
        if (!(e instanceof ApiError && e.status === 404)) console.warn('[calls] call info', e);
        setFetched({ callId, state: 'missing' });
      });
    return () => {
      alive = false;
    };
  }, [callId, skip]);
  return fetched?.callId === callId ? fetched : null;
}

export function CallDetails() {
  const { callId } = useParams<{ callId: string }>();
  const navigate = useNavigate();
  const desktop = useIsDesktop();
  const log = useCalls((s) => s.log);

  useEffect(() => {
    void useCalls.getState().loadLog();
  }, []);

  const logGroup = useMemo(
    () => groupCallLog(log.entries).find((g) => g.entries.some((e) => e.call.id === callId)),
    [log.entries, callId],
  );
  const fetched = useCallEntry(callId, !!logGroup);
  const single = fetched?.state === 'ok' ? fetched.entry : null;
  const group =
    logGroup ?? (single ? { key: single.call.id, entries: [single], head: single } : undefined);
  const entry = group?.entries.find((e) => e.call.id === callId);
  const liveChat = useChats((s) => (entry ? s.byId[entry.chat.id] : undefined));

  if (!entry || !group) {
    const logSettled = log.loaded || !!log.error;
    if (!logSettled || !fetched || fetched.state === 'loading') return <PageSpinner />;
    return (
      <div className="flex flex-1 flex-col bg-app">
        <PaneHeader title="Call info" back={desktop ? undefined : '/calls'} border />
        <div className="flex flex-1 items-center justify-center">
          <EmptyState
            icon={PhoneMissedIcon}
            title="Call not found"
            description="It may have been removed from your call log."
          />
        </div>
      </div>
    );
  }

  const title = chatTitle(entry.chat);
  const call = entry.call;
  const callable = canCallBack(liveChat);
  const start = (type: 'audio' | 'video') =>
    void useCalls.getState().startCall(entry.chat.id, type);
  const remove = async () => {
    const n = group.entries.length;
    const ok = await confirm({
      title: n > 1 ? `Remove ${n} calls from your log?` : 'Remove this call from your log?',
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    await removeEntries(group.entries);
    navigate('/calls', { replace: true });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-app" data-testid="call-details">
      <PaneHeader
        title="Call info"
        back={desktop ? undefined : '/calls'}
        border
        actions={
          <>
            <IconButton
              icon={MessageCircle}
              label="Message"
              onClick={() => navigate(`/chats/${entry.chat.id}`)}
            />
            <IconButton icon={Trash2} label="Remove from call log" onClick={() => void remove()} />
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto pb-6 scrollbar-thin">
        <div className="mx-auto max-w-2xl">
          <section className="m-3 flex flex-col items-center gap-3 rounded-3xl bg-surface px-6 py-7 text-center shadow-sm">
            <CallChatAvatar chat={entry.chat} size="2xl" />
            <div>
              <h2 className="text-[22px] font-semibold tracking-tight text-fg">{title}</h2>
              <p className="mt-0.5 text-[14px] text-muted">{callKindLabel(call)}</p>
            </div>
            <div className="mt-2 flex gap-3">
              <ActionButton
                icon={MessageCircle}
                label="Message"
                onClick={() => navigate(`/chats/${entry.chat.id}`)}
              />
              {callable ? (
                <>
                  <ActionButton icon={PhoneIcon} label="Voice" onClick={() => start('audio')} />
                  <ActionButton icon={VideoIcon} label="Video" onClick={() => start('video')} />
                </>
              ) : null}
            </div>
          </section>

          <ListSection
            title={formatDaySeparator(call.createdAt)}
            className="m-3 overflow-hidden rounded-3xl bg-surface pb-2 shadow-sm"
          >
            {group.entries.map((e) => {
              const outcome = outcomeText(e);
              const duration = durationText(e);
              return (
                <div
                  key={e.call.id}
                  className="flex items-center gap-3 px-4 py-2.5"
                  data-testid="call-details-entry"
                >
                  <DirectionIcon entry={e} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] text-fg">
                      {e.direction === 'incoming' ? 'Incoming' : 'Outgoing'}{' '}
                      {e.call.type === 'video' ? 'video' : 'voice'} call
                    </p>
                    <p className="text-[13px] text-muted">
                      {[formatTime(e.call.createdAt), outcome || null].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <span className="text-[13px] text-muted tabular-nums">
                    {duration ?? (e.outcome === 'answered' ? '0:00' : '')}
                  </span>
                </div>
              );
            })}
          </ListSection>

          {call.isGroup ? (
            <ListSection
              title={`${call.participants.length} participants`}
              className="m-3 overflow-hidden rounded-3xl bg-surface pb-2 shadow-sm"
            >
              {[...call.participants]
                .sort((a, b) =>
                  a.userId === call.initiatorId ? -1 : b.userId === call.initiatorId ? 1 : 0,
                )
                .map((p) => (
                  <ParticipantRow key={p.userId} p={p} initiatorId={call.initiatorId} />
                ))}
            </ListSection>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof PhoneIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-20 flex-col items-center gap-1.5 rounded-2xl border border-line py-2.5 text-[13px] font-medium text-brand-ink transition-colors hover:bg-brand-soft focus-visible:outline-2 focus-visible:outline-brand"
    >
      <Icon size={20} aria-hidden />
      {label}
    </button>
  );
}
