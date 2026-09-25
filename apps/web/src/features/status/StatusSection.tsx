/**
 * The "Status" section of the Updates tab: My status (add / view mine / posting progress),
 * Recent updates (unseen first) and Viewed updates, each row with a segmented ring around the
 * latest status preview. Also hosts the status privacy dialog.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { Camera, CircleDashed, EllipsisVertical, Lock, Pencil, Plus } from 'lucide-react';
import { userDisplayName, type StatusFeedItem } from '@enbox/shared';
import { UserAvatar } from '@/components/common/UserAvatar';
import { DropdownMenu, IconButton, ListSection, Skeleton, toast } from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatRelativeShort } from '@/lib/format';
import { useMe } from '@/stores/auth';
import { useStatus, useStatusLists } from '@/stores/status';
import { StatusPrivacyDialog } from './StatusPrivacyDialog';
import { StatusRing, StatusThumb } from './StatusRing';

const RING = 52;

/** Pick a photo/video and open the composer with it. */
export function useMediaPicker() {
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const open = () => input.current?.click();
  const element = (
    <input
      ref={input}
      type="file"
      accept="image/*,video/*"
      className="hidden"
      aria-hidden
      tabIndex={-1}
      data-testid="status-media-input"
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (file) navigate('/updates/status/new', { state: { file } });
      }}
    />
  );
  return { open, element };
}

function rowClass(active: boolean) {
  return cn(
    'flex w-full items-center gap-3 px-3 py-2 text-left outline-none transition-colors duration-100 lg:px-3.5',
    'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand',
    active ? 'bg-selected' : 'hover:bg-hover',
  );
}

function MyStatusRow() {
  const me = useMe();
  const { mine } = useStatusLists();
  const posting = useStatus((s) => s.posting);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const picker = useMediaPicker();
  const latest = mine[mine.length - 1];
  const progress = posting.length
    ? Math.round((posting.reduce((a, p) => a + p.progress, 0) / posting.length) * 100)
    : null;
  const active = !!me && pathname === `/updates/status/${me.id}`;
  const subtitle =
    progress !== null
      ? `Sending…${posting.some((p) => p.type !== 'text') ? ` ${progress}%` : ''}`
      : latest
        ? `${formatRelativeShort(latest.createdAt)}${latest.viewCount ? ` · ${latest.viewCount} view${latest.viewCount === 1 ? '' : 's'}` : ''}`
        : 'Tap to add status update';

  const avatar = me ? <UserAvatar user={{ ...me, contactName: null }} size={RING - 4} /> : null;
  return (
    <div className="relative flex items-center">
      <button
        type="button"
        className={rowClass(active)}
        onClick={() =>
          mine.length && me ? navigate(`/updates/status/${me.id}`) : navigate('/updates/status/new')
        }
        data-testid="my-status"
        aria-label={
          mine.length
            ? `My status, ${mine.length} update${mine.length === 1 ? '' : 's'}`
            : 'Add status update'
        }
      >
        <span className="relative shrink-0 py-0.5">
          {latest ? (
            <StatusRing statuses={mine.map((s) => ({ ...s, viewed: true }))} size={RING}>
              <StatusThumb status={latest} size={RING - 9} />
            </StatusRing>
          ) : (
            <span className="inline-flex p-0.5">{avatar}</span>
          )}
          {!latest ? (
            <span className="absolute -right-0.5 bottom-0 flex size-5 items-center justify-center rounded-full bg-brand text-on-brand ring-2 ring-surface">
              <Plus size={14} strokeWidth={3} aria-hidden />
            </span>
          ) : null}
        </span>
        <span className="min-w-0 flex-1 pr-24">
          <span className="block truncate text-[16px] font-medium text-fg">My status</span>
          <span
            className={cn(
              'block truncate text-[14px]',
              progress !== null ? 'text-brand-ink' : 'text-muted',
            )}
          >
            {subtitle}
          </span>
        </span>
      </button>
      <div className="absolute right-2 flex items-center gap-0.5">
        <IconButton
          icon={Pencil}
          label="New text status"
          size="sm"
          onClick={() => navigate('/updates/status/new')}
        />
        <IconButton
          icon={Camera}
          label="New photo or video status"
          size="sm"
          onClick={picker.open}
        />
      </div>
      {picker.element}
    </div>
  );
}

