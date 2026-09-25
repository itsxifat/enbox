/**
 * Chat list row: avatar (+online dot), title, time, preview (typing / draft / last message
 * with ticks and sender prefix), unread / @mention badges, muted & pinned icons, marked-unread
 * dot. Right-click or the hover chevron opens the chat menu; long-press opens an action sheet.
 */
import { memo, useCallback, useState, type MouseEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { AtSign, BellOff, ChevronDown, MessageSquareText, Pin } from 'lucide-react';
import { chatTitle, isMuted, renderMentions, tickStatus, type ChatSummary } from '@enbox/shared';
import { ChatAvatar } from '@/components/common/ChatAvatar';
import { IN_APP_NAV } from '@/components/layout/navigation';
import { Badge, ListItem, Menu, type MenuAnchor } from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatChatListTime } from '@/lib/format';
import { useAuth } from '@/stores/auth';
import { isChatUnread, useChats, useTypingUsers } from '@/stores/chats';
import type { ClientMessage } from '@/stores/messages';
import { nameOf, useUsers } from '@/stores/users';
import { Ticks } from '@/features/conversation/bubbles/Ticks';
import { ActionSheet } from './ActionSheet';
import { chatMenuItems } from './chatActions';
import { useDraft } from './drafts';
import { PreviewLine, previewParts } from './preview';
import { useLongPress } from './useLongPress';

function TypingPreview({
  chat,
  typing,
}: {
  chat: ChatSummary;
  typing: Record<string, { state: string }>;
}) {
  const ids = Object.keys(typing);
  const recording = Object.values(typing).some((t) => t.state === 'recording');
  const verb = recording ? 'recording audio…' : 'typing…';
  const who =
    chat.type === 'direct'
      ? ''
      : ids.length > 1
        ? `${ids.length} people are `
        : `${nameOf(ids[0]!)} is `;
  return (
    <span className="truncate font-medium text-brand-ink">
      {who}
      {verb}
    </span>
  );
}

function LastMessagePreview({ chat, me }: { chat: ChatSummary; me: string | undefined }) {
  const last = chat.lastMessage as ClientMessage | null;
  if (!last) {
    if (chat.membership !== 'active' && chat.type === 'group')
      return <>You’re no longer a member</>;
    return <>{chat.type === 'direct' ? 'Tap to start chatting' : (chat.description ?? '')}</>;
  }
  const mine = !!me && last.senderId === me;
  const status = mine && !last.deletedAt ? (last.failed ? 'failed' : tickStatus(last, chat)) : null;
  const showSender =
    chat.type === 'group' && last.senderId && last.type !== 'system' && last.type !== 'call';
  const prefix = showSender ? (mine ? 'You' : nameOf(last.senderId!)) : null;
  return (
    <span className="flex min-w-0 items-center gap-1">
      {status ? <Ticks status={status} size={16} className="shrink-0" /> : null}
      {prefix ? <span className="shrink-0">{`${prefix}: `}</span> : null}
      <PreviewLine parts={previewParts(last, { meId: me, chat })} />
    </span>
  );
}

export interface ChatRowProps {
  chat: ChatSummary;
  to: string;
  active?: boolean;
  /** Called after the chat was deleted from the menu. */
  onDeleted?: () => void;
}

