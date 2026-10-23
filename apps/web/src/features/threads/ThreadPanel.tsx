/**
 * A thread beside its channel (Discord's thread panel), a card pane in place of the member
 * list: the header (thread icon, name, a forum post's tags, its pin / lock / closed marks, "…"
 * menu with Follow / Archive — a post's Close — / Lock / Pin (posts) / Rename / Copy Link /
 * Delete as permitted and Copy ID in Developer Mode, close ✕), the starter message, then the
 * thread's conversation — the channel's message list, typing line, composer and message menu,
 * for the thread's chat. On phones the same panel covers the screen (`overlay`, rendered by
 * the channel header's ThreadsButton).
 *
 * `threadId === NEW_THREAD_ID` is the "New Thread" form: a name (prefilled with the starter
 * message's text), the starter message, and the first message — sending it creates the thread.
 *
 * The thread's chat is shown as a text channel of its Space (`type: 'space_text'`, the
 * composer's mentions and the Space message rows work as in the channel) with my permissions
 * computed here: the parent channel's, minus sending when the thread is locked.
 */
import { Suspense, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useParams } from 'react-router';
import { Archive, EllipsisVertical, IdCard, Link2, Lock, MessagesSquare, Pin, SendHorizontal, X } from 'lucide-react';
import type { ChatSummary, ID, Message } from '@enbox/shared';
import { DropdownMenu, EmptyState, IconButton, Input, PageSpinner, Portal, toast, type MenuEntry } from '@/components/ui';
import { RowAppearanceContext } from '@/features/conversation/bubbles/appearance';
import { ReadOnlyFooter, SelectionBar } from '@/features/conversation/Bars';
import { Composer } from '@/features/conversation/composer/Composer';
import { LazyLightbox } from '@/features/conversation/lazy';
import { MessageActionsHost } from '@/features/conversation/MessageActionsHost';
import { MessageList, type JumpTarget, type UnreadSnapshot } from '@/features/conversation/MessageList';
import { MessageContent, SenderAvatar, SenderName, rowShape } from '@/features/conversation/MessageRow';
import { copyId, useDeveloperMode } from '@/features/conversation/moreActions';
import { useConversationUi } from '@/features/conversation/state';
import { postTags } from '@/features/forums/format';
import { TagPill } from '@/features/forums/tags';
import { cn } from '@/lib/cn';
import { formatTime } from '@/lib/format';
import { markChatRead } from '@/realtime/chats';
import { useAuth } from '@/stores/auth';
import { useChat, useChats } from '@/stores/chats';
import { useMessages } from '@/stores/messages';
import { useSidePanel } from '@/stores/sidePanel';
import { useSpace } from '@/stores/spaces';
import { NEW_THREAD_ID, threadRights, threadView, useThreads } from '@/stores/threads';
import { copyThreadLink, deleteThreadItem, threadMenuItems } from './actions';

const COZY = { bubbleStyle: 'cozy' as const, messageAnimation: 'fade' as const };

function closePanel(): void {
  useSidePanel.getState().close();
  if (useThreads.getState().draft) useThreads.setState({ draft: null });
}

export function ThreadPanel({ threadId, parentId, overlay = false }: { threadId: ID; parentId: ID; overlay?: boolean }) {
  // Desktop: the panel belongs to its channel; going to ANOTHER channel closes it. Only a
  // route change counts (a jump may open the panel first and land on the channel after).
  const { chatId } = useParams<{ chatId?: string }>();
  const routeAtOpen = useRef(chatId);
  useEffect(() => {
    if (overlay || chatId === routeAtOpen.current) return;
    routeAtOpen.current = chatId;
    if (chatId && chatId !== parentId) closePanel();
  }, [overlay, chatId, parentId]);
  return threadId === NEW_THREAD_ID ? (
    <NewThread parentId={parentId} overlay={overlay} />
  ) : (
    <OpenThread threadId={threadId} parentId={parentId} overlay={overlay} />
  );
}

