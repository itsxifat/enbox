/**
 * A forum channel (Discord's forum view): the header, the post guidelines (collapsible
 * markdown), a top bar — "Search or create a post...", New Post, the sort and layout
 * choices — the tag filter row, the inline New Post form, then the posts as a list or a
 * gallery, newest activity (or newest) first, open posts before archived ones, loaded page by
 * page. A post opens in the thread panel beside the forum (on phones over it), so the forum
 * stays behind it; `?thread=<postId>` on the forum's URL opens one.
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  ArrowDownWideNarrow,
  ArrowLeft,
  Bell,
  BookOpen,
  ChevronDown,
  LayoutGrid,
  List,
  MessagesSquare,
  Plus,
  Settings,
  Users,
} from 'lucide-react';
import { PERM, hasPerm, type ChatSummary, type ForumInfo, type ID, type Space } from '@enbox/shared';
import { Button, DropdownMenu, EmptyState, IconButton, SearchInput, Sheet, Spinner, toast } from '@/components/ui';
import { RichText } from '@/features/conversation/bubbles/RichText';
import { InboxButton } from '@/features/inbox/InboxButton';
import { HeaderSearch } from '@/features/search/HeaderSearch';
import { ChannelDialog } from '@/features/spaces/dialogs/ChannelDialog';
import { NotificationDialog } from '@/features/spaces/dialogs/NotificationDialog';
import { MemberList } from '@/features/spaces/MemberList';
import { useSpacesUi } from '@/features/spaces/ui';
import { openThread } from '@/features/threads/actions';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';
import { lazyNamed } from '@/lib/lazy';
import { useConnection } from '@/lib/socket';
import {
  filterKey,
  forumOf,
  useForumPosts,
  useForums,
  viewOf,
  type ForumFilter,
  type ForumView,
} from '@/stores/forums';
import { useSidePanel } from '@/stores/sidePanel';
import { NewPostComposer } from './NewPostComposer';
import { PostCard } from './PostCard';
import { TagToggle } from './tags';

const ThreadPanel = lazyNamed(() => import('@/features/threads/ThreadPanel'), 'ThreadPanel');

/** Search keystrokes wait this long before the server is asked (the list filters at once). */
const SEARCH_DEBOUNCE_MS = 250;

const SORT_LABELS = { activity: 'Recent Activity', created: 'Creation Time' } as const;
const LAYOUT_LABELS = { list: 'List', gallery: 'Gallery' } as const;

function ForumHeader({ chat, space }: { chat: ChatSummary; space: Space }) {
  const desktop = useIsDesktop();
  const navigate = useNavigate();
  const ui = useSpacesUi();
  const [dialog, setDialog] = useState<'settings' | 'notifications' | 'members' | null>(null);
  const canManage = hasPerm(chat.spacePermissions, PERM.MANAGE_CHANNELS);
  return (
    <header className="flex min-h-14 shrink-0 items-center gap-2 px-3 pt-[env(safe-area-inset-top)]" data-testid="forum-header">
      {desktop ? null : (
        <IconButton icon={ArrowLeft} label="Back" variant="ghost" onClick={() => navigate(`/spaces/${space.id}`)} />
      )}
      <MessagesSquare size={22} className="shrink-0 text-muted" aria-hidden />
      <h1 className="min-w-0 flex-1 truncate text-[16px] font-bold text-fg">{chat.name}</h1>
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <IconButton icon={Bell} label="Notification settings" variant="ghost" onClick={() => setDialog('notifications')} />
        {canManage ? (
          <IconButton icon={Settings} label="Edit channel" variant="ghost" onClick={() => setDialog('settings')} />
        ) : null}
        <IconButton
          icon={Users}
          label={ui.canShowMembers ? (ui.membersOpen ? 'Hide member list' : 'Show member list') : 'Members'}
          variant="ghost"
          active={ui.membersOpen}
          onClick={() => (ui.canShowMembers ? ui.toggleMembers() : setDialog('members'))}
        />
        {/* A forum holds no messages itself: search the Space. */}
        <HeaderSearch scope={{ kind: 'space', spaceId: space.id }} chatId={chat.id} />
        <InboxButton />
      </div>
      {dialog === 'settings' ? <ChannelDialog spaceId={space.id} chat={chat} onClose={() => setDialog(null)} /> : null}
      {dialog === 'notifications' ? <NotificationDialog space={space} chat={chat} onClose={() => setDialog(null)} /> : null}
      <Sheet open={dialog === 'members'} onClose={() => setDialog(null)} aria-label="Members">
        <MemberList spaceId={space.id} inSheet />
      </Sheet>
    </header>
  );
}

/** The forum's post guidelines (markdown), open until collapsed. */
function Guidelines({ text }: { text: string }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="card-inset px-4 py-3" aria-label="Post guidelines" data-testid="forum-guidelines">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 text-left text-muted hover:text-fg"
      >
        <BookOpen size={16} aria-hidden />
        <span className="flex-1 text-[12px] font-bold tracking-wide uppercase">Post Guidelines</span>
        <ChevronDown size={16} className={cn('transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open ? (
        <div className="mt-2 text-[14.5px] leading-relaxed break-words text-fg" data-testid="forum-guidelines-text">
          <RichText text={text} />
        </div>
      ) : null}
    </section>
  );
}

