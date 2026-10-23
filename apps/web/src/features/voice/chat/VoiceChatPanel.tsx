/**
 * The text chat of a voice or Stage channel (Discord's "Text in Voice"): beside the call view
 * in place of the member list (a card pane), full screen on phones (`overlay`, rendered by the
 * view's Chat button). Header: the channel's icon, its name and ✕; then the channel's message
 * list, typing line and composer (with the message menu, the drop zone, Forward and the media
 * viewer). Readable and writable without connecting to the call.
 *
 * While it is shown the chat is the open conversation (`setOpenChat`: read receipts, no
 * notifications for it, the window kept) and it is marked read, also as messages arrive.
 */
import { Suspense, useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useParams } from 'react-router';
import { MessagesSquare, Podcast, Volume2, X } from 'lucide-react';
import type { ChatSummary, ID } from '@enbox/shared';
import { EmptyState, IconButton, PageSpinner, Portal } from '@/components/ui';
import { ReadOnlyFooter, SelectionBar } from '@/features/conversation/Bars';
import { RowAppearanceContext } from '@/features/conversation/bubbles/appearance';
import { Composer } from '@/features/conversation/composer/Composer';
import { ConversationDropzone } from '@/features/conversation/dropzone/ConversationDropzone';
import { ForwardDialog } from '@/features/conversation/ForwardDialog';
import { LazyLightbox } from '@/features/conversation/lazy';
import { MessageActionsHost } from '@/features/conversation/MessageActionsHost';
import { MessageInfoSheet } from '@/features/conversation/MessageInfoSheet';
import { MessageList, type JumpTarget, type UnreadSnapshot } from '@/features/conversation/MessageList';
import { useConversationUi } from '@/features/conversation/state';
import { TypingLine } from '@/features/threads/TypingLine';
import { markChatRead } from '@/realtime/chats';
import { useChat, useChats } from '@/stores/chats';
import { useMessages } from '@/stores/messages';
import { dismissVoiceChat, hideVoiceChat } from './actions';

const COZY = { bubbleStyle: 'cozy' as const, messageAnimation: 'fade' as const };

export function VoiceChatPanel({ channelId, overlay = false }: { channelId: ID; overlay?: boolean }) {
  const chat = useChat(channelId);
  // Desktop: the panel belongs to its channel's view; any other page closes it (still
  // remembered: coming back shows it again).
  const { chatId } = useParams<{ chatId?: string }>();
  useEffect(() => {
    if (!overlay && chatId !== channelId) dismissVoiceChat(channelId);
  }, [overlay, chatId, channelId]);
  const selecting = useConversationUi((s) => s.selecting[channelId] !== undefined);
  const label = `Chat in ${chat?.name ?? 'channel'}`;
  return (
    <Shell overlay={overlay} label={label} chatId={channelId}>
      {chat ? (
        <>
          {selecting ? <SelectionBar chat={chat} /> : <Header chat={chat} />}
          <VoiceConversation key={chat.id} chat={chat} />
        </>
      ) : (
        <>
          <header className="flex min-h-14 shrink-0 items-center gap-2 pr-2 pl-4">
            <MessagesSquare size={20} className="shrink-0 text-muted" aria-hidden />
            <h2 className="min-w-0 flex-1 truncate text-[16px] font-bold text-fg">Chat</h2>
            <IconButton icon={X} label="Close chat" variant="ghost" onClick={() => hideVoiceChat(channelId)} />
          </header>
          <div className="flex min-h-0 flex-1 items-center justify-center p-6">
            <EmptyState
              icon={MessagesSquare}
              title="Channel not found"
              description="It may have been deleted, or you can no longer see it."
            />
          </div>
        </>
      )}
    </Shell>
  );
}

function Shell({
  overlay,
  label,
  chatId,
  children,
}: {
  overlay: boolean;
  label: string;
  /** Escape leaves the chat's select mode first. */
  chatId: ID;
  children: ReactNode;
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    const ui = useConversationUi.getState();
    if (ui.selecting[chatId] === undefined) return;
    ui.clearSelect(chatId);
    e.preventDefault();
  };
  const body = (
    <aside
      aria-label={label}
      onKeyDown={onKeyDown}
      data-testid="voice-chat-panel"
      data-chat-id={chatId}
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

function Header({ chat }: { chat: ChatSummary }) {
  const Icon = chat.type === 'space_stage' ? Podcast : Volume2;
  return (
    <header className="flex min-h-14 shrink-0 items-center gap-2 pr-2 pl-4" data-testid="voice-chat-header">
      <Icon size={20} className="shrink-0 text-muted" aria-hidden />
      <h2 className="min-w-0 flex-1 truncate text-[16px] font-bold text-fg" title={chat.name ?? undefined}>
        {chat.name}
      </h2>
      <IconButton icon={X} label="Close chat" variant="ghost" onClick={() => hideVoiceChat(chat.id)} />
    </header>
  );
}

function VoiceConversation({ chat }: { chat: ChatSummary }) {
  const hasWindow = useMessages((s) => s.byChat[chat.id] !== undefined);
  const viewer = useConversationUi((s) => s.viewer?.chatId === chat.id);
  // Captured before the chat is marked read (the channel's "N new messages" divider).
  const [unread] = useState<UnreadSnapshot | null>(() =>
    chat.unreadCount > 0 ? { afterSeq: chat.lastReadSeq, count: chat.unreadCount } : null,
  );
  // A jump requested before the panel opened (search, the Inbox, a link): open there. The list
  // consumes the request itself once mounted (scroll + highlight), like a channel's.
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
    // Once per channel; errors show in the list (retry).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.id]);

  // The open conversation while shown (realtime/chats.ts: read on arrival and on focus).
  useEffect(() => {
    useChats.getState().setOpenChat(chat.id);
    return () => {
      if (useChats.getState().openChatId === chat.id) useChats.getState().setOpenChat(null);
    };
  }, [chat.id]);
  // Read while shown (and focused), whatever else marked it.
  const lastSeq = chat.lastSeq;
  useEffect(() => {
    markChatRead(chat.id);
  }, [chat.id, lastSeq]);

  // Leaving the chat: reset its transient UI (selection, menus, reply, edit).
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

  const canCompose = chat.membership === 'active' && chat.permissions.canSend;
  return (
    <RowAppearanceContext.Provider value={COZY}>
      <div className="relative min-h-0 flex-1" data-testid="voice-chat-messages">
        {!hasWindow ? <PageSpinner /> : <MessageList chat={chat} unread={unread} initialTarget={target} />}
        {/* Over the list's bottom edge, so the list doesn't jump when someone starts typing. */}
        <TypingLine
          chatId={chat.id}
          spaceId={chat.space?.spaceId}
          className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] bg-surface/90"
        />
      </div>
      {/* Files dragged over the window land in this chat's composer (the card covers the panel). */}
      {canCompose ? <ConversationDropzone chat={chat} /> : null}
      {canCompose ? <Composer chat={chat} /> : <ReadOnlyFooter chat={chat} onDeleted={() => hideVoiceChat(chat.id)} />}
      <MessageActionsHost chat={chat} />
      <ForwardDialog />
      <MessageInfoSheet />
      {viewer ? (
        <Suspense fallback={null}>
          <LazyLightbox />
        </Suspense>
      ) : null}
    </RowAppearanceContext.Provider>
  );
}
