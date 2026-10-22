/**
 * The channel header's Threads button (Discord) and its popout: the channel's Active and
 * Archived threads (name, creator, message count, last activity), a name filter and Create.
 * Also owns the thread deep link (`/spaces/:spaceId/:chatId?thread=<threadId>` opens it beside
 * the channel) and, on phones, the full-screen thread panel of this channel.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Archive, Lock, MessagesSquare, Plus } from 'lucide-react';
import { PERM, hasPerm, type ChatSummary } from '@enbox/shared';
import { UserAvatar } from '@/components/common/UserAvatar';
import { Badge, Button, IconButton, Popover, SearchInput, Spinner, Tabs, toast } from '@/components/ui';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';
import { useSidePanel } from '@/stores/sidePanel';
import { useChannelThreads, useThreads } from '@/stores/threads';
import { useUserName } from '@/stores/users';
import { openThread } from './actions';
import { ThreadPanel } from './ThreadPanel';
import { lastActiveLabel, messagesLabel } from './ThreadStarterCard';

type Tab = 'active' | 'archived';

/**
 * `?thread=<id>` on a channel URL opens that thread beside it (then leaves the URL); a thread
 * opened as a page of its own (a push, the quick switcher) moves to its channel that way.
 */
function useThreadLink(chat: ChatSummary): void {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const threadId = params.get('thread');
  useEffect(() => {
    if (!threadId || chat.type !== 'space_text') return;
    openThread(threadId, chat.id);
    const next = new URLSearchParams(params);
    next.delete('thread');
    setParams(next, { replace: true });
    // Once per link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, chat.id]);
  const parentId = chat.thread?.parentId;
  const spaceId = chat.space?.spaceId;
  useEffect(() => {
    if (chat.type === 'space_thread' && parentId && spaceId)
      navigate(`/spaces/${spaceId}/${parentId}?thread=${chat.id}`, { replace: true });
  }, [chat.type, chat.id, parentId, spaceId, navigate]);
}

export function ThreadsButton({ chat }: { chat: ChatSummary }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const desktop = useIsDesktop();
  const panel = useSidePanel((s) => s.panel);
  useThreadLink(chat);
  // Phones: leaving the channel (Back) closes its full-screen thread too.
  const desktopRef = useRef(desktop);
  desktopRef.current = desktop;
  useEffect(
    () => () => {
      const p = useSidePanel.getState().panel;
      if (!desktopRef.current && p?.kind === 'thread' && p.parentId === chat.id) useSidePanel.getState().close();
    },
    [chat.id],
  );
  if (chat.type !== 'space_text') return null;
  const mobilePanel = !desktop && panel?.kind === 'thread' && panel.parentId === chat.id ? panel : null;
  return (
    <>
      <IconButton
        icon={MessagesSquare}
        label="Threads"
        variant="ghost"
        active={!!anchor}
        aria-haspopup="dialog"
        aria-expanded={!!anchor}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
      />
      <Popover
        open={!!anchor}
        anchor={anchor}
        onClose={() => setAnchor(null)}
        placement="bottom"
        align="end"
        aria-label="Threads"
        className="w-[min(440px,calc(100vw-16px))] overflow-hidden"
      >
        {anchor ? <ThreadsPopout chat={chat} onClose={() => setAnchor(null)} /> : null}
      </Popover>
      {mobilePanel ? (
        <ThreadPanel key={mobilePanel.threadId} threadId={mobilePanel.threadId} parentId={mobilePanel.parentId} overlay />
      ) : null}
    </>
  );
}

const norm = (s: string) => s.toLocaleLowerCase().normalize('NFKD').replace(/\p{M}/gu, '');

/** The popout's body (exported for tests). */
export function ThreadsPopout({ chat, onClose }: { chat: ChatSummary; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('active');
  const [query, setQuery] = useState('');
  const active = useChannelThreads(chat.id);
  const archived = useChannelThreads(chat.id, { archived: true });
  const list = useThreads((s) => s.lists[chat.id]);
  const loaded = tab === 'active' ? list?.active != null : list?.archived != null;

  useEffect(() => {
    void useThreads
      .getState()
      .loadThreads(chat.id, { archived: tab === 'archived' })
      .catch((e: unknown) => toast.error(e));
  }, [chat.id, tab]);

  const rows = useMemo(() => {
    const q = norm(query.trim());
    const all = tab === 'active' ? active : archived;
    return q ? all.filter((t) => norm(t.name ?? '').includes(q)) : all;
  }, [tab, active, archived, query]);

  const canCreate = chat.membership === 'active' && hasPerm(chat.spacePermissions, PERM.SEND_MESSAGES);
  return (
    <div className="flex max-h-[min(70vh,560px)] flex-col" data-testid="threads-popout">
      <div className="flex items-center gap-2 px-4 pt-3 pb-2">
        <MessagesSquare size={20} className="shrink-0 text-muted" aria-hidden />
        <h2 className="shrink-0 text-[16px] font-bold text-fg">Threads</h2>
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search for Thread Name"
          aria-label="Search threads"
          className="ml-1 min-w-0 flex-1"
        />
        {canCreate ? (
          <Button
            size="sm"
            leftIcon={Plus}
            onClick={() => {
              onClose();
              useThreads.getState().startDraft(chat.id);
            }}
          >
            Create Thread
          </Button>
        ) : null}
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        variant="chips"
        aria-label="Thread lists"
        className="px-4 pb-2"
        items={[
          { value: 'active', label: 'Active' },
          { value: 'archived', label: 'Archived' },
        ]}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {rows.length ? (
          <ul aria-label={tab === 'active' ? 'Active threads' : 'Archived threads'} className="flex flex-col gap-0.5">
            {rows.map((t) => (
              <ThreadRow
                key={t.id}
                thread={t}
                onOpen={() => {
                  onClose();
                  openThread(t.id, chat.id);
                }}
              />
            ))}
          </ul>
        ) : !loaded && list?.loading !== false ? (
          <div className="flex justify-center py-8 text-brand-ink">
            <Spinner size={22} />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
            <MessagesSquare size={36} className="text-subtle" aria-hidden />
            <p className="font-semibold text-fg">
              {query ? 'No threads match your search' : tab === 'active' ? 'There are no active threads.' : 'There are no archived threads.'}
            </p>
            {!query && tab === 'active' ? (
              <p className="text-[13px] text-muted">Stay focused on a conversation with a thread — a temporary text channel.</p>
            ) : null}
          </div>
        )}
        {tab === 'archived' && list?.archivedCursor ? (
          <div className="flex justify-center pt-2">
            <Button
              size="sm"
              variant="secondary"
              loading={list.loading}
              onClick={() =>
                void useThreads
                  .getState()
                  .loadThreads(chat.id, { archived: true, more: true })
                  .catch((e: unknown) => toast.error(e))
              }
            >
              Load more
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ThreadRow({ thread, onOpen }: { thread: ChatSummary; onOpen: () => void }) {
  const ownerId = thread.thread?.ownerId ?? null;
  const owner = useUserName(ownerId);
  const count = thread.thread?.messageCount ?? 0;
  const unread = thread.lastSeq > thread.lastReadSeq && thread.lastReadSeq > 0;
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:outline-brand"
        data-testid="thread-row"
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className={cn('truncate text-[15px] text-fg', unread ? 'font-bold' : 'font-semibold')}>{thread.name}</span>
            {thread.thread?.locked ? <Lock size={13} className="shrink-0 text-muted" aria-label="Locked" /> : null}
            {thread.thread?.archived ? <Archive size={13} className="shrink-0 text-muted" aria-label="Archived" /> : null}
          </span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[13px] text-muted">
            {ownerId ? <UserAvatar userId={ownerId} size={16} decorated={false} /> : null}
            {ownerId ? <span className="max-w-[40%] truncate">{owner}</span> : null}
            {ownerId ? <span aria-hidden>·</span> : null}
            <span className="shrink-0">{messagesLabel(count)}</span>
            <span aria-hidden>·</span>
            <span className="truncate">{lastActiveLabel(thread.lastActivityAt)}</span>
          </span>
        </span>
        {thread.unreadMentionCount > 0 ? <Badge count={thread.unreadMentionCount} size="sm" tone="danger" /> : null}
      </button>
    </li>
  );
}
