/**
 * Discord's Compact message display (Settings ▸ Chats ▸ Message display; Discord-style rows
 * only, MessageList picks it): one line per message — the short time in a fixed gutter, a small
 * avatar when `compactShowAvatars` is on, the name in its role colour and the text right after
 * it, wrapping under the name. The later messages of a group start there too, their time on
 * hover. Reply and forward lines sit above the line; attachments, cards, polls, embeds,
 * reactions and threads under it. Same props, actions, selection and keys as `CozyMessageRow`,
 * from the pieces `MessageRow` exports.
 */
import { memo } from 'react';
import { cn } from '@/lib/cn';
import { BookmarkMark } from '@/features/bookmarks/BookmarkMark';
import { useAuth } from '@/stores/auth';
import { chatFontPx, useUi } from '@/stores/ui';
import { useMessageRowA11y } from '@/features/a11y/messageRowA11y';
import { ThreadStarterCard } from '@/features/threads/ThreadStarterCard';
import { PublishPill } from '@/features/announcements/PublishPill';
import {
  CrosspostSource,
  OverrideAuthorName,
  OverrideAvatar,
} from '@/features/webhooks/OverrideAuthor';
import { useEnterAnimation } from './bubbles/appearance';
import { ReactionChips, ReactionsDialog } from './bubbles/Reactions';
import { DaySeparator, SystemPill, UnreadDivider } from './bubbles/SystemPill';
import { MENTION_ROW_CLASS, useMentionsMe } from './mentions/mentionHighlight';
import { MessageTime } from './time/MessageTime';
import { formatFullMessageTime } from './time/timeFormat';
import {
  BubbleHeader,
  MessageContent,
  RetryButton,
  RowToolbar,
  SelectCheckbox,
  SenderAvatar,
  SenderName,
  SwipeHint,
  rowShape,
  useRowInteractions,
  type MessageRowProps,
} from './MessageRow';

/** The name sits on the text's first line: same size and line height, no extra padding. */
const NAME_CLASS = 'text-chat! leading-[1.38]! pt-0!';
/** One text line (MessageContent's `text-chat leading-[1.38]`), to centre the time and name in. */
const LINE_HEIGHT = 'h-[calc(var(--chat-font-size)*1.38)]';

