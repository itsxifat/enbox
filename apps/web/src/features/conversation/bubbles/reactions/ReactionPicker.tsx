/**
 * The full emoji picker in a popover, for adding a reaction (the "+" chip, the message menu).
 * `chat` brings my Spaces' custom emoji (its own Space first; other Spaces' left out where
 * USE_EXTERNAL_EMOJI is denied); a picked one is its token `<:name:id>`. Picking a super
 * reaction (`burst`) shows a "Super Reaction" header; with `modeSwitch` the header is a switch
 * between the two kinds, and `onPick` says which one was picked.
 */
import { Suspense, useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { ChatSummary } from '@enbox/shared';
import { Spinner, Switch } from '@/components/ui';
import { cn } from '@/lib/cn';
import { Popover, type PopoverAnchor } from '../../Popover';
import { LazyEmojiPicker } from '../../lazy';

export function ReactionPickerPopover({
  chat,
  anchor,
  onClose,
  onPick,
  burst = false,
  modeSwitch = false,
}: {
  chat: ChatSummary;
  /** Open while set. */
  anchor: PopoverAnchor | null;
  onClose: () => void;
  /** `opts.burst`: picked as a super reaction. */
  onPick: (emoji: string, opts: { burst: boolean }) => void;
  /** Picking a super reaction (Add Super Reaction); with `modeSwitch`, the first mode. */
  burst?: boolean;
  /** A "Super Reaction" switch in the header (for callers that read `opts.burst`). */
  modeSwitch?: boolean;
}) {
  const [superMode, setSuperMode] = useState(burst);
  // Each opening starts in the caller's mode.
  useEffect(() => {
    if (anchor) setSuperMode(burst);
  }, [anchor, burst]);
  const picking = modeSwitch ? superMode : burst;

  return (
    <Popover
      open={!!anchor}
      anchor={anchor}
      onClose={onClose}
      aria-label={picking ? 'Choose a Super Reaction' : 'Choose a reaction'}
      className="overflow-hidden"
    >
      <div className="w-[min(340px,calc(100vw-16px))]">
        {burst || modeSwitch ? (
          <div className="flex h-11 items-center gap-2 px-3" data-testid="super-reaction-header">
            <Sparkles
              size={18}
              aria-hidden
              className={cn('shrink-0', picking ? 'text-brand-ink' : 'text-muted')}
            />
            <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-fg">
              Super Reaction
            </span>
            {modeSwitch ? (
              <Switch checked={superMode} onChange={setSuperMode} aria-label="Super Reaction" />
            ) : null}
          </div>
        ) : null}
        <Suspense
          fallback={
            <div className="flex h-[380px] items-center justify-center text-brand-ink">
              <Spinner />
            </div>
          }
        >
          {anchor ? (
            <LazyEmojiPicker
              height={380}
              autoFocusSearch
              custom={chat}
              onPick={(emoji) => {
                onClose();
                onPick(emoji, { burst: picking });
              }}
            />
          ) : null}
        </Suspense>
      </div>
    </Popover>
  );
}
