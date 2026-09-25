/**
 * PLACEHOLDER (agent 2 owns this folder): the conversation view for /chats/:chatId (also
 * mounted under /archived/:chatId, /starred/:chatId and reused for channels).
 *
 * Contract the real implementation must keep:
 * - call `useChats().setOpenChat(chatId)` while mounted (drives read receipts, unread
 *   suppression and notification muting — see realtime/chats.ts `markChatRead`)
 * - load with `useMessages().loadLatest(chatId)` when `!loaded`
 * - open the info panel for the chat type: direct → features/contacts/ContactInfoPanel
 *   (agent 1), group → features/groups/GroupInfoPanel (agent 3), channel →
 *   features/channels/ChannelInfoPanel (agent 3); all take `{ chatId, onClose }`
 * - start calls via `useCalls().startCall(chatId, 'audio' | 'video')` (agent 4)
 */
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useLocation, useParams } from 'react-router';
import { EllipsisVertical, MessageCircleOff, Phone, SendHorizontal, Video } from 'lucide-react';
import { chatTitle, systemEventText, type ChatSummary } from '@enbox/shared';
import { ChatAvatar } from '@/components/common/ChatAvatar';
import { PaneHeader } from '@/components/layout/PaneHeader';
import { EmptyState, IconButton, PageSpinner, Sheet, Textarea, toast } from '@/components/ui';
import { ChannelInfoPanel } from '@/features/channels/ChannelInfoPanel';
import { ContactInfoPanel } from '@/features/contacts/ContactInfoPanel';
import { GroupInfoPanel } from '@/features/groups/GroupInfoPanel';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';
import { formatDaySeparator, formatLastSeen, formatTime, isSameLocalDay } from '@/lib/format';
import { useAuth } from '@/stores/auth';
import { useCalls } from '@/stores/calls';
import { useChat, useChats, useTypingUsers } from '@/stores/chats';
import { useChatMessages, useMessages, type ClientMessage } from '@/stores/messages';
import { useUi } from '@/stores/ui';
import { nameOf, usePresence } from '@/stores/users';

function backPath(pathname: string): string {
  for (const base of ['/archived', '/starred', '/updates'])
    if (pathname.startsWith(base)) return base;
  return '/chats';
}

function useSubtitle(chat: ChatSummary): string {
  const typing = useTypingUsers(chat.id);
  const presence = usePresence(chat.type === 'direct' ? chat.peer?.id : null);
  const ids = Object.keys(typing);
  if (ids.length) {
    const verb = Object.values(typing).some((t) => t.state === 'recording')
      ? 'recording audio…'
      : 'typing…';
    return chat.type === 'direct' ? verb : `${nameOf(ids[0]!)} is ${verb}`;
  }
  if (chat.type === 'direct') return formatLastSeen(presence);
  if (chat.type === 'channel') return `${chat.memberCount} followers`;
  return `${chat.memberCount} members`;
}

function InfoPanel({ chat, onClose }: { chat: ChatSummary; onClose: () => void }) {
  if (chat.type === 'direct') return <ContactInfoPanel chatId={chat.id} onClose={onClose} />;
  if (chat.type === 'channel') return <ChannelInfoPanel chatId={chat.id} onClose={onClose} />;
  return <GroupInfoPanel chatId={chat.id} onClose={onClose} />;
}

function Bubble({ m, mine, showDay }: { m: ClientMessage; mine: boolean; showDay: boolean }) {
  return (
    <>
      {showDay ? (
        <div className="sticky top-2 z-[1] my-2 self-center rounded-lg bg-surface/90 px-3 py-1 text-xs font-medium text-muted shadow-bubble backdrop-blur">
          {formatDaySeparator(m.createdAt)}
        </div>
      ) : null}
      {m.type === 'system' && m.system ? (
        <div className="my-1 self-center rounded-lg bg-surface/90 px-3 py-1 text-center text-xs text-muted shadow-bubble">
          {systemEventText(m.system, (id) => nameOf(id))}
        </div>
      ) : (
        <div
          className={cn(
            'max-w-[min(80%,560px)] rounded-2xl px-3 py-1.5 text-chat leading-snug text-fg shadow-bubble',
            mine ? 'self-end rounded-tr-md bg-bubble-out' : 'self-start rounded-tl-md bg-bubble-in',
            m.failed && 'ring-1 ring-danger',
          )}
        >
          <span className="break-words whitespace-pre-wrap">
            {m.deletedAt ? (
              <i className="text-muted">This message was deleted</i>
            ) : (
              (m.text ?? `[${m.type}]`)
            )}
          </span>
          <span
            className={cn(
              'float-right mt-1.5 ml-3 text-[11px]',
              mine ? 'text-bubble-out-meta' : 'text-bubble-in-meta',
            )}
          >
            {m.pending ? 'sending…' : m.failed ? 'failed' : formatTime(m.createdAt)}
          </span>
        </div>
      )}
    </>
  );
}

