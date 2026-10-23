/**
 * Space Settings ▸ Reports: reports about this Space's messages and the Space itself, for its
 * moderators (MANAGE_MESSAGES, KICK_MEMBERS, BAN_MEMBERS or MODERATE_MEMBERS; the server
 * leaves out channels I can't see). Open / Resolved / Dismissed tabs; each card shows the
 * category, when, the reporter's details and the evidence as it was reported (message text,
 * files, author), with Jump to message while it still exists, the moderation actions on the
 * author (delete the message, time out, kick, ban) and Resolve / Dismiss / Reopen. Who
 * reported it is never shown.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { ChevronDown, Clock, FileText, Flag, Gavel, LogOut, Trash2 } from 'lucide-react';
import {
  PERM,
  hasPerm,
  renderMentions,
  userDisplayName,
  type Message,
  type ReportStatus,
  type Space,
  type SpaceReport,
  type SpaceReportPage,
} from '@enbox/shared';
import {
  Avatar,
  Button,
  DropdownMenu,
  EmptyState,
  Spinner,
  Tabs,
  choose,
  confirm,
  toast,
  type MenuEntry,
} from '@/components/ui';
import { chatPath, messageLink } from '@/features/chats/links';
import { banMember, kickMember, updateMember } from '@/features/spaces/actions';
import { api, errorMessage, isApiError, mediaUrl } from '@/lib/api';
import { formatChatListTime } from '@/lib/format';
import { useMe } from '@/stores/auth';
import { getChat, useChat } from '@/stores/chats';
import { nameOf, useUser } from '@/stores/users';
import { CATEGORY_INFO } from './categories';

const PAGE_SIZE = 25;

const TABS: { value: ReportStatus; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'dismissed', label: 'Dismissed' },
];

const EMPTY: Record<ReportStatus, { title: string; description: string }> = {
  open: {
    title: 'No open reports',
    description: 'When members report something here, it shows up for you to review.',
  },
  resolved: { title: 'Nothing resolved yet', description: 'Reports you resolve are kept here.' },
  dismissed: { title: 'Nothing dismissed', description: 'Reports you dismiss are kept here.' },
};

const TIMEOUTS = [
  { value: '60', label: '60 seconds', ms: 60_000 },
  { value: '300', label: '5 minutes', ms: 300_000 },
  { value: '3600', label: '1 hour', ms: 3_600_000 },
  { value: '86400', label: '1 day', ms: 86_400_000 },
  { value: '604800', label: '1 week', ms: 604_800_000 },
] as const;

const IMAGE_RE = /\.(jpe?g|png|gif|webp|avif)$/i;

/** One page of reports; skips ahead past pages the server emptied (channels I can't see). */
async function fetchReports(
  spaceId: string,
  status: ReportStatus,
  before?: string,
): Promise<SpaceReportPage> {
  let cursor = before;
  for (let i = 0; ; i++) {
    const page = await api.get<SpaceReportPage>(`/api/spaces/${spaceId}/reports`, {
      query: { status, limit: PAGE_SIZE, before: cursor },
    });
    if (page.reports.length > 0 || !page.nextCursor || i >= 4) return page;
    cursor = page.nextCursor;
  }
}