export const CompactMessageRow = memo(function CompactMessageRow({
  row,
  chat,
  onJump,
  onJumpById,
}: MessageRowProps) {
  const m = row.message;
  const { mine } = row;
  const x = useRowInteractions(chat, m);
  const { selecting, selected, dx } = x;
  const enter = useEnterAnimation(row.key);
  // Discord shows your own name, not "You".
  const myName = useAuth((s) => s.user?.displayName ?? 'You');
  const avatars = useUi((s) => s.prefs.compactShowAvatars);
  const avatarSize = useUi((s) => Math.round(chatFontPx(s.prefs) * 1.2));
  const a11y = useMessageRowA11y(m, chat, mine);
  const mentioned = useMentionsMe(m, chat, mine);

  if (m.type === 'system') {
    return (
      <div data-testid="message" data-type="system" data-message-id={m.id}>
        {row.showDay ? <DaySeparator date={m.createdAt} /> : null}
        {row.unreadDivider ? <UnreadDivider count={row.unreadDivider} /> : null}
        <SystemPill m={m} chat={chat} onJump={onJumpById} />
      </div>
    );
  }

  const shape = rowShape(m, false);
  const { deleted, bare, visual } = shape;
  const hasReactions = m.reactions.length > 0 && !deleted;
  // No user sent it: a webhook or a crosspost shows as its author override (no profile).
  const override = m.authorOverride ?? null;
  const header = row.firstInGroup && (!!m.senderId || !!override);
  // Text flows on after the name; media, cards, polls, big emoji and text-less embeds start
  // under it.
  const inline = deleted || (m.type === 'text' && !bare && !!m.text);

  return (
    <div
      data-testid="message"
      data-message-id={m.id}
      data-seq={m.seq}
      data-mine={mine || undefined}
      data-type={m.type}
      data-cozy
      data-compact
      data-mentioned={mentioned || undefined}
      {...a11y}
    >
      {row.showDay ? <DaySeparator date={m.createdAt} /> : null}
      {row.unreadDivider ? <UnreadDivider count={row.unreadDivider} /> : null}
      <div
        className={cn(
          'group/msg relative flex items-start px-3 pt-px transition-colors duration-700 lg:px-5',
          // The space above a group follows Message spacing and UI density.
          row.firstInGroup && 'msg-group-start-compact',
          hasReactions ? 'pb-1' : 'pb-px',
          // Mentions me (Discord's tint and bar); selection and the jump flash take over.
          mentioned && !selected && !x.flash ? MENTION_ROW_CLASS : 'hover:bg-fg/[0.04]',
          selecting && 'cursor-pointer',
          selected && 'bg-brand/12',
          x.flash && 'bg-brand/20 duration-150',
        )}
        onClick={selecting ? x.toggleSelected : undefined}
        onContextMenu={x.onContextMenu}
        data-animate-avatars
      >
        {selecting ? <SelectCheckbox selected={selected} onToggle={x.toggleSelected} /> : null}

        <SwipeHint dx={dx} />

        {/* The gutter on the left is the time's (absolutely placed on the message's line). */}
        <div
          className="relative min-w-0 flex-1 pl-[calc(var(--chat-font-size)*4.3)]"
          style={dx ? { transform: `translateX(${dx}px)` } : undefined}
        >
          <div
            ref={x.bubbleRef}
            data-testid="bubble"
            {...x.bubbleHandlers}
            className={cn(
              'msg-bubble relative min-w-0 max-w-full rounded-md [touch-action:pan-y]',
              enter,
              m.failed && 'ring-1 ring-danger/60',
            )}
          >
            {header && override?.kind === 'crosspost' && override.source ? (
              <CrosspostSource source={override.source} />
            ) : null}
            <BubbleHeader m={m} chat={chat} onJump={onJump} deleted={deleted} />
            <div className="relative" data-testid="compact-line">
              <MessageTime
                at={m.createdAt}
                short
                aria-hidden={header ? undefined : true}
                className={cn(
                  'absolute top-0.5 right-full flex w-[calc(var(--chat-font-size)*4.3)] items-center justify-end pr-2 text-[length:calc(var(--chat-font-size)*0.72)] whitespace-nowrap text-muted tabular-nums',
                  LINE_HEIGHT,
                  !header && 'opacity-0 group-hover/msg:opacity-100',
                )}
              />
              {header ? (
                <span
                  className={cn(
                    'mt-0.5 ml-1.5 flex max-w-full min-w-0 items-center gap-1',
                    LINE_HEIGHT,
                    inline ? 'float-left mr-0.5' : 'w-fit',
                  )}
                  data-testid="compact-author"
                >
                  {avatars ? (
                    override ? (
                      <OverrideAvatar override={override} selecting={selecting} size={avatarSize} />
                    ) : (
                      <SenderAvatar
                        userId={m.senderId!}
                        selecting={selecting}
                        size={avatarSize}
                        spaceId={chat.space?.spaceId}
                        chatId={chat.id}
                      />
                    )
                  ) : null}
                  {override ? (
                    <OverrideAuthorName
                      override={override}
                      selecting={selecting}
                      className={cn('-ml-1', NAME_CLASS)}
                    />
                  ) : (
                    <SenderName
                      userId={m.senderId!}
                      selecting={selecting}
                      you={myName}
                      className={cn('-ml-1', NAME_CLASS)}
                      spaceId={chat.space?.spaceId}
                      chatId={chat.id}
                    />
                  )}
                  <BookmarkMark messageId={m.id} />
                </span>
              ) : null}
              <div
                className={cn(
                  // MessageContent's own block: a tighter line than the cozy row's.
                  '[&>div]:pt-0.5 [&>div]:pb-0.5',
                  bare && '[&>div]:items-start',
                  !bare && (visual ? 'max-w-[min(100%,480px)]' : 'max-w-[720px]'),
                  m.pending && 'opacity-60',
                )}
              >
                <MessageContent m={m} mine={mine} chat={chat} search={x.search} shape={shape} />
                {m.editedAt && !m.deletedAt ? (
                  <span
                    className="ml-1.5 text-[11px] text-subtle"
                    title={formatFullMessageTime(m.editedAt)}
                  >
                    (edited)
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          {hasReactions ? <ReactionChips m={m} chat={chat} className="mt-1 px-1" /> : null}
          {m.thread ? <ThreadStarterCard message={m} /> : null}
          <PublishPill chat={chat} m={m} />

          <RetryButton chat={chat} m={m} />
        </div>

        {!selecting ? (
          <RowToolbar
            chat={chat}
            m={m}
            reactable={x.reactable}
            menuOpen={x.menuOpen}
            anchored={x.toolbarAnchored}
            toolbarRef={x.toolbarRef}
            open={x.open}
            className="absolute top-0 right-3 z-[1] -translate-y-1/2 lg:right-5"
          />
        ) : null}
      </div>
      {x.reactionsOpen ? (
        <ReactionsDialog m={m} chat={chat} open onClose={() => x.setReactionsOpen(false)} />
      ) : null}
    </div>
  );
});