function UpdateRow({ item }: { item: StatusFeedItem }) {
  const { pathname } = useLocation();
  const latest = item.statuses[item.statuses.length - 1]!;
  const to = `/updates/status/${item.user.id}`;
  const name = userDisplayName(item.user);
  return (
    <Link
      to={to}
      className={rowClass(pathname === to)}
      data-testid="status-row"
      data-user-id={item.user.id}
      data-unseen={item.allViewed ? undefined : ''}
      aria-label={`${name}, ${item.allViewed ? 'viewed' : 'new status update'}, ${formatRelativeShort(item.lastUpdatedAt)}`}
    >
      <StatusRing statuses={item.statuses} size={RING} className="my-0.5">
        <StatusThumb status={latest} size={RING - 9} />
      </StatusRing>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[16px] font-medium text-fg">{name}</span>
        <span className="block truncate text-[14px] text-muted">
          {formatRelativeShort(item.lastUpdatedAt)}
        </span>
      </span>
    </Link>
  );
}

function SubHeader({ children }: { children: string }) {
  return <h4 className="px-4 pt-3 pb-1 text-[13px] font-medium text-muted">{children}</h4>;
}

export function StatusSection() {
  const { recent, viewed, mine } = useStatusLists();
  const navigate = useNavigate();
  const loaded = useStatus((s) => s.loaded);
  const error = useStatus((s) => s.error);
  const [privacyOpen, setPrivacyOpen] = useState(false);

  useEffect(() => {
    const s = useStatus.getState();
    if (!s.loaded && !s.loading) void s.loadFeed().catch(() => undefined);
    s.pruneExpired();
    const id = setInterval(() => useStatus.getState().pruneExpired(), 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <ListSection
      title="Status"
      action={
        <DropdownMenu
          aria-label="Status options"
          trigger={(t) => (
            <IconButton
              {...t}
              icon={EllipsisVertical}
              label="Status options"
              size="sm"
              active={t.active}
            />
          )}
          items={[
            mine.length
              ? {
                  label: 'My status updates',
                  icon: CircleDashed,
                  onSelect: () => navigate('/updates/status/mine'),
                }
              : null,
            { label: 'Status privacy', icon: Lock, onSelect: () => setPrivacyOpen(true) },
          ]}
        />
      }
    >
      <MyStatusRow />
      {!loaded && !error ? (
        <div className="space-y-3 px-4 py-3" aria-hidden>
          {[0, 1].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton circle className="size-[52px]" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-1/3" />
                <Skeleton className="h-3 w-1/4" />
              </div>
            </div>
          ))}
        </div>
      ) : error && !loaded ? (
        <button
          type="button"
          className="mx-4 my-2 text-[14px] text-danger hover:underline"
          onClick={() =>
            void useStatus
              .getState()
              .loadFeed()
              .catch((e: unknown) => toast.error(e))
          }
        >
          Couldn't load status updates. Tap to retry.
        </button>
      ) : null}
      {recent.length ? (
        <>
          <SubHeader>Recent updates</SubHeader>
          {recent.map((item) => (
            <UpdateRow key={item.user.id} item={item} />
          ))}
        </>
      ) : null}
      {viewed.length ? (
        <>
          <SubHeader>Viewed updates</SubHeader>
          {viewed.map((item) => (
            <UpdateRow key={item.user.id} item={item} />
          ))}
        </>
      ) : null}
      {loaded && !recent.length && !viewed.length ? (
        <p className="px-4 pt-1 pb-2 text-[13px] text-subtle">
          Status updates from your contacts will appear here.
        </p>
      ) : null}
      <StatusPrivacyDialog open={privacyOpen} onClose={() => setPrivacyOpen(false)} />
    </ListSection>
  );
}
