/**
 * The `cozy` bubble style (README "Chat themes & animations"): Discord-style rows — a 40 px
 * avatar, name and time header on the first message of a sender group, no bubble
 * background, full-width content and a hover toolbar in the top-right corner. Same props,
 * actions and gestures as `MessageRow` (which exports the shared pieces); `MessageList`
 * picks it from the appearance context.
 */
import { memo } from 'react';
import { cn } from '@/lib/cn';
import { formatTime } from '@/lib/format';
import { useAuth } from '@/stores/auth';
import { useEnterAnimation } from './bubbles/appearance';
import { ReactionPill, ReactionsDialog } from './bubbles/Reactions';
import { DaySeparator, SystemPill, UnreadDivider } from './bubbles/SystemPill';
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
  const header = row.firstInGroup && !!m.senderId;

  return (
    <div
      data-testid="message"
      data-message-id={m.id}
      data-seq={m.seq}
      data-mine={mine || undefined}
      data-type={m.type}
      data-cozy
    >
      {row.showDay ? <DaySeparator date={m.createdAt} /> : null}
      {row.unreadDivider ? <UnreadDivider count={row.unreadDivider} /> : null}
      <div
        className={cn(
          'group/msg relative flex items-start gap-3 px-3 transition-colors duration-700 lg:px-5',
          row.firstInGroup ? 'mt-2.5 pt-0.5' : 'pt-px',
          hasReactions ? 'pb-1' : 'pb-px',
          'hover:bg-fg/[0.04]',
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
          {header ? (
            <SenderAvatar userId={m.senderId!} selecting={selecting} size={40} />
          ) : (
            <span
              className="block pt-1 text-right text-[10.5px] leading-4 text-muted opacity-0 group-hover/msg:opacity-100"
              aria-hidden
            >
              {formatTime(m.createdAt)}
            </span>
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
                <SenderName
                  userId={m.senderId!}
                  selecting={selecting}
                  you={myName}
                  className="text-[14.5px]"
                />
                <span className="shrink-0 text-[11.5px] text-muted">{formatTime(m.createdAt)}</span>
              </div>
            ) : null}
            <BubbleHeader m={m} chat={chat} onJump={onJump} deleted={deleted} />
            <div className={cn(!bare && (visual ? 'max-w-[min(100%,480px)]' : 'max-w-[720px]'))}>
              <MessageContent m={m} mine={mine} chat={chat} search={x.search} shape={shape} />
            </div>
          </div>

          {hasReactions ? (
            <div className="mt-1 flex px-1">
              <ReactionPill
                reactions={m.reactions}
                mine={mine}
                myReaction={m.myReaction}
                onClick={() => x.setReactionsOpen(true)}
              />
            </div>
          ) : null}

          <RetryButton chat={chat} m={m} />
        </div>

        {!selecting ? (
          <RowToolbar
            mine={false}
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
