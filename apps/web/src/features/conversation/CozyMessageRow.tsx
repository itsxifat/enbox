/**
 * The `cozy` bubble style (README "Chat themes & animations"): Discord-style rows — a 40 px
 * avatar, name and time header ("Today at 3:14 PM") on the first message of a sender group,
 * the short time beside the later ones on hover (the full date in their tooltips), no bubble
 * background, full-width content and a hover toolbar in the top-right corner. A message that
 * mentions me wears Discord's tint and accent bar. Same props, actions and gestures as
 * `MessageRow` (which exports the shared pieces); `MessageList` picks it from the appearance
 * context.
 */
import { memo } from 'react';
import { cn } from '@/lib/cn';
import { BookmarkMark } from '@/features/bookmarks/BookmarkMark';
import { useAuth } from '@/stores/auth';
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

export const CozyMessageRow = memo(function CozyMessageRow({
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

  return (
    <div
      data-testid="message"
      data-message-id={m.id}
      data-seq={m.seq}
      data-mine={mine || undefined}
      data-type={m.type}
      data-cozy
      data-mentioned={mentioned || undefined}
      {...a11y}
    >
      {row.showDay ? <DaySeparator date={m.createdAt} /> : null}
      {row.unreadDivider ? <UnreadDivider count={row.unreadDivider} /> : null}
      <div
        className={cn(
          'group/msg relative flex items-start gap-3 px-3 transition-colors duration-700 lg:px-5',
          // The space above a group follows Settings ▸ Accessibility ▸ Message spacing.
          row.firstInGroup ? 'msg-group-start-cozy pt-0.5' : 'pt-px',
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

        {/* Avatar column: the avatar on the group's first row, the time on hover below it. */}
        <span className="w-10 shrink-0 self-start">
          {header && override ? (
            <OverrideAvatar override={override} selecting={selecting} size={40} />
          ) : header ? (
            <SenderAvatar
              userId={m.senderId!}
              selecting={selecting}
              size={40}
              spaceId={chat.space?.spaceId}
              chatId={chat.id}
            />
          ) : (
            <MessageTime
              at={m.createdAt}
              short
              aria-hidden
              className="block pt-1 text-right text-[10.5px] leading-4 text-muted opacity-0 group-hover/msg:opacity-100"
            />
          )}
        </span>

        <div
          className="relative min-w-0 flex-1"
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
            {header ? (
              <div className="flex items-baseline gap-2">
                {override ? (
                  <OverrideAuthorName override={override} selecting={selecting} className="text-[14.5px]" />
                ) : (
                  <SenderName
                    userId={m.senderId!}
                    selecting={selecting}
                    you={myName}
                    className="text-[14.5px]"
                    spaceId={chat.space?.spaceId}
                    chatId={chat.id}
                  />
                )}
                <MessageTime at={m.createdAt} className="shrink-0 text-[11.5px] text-muted" />
                <BookmarkMark messageId={m.id} className="self-center" />
              </div>
            ) : null}
            {header && override?.kind === 'crosspost' && override.source ? (
              <CrosspostSource source={override.source} />
            ) : null}
            <BubbleHeader m={m} chat={chat} onJump={onJump} deleted={deleted} />
            <div className={cn(!bare && (visual ? 'max-w-[min(100%,480px)]' : 'max-w-[720px]'), m.pending && 'opacity-60')}>
              <MessageContent m={m} mine={mine} chat={chat} search={x.search} shape={shape} />
              {m.editedAt && !m.deletedAt ? (
                <span className="ml-1 text-[11px] text-subtle" title={formatFullMessageTime(m.editedAt)}>
                  (edited)
                </span>
              ) : null}
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