/** A chip that opens a small menu of choices (Sort, Layout). */
function ChoiceChip<T extends string>({
  label,
  icon: Icon,
  value,
  options,
  onChange,
}: {
  label: string;
  icon: typeof List;
  value: T;
  options: Record<T, string>;
  onChange: (v: T) => void;
}) {
  return (
    <DropdownMenu
      aria-label={label}
      align="end"
      items={(Object.keys(options) as T[]).map((v) => ({
        label: options[v],
        checked: v === value,
        radio: true,
        onSelect: () => onChange(v),
      }))}
      trigger={({ active, ...p }) => (
        <button
          type="button"
          {...p}
          aria-label={`${label}: ${options[value]}`}
          className={cn(
            'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-brand',
            active ? 'bg-brand-soft text-brand-ink' : 'bg-surface-2 text-muted hover:bg-line hover:text-fg',
          )}
        >
          <Icon size={15} aria-hidden />
          <span className="hidden sm:inline">{label}:</span>
          <span>{options[value]}</span>
          <ChevronDown size={14} aria-hidden />
        </button>
      )}
    />
  );
}

/** Phones: the panel of a post covers the forum; leaving the forum closes it. */
function usePhonePanel(forumId: ID) {
  const desktop = useIsDesktop();
  const panel = useSidePanel((s) => s.panel);
  const desktopRef = useRef(desktop);
  desktopRef.current = desktop;
  useEffect(
    () => () => {
      const p = useSidePanel.getState().panel;
      if (!desktopRef.current && p?.kind === 'thread' && p.parentId === forumId) useSidePanel.getState().close();
    },
    [forumId],
  );
  return !desktop && panel?.kind === 'thread' && panel.parentId === forumId ? panel : null;
}