function Shell({
  overlay,
  label,
  children,
  chatId,
}: {
  overlay: boolean;
  label: string;
  children: ReactNode;
  /** The thread's chat: Escape leaves its select mode first. */
  chatId?: ID;
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Escape' || e.defaultPrevented || !chatId) return;
    const ui = useConversationUi.getState();
    if (ui.selecting[chatId] === undefined) return;
    ui.clearSelect(chatId);
    e.preventDefault();
  };
  const body = (
    <aside
      aria-label={label}
      onKeyDown={onKeyDown}
      data-testid="thread-panel"
      className={
        overlay
          ? 'fixed inset-0 z-40 flex flex-col bg-surface pt-[env(safe-area-inset-top)]'
          : 'card-pane relative flex w-[clamp(360px,32vw,480px)] min-w-0 shrink-0 flex-col'
      }
    >
      {children}
    </aside>
  );
  return overlay ? <Portal>{body}</Portal> : body;
}

function Header({ title, badges, actions }: { title: ReactNode; badges?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex min-h-14 shrink-0 items-center gap-2 pr-2 pl-4" data-testid="thread-panel-header">
      <MessagesSquare size={20} className="shrink-0 text-muted" aria-hidden />
      <div className="flex min-w-0 flex-1 items-center gap-1.5">{title}</div>
      {badges}
      <div className="flex shrink-0 items-center gap-0.5">
        {actions}
        <IconButton icon={X} label="Close thread" variant="ghost" onClick={closePanel} />
      </div>
    </header>
  );
}

/** The starter message as Discord shows it on top of a thread: a full message row, no actions. */
function StarterRow({ m, chat }: { m: Message; chat: ChatSummary }) {
  return (
    <div className="flex items-start gap-3 px-4 py-2" data-testid="thread-starter" data-message-id={m.id}>
      {m.senderId ? (
        <SenderAvatar userId={m.senderId} selecting={false} size={40} spaceId={chat.space?.spaceId} />
      ) : (
        <span className="size-10 shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          {m.senderId ? (
            <SenderName userId={m.senderId} selecting={false} className="text-[14.5px]" spaceId={chat.space?.spaceId} />
          ) : null}
          <span className="shrink-0 text-[11.5px] text-muted">{formatTime(m.createdAt)}</span>
        </div>
        <MessageContent m={m} mine={false} chat={chat} search={null} shape={rowShape(m, false)} />
      </div>
    </div>
  );
}

/** The thread's starter message from the channel's loaded window, else the copy seen on the way in. */
function useStarter(thread: ChatSummary): Message | undefined {
  const starterId = thread.thread?.starterMessageId;
  const parentId = thread.thread?.parentId;
  const fromWindow = useMessages((s) =>
    starterId && parentId ? s.byChat[parentId]?.items.find((m) => m.id === starterId) : undefined,
  );
  const stashed = useThreads((s) => s.starters[thread.id]);
  return fromWindow ?? (stashed?.id === starterId ? stashed : undefined);
}

// ---------------------------------------------------------------------------
// An open thread
// ---------------------------------------------------------------------------

