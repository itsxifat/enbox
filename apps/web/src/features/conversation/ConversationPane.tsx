/**
 * The conversation view for /chats/:chatId (also /archived/:chatId, /starred/:chatId and
 * reused by the channel view).
 *
 * Contract kept for other features:
 * - calls `useChats().setOpenChat(chatId)` while mounted (read receipts, unread suppression,
 *   notification muting — see realtime/chats.ts `markChatRead`)
 * - loads with `useMessages().loadLatest(chatId)` (or `loadAround` for `?m=<seq>` links,
 *   see features/chats/links.ts `messageLink`)
 * - info panels by chat type: ContactInfoPanel (direct), GroupInfoPanel (group),
 *   ChannelInfoPanel (channel), all `{ chatId, onClose }`, inside a <Sheet>
 * - calls start with `useCalls().startCall(chatId, 'audio' | 'video')`
 */
import { Suspense, useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { MessageCircleOff } from 'lucide-react';
import type { ChatSummary } from '@enbox/shared';
import { PaneHeader } from '@/components/layout/PaneHeader';
import { Button, EmptyState, PageSpinner, Sheet } from '@/components/ui';
import { ChannelInfoPanel } from '@/features/channels/ChannelInfoPanel';
import { ContactInfoPanel } from '@/features/contacts/ContactInfoPanel';
import { GroupInfoPanel } from '@/features/groups/GroupInfoPanel';
import { chatPath } from '@/features/chats/links';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { useChat, useChats } from '@/stores/chats';
import { useMessages } from '@/stores/messages';
import { ChatSearchBar, ReadOnlyFooter, SelectionBar } from './Bars';
import { Composer } from './composer/Composer';
import { ConversationHeader, backPath } from './ConversationHeader';
import { ForwardDialog } from './ForwardDialog';
import { LazyLightbox } from './lazy';
import { MessageActionsHost } from './MessageActionsHost';
import { MessageInfoSheet } from './MessageInfoSheet';
import { MessageList, type JumpTarget, type UnreadSnapshot } from './MessageList';
import { OngoingCallBanner } from '@/features/calls';
import { PinnedBar } from './PinnedBar';
import { useConversationUi } from './state';

function InfoPanel({ chat, onClose }: { chat: ChatSummary; onClose: () => void }) {
  if (chat.type === 'direct') return <ContactInfoPanel chatId={chat.id} onClose={onClose} />;
  if (chat.type === 'channel') return <ChannelInfoPanel chatId={chat.id} onClose={onClose} />;
  return <GroupInfoPanel chatId={chat.id} onClose={onClose} />;
}

function targetFromParams(params: URLSearchParams): JumpTarget | null {
  const seq = Number(params.get('m'));
  if (!Number.isInteger(seq) || seq <= 0) return null;
  return { seq, messageId: params.get('mid') ?? undefined };
}

export function ConversationPane() {
  const { chatId } = useParams<{ chatId: string }>();
  const [params, setParams] = useSearchParams();
  const chat = useChat(chatId);
  const chatsLoaded = useChats((s) => s.loaded);
  const [consumed, setConsumed] = useState<{ chatId: string; t: JumpTarget } | null>(null);

  // `?m=<seq>[&mid=<id>]` links (search results, starred): remember, then drop from the URL.
  const paramTarget = targetFromParams(params);
  const target = paramTarget && chatId ? { chatId, t: paramTarget } : consumed;
  const paramKey = paramTarget
    ? `${chatId}:${paramTarget.seq}:${paramTarget.messageId ?? ''}`
    : null;
  const isChannel = chat?.type === 'channel';
  useEffect(() => {
    // Channels redirect to their feed with the params (see below): leave the URL alone.
    if (!paramKey || !chatId || !paramTarget || isChannel) return;
    setConsumed({ chatId, t: paramTarget });
    const next = new URLSearchParams(params);
    next.delete('m');
    next.delete('mid');
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramKey]);

  useEffect(() => {
    if (!chatId) return;
    useChats.getState().setOpenChat(chatId);
    return () => {
      if (useChats.getState().openChatId === chatId) useChats.getState().setOpenChat(null);
    };
  }, [chatId]);

  useEffect(() => {
    if (chatId && chatsLoaded && !chat)
      void useChats
        .getState()
        .refreshChat(chatId)
        .catch(() => undefined);
  }, [chatId, chatsLoaded, chat]);

  if (!chat) return <MissingChat loaded={chatsLoaded} />;
  // Channels have their own feed (ChannelPane); search/starred/forward links land here too.
  if (chat.type === 'channel')
    return (
      <Navigate
        to={chatPath(chat, { seq: paramTarget?.seq, messageId: paramTarget?.messageId })}
        replace
      />
    );
  return (
    <Conversation
      key={chat.id}
      chat={chat}
      initialTarget={target?.chatId === chat.id ? target.t : null}
    />
  );
}

/**
 * No chat to show: still loading the list (or it failed), or the chat is gone (deleted,
 * removed while open). Phones show this full screen, so it keeps a header with Back.
 */
function MissingChat({ loaded }: { loaded: boolean }) {
  const desktop = useIsDesktop();
  const { pathname } = useLocation();
  const error = useChats((s) => s.error);
  const loading = useChats((s) => s.loading);
  let body;
  if (loaded) {
    body = (
      <EmptyState
        icon={MessageCircleOff}
        title="Chat not found"
        description="It may have been deleted, or you no longer have access."
      />
    );
  } else if (error && !loading) {
    body = (
      <EmptyState
        icon={MessageCircleOff}
        title="Couldn’t load your chats"
        description={error}
        action={
          <Button
            variant="soft"
            onClick={() =>
              void useChats
                .getState()
                .loadChats()
                .catch(() => undefined)
            }
          >
            Try again
          </Button>
        }
      />
    );
  } else {
    body = <PageSpinner />;
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-app">
      <PaneHeader title="Chat" back={desktop ? undefined : backPath(pathname)} border />
      <div className="flex min-h-0 flex-1 items-center justify-center">{body}</div>
    </div>
  );
}

function Conversation({
  chat,
  initialTarget,
}: {
  chat: ChatSummary;
  initialTarget: JumpTarget | null;
}) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // Only whether the window exists: subscribing to the window itself would re-render the
  // whole conversation (composer, header, dialogs) on every message-store change.
  const hasWindow = useMessages((s) => s.byChat[chat.id] !== undefined);
  const selecting = useConversationUi((s) => s.selecting[chat.id] !== undefined);
  const searching = useConversationUi((s) => typeof s.search[chat.id] === 'string');
  const viewer = useConversationUi((s) => s.viewer?.chatId === chat.id);
  const [infoOpen, setInfoOpen] = useState(false);
  const openInfo = useCallback(() => setInfoOpen(true), []);
  // Captured before the chat is marked read (the effect in ConversationPane runs after this render).
  const [unread, setUnread] = useState<UnreadSnapshot | null>(() =>
    chat.unreadCount > 0 ? { afterSeq: chat.lastReadSeq, count: chat.unreadCount } : null,
  );
  // Sending a message dismisses the "N unread messages" divider (WhatsApp behaviour).
  const bottomToken = useConversationUi((s) => s.bottomToken);
  const firstBottomToken = useRef(bottomToken);
  useEffect(() => {
    if (bottomToken !== firstBottomToken.current) setUnread(null);
  }, [bottomToken]);

  // Jump to the linked message (on open, and for new links while open).
  const targetKey = initialTarget ? `${initialTarget.seq}:${initialTarget.messageId ?? ''}` : null;
  useEffect(() => {
    if (initialTarget)
      useConversationUi.getState().requestJump(chat.id, initialTarget.seq, initialTarget.messageId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey, chat.id]);

  useEffect(() => {
    const s = useMessages.getState().byChat[chat.id];
    if (s?.loadingLatest) return;
    if (initialTarget && !(s?.loaded && s.items.some((m) => m.seq === initialTarget.seq))) {
      void useMessages
        .getState()
        .loadAround(chat.id, initialTarget.seq)
        .catch(() => undefined);
    } else if (!s?.loaded || (s.hasMoreAfter && !initialTarget)) {
      void useMessages
        .getState()
        .loadLatest(chat.id)
        .catch(() => undefined);
    }
    // Once per mount; errors are shown by the list (retry button).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.id]);

  // Leaving the chat: reset transient UI (selection, search, action menus).
  useEffect(
    () => () => {
      const ui = useConversationUi.getState();
      ui.clearSelect(chat.id);
      ui.setSearch(chat.id, null);
      if (ui.action?.chatId === chat.id) ui.openActions(null);
      if (ui.editing[chat.id]) ui.setEditing(chat.id, null);
    },
    [chat.id],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    const ui = useConversationUi.getState();
    if (ui.selecting[chat.id] !== undefined) ui.clearSelect(chat.id);
    else if (typeof ui.search[chat.id] === 'string') ui.setSearch(chat.id, null);
    else return;
    e.preventDefault();
  };

  const canCompose = chat.membership === 'active' && chat.permissions.canSend;

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onKeyDown={onKeyDown}
      data-testid="conversation"
      data-chat-id={chat.id}
    >
      {selecting ? (
        <SelectionBar chat={chat} />
      ) : searching ? (
        <ChatSearchBar chat={chat} />
      ) : (
        <ConversationHeader chat={chat} onOpenInfo={openInfo} />
      )}
      <PinnedBar chat={chat} />
      <OngoingCallBanner chatId={chat.id} />
      <div className="chat-wallpaper relative min-h-0 flex-1">
        {!hasWindow ? (
          <PageSpinner />
        ) : (
          <MessageList chat={chat} unread={unread} initialTarget={initialTarget} />
        )}
      </div>
      {canCompose ? (
        <Composer chat={chat} />
      ) : (
        <ReadOnlyFooter
          chat={chat}
          onDeleted={() => navigate(backPath(pathname), { replace: true })}
        />
      )}

      <MessageActionsHost chat={chat} />
      <ForwardDialog />
      <MessageInfoSheet />
      {viewer ? (
        <Suspense fallback={null}>
          <LazyLightbox />
        </Suspense>
      ) : null}
      <Sheet open={infoOpen} onClose={() => setInfoOpen(false)} aria-label="Chat info">
        <InfoPanel chat={chat} onClose={() => setInfoOpen(false)} />
      </Sheet>
    </div>
  );
}
