/**
 * /preview/:spaceId — a Space listed in discovery, read before joining (Discord's preview mode,
 * "lurking"): its banner, name and counts over the channels @everyone can read, by category,
 * and the newest messages of the one picked (`?c=`), read-only. Where the composer would be, a
 * bar offers Join (the Discover join). Members land in the Space itself — joining from here
 * opens the channel being read. Nothing here writes (no read state, no membership), and the
 * rail shows nothing new; Back returns to Discover.
 *
 * - Desktop: [channel list card | channel card], laid out like a Space.
 * - Phone: the channel list, or the picked channel full screen (its Back returns to the list).
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  EyeOff,
  Hash,
  Megaphone,
  RefreshCw,
} from 'lucide-react';
import type { ID, Message, SpacePreview } from '@enbox/shared';
import { Button, EmptyState, IconButton, PageSpinner, buttonClasses, toast } from '@/components/ui';
import { bannerGradient, memberCountLabel } from '@/features/discover/SpaceCard';
import { SpaceIcon } from '@/features/spaces/community/SpaceIcon';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { ApiError, api, errorMessage, mediaUrl } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useDiscover } from '@/stores/discover';
import { useSpaces } from '@/stores/spaces';
import { PreviewMessages, type PreviewChannel } from './PreviewMessages';

/** Location state of a channel opened from the phone's list (its Back goes back in history). */
const FROM_LIST = { fromPreviewList: true } as const;

export interface ChannelGroup {
  /** Category name, null for the channels above every category. */
  name: string | null;
  channels: PreviewChannel[];
}

/** The channels (in sidebar order) as runs of one category each. Pure. */
export function channelGroups(channels: readonly PreviewChannel[]): ChannelGroup[] {
  const out: ChannelGroup[] = [];
  for (const c of channels) {
    const last = out.at(-1);
    if (last && last.name === c.categoryName) last.channels.push(c);
    else out.push({ name: c.categoryName, channels: [c] });
  }
  return out;
}

/** The bar where the composer would be. */
export function JoinBar({
  name,
  joining,
  onJoin,
}: {
  name: string;
  joining: boolean;
  onJoin: () => void;
}) {
  return (
    <div
      className="shrink-0 px-3 pt-1 pb-[max(env(safe-area-inset-bottom),12px)] lg:px-4 lg:pb-4"
      data-testid="preview-join-bar"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-surface-2 px-4 py-3">
        <p className="min-w-0 flex-1 text-[14px] text-fg">
          You’re viewing <span className="font-semibold">{name}</span>. Join this Space to start
          chatting.
        </p>
        <Button onClick={onJoin} loading={joining} className="ml-auto">
          Join Space
        </Button>
      </div>
    </div>
  );
}