export const ChatRow = memo(function ChatRow({ chat, to, active, onDeleted }: ChatRowProps) {
  const navigate = useNavigate();
  const me = useAuth((s) => s.user?.id);
  // Names in previews (sender prefix, mentions, system texts) come from the users cache:
  // re-render when profiles arrive (only mounted rows subscribe — the list is virtualized).
  useUsers((s) => s.byId);
  const typing = useTypingUsers(chat.id);
  const draft = useDraft(chat.id);
  const isOpen = useChats((s) => s.openChatId === chat.id);
  const myName = useAuth((s) => s.user?.displayName ?? 'You');
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  const [sheet, setSheet] = useState(false);
  const closeMenu = useCallback(() => setMenu(null), []);
  const longPress = useLongPress(() => setSheet(true));

  const muted = isMuted(chat.mutedUntil);
  const unread = isChatUnread(chat);
  const hasTyping = Object.keys(typing).length > 0;
  const showDraft = !!draft && !isOpen && !hasTyping && draft.text.trim().length > 0;

  let subtitle: ReactNode;
  if (hasTyping) subtitle = <TypingPreview chat={chat} typing={typing} />;
  else if (showDraft)
    subtitle = (
      <span className="flex min-w-0 items-center gap-1">
        <span className="shrink-0 font-medium text-danger">{'Draft: '}</span>
        <span className="truncate">
          {renderMentions(draft.text, (id) => nameOf(id, { you: myName }))}
        </span>
      </span>
    );
  else subtitle = <LastMessagePreview chat={chat} me={me} />;

  const onContextMenu = (e: MouseEvent<HTMLElement>) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  };

  const items = chatMenuItems(chat, { onDeleted });
  const title = chatTitle(chat, me);

  return (
    <div
      className="group/row relative"
      {...longPress}
      data-testid="chat-row"
      data-chat-id={chat.id}
    >
      <ListItem
        to={to}
        linkState={IN_APP_NAV}
        active={active}
        onContextMenu={onContextMenu}
        leading={
          <ChatAvatar
            chat={chat}
            size="lg"
            showPresence={chat.type === 'direct' && chat.peer?.id !== me}
          />
        }
        title={title}
        meta={
          chat.lastMessage || chat.lastActivityAt
            ? formatChatListTime(chat.lastActivityAt)
            : undefined
        }
        highlight={unread && !muted}
        subtitle={subtitle}
        trailing={
          <>
            {muted ? <BellOff size={15} aria-label="Muted" /> : null}
            {chat.isPinned && !chat.isArchived ? (
              <Pin size={15} className="rotate-45" aria-label="Pinned" />
            ) : null}
            {chat.unreadMentionCount > 0 ? (
              <span
                className="flex size-5 items-center justify-center rounded-full bg-unread text-on-brand"
                aria-label="You were mentioned"
                role="img"
              >
                <AtSign size={12} strokeWidth={2.6} aria-hidden />
              </span>
            ) : null}
            {unread ? (
              chat.unreadCount > 0 ? (
                <Badge
                  count={chat.unreadCount}
                  tone={muted ? 'muted' : 'brand'}
                  label={`${chat.unreadCount} unread message${chat.unreadCount === 1 ? '' : 's'}`}
                />
              ) : (
                <span
                  className={cn('size-5 rounded-full', muted ? 'bg-unread-muted' : 'bg-unread')}
                  role="img"
                  aria-label="Marked as unread"
                />
              )
            ) : null}
            {/* Room for the hover chevron (the button itself sits outside the link). */}
            <span
              aria-hidden
              className={cn(
                'hidden w-0 transition-[width] duration-150 lg:block lg:group-hover/row:w-6 lg:group-focus-within/row:w-6',
                menu && 'lg:w-6',
              )}
            />
          </>
        }
      />
      {/* Desktop: hover chevron opens the chat menu (WhatsApp Web). Below lg it is only
          shown while focused by keyboard (touch uses long-press). */}
      <button
        type="button"
        aria-label={`Chat options for ${title}`}
        onClick={(e) => setMenu(e.currentTarget)}
        className={cn(
          'absolute top-[34px] right-3.5 flex size-6 items-center justify-center rounded-full text-muted opacity-0 transition-opacity duration-150 hover:bg-hover hover:text-fg',
          'max-lg:pointer-events-none max-lg:bg-elevated max-lg:focus-visible:pointer-events-auto',
          'lg:group-hover/row:opacity-100 focus-visible:opacity-100',
          menu && 'opacity-100',
        )}
      >
        <ChevronDown size={18} aria-hidden />
      </button>
      <Menu
        open={!!menu}
        onClose={closeMenu}
        anchor={menu}
        items={items}
        align="end"
        aria-label={`Chat options for ${title}`}
      />
      <ActionSheet
        open={sheet}
        onClose={() => setSheet(false)}
        title={title}
        items={[
          {
            label: 'Open chat',
            icon: MessageSquareText,
            onSelect: () => navigate(to, { state: IN_APP_NAV }),
          },
          ...items,
        ]}
      />
    </div>
  );
});
