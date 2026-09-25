/**
 * The single message action surface of a conversation: desktop dropdown/context menu,
 * touch long-press sheet (with a quick-reactions strip) and the reaction picker (quick
 * reactions + full emoji picker). Opened through `useConversationUi().openActions`.
 */
import { Suspense, useCallback, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  CheckSquare,
  Copy,
  Download,
  Forward,
  Info,
  MessageSquareReply,
  MessageSquareText,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Reply,
  RotateCw,
  SmilePlus,
  Star,
  StarOff,
  Trash2,
} from 'lucide-react';
import { QUICK_REACTIONS, type ChatSummary } from '@enbox/shared';
import { Menu, Spinner, type MenuEntry } from '@/components/ui';
import { mediaUrl } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useMessages, type ClientMessage } from '@/stores/messages';
import { nameOf, useUsers } from '@/stores/users';
import { ActionSheet } from '@/features/chats/ActionSheet';
import {
  canEdit,
  canForward,
  canInfo,
  canMessageSender,
  canPinMessage,
  canReact,
  canReply,
  canReplyPrivately,
  copyMessages,
  copyText,
  deleteMessages,
  isActionable,
  openDirectChat,
  pinMessage,
  react,
  retry,
  setStarred,
  startEdit,
  startReply,
  unpinMessage,
  type SenderInfo,
} from './actions';
import { LazyEmojiPicker } from './lazy';
import { myReactionOf } from './lib/optimistic';
import { useChatMembersStore } from './members';
import { Popover } from './Popover';
import { useConversationUi } from './state';