export function ReportsPage({ space }: { space: Space }) {
  const [tab, setTab] = useState<ReportStatus>('open');
  const [reports, setReports] = useState<SpaceReport[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);

  useEffect(() => {
    const seq = ++request.current;
    setReports(null);
    setCursor(null);
    setError(null);
    fetchReports(space.id, tab)
      .then((page) => {
        if (seq !== request.current) return;
        setReports(page.reports);
        setCursor(page.nextCursor);
      })
      .catch(
        (e: unknown) =>
          seq === request.current && setError(errorMessage(e, 'Failed to load reports')),
      );
  }, [space.id, tab]);

  const loadMore = async () => {
    if (!cursor) return;
    const seq = request.current;
    setLoadingMore(true);
    try {
      const page = await fetchReports(space.id, tab, cursor);
      if (seq !== request.current) return;
      setReports((list) => [
        ...(list ?? []),
        ...page.reports.filter((r) => !list?.some((x) => x.id === r.id)),
      ]);
      setCursor(page.nextCursor);
    } catch (e) {
      toast.error(e);
    } finally {
      setLoadingMore(false);
    }
  };

  /** A report changed status: it leaves this tab. */
  const moved = useCallback((report: SpaceReport) => {
    setReports((list) => list?.filter((r) => r.id !== report.id) ?? null);
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[14px] text-muted">
        Reports about messages in this Space’s channels and about the Space itself. Who reported
        them is never shown.
      </p>
      <Tabs value={tab} onChange={setTab} items={TABS} variant="chips" aria-label="Report status" />
      {error ? <p className="text-danger">{error}</p> : null}
      {!reports && !error ? <Spinner /> : null}
      {reports && reports.length === 0 ? (
        <EmptyState icon={Flag} title={EMPTY[tab].title} description={EMPTY[tab].description} />
      ) : null}
      {reports?.map((r) => (
        <ReportCard key={r.id} space={space} report={r} onMoved={moved} />
      ))}
      {reports && cursor ? (
        <Button variant="ghost" loading={loadingMore} onClick={() => void loadMore()}>
          Load more
        </Button>
      ) : null}
    </div>
  );
}

function Evidence({ report, gone }: { report: SpaceReport; gone: boolean }) {
  const e = report.evidence;
  const authorId = e.message
    ? e.message.senderId
    : report.targetType === 'user'
      ? report.targetId
      : null;
  const author = useUser(authorId);
  const channel = useChat(e.message?.chatId);
  // The name as it was reported (the account may have been renamed or deleted since).
  const shownName = e.user?.displayName ?? (author ? userDisplayName(author) : null);
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-surface-2 p-3">
      {shownName || authorId ? (
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar
            src={author?.avatarUrl}
            name={shownName ?? 'User'}
            colorSeed={authorId ?? report.id}
            size={28}
            decorative
          />
          <span className="min-w-0 truncate text-[14px]">
            <span className="font-semibold">{shownName ?? 'Unknown user'}</span>
            {e.user?.username ? <span className="text-muted"> @{e.user.username}</span> : null}
          </span>
          {e.message ? (
            <span className="ml-auto shrink-0 text-[12px] text-subtle">
              {channel?.name ? `#${channel.name} · ` : ''}
              {formatChatListTime(e.message.createdAt)}
            </span>
          ) : null}
        </div>
      ) : null}
      {report.targetType === 'space' ? (
        <p className="text-[14px]">The Space itself{e.space ? `: ${e.space.name}` : ''}</p>
      ) : null}
      {e.message?.text ? (
        <p className="text-[14px] break-words whitespace-pre-wrap text-fg">
          {renderMentions(e.message.text, (id) => nameOf(id))}
        </p>
      ) : null}
      {e.message?.mediaUrls.length ? (
        <div className="flex flex-wrap gap-2" aria-label="Files">
          {e.message.mediaUrls.map((url) =>
            IMAGE_RE.test(url) ? (
              <a key={url} href={mediaUrl(url)} target="_blank" rel="noreferrer noopener">
                <img
                  src={mediaUrl(url)}
                  alt="Reported file"
                  className="size-20 rounded-md object-cover"
                  loading="lazy"
                />
              </a>
            ) : (
              <a
                key={url}
                href={mediaUrl(url)}
                target="_blank"
                rel="noreferrer noopener"
                className="flex items-center gap-1.5 rounded-md bg-surface px-2.5 py-1.5 text-[13px] text-link hover:underline"
              >
                <FileText size={14} aria-hidden />
                {url.split('/').pop()}
              </a>
            ),
          )}
        </div>
      ) : null}
      {e.message && gone ? (
        <p className="text-[12.5px] text-muted italic">The message has since been deleted.</p>
      ) : null}
    </div>
  );
}