function OpenThread({ threadId, parentId, overlay }: { threadId: ID; parentId: ID; overlay: boolean }) {
  const thread = useChat(threadId);
  const parent = useChat(parentId);
  const space = useSpace(thread?.space?.spaceId ?? parent?.space?.spaceId);
  const me = useAuth((s) => s.user?.id) ?? '';
  const [missing, setMissing] = useState(false);
  const known = !!thread;

  // Not in the chats store (a link, an archived thread dropped by a channel-list reload): fetch it.
  useEffect(() => {
    if (known) return;
    let live = true;
    void useChats
      .getState()
      .refreshChat(threadId)
      .then((c) => live && !c && setMissing(true))
      .catch(() => live && setMissing(true));
    return () => {
      live = false;
    };
  }, [threadId, known]);

  // Read while open and focused (the conversation's own tracking follows the channel).
  const lastSeq = thread?.lastSeq;
  useEffect(() => {
    if (lastSeq !== undefined) markChatRead(threadId);
  }, [threadId, lastSeq]);
  useEffect(() => {
    const onFocus = () => markChatRead(threadId);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [threadId]);

  const view = useMemo(() => {
    if (!thread) return null;
    const { bits, permissions } = threadView(thread, space, parent, me);
    return { ...thread, type: 'space_text' as const, spacePermissions: bits, permissions };
  }, [thread, space, parent, me]);
  const selecting = useConversationUi((s) => s.selecting[threadId] !== undefined);

  if (!thread || !view)
    return (
      <Shell overlay={overlay} label="Thread">
        <Header title={<span className="truncate text-[16px] font-bold text-fg">Thread</span>} />
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          {missing ? (
            <EmptyState icon={MessagesSquare} title="Thread not found" description="It may have been deleted, or you can no longer see its channel." />
          ) : (
            <PageSpinner />
          )}
        </div>
      </Shell>
    );
  return (
    <Shell overlay={overlay} label={`Thread ${thread.name ?? ''}`} chatId={threadId}>
      {selecting ? <SelectionBar chat={view} /> : <ThreadHeader thread={view} me={me} />}
      <ThreadConversation chat={view} parent={parent} />
    </Shell>
  );
}

function ThreadHeader({ thread, me }: { thread: ChatSummary; me: ID }) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(thread.name ?? '');
  const info = thread.thread;
  const spaceId = thread.space?.spaceId;
  // A forum's threads are its posts; a post wears tags of its forum.
  const parentType = useChats((s) => (info ? s.byId[info.parentId]?.type : undefined));
  const forum = useChats((s) => (info ? s.byId[info.parentId]?.space?.forum : undefined));
  const post = parentType === 'space_forum';
  const noun = post ? 'Post' : 'Thread';
  const rights = threadRights(thread, me, { post });
  const tags = post && forum ? postTags(forum, info?.appliedTags) : [];
  const devMode = useDeveloperMode();

  const save = () => {
    const next = name.trim();
    setRenaming(false);
    if (next && next !== thread.name)
      void useThreads
        .getState()
        .updateThread(thread.id, { name: next })
        .catch((e: unknown) => toast.error(e));
    else setName(thread.name ?? '');
  };

  const items: MenuEntry[] = [
    ...threadMenuItems(thread, me, {
      post,
      onRename: () => {
        setName(thread.name ?? '');
        setRenaming(true);
      },
    }),
    spaceId && info
      ? { label: 'Copy Link', icon: Link2, onSelect: () => copyThreadLink(spaceId, info.parentId, thread.id) }
      : null,
    rights.canDelete && 'separator',
    rights.canDelete && deleteThreadItem(thread, noun),
    devMode && 'separator',
    devMode && { label: `Copy ${noun} ID`, icon: IdCard, onSelect: () => void copyId(thread.id, `${noun} ID`) },
  ];

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') save();
    if (e.key === 'Escape') {
      e.preventDefault();
      setRenaming(false);
      setName(thread.name ?? '');
    }
  };

  return (
    <Header
      title={
        renaming ? (
          <Input
            aria-label="Thread name"
            value={name}
            maxLength={100}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={onKey}
            onBlur={save}
            containerClassName="min-w-0 flex-1"
          />
        ) : (
          <div className="flex min-w-0 flex-col">
            <h2 className="truncate text-[16px] font-bold text-fg" title={thread.name ?? undefined}>
              {thread.name}
            </h2>
            {tags.length ? (
              <ul aria-label="Post tags" className="mt-0.5 flex min-w-0 gap-1 overflow-hidden" data-testid="thread-post-tags">
                {tags.map((t) => (
                  <li key={t.id} className="min-w-0 shrink-0">
                    <TagPill tag={t} />
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        )
      }
      badges={
        <span className="flex shrink-0 items-center gap-1 text-muted">
          {info?.pinned ? <Pin size={15} aria-label="Pinned" /> : null}
          {info?.locked ? <Lock size={15} aria-label="Locked" /> : null}
          {info?.archived ? <Archive size={15} aria-label={post ? 'Closed' : 'Archived'} /> : null}
        </span>
      }
      actions={
        items.some(Boolean) ? (
          <DropdownMenu
            aria-label="Thread options"
            trigger={(p) => <IconButton {...p} icon={EllipsisVertical} label="Thread options" variant="ghost" />}
            items={items}
          />
        ) : null
      }
    />
  );
}

function ThreadConversation({ chat, parent }: { chat: ChatSummary; parent: ChatSummary | undefined }) {
  const hasWindow = useMessages((s) => s.byChat[chat.id] !== undefined);
  const viewer = useConversationUi((s) => s.viewer?.chatId === chat.id);
  const starter = useStarter(chat);
  // Captured before the thread is marked read (like the channel's "N new messages" divider).
  const [unread] = useState<UnreadSnapshot | null>(() =>
    chat.unreadCount > 0 ? { afterSeq: chat.lastReadSeq, count: chat.unreadCount } : null,
  );
  // A jump requested for this thread before the panel opened (search, Inbox): open there. The
  // list consumes the request itself once mounted (scroll + highlight), like a channel's.
  const [target] = useState<JumpTarget | null>(() => {
    const j = useConversationUi.getState().jump;
    return j?.chatId === chat.id ? { seq: j.seq, messageId: j.messageId } : null;
  });

  useEffect(() => {
    const s = useMessages.getState().byChat[chat.id];
    if (s?.loadingLatest) return;
    if (target && !(s?.loaded && s.items.some((m) => m.seq === target.seq)))
      void useMessages
        .getState()
        .loadAround(chat.id, target.seq)
        .catch(() => undefined);
    else if (!s?.loaded || (s.hasMoreAfter && !target))
      void useMessages
        .getState()
        .loadLatest(chat.id)
        .catch(() => undefined);
    // Once per thread; errors show in the list (retry).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.id]);

  // Reply / Edit focus the composer through one shared request that both composers answer
  // (this one last): when it was the channel's, give the focus back to the channel's composer.
  const parentId = chat.thread?.parentId;
  useEffect(() => {
    if (!parentId) return;
    return useConversationUi.subscribe((s, prev) => {
      if (s.focusToken === prev.focusToken) return;
      if (s.reply[parentId] === prev.reply[parentId] && s.editing[parentId] === prev.editing[parentId]) return;
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLTextAreaElement>(`[data-testid="conversation"][data-chat-id="${parentId}"] textarea`)
          ?.focus(),
      );
    });
  }, [parentId]);

  // Leaving the thread: reset its transient UI (reply, edit, menus), like the conversation does.
  useEffect(
    () => () => {
      const ui = useConversationUi.getState();
      ui.clearSelect(chat.id);
      ui.setSearch(chat.id, null);
      if (ui.action?.chatId === chat.id) ui.openActions(null);
      if (ui.editing[chat.id]) ui.setEditing(chat.id, null);
      if (ui.reply[chat.id]) ui.setReply(chat.id, null);
    },
    [chat.id],
  );

  const info = chat.thread;
  const canCompose = chat.membership === 'active' && chat.permissions.canSend;
  const post = parent?.type === 'space_forum';
  return (
    <RowAppearanceContext.Provider value={COZY}>
      {starter && parent ? (
        <div className="max-h-[38%] shrink-0 overflow-y-auto">
          <StarterRow m={starter} chat={parent} />
        </div>
      ) : info?.starterMessageId ? (
        <p className="shrink-0 px-4 pb-2 text-[13px] text-muted">Started from a message in #{parent?.name ?? 'channel'}.</p>
      ) : null}
      <div className="relative min-h-0 flex-1" data-testid="thread-messages">
        {!hasWindow ? <PageSpinner /> : <MessageList chat={chat} unread={unread} initialTarget={target} />}
      </div>
      {info?.archived && canCompose ? (
        <p className="shrink-0 px-4 pt-1 text-[12.5px] text-muted" data-testid="thread-archived-note">
          {post
            ? 'This post is closed. Sending a message will reopen it.'
            : 'This thread is archived. Sending a message will unarchive it.'}
        </p>
      ) : null}
      {canCompose ? (
        <Composer chat={chat} />
      ) : info?.locked ? (
        <div
          className="card-inset mx-3 mt-2 mb-[max(12px,env(safe-area-inset-bottom))] shrink-0 px-4 py-3 text-center text-[14px] text-muted"
          data-testid="thread-locked-footer"
        >
          This {post ? 'post' : 'thread'} is locked. Only moderators can send messages.
        </div>
      ) : (
        <ReadOnlyFooter chat={chat} onDeleted={closePanel} />
      )}
      <MessageActionsHost chat={chat} />
      {viewer ? (
        <Suspense fallback={null}>
          <LazyLightbox />
        </Suspense>
      ) : null}
    </RowAppearanceContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// New Thread
// ---------------------------------------------------------------------------

function NewThread({ parentId, overlay }: { parentId: ID; overlay: boolean }) {
  const draft = useThreads((s) => s.draft);
  const parent = useChat(parentId);
  const starter = useThreads((s) => (draft?.messageId ? s.starters[`${NEW_THREAD_ID}:${draft.messageId}`] : undefined));
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const stale = !draft || draft.parentId !== parentId;

  // No draft for this channel (any more): close the panel — unless it already moved on to the
  // thread the draft became.
  useEffect(() => {
    const p = useSidePanel.getState().panel;
    if (stale && p?.kind === 'thread' && p.threadId === NEW_THREAD_ID) useSidePanel.getState().close();
  }, [stale]);
  if (stale) return null;

  const submit = async () => {
    if (busy || !text.trim()) return;
    setBusy(true);
    try {
      await useThreads.getState().submitDraft(text);
    } catch (e) {
      toast.error(e);
      setBusy(false);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <Shell overlay={overlay} label="New Thread">
      <Header title={<h2 className="truncate text-[16px] font-bold text-fg">New Thread</h2>} />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {starter && parent ? <StarterRow m={starter} chat={parent} /> : null}
        <div className="px-4 pt-3">
          <label htmlFor="thread-name" className="mb-1.5 block text-[12px] font-bold tracking-wide text-muted uppercase">
            Thread Name
          </label>
          <Input
            id="thread-name"
            value={draft.name}
            maxLength={100}
            placeholder="New Thread"
            autoFocus
            onChange={(e) => useThreads.getState().setDraftName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                textRef.current?.focus();
              }
            }}
            data-testid="thread-name-input"
          />
          <p className="mt-2 text-[13px] text-muted">
            Send the first message to start the thread{parent?.name ? ` in #${parent.name}` : ''}.
          </p>
        </div>
        <div className="flex-1" />
      </div>
      <form
        className="mx-3 mt-2 mb-[max(12px,env(safe-area-inset-bottom))] flex shrink-0 items-end gap-2 rounded-xl bg-surface-2 px-3 py-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <textarea
          ref={textRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          rows={1}
          maxLength={4000}
          aria-label="First message"
          placeholder="Enter a message to start the thread"
          className="max-h-40 min-h-6 flex-1 resize-none bg-transparent py-1 text-chat text-fg outline-none placeholder:text-subtle"
          data-testid="thread-first-message"
        />
        <IconButton
          icon={SendHorizontal}
          label="Create Thread"
          variant="ghost"
          type="submit"
          loading={busy}
          disabled={!text.trim()}
          className={cn(text.trim() && 'text-brand-ink')}
        />
      </form>
    </Shell>
  );
}
