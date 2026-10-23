/**
 * The single message action surface of a conversation: desktop dropdown/context menu,
 * touch long-press sheet (with a quick-reactions strip) and the reaction picker (my most
 * recent reactions + the full emoji picker). Opened through `useConversationUi().openActions`.
 * Touch: a double tap on a message adds ❤️ (Discord's tap to react).
 *
 * The menu follows Discord: Add Reaction ▸ (quick picks, View More), Edit Message, Reply,
 * Forward, Create / Open Thread, Copy Text, Pin Message, Mark Unread, Copy Message Link, Speak
 * Message, Delete Message, then Copy Message ID in Developer Mode. Other chats add their
 * WhatsApp extras (reply privately, star, info, select; delete offers "for me").
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  CheckSquare,
  Copy,
  Download,
  Forward,
  IdCard,
  Info,
  Link,
  MessageSquareDot,
  MessageSquareReply,
  MessageSquareText,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Reply,
  RotateCw,
  SmilePlus,
  Speech,
  Star,
  StarOff,
  Trash2,
} from 'lucide-react';
import {
  QUICK_REACTIONS,
  isSpaceChatType,
  parseCustomEmoji,
  type ChatSummary,
} from '@enbox/shared';
import { Menu, type MenuEntry, type MenuItem } from '@/components/ui';
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
  isActionable,
  openDirectChat,
  pinMessage,
  retry,
  setStarred,
  startEdit,
  startReply,
  unpinMessage,
  type SenderInfo,
} from './actions';
import {
  canDeleteMessage,
  canMarkUnread,
  canSpeak,
  copyId,
  copyMessageLink,
  deleteMessage,
  markUnread,
  speakMessage,
  useDeveloperMode,
  useUnreadMarkSync,
} from './moreActions';
import {
  canAddNewReaction,
  isMyReaction,
  reactionKey,
  reactionLabel,
} from './bubbles/reactions/model';
import {
  addReaction,
  canAddReaction,
  canRemoveOwnReaction,
  toggleReaction,
} from './bubbles/reactions/reactionActions';
import { ReactionEmoji } from './bubbles/reactions/ReactionEmoji';
import { ReactionPickerPopover } from './bubbles/reactions/ReactionPicker';
import { recentReactions } from './bubbles/reactions/recent';
import { useChatMembersStore } from './members';
import { Popover } from './Popover';
import { useConversationUi } from './state';
import { threadMessageAction } from '@/features/threads/actions';

/** Discord's tap to react: what a double tap on a message adds. */
export const DOUBLE_TAP_REACTION = '❤️';
/** Two taps within this long and this close are a double tap. */
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_SLOP_PX = 24;

/**
 * Quick reactions: my `count` most recent (QUICK_REACTIONS until I have some), toggling.
 * Quick-only channels offer QUICK_REACTIONS; without ADD_REACTIONS only the emoji already
 * on the message (joining needs no more than seeing it).
 */
