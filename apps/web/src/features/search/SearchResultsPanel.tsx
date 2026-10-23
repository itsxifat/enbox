/**
 * Search results beside the conversation (Discord): "N Results", Newest / Oldest, the results
 * grouped by channel (consecutive runs, so the list keeps its sort order), compact cards with
 * the matched words highlighted and a Jump button on hover, Discord's pager, a loading
 * skeleton and the empty state.
 *
 * Spaces show it as its own card on the right instead of the member list (SpacesView); DMs and
 * groups dock it inside the conversation card (`variant="inset"`, ChatSearchDock). `query` is
 * the side panel's canonical string (query.ts). Jump scrolls the open conversation, opens
 * another channel at the message (`chatPath(…, { seq, messageId })`), or opens a thread beside
 * its channel.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  Podcast,
  ChartColumn,
  ChevronLeft,
  ChevronRight,
  Contact,
  Film,
  Hash,
  MapPin,
  MessagesSquare,
  Paperclip,
  SearchX,
  Volume2,
  X,
  type LucideIcon,
} from 'lucide-react';
import {
  SEARCH_PAGE_SIZE,
  SEARCH_TOTAL_CAP,
  type Message,
  type MessageSearchPage,
  type MessageSearchResult,
  type SpaceChannelInfo,
} from '@enbox/shared';
import { IN_APP_NAV } from '@/components/layout/navigation';
import { Button, IconButton, Skeleton } from '@/components/ui';
import { chatPath } from '@/features/chats/links';
import { RichText } from '@/features/conversation/bubbles/RichText';
import { SenderAvatar, SenderName } from '@/features/conversation/MessageRow';
import { useConversationUi } from '@/features/conversation/state';
import { api, errorMessage, mediaUrl } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatShortDate, formatTime } from '@/lib/format';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { scopeKey, useSearch, type SearchSort } from '@/stores/search';
import { useSidePanel, type SearchScope } from '@/stores/sidePanel';
import { useUsers } from '@/stores/users';
import { SearchHighlightStyle, supportsHighlights, useWordHighlights } from './highlight';
import { parseQuery, searchWords, toApiQuery } from './query';

export type ResultsVariant = 'card' | 'inset' | 'sheet';

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export interface ResultGroup {
  key: string;
  chat: MessageSearchResult['chat'];
  items: MessageSearchResult[];
}

/** Consecutive results of the same channel under one header. */
export function groupResults(items: readonly MessageSearchResult[]): ResultGroup[] {
  const out: ResultGroup[] = [];
  for (const r of items) {
    const last = out[out.length - 1];
    if (last && last.chat.id === r.chat.id) last.items.push(r);
    else out.push({ key: `${r.chat.id}:${r.message.id}`, chat: r.chat, items: [r] });
  }
  return out;
}

/** Page buttons (0-based) with gaps: first, last and the current one's neighbours. */
export function pageList(current: number, count: number): (number | 'gap')[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i);
  const out: (number | 'gap')[] = [0];
  const from = Math.max(1, Math.min(current - 1, count - 4));
  const to = Math.min(count - 2, Math.max(current + 1, 3));
  if (from > 1) out.push('gap');
  for (let i = from; i <= to; i++) out.push(i);
  if (to < count - 2) out.push('gap');
  out.push(count - 1);
  return out;
}

export function resultCountLabel(total: number, capped: boolean): string {
  const n = `${total.toLocaleString()}${capped ? '+' : ''}`;
  return total === 1 && !capped ? '1 Result' : `${n} Results`;
}

/** "Today at 3:45 PM", "Yesterday at …", else the date and time. */
export function formatResultTime(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(now) - day(d)) / 86_400_000);
  if (days === 0) return `Today at ${formatTime(d)}`;
  if (days === 1) return `Yesterday at ${formatTime(d)}`;
  return `${formatShortDate(d)} ${formatTime(d)}`;
}

/** Pages the server can serve (`offset` stops at SEARCH_TOTAL_CAP). */
export function pageCount(total: number): number {
  return Math.max(1, Math.ceil(Math.min(total, SEARCH_TOTAL_CAP) / SEARCH_PAGE_SIZE));
}

// ---------------------------------------------------------------------------
// Jump
// ---------------------------------------------------------------------------

