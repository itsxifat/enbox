/**
 * Calls tab (/calls): ongoing calls I can join, then the call log (GET /api/calls, paged by
 * `before`, grouped like WhatsApp), All/Missed filters, search, call back buttons, clear log.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  EllipsisVertical,
  Phone,
  PhoneCall,
  PhoneMissed,
  RefreshCw,
  Trash2,
  Video,
} from 'lucide-react';
import { chatTitle, type Call } from '@enbox/shared';
import { PaneHeader } from '@/components/layout/PaneHeader';
import {
  Button,
  DropdownMenu,
  EmptyState,
  IconButton,
  ListItem,
  ListItemSkeleton,
  ListSection,
  Menu,
  SearchInput,
  Spinner,
  Tabs,
  confirm,
  toast,
} from '@/components/ui';
import { formatRelativeShort } from '@/lib/format';
import { cn } from '@/lib/cn';
import { useMe } from '@/stores/auth';
import { useCalls } from '@/stores/calls';
import { useChats } from '@/stores/chats';
import { useMarkCallsVisited } from './hooks';
import {
  callKindLabel,
  groupCallLog,
  isMissedEntry,
  joinedOthers,
  participantOf,
  type CallLogGroup,
  type LogFilter,
} from './logic';
import { CallChatAvatar, DirectionIcon, durationText, outcomeText, removeEntries } from './ui/log';

export function CallsPane() {
  const navigate = useNavigate();
  const { callId } = useParams<{ callId?: string }>();
  const log = useCalls((s) => s.log);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<LogFilter>('all');
  useMarkCallsVisited();

  useEffect(() => {
    void useCalls.getState().loadLog({ refresh: true });
  }, []);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const entries = q
      ? log.entries.filter((e) => chatTitle(e.chat).toLowerCase().includes(q))
      : log.entries;
    return groupCallLog(
      entries.filter((e) => e.outcome !== 'ongoing'),
      filter,
    );
  }, [log.entries, query, filter]);
  const missedCount = useMemo(() => log.entries.filter(isMissedEntry).length, [log.entries]);
  const hasOngoing = useOngoingCalls('').length > 0;

  const clearLog = async () => {
    const ok = await confirm({
      title: 'Clear call log?',
      message: 'This removes every call from your call log on all your devices.',
      confirmLabel: 'Clear',
      danger: true,
    });
    if (!ok) return;
    try {
      await useCalls.getState().clearLog();
      toast.success('Call log cleared');
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <>
      <PaneHeader
        title="Calls"
        large
        actions={
          <>
            <IconButton icon={PhoneCall} label="New call" onClick={() => navigate('/calls/new')} />
            <DropdownMenu
              aria-label="Calls menu"
              trigger={(t) => (
                <IconButton {...t} icon={EllipsisVertical} label="Menu" active={t.active} />
              )}
              items={[
                { label: 'New call', icon: PhoneCall, onSelect: () => navigate('/calls/new') },
                {
                  label: 'Clear call log',
                  icon: Trash2,
                  danger: true,
                  disabled: !log.entries.length,
                  onSelect: () => void clearLog(),
                },
              ]}
            />
          </>
        }
      >
        <SearchInput value={query} onChange={setQuery} placeholder="Search calls" />
        <Tabs
          variant="chips"
          className="mt-2"
          value={filter}
          onChange={setFilter}
          items={[
            { value: 'all', label: 'All' },
            { value: 'missed', label: 'Missed', count: missedCount || undefined },
          ]}
        />
      </PaneHeader>
      <div className="min-h-0 flex-1 overflow-y-auto pb-4 scrollbar-thin" data-testid="calls-list">
        <OngoingSection query={query} />
        {!log.loaded && log.loading ? (
          <ListItemSkeleton count={8} />
        ) : !log.loaded && log.error ? (
          <EmptyState
            icon={PhoneMissed}
            title="Couldn't load your calls"
            description={log.error}
            action={
              <Button
                variant="soft"
                leftIcon={RefreshCw}
                onClick={() => void useCalls.getState().loadLog({ refresh: true })}
              >
                Try again
              </Button>
            }
          />
        ) : groups.length === 0 &&
          hasOngoing &&
          !query &&
          filter === 'all' ? null : groups.length === 0 ? (
          <EmptyState
            icon={filter === 'missed' ? PhoneMissed : Phone}
            title={
              query ? 'No calls found' : filter === 'missed' ? 'No missed calls' : 'No calls yet'
            }
            description={
              query
                ? `No calls with "${query.trim()}".`
                : filter === 'missed'
                  ? "Calls you don't answer will show up here."
                  : 'Start a voice or video call with your contacts and groups — right from your browser.'
            }
            action={
              !query && filter === 'all' ? (
                <Button leftIcon={PhoneCall} onClick={() => navigate('/calls/new')}>
                  Start a call
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ListSection title="Recent">
            {groups.map((g) => (
              <CallLogRow
                key={g.key}
                group={g}
                active={g.entries.some((e) => e.call.id === callId)}
              />
            ))}
            <LoadMore />
          </ListSection>
        )}
      </div>
    </>
  );
}

function LoadMore() {
  const ref = useRef<HTMLDivElement>(null);
  const { hasMore, loadingMore, loaded } = useCalls((s) => s.log);
  useEffect(() => {
    const el = ref.current;
    if (!el || !hasMore || !loaded) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) void useCalls.getState().loadMoreLog();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loaded]);
  if (!hasMore) return null;
  return (
    <div ref={ref} className="flex h-14 items-center justify-center">
      {loadingMore ? <Spinner size={20} /> : null}
    </div>
  );
}

function CallLogRow({ group, active }: { group: CallLogGroup; active: boolean }) {
  const navigate = useNavigate();
  const { head, entries } = group;
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const missed = isMissedEntry(head);
  const outcome = outcomeText(head);
  const duration = durationText(head);
  const title = chatTitle(head.chat);
  const time = formatRelativeShort(head.call.createdAt);
  const callBack = (type: 'audio' | 'video') =>
    void useCalls.getState().startCall(head.chat.id, type);

  return (
    <>
      <div
        className={cn(
          'group/li relative flex items-center gap-3 px-3 transition-colors duration-100 lg:px-3.5',
          active ? 'bg-selected' : 'hover:bg-hover has-[a:focus-visible]:bg-hover',
        )}
        data-testid="call-log-row"
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        <Link
          to={`/calls/${head.call.id}`}
          aria-current={active ? 'page' : undefined}
          aria-label={`${title}, ${head.direction} ${callKindLabel(head.call).toLowerCase()}${outcome ? `, ${outcome}` : ''}, ${time}`}
          className="absolute inset-0 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
        />
        <div className="pointer-events-none relative shrink-0 py-2.5">
          <CallChatAvatar chat={head.chat} />
        </div>
        <div
          className={cn(
            'pointer-events-none relative flex min-w-0 flex-1 items-center gap-2 self-stretch py-3',
            !active && 'border-b border-line group-last/li:border-transparent',
          )}
        >
          <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
            <span
              className={cn(
                'truncate text-[16px] leading-snug font-medium',
                missed ? 'text-danger' : 'text-fg',
              )}
            >
              {title}
              {entries.length > 1 ? <span className="font-normal"> ({entries.length})</span> : null}
            </span>
            <span
              className="flex min-w-0 items-center gap-1.5 text-[14px] text-muted"
              data-testid="call-log-subtitle"
            >
              <DirectionIcon entry={head} />
              <span className="truncate">
                {[outcome && outcome !== 'Missed' ? outcome : null, time, duration]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </span>
          </div>
          <button
            type="button"
            aria-label={`${head.call.type === 'video' ? 'Video' : 'Voice'} call ${title}`}
            title={`${head.call.type === 'video' ? 'Video' : 'Voice'} call`}
            onClick={() => callBack(head.call.type)}
            className="pointer-events-auto relative flex size-10 shrink-0 items-center justify-center rounded-full text-brand-ink transition-colors hover:bg-brand-soft focus-visible:outline-2 focus-visible:outline-brand"
          >
            {head.call.type === 'video' ? (
              <Video size={21} aria-hidden />
            ) : (
              <Phone size={20} aria-hidden />
            )}
          </button>
        </div>
      </div>
      <Menu
        open={!!menu}
        anchor={menu}
        onClose={() => setMenu(null)}
        items={[
          { label: 'Voice call', icon: Phone, onSelect: () => callBack('audio') },
          { label: 'Video call', icon: Video, onSelect: () => callBack('video') },
          { label: 'Call info', onSelect: () => navigate(`/calls/${head.call.id}`) },
          'separator',
          {
            label:
              entries.length > 1
                ? `Remove ${entries.length} calls from log`
                : 'Remove from call log',
            icon: Trash2,
            danger: true,
            onSelect: () => void removeEntries(entries),
          },
        ]}
      />
    </>
  );
}

/** Live calls in my chats that I can join or am in (group calls; 1:1 only while I'm in them). */
function useOngoingCalls(query: string): Call[] {
  const me = useMe()?.id ?? '';
  const liveCalls = useCalls((s) => s.liveCalls);
  const active = useCalls((s) => s.active);
  const chats = useChats((s) => s.byId);
  return useMemo(() => {
    const q = query.trim().toLowerCase();
    return Object.values(liveCalls)
      .filter((c) => {
        const mine = participantOf(c, me);
        const here = active?.call.id === c.id && active.phase !== 'ended';
        // Ringing me: the incoming UI handles it. 1:1 calls: only while I'm in them.
        if (!here && mine && (mine.status === 'invited' || mine.status === 'ringing')) return false;
        if (!c.isGroup && !here) return false;
        return joinedOthers(c, me).length > 0 || here;
      })
      .filter((c) => {
        const chat = chats[c.chatId];
        return !q || (chat ? chatTitle(chat).toLowerCase().includes(q) : false);
      });
  }, [liveCalls, active, chats, me, query]);
}