export function QuickReactions({
  chat,
  m,
  onDone,
  onMore,
  count = 3,
  className,
}: {
  chat: ChatSummary;
  m: ClientMessage;
  onDone: () => void;
  onMore?: () => void;
  /** How many recent emoji (hover toolbar 3, long-press sheet 6). */
  count?: number;
  className?: string;
}) {
  const me = useAuth((s) => s.user?.id);
  const quickOnly = chat.type === 'channel' && chat.channelSettings?.reactions === 'quick';
  const addNew = canAddNewReaction(chat);
  // Read once per opening: the strip doesn't reorder under the pointer.
  const [recent] = useState(() => recentReactions(count));
  const choices = quickOnly
    ? [...QUICK_REACTIONS]
    : addNew
      ? recent
      : m.reactions.map((r) => r.emoji).slice(0, count);
  return (
    <div
      className={cn('flex items-center gap-0.5', className)}
      role="group"
      aria-label="Quick reactions"
    >
      {choices.map((e) => {
        const mine = isMyReaction(m, me, e);
        const enabled = mine ? canRemoveOwnReaction(chat, m) : canAddReaction(chat, m, e);
        return (
          <button
            key={reactionKey(e)}
            type="button"
            aria-label={mine ? `Remove reaction ${reactionLabel(e)}` : `React ${reactionLabel(e)}`}
            aria-pressed={mine}
            disabled={!enabled}
            onClick={() => {
              onDone();
              void toggleReaction(chat, m, e);
            }}
            className={cn(
              'flex size-10 items-center justify-center rounded-full leading-none transition-transform focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-40',
              'motion-safe:hover:scale-125 motion-safe:focus-visible:scale-125',
              mine && 'bg-brand-soft',
            )}
          >
            <ReactionEmoji emoji={e} size={26} />
          </button>
        );
      })}
      {onMore && !quickOnly && addNew ? (
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

/** Add Reaction ▸'s quick picks: four recent emoji (the quick list in quick-only channels). */
function menuReactionChoices(chat: ChatSummary, m: ClientMessage): string[] {
  if (chat.type === 'channel' && chat.channelSettings?.reactions === 'quick')
    return [...QUICK_REACTIONS];
  if (!canAddNewReaction(chat)) return m.reactions.map((r) => r.emoji).slice(0, 4);
  return recentReactions(4);
}

/** An emoji as a menu item's label (custom emoji also show their `:name:`). */
function MenuEmoji({ emoji }: { emoji: string }) {
  return (
    <span className="inline-flex items-center gap-2.5 align-middle">
      <ReactionEmoji emoji={emoji} size={22} />
      <span className={parseCustomEmoji(emoji) ? 'truncate' : 'sr-only'}>
        {reactionLabel(emoji)}
      </span>
    </span>
  );
}

/** Drop empty entries and the separators that would lead, trail or double up. */
function tidy(entries: MenuEntry[]): MenuEntry[] {
  const out: (MenuItem | 'separator')[] = [];
  for (const e of entries) {
    if (!e || (e === 'separator' && (!out.length || out.at(-1) === 'separator'))) continue;
    out.push(e);
  }
  while (out.at(-1) === 'separator') out.pop();
  return out;
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
  const devMode = useDeveloperMode();
  useDoubleTapReaction(chat);
  // Mark Unread on another of my devices moves the NEW line here too.
  useUnreadMarkSync(chat);

  let items: MenuEntry[] = [];
  if (action && m) {
    const actionable = isActionable(m);
    // Space channels are Discord's: no WhatsApp extras (star, info, select, delete for me).
    const whatsApp = !isSpaceChatType(chat.type);
    const sender: SenderInfo = {
      deleted: !!(m.senderId && senderProfile?.isDeleted),
      member: members && m.senderId ? members.some((x) => x.user.id === m.senderId) : null,
    };
    const pinned = !!pins?.includes(m.id);
    const text = copyText(m);
    const addNew = canAddNewReaction(chat);
    const reactions: MenuItem | null =
      action.mode === 'menu' && canReact(chat, m) && (addNew || m.reactions.length > 0)
        ? {
            label: 'Add Reaction',
            icon: SmilePlus,
            // Quick-only channels, and members who may only join existing emoji: no full
            // picker (it would offer emoji the server refuses).
            submenu: [
              ...menuReactionChoices(chat, m).map((e): MenuItem => {
                const mine = isMyReaction(m, me, e);
                return {
                  label: <MenuEmoji emoji={e} />,
                  disabled: mine ? !canRemoveOwnReaction(chat, m) : !canAddReaction(chat, m, e),
                  onSelect: () => void toggleReaction(chat, m, e),
                };
              }),
              quickOnly || !addNew
                ? null
                : {
                    label: 'View More',
                    icon: Plus,
                    onSelect: () => setPicker({ anchor: action.anchor, messageId: m.id }),
                  },
            ],
          }
        : null;
    items = tidy([
      m.failed ? { label: 'Retry', icon: RotateCw, onSelect: () => retry(chat.id, m) } : null,
      reactions,
      reactions ? 'separator' : null,
      canEdit(chat, m)
        ? { label: 'Edit Message', icon: Pencil, onSelect: () => startEdit(chat, m) }
        : null,
      canReply(chat, m)
        ? { label: 'Reply', icon: Reply, onSelect: () => startReply(chat, m) }
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
      canForward(m)
        ? {
            label: 'Forward',
            icon: Forward,
            onSelect: () => useConversationUi.getState().openForward([m]),
          }
        : null,
      threadMessageAction(chat, m),
      text ? { label: 'Copy Text', icon: Copy, onSelect: () => void copyMessages([m]) } : null,
      canPinMessage(chat, m)
        ? pinned
          ? { label: 'Unpin Message', icon: PinOff, onSelect: () => void unpinMessage(chat, m.id) }
          : { label: 'Pin Message', icon: Pin, onSelect: () => void pinMessage(chat, m) }
        : null,
      whatsApp && actionable && !m.deletedAt && m.type !== 'call'
        ? m.starred
          ? { label: 'Unstar', icon: StarOff, onSelect: () => void setStarred([m], false) }
          : { label: 'Star', icon: Star, onSelect: () => void setStarred([m], true) }
        : null,
      canMarkUnread(chat, m)
        ? { label: 'Mark Unread', icon: MessageSquareDot, onSelect: () => void markUnread(chat, m) }
        : null,
      actionable
        ? { label: 'Copy Message Link', icon: Link, onSelect: () => void copyMessageLink(chat, m) }
        : null,
      canSpeak(m)
        ? { label: 'Speak Message', icon: Speech, onSelect: () => speakMessage(chat, m) }
        : null,
      whatsApp && canInfo(chat, m)
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
      whatsApp && actionable
        ? {
            label: 'Select',
            icon: CheckSquare,
            onSelect: () => useConversationUi.getState().startSelect(chat.id, m.id),
          }
        : null,
      'separator',
      canDeleteMessage(chat, m)
        ? {
            label: 'Delete Message',
            icon: Trash2,
            danger: true,
            onSelect: () => void deleteMessage(chat, m),
          }
        : null,
      devMode && actionable ? 'separator' : null,
      devMode && actionable
        ? {
            label: 'Copy Message ID',
            icon: IdCard,
            onSelect: () => void copyId(m.id, 'Message ID'),
          }
        : null,
    ]);
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
              count={6}
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
      <ReactionPickerPopover
        chat={chat}
        anchor={picker && pickerMessage ? picker.anchor : null}
        onClose={() => setPicker(null)}
        onPick={(emoji) => {
          if (pickerMessage) void toggleReaction(chat, pickerMessage, emoji);
        }}
      />
    </>
  );
}

/**
 * Discord's tap to react: two quick taps on a message bubble (touch only; not on links,
 * buttons or media, not in select mode) add DOUBLE_TAP_REACTION. One document listener per
 * open conversation; only this chat's messages count.
 */
function useDoubleTapReaction(chat: ChatSummary): void {
  useEffect(() => {
    let last: { id: string; t: number; x: number; y: number } | null = null;
    const onUp = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      const target = e.target instanceof Element ? e.target : null;
      const row = target
        ?.closest<HTMLElement>('[data-testid="bubble"]')
        ?.closest<HTMLElement>('[data-message-id]');
      const id = row?.dataset.messageId;
      if (
        !id ||
        target!.closest(
          'a, button, input, textarea, select, label, img, video, audio, [role="button"], [contenteditable="true"]',
        )
      ) {
        last = null;
        return;
      }
      const prev = last;
      last = { id, t: e.timeStamp, x: e.clientX, y: e.clientY };
      if (
        !prev ||
        prev.id !== id ||
        e.timeStamp - prev.t > DOUBLE_TAP_MS ||
        Math.hypot(e.clientX - prev.x, e.clientY - prev.y) > DOUBLE_TAP_SLOP_PX
      )
        return;
      last = null;
      if (useConversationUi.getState().selecting[chat.id] !== undefined) return;
      const m = useMessages.getState().byChat[chat.id]?.items.find((x) => x.id === id);
      if (m) void addReaction(chat, m, DOUBLE_TAP_REACTION);
    };
    document.addEventListener('pointerup', onUp);
    return () => document.removeEventListener('pointerup', onUp);
  }, [chat]);
}