function useJump(onJumped?: () => void) {
  const navigate = useNavigate();
  return useCallback(
    (r: MessageSearchResult) => {
      const { message: m, chat: c } = r;
      const ui = useConversationUi.getState();
      const open = useChats.getState().openChatId;
      if (c.type === 'space_thread' && c.parentId && c.spaceId) {
        // A thread opens beside its channel (the thread panel takes the results' place).
        if (open !== c.parentId)
          void navigate(`/spaces/${c.spaceId}/${c.parentId}`, { state: IN_APP_NAV });
        useSidePanel.getState().open({ kind: 'thread', threadId: c.id, parentId: c.parentId });
        ui.requestJump(c.id, m.seq, m.id);
      } else if (open === c.id) {
        ui.requestJump(c.id, m.seq, m.id);
      } else {
        const target = useChats.getState().byId[c.id] ?? {
          id: c.id,
          type: c.type,
          space: c.spaceId ? ({ spaceId: c.spaceId } as SpaceChannelInfo) : null,
        };
        void navigate(chatPath(target, { seq: m.seq, messageId: m.id }), { state: IN_APP_NAV });
      }
      onJumped?.();
    },
    [navigate, onJumped],
  );
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

function AttachmentLine({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <span className="mt-1 flex max-w-full items-center gap-1.5 text-[13px] text-muted">
      <Icon size={14} className="shrink-0" aria-hidden />
      <span className="truncate">{text}</span>
    </span>
  );
}

function Attachment({ m }: { m: Message }) {
  if (m.poll) return <AttachmentLine icon={ChartColumn} text={m.poll.question} />;
  const media = m.media;
  if (media) {
    const thumb = media.thumbnailUrl ?? (media.kind === 'image' ? media.url : null);
    if ((media.kind === 'image' || media.kind === 'video') && thumb)
      return (
        <img
          src={mediaUrl(thumb)}
          alt={media.fileName ?? (media.kind === 'image' ? 'Image' : 'Video')}
          loading="lazy"
          className="mt-1 block max-h-[140px] max-w-full rounded-md object-cover"
        />
      );
    if (media.kind === 'voice') return <AttachmentLine icon={Volume2} text="Voice message" />;
    const icon = media.kind === 'audio' ? Volume2 : media.kind === 'video' ? Film : Paperclip;
    return (
      <AttachmentLine
        icon={icon}
        text={media.fileName ?? (media.kind === 'audio' ? 'Audio' : 'File')}
      />
    );
  }
  if (m.location)
    return (
      <AttachmentLine icon={MapPin} text={m.location.name ?? m.location.address ?? 'Location'} />
    );
  if (m.contact) return <AttachmentLine icon={Contact} text={m.contact.name} />;
  return null;
}

function ResultBody({ m, words }: { m: Message; words: readonly string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const native = supportsHighlights();
  useWordHighlights(ref, native ? words : []);
  return (
    <div
      ref={ref}
      className="min-w-0 text-[14px] leading-[1.375] break-words whitespace-pre-wrap text-fg"
    >
      {/* Without the Highlight API RichText marks the longest word itself. */}
      {m.text ? <RichText text={m.text} highlight={native ? null : (words[0] ?? null)} /> : null}
      <Attachment m={m} />
    </div>
  );
}

function ResultCard({
  r,
  words,
  variant,
  onJump,
}: {
  r: MessageSearchResult;
  words: readonly string[];
  variant: ResultsVariant;
  onJump: (r: MessageSearchResult) => void;
}) {
  const m = r.message;
  const spaceId = r.chat.spaceId ?? null;
  const myName = useAuth((s) => s.user?.displayName ?? 'You');
  return (
    <article
      data-testid="search-result"
      data-message-id={m.id}
      aria-label={`Message from ${formatResultTime(m.createdAt)}`}
      className={cn(
        'group/card relative flex gap-3 rounded-lg p-2.5 pr-3 transition-colors',
        variant === 'inset'
          ? 'bg-surface hover:bg-hover'
          : 'bg-surface-2 hover:brightness-[0.98] dark:hover:brightness-110',
      )}
    >
      <span className="w-10 shrink-0">
        {m.senderId ? (
          <SenderAvatar userId={m.senderId} selecting={false} size={40} spaceId={spaceId} />
        ) : null}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-1">
          {m.senderId ? (
            <SenderName userId={m.senderId} selecting={false} spaceId={spaceId} you={myName} />
          ) : null}
          <time
            dateTime={m.createdAt}
            title={new Date(m.createdAt).toLocaleString()}
            className="shrink-0 text-[12px] text-muted"
          >
            {formatResultTime(m.createdAt)}
          </time>
        </div>
        <ResultBody m={m} words={words} />
      </div>
      <button
        type="button"
        onClick={() => onJump(r)}
        className={cn(
          'absolute top-2 right-2 rounded-md px-2 py-0.5 text-[12px] font-semibold text-fg shadow-sm transition-opacity',
          variant === 'sheet'
            ? 'opacity-100'
            : 'opacity-0 group-hover/card:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100',
          'focus-visible:outline-2 focus-visible:outline-brand',
          'hover:bg-brand hover:text-on-brand',
          variant === 'inset' ? 'bg-surface-2' : 'bg-surface',
        )}
      >
        Jump
      </button>
    </article>
  );
}

function GroupHeader({ chat }: { chat: MessageSearchResult['chat'] }) {
  const thread = chat.type === 'space_thread';
  const Icon = chat.type === 'space_stage' ? Podcast : chat.type === 'space_voice' ? Volume2 : Hash;
  return (
    <h3 className="flex min-w-0 items-center gap-1 px-1 pt-3 pb-1.5 text-[13px] font-semibold text-muted">
      <Icon size={15} className="shrink-0" aria-hidden />
      <span className="truncate">
        {thread ? (chat.parentName ?? 'channel') : (chat.name ?? 'channel')}
      </span>
      {thread ? (
        <>
          <ChevronRight size={14} className="shrink-0" aria-hidden />
          <MessagesSquare size={14} className="shrink-0" aria-hidden />
          <span className="truncate">{chat.name ?? 'thread'}</span>
        </>
      ) : null}
    </h3>
  );
}

function ResultsSkeleton() {
  return (
    <div role="status" aria-label="Loading results" className="flex flex-col gap-2 px-3 py-3">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="flex gap-3 rounded-lg p-2.5" style={{ opacity: 1 - i * 0.15 }}>
          <Skeleton circle className="size-10 shrink-0" />
          <div className="flex min-w-0 flex-1 flex-col gap-2 pt-1">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className={i % 2 ? 'h-3 w-4/5' : 'h-3 w-3/5'} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Pager({
  page,
  pages,
  onPage,
}: {
  page: number;
  pages: number;
  onPage: (p: number) => void;
}) {
  if (pages <= 1) return null;
  const btn =
    'inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-[13px] font-medium text-fg hover:bg-hover disabled:pointer-events-none disabled:opacity-40';
  return (
    <nav
      aria-label="Result pages"
      className="flex shrink-0 flex-wrap items-center justify-center gap-1 px-3 py-3"
    >
      <button type="button" className={btn} disabled={page === 0} onClick={() => onPage(page - 1)}>
        <ChevronLeft size={16} aria-hidden /> Previous
      </button>
      {pageList(page, pages).map((p, i) =>
        p === 'gap' ? (
          <span key={`gap-${i}`} className="px-1 text-muted" aria-hidden>
            …
          </span>
        ) : (
          <button
            key={p}
            type="button"
            aria-label={`Page ${p + 1}`}
            aria-current={p === page ? 'page' : undefined}
            className={cn(btn, p === page && 'bg-brand text-on-brand hover:bg-brand')}
            onClick={() => onPage(p)}
          >
            {p + 1}
          </button>
        ),
      )}
      <button
        type="button"
        className={btn}
        disabled={page >= pages - 1}
        onClick={() => onPage(page + 1)}
      >
        Next <ChevronRight size={16} aria-hidden />
      </button>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

interface Loaded {
  key: string;
  data: MessageSearchPage | null;
  error: string | null;
}

export interface SearchResultsProps {
  scope: SearchScope;
  query: string;
  onClose: () => void;
  /** After a Jump (the phone sheet closes). */
  onJumped?: () => void;
  variant?: ResultsVariant;
}

/** Header, results and pager of one query (remount it per query: the page starts at 1). */
export function SearchResults({
  scope,
  query,
  onClose,
  onJumped,
  variant = 'card',
}: SearchResultsProps) {
  const parsed = useMemo(() => parseQuery(query), [query]);
  const apiQuery = useMemo(() => toApiQuery(parsed, scope.kind), [parsed, scope.kind]);
  const words = useMemo(() => searchWords(parsed.text), [parsed.text]);
  const sort = useSearch((s) => s.sort);
  const [page, setPage] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded>({ key: '', data: null, error: null });
  const [lastTotal, setLastTotal] = useState<{ total: number; capped: boolean } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const jump = useJump(onJumped);

  const url =
    scope.kind === 'space'
      ? `/api/spaces/${scope.spaceId}/messages/search`
      : `/api/chats/${scope.chatId}/messages/search`;
  const reqKey = `${url}?${JSON.stringify(apiQuery)}&sort=${sort}&page=${page}&n=${attempt}`;

  useEffect(() => {
    const controller = new AbortController();
    api
      .get<MessageSearchPage>(url, {
        query: { ...apiQuery, sort, offset: page * SEARCH_PAGE_SIZE },
        signal: controller.signal,
      })
      .then((data) => {
        useUsers.getState().upsertUsers(data.users);
        setLoaded({ key: reqKey, data, error: null });
        setLastTotal({ total: data.total, capped: data.capped });
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted)
          setLoaded({ key: reqKey, data: null, error: errorMessage(e) });
      });
    return () => controller.abort();
    // reqKey covers url, query, sort, page and retries.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reqKey]);

  const loading = loaded.key !== reqKey;
  const data = loading ? null : loaded.data;
  const pages = lastTotal ? pageCount(lastTotal.total) : 1;
  const groups = useMemo(() => groupResults(data?.items ?? []), [data]);

  const goTo = (p: number) => {
    setPage(p);
    listRef.current?.scrollTo?.({ top: 0 });
  };
  const setSort = (s: SearchSort) => {
    if (s === sort) return;
    useSearch.getState().setSort(s);
    goTo(0);
  };

  const tab = (s: SearchSort, label: string) => (
    <button
      type="button"
      aria-pressed={sort === s}
      onClick={() => setSort(s)}
      className={cn(
        'rounded-md px-2 py-1 text-[13px] font-medium transition-colors',
        sort === s ? 'bg-hover text-fg' : 'text-muted hover:text-fg',
      )}
    >
      {label}
    </button>
  );

  return (
    <>
      <SearchHighlightStyle />
      <header className="flex h-12 shrink-0 items-center gap-2 pr-2 pl-4">
        <h2
          className="min-w-0 flex-1 truncate text-[15px] font-semibold text-fg"
          aria-live="polite"
        >
          {lastTotal ? resultCountLabel(lastTotal.total, lastTotal.capped) : 'Searching…'}
        </h2>
        <div className="flex items-center gap-0.5" role="group" aria-label="Sort results">
          {tab('newest', 'Newest')}
          {tab('oldest', 'Oldest')}
        </div>
        <IconButton icon={X} label="Close search results" size="sm" onClick={onClose} />
      </header>
      <div
        ref={listRef}
        className="min-h-0 flex-1 overflow-y-auto scrollbar-thin"
        data-testid="search-results-list"
      >
        {loading ? (
          <ResultsSkeleton />
        ) : loaded.error ? (
          <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
            <p className="text-[14px] text-danger">{loaded.error}</p>
            <Button variant="soft" size="sm" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </Button>
          </div>
        ) : !groups.length ? (
          <div
            className="flex flex-col items-center gap-3 px-8 py-14 text-center"
            data-testid="search-empty"
          >
            <div className="flex size-16 items-center justify-center rounded-full bg-brand-soft text-brand-ink">
              <SearchX size={28} aria-hidden />
            </div>
            <p className="max-w-[260px] text-[14px] leading-relaxed text-muted">
              We searched far and wide. Unfortunately, no results were found.
            </p>
          </div>
        ) : (
          <div className="flex flex-col px-3 pb-2">
            {groups.map((g) => (
              <section key={g.key} data-testid="search-group" aria-label={g.chat.name ?? undefined}>
                {scope.kind === 'space' ? <GroupHeader chat={g.chat} /> : <div className="h-2" />}
                <div className="flex flex-col gap-2">
                  {g.items.map((r) => (
                    <ResultCard
                      key={r.message.id}
                      r={r}
                      words={words}
                      variant={variant}
                      onJump={jump}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
        {!loading && !loaded.error && groups.length ? (
          <Pager page={page} pages={pages} onPage={goTo} />
        ) : null}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

/**
 * The right-hand results panel (`useSidePanel().panel = { kind: 'search', scope, query }`).
 * A Space search closes itself once the route shows another Space (or a DM's search shows up
 * in a Space).
 */
export function SearchResultsPanel({
  scope,
  query,
  variant = 'card',
}: {
  scope: SearchScope;
  query: string;
  variant?: Exclude<ResultsVariant, 'sheet'>;
}) {
  const { spaceId } = useParams<{ spaceId?: string }>();
  const stale = !!spaceId && (scope.kind !== 'space' || scope.spaceId !== spaceId);
  useEffect(() => {
    if (stale) useSidePanel.getState().close();
  }, [stale]);
  if (stale) return null;
  return (
    <aside
      aria-label="Search results"
      data-testid="search-results"
      className={cn(
        'relative flex min-h-0 w-[420px] shrink-0 flex-col',
        variant === 'card' ? 'card-pane max-w-[40vw]' : 'max-w-[50%] bg-surface-2',
      )}
    >
      <SearchResults
        key={`${scopeKey(scope)}|${query}`}
        scope={scope}
        query={query}
        variant={variant}
        onClose={() => useSidePanel.getState().close()}
      />
    </aside>
  );
}
