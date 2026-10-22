/**
 * The full emoji picker in a popover, for adding a reaction (the "+" chip, the message menu).
 * `chat` brings my Spaces' custom emoji (its own Space first; other Spaces' left out where
 * USE_EXTERNAL_EMOJI is denied); a picked one is its token `<:name:id>`.
 */
import { Suspense } from 'react';
import type { ChatSummary } from '@enbox/shared';
import { Spinner } from '@/components/ui';
import { Popover, type PopoverAnchor } from '../../Popover';
import { LazyEmojiPicker } from '../../lazy';

export function ReactionPickerPopover({
  chat,
  anchor,
  onClose,
  onPick,
}: {
  chat: ChatSummary;
  /** Open while set. */
  anchor: PopoverAnchor | null;
  onClose: () => void;
  onPick: (emoji: string) => void;
}) {
  return (
    <Popover
      open={!!anchor}
      anchor={anchor}
      onClose={onClose}
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
          {anchor ? (
            <LazyEmojiPicker
              height={380}
              autoFocusSearch
              custom={chat}
              onPick={(emoji) => {
                onClose();
                onPick(emoji);
              }}
            />
          ) : null}
        </Suspense>
      </div>
    </Popover>
  );
}