function SpaceHeader({ preview }: { preview: SpacePreview }) {
  return (
    <div className="shrink-0">
      <div
        className="relative h-28 shrink-0 overflow-hidden lg:rounded-t-[var(--radius-card)]"
        style={preview.bannerUrl ? undefined : { background: bannerGradient(preview.id) }}
      >
        {preview.bannerUrl ? (
          <img
            src={mediaUrl(preview.bannerUrl)}
            alt=""
            className="size-full object-cover"
            draggable={false}
          />
        ) : null}
        <Link
          to="/discover"
          aria-label="Back to Discover"
          className="absolute top-[max(env(safe-area-inset-top),8px)] left-2 inline-flex items-center gap-1 rounded-full bg-black/45 py-1 pr-3 pl-2 text-[13px] font-semibold text-white backdrop-blur-sm hover:bg-black/60 focus-visible:outline-2 focus-visible:outline-white"
        >
          <ArrowLeft size={16} aria-hidden /> Back
        </Link>
      </div>
      <div className="px-4 pb-1">
        <SpaceIcon
          name={preview.name}
          iconUrl={preview.iconUrl}
          size={56}
          className="-mt-7 ring-[5px] ring-surface"
        />
        <h1 className="mt-2 truncate text-[17px] font-bold text-fg">{preview.name}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 shrink-0 rounded-full bg-success" aria-hidden />
            {preview.onlineCount.toLocaleString()} Online
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 shrink-0 rounded-full bg-subtle" aria-hidden />
            {memberCountLabel(preview.memberCount)}
          </span>
        </p>
        {preview.description ? (
          <p className="mt-2 line-clamp-3 text-[13px] leading-snug break-words text-muted">
            {preview.description}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ChannelLink({
  channel,
  active,
  desktop,
}: {
  channel: PreviewChannel;
  active: boolean;
  desktop: boolean;
}) {
  const Icon = channel.isNews ? Megaphone : Hash;
  return (
    <Link
      to={{ search: `?c=${channel.id}` }}
      replace={desktop}
      state={desktop ? undefined : FROM_LIST}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex h-9 items-center gap-1.5 rounded-lg px-2 text-[15px] transition-colors outline-none focus-visible:outline-2 focus-visible:outline-brand',
        active ? 'bg-selected font-semibold text-fg' : 'text-muted hover:bg-hover hover:text-fg',
      )}
      data-testid="preview-channel-row"
    >
      <Icon size={18} className="shrink-0 opacity-70" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{channel.name}</span>
    </Link>
  );
}

/** The sidebar: the Space's header and its readable channels (categories collapse, Discord). */
function PreviewSidebar({
  preview,
  activeId,
  desktop,
}: {
  preview: SpacePreview;
  activeId: ID | null;
  desktop: boolean;
}) {
  const groups = useMemo(() => channelGroups(preview.channels), [preview.channels]);
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});
  return (
    <aside
      aria-label="Channels"
      className="lg:card-pane flex min-h-0 min-w-0 flex-1 flex-col bg-surface lg:w-[260px] lg:flex-none"
    >
      <SpaceHeader preview={preview} />
      <nav
        aria-label={`${preview.name} channels`}
        className="min-h-0 flex-1 overflow-y-auto pb-4 scrollbar-thin"
      >
        {groups.map((g, i) => {
          const shut = !!collapsed[i];
          // Collapsed (Discord): only the open channel stays.
          const shown = shut ? g.channels.filter((c) => c.id === activeId) : g.channels;
          return (
            <div key={`${i}:${g.name ?? ''}`} className="pt-4">
              {g.name ? (
                <button
                  type="button"
                  aria-expanded={!shut}
                  onClick={() => setCollapsed((s) => ({ ...s, [i]: !shut }))}
                  className="mx-2 flex max-w-[calc(100%-1rem)] min-w-0 items-center gap-0.5 rounded px-1 py-1 text-[12px] font-bold tracking-wide text-muted uppercase hover:text-fg focus-visible:outline-2 focus-visible:outline-brand"
                >
                  {shut ? (
                    <ChevronRight size={14} aria-hidden />
                  ) : (
                    <ChevronDown size={14} aria-hidden />
                  )}
                  <span className="truncate">{g.name}</span>
                </button>
              ) : null}
              <ul className="mt-0.5 flex flex-col gap-0.5 px-2">
                {shown.map((c) => (
                  <li key={c.id}>
                    <ChannelLink channel={c} active={c.id === activeId} desktop={desktop} />
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        {preview.channels.length === 0 ? (
          <p className="px-4 pt-6 text-sm text-muted">No channels everyone can read yet.</p>
        ) : null}
      </nav>
    </aside>
  );
}

function ChannelPane({
  spaceId,
  channel,
  cache,
  onBack,
}: {
  spaceId: ID;
  channel: PreviewChannel;
  cache: Map<ID, Message[]>;
  onBack?: () => void;
}) {
  const Icon = channel.isNews ? Megaphone : Hash;
  return (
    <>
      <header
        className="flex min-h-14 shrink-0 items-center gap-2 px-3 pt-[env(safe-area-inset-top)]"
        data-testid="preview-channel-header"
      >
        {onBack ? (
          <IconButton icon={ArrowLeft} label="Back to channels" variant="ghost" onClick={onBack} />
        ) : null}
        <Icon size={22} className="shrink-0 text-muted" aria-hidden />
        <h2 className="shrink-0 truncate text-[16px] font-bold text-fg">{channel.name}</h2>
        {channel.topic ? (
          <>
            <span className="mx-1 hidden h-5 w-px bg-line-strong sm:block" aria-hidden />
            <p
              className="hidden min-w-0 flex-1 truncate text-[14px] text-muted sm:block"
              title={channel.topic}
            >
              {channel.topic}
            </p>
          </>
        ) : null}
      </header>
      <PreviewMessages key={channel.id} spaceId={spaceId} channel={channel} cache={cache} />
    </>
  );
}

function Unavailable() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-surface p-6 lg:card-pane">
      <EmptyState
        icon={EyeOff}
        title="This Space can’t be previewed"
        description="It may have left discovery, or it isn’t available to you."
        action={
          <Link to="/discover" className={buttonClasses('soft')}>
            Back to Discover
          </Link>
        }
      />
    </div>
  );
}

type Load =
  | { status: 'loading' }
  | { status: 'ready'; preview: SpacePreview }
  | { status: 'missing' }
  | { status: 'error'; message: string };

function Preview({ spaceId }: { spaceId: ID }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const desktop = useIsDesktop();
  const member = useSpaces((s) => !!s.byId[spaceId]);
  const joining = useDiscover((s) => !!s.joining[spaceId]);
  const [state, setState] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [cache] = useState(() => new Map<ID, Message[]>());

  useEffect(() => {
    const ctrl = new AbortController();
    setState({ status: 'loading' });
    api
      .get<SpacePreview>(`/api/spaces/${spaceId}/preview`, { signal: ctrl.signal })
      .then((preview) => setState({ status: 'ready', preview }))
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return;
        setState(
          e instanceof ApiError && (e.status === 404 || e.status === 400)
            ? { status: 'missing' }
            : { status: 'error', message: errorMessage(e) },
        );
      });
    return () => ctrl.abort();
  }, [spaceId, attempt]);

  const preview = state.status === 'ready' ? state.preview : null;
  const picked = params.get('c');
  // Desktop always shows a channel (the first one by default); phones start on the list.
  const channel =
    preview?.channels.find((c) => c.id === picked) ??
    (desktop ? (preview?.channels[0] ?? null) : null);

  // Members (joined just now, or before) open the Space, on the channel being read.
  if (member)
    return (
      <Navigate to={channel ? `/spaces/${spaceId}/${channel.id}` : `/spaces/${spaceId}`} replace />
    );
  if (state.status === 'missing') return <Unavailable />;
  if (state.status === 'error')
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-surface p-6 lg:card-pane">
        <EmptyState
          icon={RefreshCw}
          title="Couldn’t load this Space"
          description={state.message}
          action={
            <Button variant="soft" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </Button>
          }
        />
      </div>
    );
  if (!preview)
    return (
      <div className="flex min-h-0 flex-1 bg-surface lg:card-pane">
        <PageSpinner />
      </div>
    );

  const join = () =>
    void useDiscover
      .getState()
      .join(spaceId)
      .catch((e: unknown) => toast.error(e));
  const backToList = () => {
    if ((location.state as typeof FROM_LIST | null)?.fromPreviewList) void navigate(-1);
    else setParams({}, { replace: true });
  };
  const bar = <JoinBar name={preview.name} joining={joining} onJoin={join} />;
  const body = channel ? (
    <ChannelPane
      spaceId={spaceId}
      channel={channel}
      cache={cache}
      onBack={desktop ? undefined : backToList}
    />
  ) : (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <EmptyState
        icon={Hash}
        title="Nothing to read yet"
        description="No channel of this Space is open to everyone. Join it to see what’s inside."
      />
    </div>
  );

  if (desktop)
    return (
      <div
        className="flex min-h-0 min-w-0 flex-1 gap-[var(--pane-gap)]"
        data-testid="space-preview"
      >
        <PreviewSidebar preview={preview} activeId={channel?.id ?? null} desktop />
        <main className="card-pane relative flex min-w-0 flex-1 flex-col">
          {body}
          {bar}
        </main>
      </div>
    );
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface" data-testid="space-preview">
      {channel ? (
        <main className="flex min-h-0 flex-1 flex-col">{body}</main>
      ) : (
        <PreviewSidebar preview={preview} activeId={null} desktop={false} />
      )}
      {bar}
    </div>
  );
}

/** /preview/:spaceId: read a discoverable Space before joining. */
export function SpacePreviewPage() {
  const { spaceId = '' } = useParams<{ spaceId: string }>();
  // A fresh page (and cache) per Space.
  return <Preview key={spaceId} spaceId={spaceId} />;
}