function ReportCard({
  space,
  report,
  onMoved,
}: {
  space: Space;
  report: SpaceReport;
  onMoved: (r: SpaceReport) => void;
}) {
  const me = useMe();
  const navigate = useNavigate();
  const [gone, setGone] = useState(false);
  const [busy, setBusy] = useState<ReportStatus | 'jump' | null>(null);
  const e = report.evidence;
  const info = CATEGORY_INFO[report.category];
  const bits = space.myPermissions;
  const userId = e.message
    ? e.message.senderId
    : report.targetType === 'user'
      ? report.targetId
      : null;
  const name = e.user?.displayName ?? (userId ? nameOf(userId) : 'them');
  const actOnUser = !!userId && userId !== me?.id && userId !== space.ownerId;
  const resolver = useUser(report.resolvedBy);

  const setStatus = async (status: ReportStatus) => {
    setBusy(status);
    try {
      const updated = await api.patch<SpaceReport>(`/api/spaces/${space.id}/reports/${report.id}`, {
        status,
      });
      toast.success(
        status === 'open'
          ? 'Report reopened'
          : status === 'resolved'
            ? 'Report resolved'
            : 'Report dismissed',
      );
      onMoved(updated);
    } catch (err) {
      toast.error(err);
      setBusy(null);
    }
  };

  const jump = async () => {
    if (!e.message) return;
    setBusy('jump');
    try {
      const m = await api.get<Message>(`/api/messages/${e.message.id}`);
      if (m.deletedAt) throw new Error('deleted');
      const chat = getChat(m.chatId);
      navigate(
        chat
          ? chatPath(chat, { seq: m.seq, messageId: m.id })
          : messageLink(m.chatId, m.seq, m.id, `/spaces/${space.id}`),
      );
    } catch (err) {
      if (isApiError(err) && err.isNetworkError) toast.error(err);
      else {
        setGone(true);
        toast.info('That message no longer exists');
      }
      setBusy(null);
    }
  };

  const deleteMessage = async () => {
    if (!e.message) return;
    const ok = await confirm({
      title: 'Delete Message',
      message: `Delete this message from ${name} for everyone?`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/api/messages/${e.message.id}`, undefined, { query: { for: 'everyone' } });
      setGone(true);
      toast.success('Message deleted');
    } catch (err) {
      toast.error(err);
    }
  };

  const timeOut = async () => {
    if (!userId) return;
    const v = await choose({
      title: `Time out ${name}`,
      message: 'They can still read, but can’t send messages, react or talk until it ends.',
      options: TIMEOUTS.map((t) => ({ value: t.value, label: t.label })),
    });
    const t = TIMEOUTS.find((x) => x.value === v);
    if (!t) return;
    try {
      await updateMember(space.id, userId, {
        timedOutUntil: new Date(Date.now() + t.ms).toISOString(),
      });
      toast.success(`${name} is timed out for ${t.label}`);
    } catch (err) {
      toast.error(err);
    }
  };

  const kick = async () => {
    if (!userId) return;
    const ok = await confirm({
      title: `Kick ${name}?`,
      message: 'They can rejoin with a new invite.',
      confirmLabel: 'Kick',
      danger: true,
    });
    if (!ok) return;
    try {
      await kickMember(space.id, userId);
      toast.success(`${name} was kicked`);
    } catch (err) {
      toast.error(err);
    }
  };

  const ban = async () => {
    if (!userId) return;
    const ok = await confirm({
      title: `Ban ${name}?`,
      message: 'They are removed and can’t rejoin, even with an invite, until unbanned.',
      confirmLabel: 'Ban',
      danger: true,
    });
    if (!ok) return;
    try {
      await banMember(space.id, userId, { reason: `Reported: ${info.label}` });
      toast.success(`${name} was banned`);
    } catch (err) {
      toast.error(err);
    }
  };

  const actions: MenuEntry[] = [
    e.message &&
      !gone &&
      hasPerm(bits, PERM.MANAGE_MESSAGES) && {
        label: 'Delete Message',
        icon: Trash2,
        danger: true,
        onSelect: () => void deleteMessage(),
      },
    actOnUser &&
      hasPerm(bits, PERM.MODERATE_MEMBERS) && {
        label: `Time out ${name}`,
        icon: Clock,
        onSelect: () => void timeOut(),
      },
    actOnUser &&
      hasPerm(bits, PERM.KICK_MEMBERS) && {
        label: `Kick ${name}`,
        icon: LogOut,
        danger: true,
        onSelect: () => void kick(),
      },
    actOnUser &&
      hasPerm(bits, PERM.BAN_MEMBERS) && {
        label: `Ban ${name}`,
        icon: Gavel,
        danger: true,
        onSelect: () => void ban(),
      },
  ].filter(Boolean);

  const kind =
    report.targetType === 'message' ? 'Message' : report.targetType === 'user' ? 'User' : 'Space';
  return (
    <article
      className="card-inset flex flex-col gap-3 p-4"
      aria-label={`${info.label} report`}
      data-testid="report-card"
    >
      <header className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-danger-soft px-2.5 py-0.5 text-[12.5px] font-semibold text-danger">
          {info.label}
        </span>
        <span className="text-[13px] text-muted">
          {kind} report · {formatChatListTime(report.createdAt)}
        </span>
      </header>
      {report.details ? (
        <p className="text-[14px] break-words whitespace-pre-wrap">
          <span className="text-muted">Details: </span>
          {report.details}
        </p>
      ) : null}
      <Evidence report={report} gone={gone} />
      {report.status !== 'open' && report.resolvedAt ? (
        <p className="text-[12.5px] text-subtle">
          {report.status === 'resolved' ? 'Resolved' : 'Dismissed'}
          {report.resolvedBy
            ? ` by ${resolver ? userDisplayName(resolver) : 'a moderator'}`
            : ''} · {formatChatListTime(report.resolvedAt)}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {e.message ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={gone}
            loading={busy === 'jump'}
            onClick={() => void jump()}
          >
            Jump to message
          </Button>
        ) : null}
        {actions.length ? (
          <DropdownMenu
            aria-label="Moderation actions"
            align="start"
            items={actions}
            trigger={({ active: _active, ...p }) => (
              <Button {...p} size="sm" variant="secondary" rightIcon={ChevronDown}>
                Take action
              </Button>
            )}
          />
        ) : null}
        <span className="flex-1" />
        {report.status === 'open' ? (
          <>
            <Button
              size="sm"
              variant="ghost"
              loading={busy === 'dismissed'}
              disabled={!!busy}
              onClick={() => void setStatus('dismissed')}
            >
              Dismiss
            </Button>
            <Button
              size="sm"
              loading={busy === 'resolved'}
              disabled={!!busy}
              onClick={() => void setStatus('resolved')}
            >
              Resolve
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            loading={busy === 'open'}
            disabled={!!busy}
            onClick={() => void setStatus('open')}
          >
            Reopen
          </Button>
        )}
      </div>
    </article>
  );
}