/** Live calls in my chats (join / return), above the log. */
function OngoingSection({ query }: { query: string }) {
  const list = useOngoingCalls(query);
  if (!list.length) return null;
  return (
    <ListSection title="Ongoing">
      {list.map((c) => (
        <OngoingRow key={c.id} call={c} />
      ))}
    </ListSection>
  );
}

function OngoingRow({ call }: { call: Call }) {
  const me = useMe()?.id ?? '';
  const chat = useChats((s) => s.byId[call.chatId]);
  const active = useCalls((s) => s.active);
  const here = active?.call.id === call.id && active.phase !== 'ended';
  const elsewhere = !here && participantOf(call, me)?.status === 'joined';
  const joined = joinedOthers(call, me).length + (here || elsewhere ? 1 : 0);
  const title = chat ? chatTitle(chat) : 'Group call';
  return (
    <ListItem
      divider={false}
      leading={
        <span className="relative">
          <CallChatAvatar
            chat={
              chat ?? { id: call.chatId, type: 'group', name: title, avatarUrl: null, peer: null }
            }
          />
          <span className="absolute -right-0.5 -bottom-0.5 flex size-5 items-center justify-center rounded-full bg-success text-white ring-2 ring-surface">
            {call.type === 'video' ? (
              <Video size={11} aria-hidden />
            ) : (
              <Phone size={11} aria-hidden />
            )}
          </span>
        </span>
      }
      title={title}
      subtitle={
        <span className="text-success">
          {here
            ? "You're in this call"
            : elsewhere
              ? 'Joined on another device'
              : `${callKindLabel(call)} · ${joined} joined`}
        </span>
      }
      end={
        here ? (
          <Button size="sm" variant="soft" onClick={() => useCalls.getState().setMinimized(false)}>
            Return
          </Button>
        ) : elsewhere ? null : (
          <button
            type="button"
            onClick={() => void useCalls.getState().joinCall(call.id)}
            className="h-8 rounded-full bg-success px-4 text-[14px] font-semibold text-white hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            Join
          </button>
        )
      }
    />
  );
}