function Composer({ chat }: { chat: ChatSummary }) {
  const [text, setText] = useState('');
  const enterToSend = useUi((s) => s.prefs.enterToSend);
  const me = useAuth((s) => s.user?.id);
  // `permissions` is computed server-side (computeChatPermissions) — don't re-derive it.
  const blocked =
    chat.membership !== 'active'
      ? "You can't send messages because you're no longer a member."
      : chat.permissions.canSend
        ? null
        : chat.type === 'channel'
          ? 'Only channel admins can post.'
          : chat.type === 'direct'
            ? chat.peer?.isDeleted
              ? 'This account was deleted.'
              : 'Unblock this contact to send a message.'
            : 'Only admins can send messages.';
  if (blocked || !me) {
    return (
      <div className="shrink-0 border-t border-line bg-surface px-4 py-3 pb-[max(12px,env(safe-area-inset-bottom))] text-center text-sm text-muted">
        {blocked}
      </div>
    );
  }
  const send = (e?: FormEvent) => {
    e?.preventDefault();
    const body = text.trim();
    if (!body) return;
    setText('');
    useMessages
      .getState()
      .sendMessage(chat.id, { type: 'text', text: body })
      .catch((err: unknown) => toast.error(err));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && enterToSend && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };
  return (
    <form
      onSubmit={send}
      className="flex shrink-0 items-end gap-2 border-t border-line bg-surface px-3 pt-2 pb-[max(8px,env(safe-area-inset-bottom))]"
    >
      <Textarea
        autoResize
        maxRows={6}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Message"
        aria-label="Message"
        variant="filled"
        containerClassName="flex-1"
      />
      <IconButton
        type="submit"
        icon={SendHorizontal}
        label="Send"
        variant="brand"
        size="lg"
        disabled={!text.trim()}
      />
    </form>
  );
}

export function ConversationPane() {
  const { chatId } = useParams<{ chatId: string }>();
  const chat = useChat(chatId);
  const chatsLoaded = useChats((s) => s.loaded);

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

  if (!chat) {
    if (!chatsLoaded) return <PageSpinner />;
    return (
      <div className="flex flex-1 items-center justify-center bg-app">
        <EmptyState
          icon={MessageCircleOff}
          title="Chat not found"
          description="It may have been deleted, or you no longer have access."
        />
      </div>
    );
  }
  return <Conversation key={chat.id} chat={chat} />;
}

function Conversation({ chat }: { chat: ChatSummary }) {
  const desktop = useIsDesktop();
  const { pathname } = useLocation();
  const me = useAuth((s) => s.user?.id);
  const msgs = useChatMessages(chat.id);
  const subtitle = useSubtitle(chat);
  const [infoOpen, setInfoOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!msgs.loaded && !msgs.loadingLatest && !msgs.error) {
      void useMessages
        .getState()
        .loadLatest(chat.id)
        .catch(() => undefined);
    }
  }, [chat.id, msgs.loaded, msgs.loadingLatest, msgs.error]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [msgs.items.length]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PaneHeader
        back={desktop ? undefined : backPath(pathname)}
        leading={<ChatAvatar chat={chat} size="md" className="mx-1" />}
        title={chatTitle(chat)}
        subtitle={subtitle}
        onTitleClick={() => setInfoOpen(true)}
        border
        actions={
          chat.type !== 'channel' && chat.membership === 'active' ? (
            <>
              <IconButton
                icon={Video}
                label="Video call"
                onClick={() => void useCalls.getState().startCall(chat.id, 'video')}
              />
              <IconButton
                icon={Phone}
                label="Voice call"
                onClick={() => void useCalls.getState().startCall(chat.id, 'audio')}
              />
              <IconButton icon={EllipsisVertical} label="Menu" onClick={() => setInfoOpen(true)} />
            </>
          ) : undefined
        }
      />
      <div className="chat-wallpaper min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        {!msgs.loaded && msgs.loadingLatest ? <PageSpinner /> : null}
        <div className="mx-auto flex max-w-4xl flex-col gap-1 px-3 py-3 lg:px-12">
          {msgs.items.map((m, i) => (
            <Bubble
              key={m.id}
              m={m}
              mine={m.senderId === me}
              showDay={i === 0 || !isSameLocalDay(msgs.items[i - 1]!.createdAt, m.createdAt)}
            />
          ))}
          <div ref={bottomRef} />
        </div>
      </div>
      <Composer chat={chat} />
      <Sheet open={infoOpen} onClose={() => setInfoOpen(false)} aria-label="Chat info">
        <InfoPanel chat={chat} onClose={() => setInfoOpen(false)} />
      </Sheet>
    </div>
  );
}