/** `?thread=<postId>` on the forum's URL opens that post beside it, then leaves the URL. */
function usePostLink(forumId: ID): void {
  const [params, setParams] = useSearchParams();
  const threadId = params.get('thread');
  useEffect(() => {
    if (!threadId) return;
    openThread(threadId, forumId);
    const next = new URLSearchParams(params);
    next.delete('thread');
    setParams(next, { replace: true });
    // Once per link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, forumId]);
}

function PostGrid({
  posts,
  info,
  view,
  openId,
  forumId,
}: {
  posts: ChatSummary[];
  info: ForumInfo;
  view: ForumView;
  openId: ID | null;
  forumId: ID;
}) {
  return (
    <ul
      className={cn(
        view.layout === 'gallery' ? 'grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3' : 'flex flex-col gap-2',
      )}
      aria-label="Posts"
    >
      {posts.map((p) => (
        <li key={p.id} className="min-w-0">
          <PostCard
            post={p}
            forum={info}
            sort={view.sort}
            layout={view.layout}
            active={p.id === openId}
            onOpen={() => openThread(p.id, forumId)}
          />
        </li>
      ))}
    </ul>
  );
}

export function ForumChannelView({ chat, space }: { chat: ChatSummary; space: Space }) {
  const info = forumOf(chat);
  const mine = useForums((s) => s.views[chat.id]);
  const view = viewOf(info, mine);
  const { sort, tag, q } = view;
  const filter = useMemo<ForumFilter>(() => ({ sort, tag, q }), [sort, tag, q]);
  const key = filterKey(filter);
  const { open, archived } = useForumPosts(chat.id, filter);
  const list = useForums((s) => (s.lists[chat.id]?.key === key ? s.lists[chat.id] : undefined));
  const readyCount = useConnection((s) => s.readyCount);
  const openId = useSidePanel((s) => (s.panel?.kind === 'thread' && s.panel.parentId === chat.id ? s.panel.threadId : null));
  const [composer, setComposer] = useState<{ title: string } | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const phonePanel = usePhonePanel(chat.id);
  usePostLink(chat.id);

  const canPost = chat.membership === 'active' && hasPerm(chat.spacePermissions, PERM.SEND_MESSAGES);
  const setView = (patch: Partial<ForumView>) => useForums.getState().setView(chat.id, patch);

  // The first page for this filter (searches wait for a pause in typing); again on reconnects.
  const search = q.trim();
  useEffect(() => {
    const run = () =>
      void useForums
        .getState()
        .loadPosts(chat.id, { sort, tag, q: search })
        .catch(() => undefined);
    if (!search) return run();
    const t = setTimeout(run, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [chat.id, sort, tag, search, readyCount]);

  // Every open post loaded: the archived ones follow below them (Discord's older posts).
  const openDone = !!list?.open.loaded && !list.open.cursor;
  const archivedPending = !!list && !list.archived.loaded && !list.archived.loading && !list.archived.error;
  useEffect(() => {
    if (openDone && archivedPending)
      void useForums
        .getState()
        .loadPosts(chat.id, filter, { archived: true })
        .catch(() => undefined);
  }, [openDone, archivedPending, chat.id, filter]);

  const hasMore = !!list?.open.loaded && (!!list.open.cursor || !!list.archived.cursor);
  const loading = !!list && (list.open.loading || list.archived.loading);
  // Nothing more to wait for before saying the forum (or the filter) is empty.
  const settled = !!list?.open.loaded && (!!list.open.cursor || list.archived.loaded || !!list.archived.error);
  const loadMore = useCallback(() => {
    const s = useForums.getState().lists[chat.id];
    if (!s || s.key !== key || s.open.loading || s.archived.loading) return;
    const store = useForums.getState();
    const done = (p: Promise<void>) => void p.catch((e: unknown) => toast.error(e));
    if (s.open.cursor) done(store.loadPosts(chat.id, filter, { more: true }));
    else if (s.archived.cursor) done(store.loadPosts(chat.id, filter, { archived: true, more: true }));
  }, [chat.id, key, filter]);

  // Endless scrolling where the browser can tell (the button below works everywhere).
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) loadMore();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loadMore, open.length, archived.length]);

  const startPost = () => {
    setComposer({ title: q.trim() });
  };
  const filtered = !!tag || !!search;
  const nothing = open.length === 0 && archived.length === 0;
  const guidelines = info.settings.guidelines?.trim();

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="forum-view" data-forum-id={chat.id}>
      <ForumHeader chat={chat} space={space} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-3 px-4 pt-1 pb-6">
          {guidelines ? <Guidelines text={guidelines} /> : null}
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput
              value={q}
              onChange={(v) => setView({ q: v })}
              placeholder={canPost ? 'Search or create a post...' : 'Search posts...'}
              aria-label="Search posts"
              className="min-w-[200px] flex-1"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canPost && q.trim()) {
                  e.preventDefault();
                  startPost();
                }
              }}
            />
            {canPost ? (
              <Button leftIcon={Plus} size="sm" onClick={startPost} data-testid="forum-new-post-button">
                New Post
              </Button>
            ) : null}
            <ChoiceChip label="Sort" icon={ArrowDownWideNarrow} value={sort} options={SORT_LABELS} onChange={(v) => setView({ sort: v })} />
            <ChoiceChip
              label="Layout"
              icon={view.layout === 'gallery' ? LayoutGrid : List}
              value={view.layout}
              options={LAYOUT_LABELS}
              onChange={(v) => setView({ layout: v })}
            />
          </div>
          {info.tags.length ? (
            <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 scrollbar-none" role="group" aria-label="Filter by tag">
              {info.tags.map((t) => (
                <TagToggle key={t.id} tag={t} selected={tag === t.id} onClick={() => setView({ tag: tag === t.id ? null : t.id })} />
              ))}
            </div>
          ) : null}
          {composer && canPost ? (
            <NewPostComposer forum={chat} info={info} initialTitle={composer.title} onClose={() => setComposer(null)} />
          ) : null}

          {nothing ? (
            !settled ? (
              list?.open.error ? (
                <EmptyState
                  icon={MessagesSquare}
                  title="Couldn’t load the posts"
                  description={list.open.error}
                  action={
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void useForums.getState().loadPosts(chat.id, filter).catch((e: unknown) => toast.error(e))}
                    >
                      Try again
                    </Button>
                  }
                />
              ) : (
                <div className="flex justify-center py-12 text-brand-ink" data-testid="forum-loading">
                  <Spinner size={24} />
                </div>
              )
            ) : filtered ? (
              <EmptyState
                icon={MessagesSquare}
                title="No posts match"
                description={search ? `Nothing found for “${search}”.` : 'No post wears this tag yet.'}
                action={
                  <Button size="sm" variant="secondary" onClick={() => setView({ q: '', tag: null })}>
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={MessagesSquare}
                title="There are no posts yet"
                description="Start the first conversation here: each post gets its own replies."
                action={
                  canPost && !composer ? (
                    <Button size="sm" leftIcon={Plus} onClick={startPost}>
                      New Post
                    </Button>
                  ) : undefined
                }
              />
            )
          ) : (
            <>
              <PostGrid posts={open} info={info} view={view} openId={openId} forumId={chat.id} />
              {archived.length ? (
                <>
                  <h2 className="section-label px-1 pt-3">Older posts</h2>
                  <PostGrid posts={archived} info={info} view={view} openId={openId} forumId={chat.id} />
                </>
              ) : null}
            </>
          )}

          {hasMore && !nothing ? (
            <div ref={sentinel} className="flex justify-center pt-2">
              <Button size="sm" variant="secondary" loading={loading} onClick={loadMore}>
                Load more posts
              </Button>
            </div>
          ) : null}
        </div>
      </div>
      {phonePanel ? (
        <Suspense fallback={null}>
          <ThreadPanel key={phonePanel.threadId} threadId={phonePanel.threadId} parentId={phonePanel.parentId} overlay />
        </Suspense>
      ) : null}
    </div>
  );
}