export function QuickReactions({
  chat,
  m,
  onDone,
  onMore,
  className,
}: {
  chat: ChatSummary;
  m: ClientMessage;
  onDone: () => void;
  onMore?: () => void;
  className?: string;
}) {
  const me = useAuth((s) => s.user?.id) ?? '';
  const current = myReactionOf(m, me);
  const quickOnly = chat.type === 'channel' && chat.channelSettings?.reactions === 'quick';
  return (
    <div
      className={cn('flex items-center gap-0.5', className)}
      role="group"
      aria-label="Quick reactions"
    >
      {QUICK_REACTIONS.map((e) => (
        <button
          key={e}
          type="button"
          aria-label={current === e ? `Remove reaction ${e}` : `React ${e}`}
          aria-pressed={current === e}
          onClick={() => {
            onDone();
            void react(chat, m, current === e ? null : e);
          }}
          className={cn(
            'flex size-10 items-center justify-center rounded-full text-[26px] leading-none transition-transform hover:scale-125 focus-visible:scale-125 focus-visible:outline-2 focus-visible:outline-brand',
            current === e && 'bg-brand-soft',
          )}
        >
          {e}
        </button>
      ))}
      {onMore && !quickOnly ? (
        <button
          type="button"
          aria-label="More reactions"
          onClick={onMore}
          className="ml-0.5 flex size-9 items-center justify-center rounded-full bg-surface-2 text-muted hover:text-fg"
        >
          <Plus size={20} aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

function downloadName(m: ClientMessage): string {
  return m.media?.fileName ?? `${m.type}-${m.id.slice(0, 8)}`;
}

export function MessageActionsHost({ chat }: { chat: ChatSummary }) {
  const action = useConversationUi((s) => (s.action?.chatId === chat.id ? s.action : null));
  const m = useMessages((s) =>
    action ? s.byChat[chat.id]?.items.find((x) => x.id === action.messageId) : undefined,
  );
  const pins = useChats((s) => s.pins[chat.id]);
  const me = useAuth((s) => s.user?.id);
  const senderProfile = useUsers((s) => (m?.senderId ? s.byId[m.senderId] : undefined));
  // Cached member list (loaded by the header for groups); never fetched just for the menu.
  const members = useChatMembersStore((s) =>
    chat.type === 'group' ? s.byChat[chat.id] : undefined,
  );
  const quickOnly = chat.type === 'channel' && chat.channelSettings?.reactions === 'quick';
  const navigate = useNavigate();
  const [picker, setPicker] = useState<{
    anchor: HTMLElement | { x: number; y: number };
    messageId: string;
  } | null>(null);
  const close = useCallback(() => useConversationUi.getState().openActions(null), []);
  const pickerMessage = useMessages((s) =>
    picker ? s.byChat[chat.id]?.items.find((x) => x.id === picker.messageId) : undefined,
  );

  const items: MenuEntry[] = [];
  if (action && m) {
    const actionable = isActionable(m);
    const sender: SenderInfo = {
      deleted: !!(m.senderId && senderProfile?.isDeleted),
      member: members && m.senderId ? members.some((x) => x.user.id === m.senderId) : null,
    };
    const pinned = !!pins?.includes(m.id);
    const text = copyText(m);
    items.push(
      m.failed ? { label: 'Retry', icon: RotateCw, onSelect: () => retry(chat.id, m) } : null,
      canReply(chat, m)
        ? { label: 'Reply', icon: Reply, onSelect: () => startReply(chat, m) }
        : null,
      action.mode === 'menu' && canReact(chat, m)
        ? {
            label: 'React',
            icon: SmilePlus,
            // Quick-only channels: the full emoji picker would offer emoji the server refuses.
            onSelect: () =>
              quickOnly
                ? useConversationUi.getState().openActions({ ...action, mode: 'react' })
                : setPicker({ anchor: action.anchor, messageId: m.id }),
          }
        : null,
      canReplyPrivately(chat, m, me, sender)
        ? {
            label: 'Reply privately',
            icon: MessageSquareReply,
            onSelect: () =>
              void openDirectChat(m.senderId!).then((id) => {
                if (!id) return;
                useConversationUi.getState().setReply(id, m);
                navigate(`/chats/${id}`);
              }),
          }
        : null,
      canMessageSender(chat, m, me, sender)
        ? {
            label: `Message ${nameOf(m.senderId!)}`,
            icon: MessageSquareText,
            onSelect: () =>
              void openDirectChat(m.senderId!).then((id) => id && navigate(`/chats/${id}`)),
          }
        : null,
      text ? { label: 'Copy', icon: Copy, onSelect: () => void copyMessages([m]) } : null,
      canForward(m)
        ? {
            label: 'Forward',
            icon: Forward,
            onSelect: () => useConversationUi.getState().openForward([m]),
          }
        : null,
      canPinMessage(chat, m)
        ? pinned
          ? { label: 'Unpin', icon: PinOff, onSelect: () => void unpinMessage(chat, m.id) }
          : { label: 'Pin', icon: Pin, onSelect: () => void pinMessage(chat, m) }
        : null,
      actionable && !m.deletedAt && m.type !== 'call'
        ? m.starred
          ? { label: 'Unstar', icon: StarOff, onSelect: () => void setStarred([m], false) }
          : { label: 'Star', icon: Star, onSelect: () => void setStarred([m], true) }
        : null,
      canEdit(chat, m) ? { label: 'Edit', icon: Pencil, onSelect: () => startEdit(chat, m) } : null,
      canInfo(chat, m)
        ? { label: 'Info', icon: Info, onSelect: () => useConversationUi.getState().openInfo(m) }
        : null,
      m.media && !m.deletedAt && actionable
        ? {
            label: 'Download',
            icon: Download,
            onSelect: () => {
              const a = document.createElement('a');
              a.href = mediaUrl(m.media!.url) ?? '';
              a.download = downloadName(m);
              a.rel = 'noopener';
              document.body.appendChild(a);
              a.click();
              a.remove();
            },
          }
        : null,
      actionable
        ? {
            label: 'Select',
            icon: CheckSquare,
            onSelect: () => useConversationUi.getState().startSelect(chat.id, m.id),
          }
        : null,
      'separator',
      {
        label: 'Delete',
        icon: Trash2,
        danger: true,
        onSelect: () => void deleteMessages(chat, [m]),
      },
    );
  }

  const reactable = !!m && canReact(chat, m);

  return (
    <>
      <Menu
        open={!!action && action.mode === 'menu' && !!m}
        anchor={action?.mode === 'menu' ? action.anchor : null}
        onClose={close}
        items={items}
        align="end"
        aria-label="Message options"
      />
      <ActionSheet
        open={!!action && action.mode === 'sheet' && !!m}
        onClose={close}
        aria-label="Message options"
        header={
          m && reactable ? (
            <QuickReactions
              chat={chat}
              m={m}
              onDone={close}
              className="justify-between rounded-full bg-surface-2 p-1"
              onMore={() => {
                const anchor = action?.anchor ?? null;
                close();
                if (anchor) setPicker({ anchor, messageId: m.id });
              }}
            />
          ) : null
        }
        items={items}
      />
      <Popover
        open={!!action && action.mode === 'react' && !!m}
        anchor={action?.mode === 'react' ? action.anchor : null}
        onClose={close}
        aria-label="React to message"
        className="p-1"
      >
        {m ? (
          <QuickReactions
            chat={chat}
            m={m}
            onDone={close}
            onMore={() => {
              const anchor = action?.anchor ?? null;
              close();
              if (anchor) setPicker({ anchor, messageId: m.id });
            }}
          />
        ) : null}
      </Popover>
      <Popover
        open={!!picker && !!pickerMessage}
        anchor={picker?.anchor ?? null}
        onClose={() => setPicker(null)}
        aria-label="Choose a reaction"
        className="overflow-hidden"
      >
        <div className="w-[min(340px,calc(100vw-16px))]">
          <Suspense
            fallback={
              <div className="flex h-[380px] items-center justify-center text-brand-ink">
                <Spinner />
              </div>
            }
          >
            {pickerMessage ? (
              <LazyEmojiPicker
                height={380}
                autoFocusSearch
                onPick={(emoji) => {
                  setPicker(null);
                  void react(chat, pickerMessage, emoji);
                }}
              />
            ) : null}
          </Suspense>
        </div>
      </Popover>
    </>
  );
}
