/**
 * The composer's sticker button: opens the sticker picker (lazy) in a popover — on touch
 * devices in a sheet instead, with the search box left unfocused (a popover closes when the
 * keyboard resizes the page); a pick closes it and is sent at once by the composer
 * (`onPick`). While `text` is a lone emoji, a "Sticker suggestions" strip above the composer
 * offers the stickers related to it (`fromText`: the sticker replaces the typed emoji). Both
 * offer what the chat allows (groups.ts).
 */
import { Suspense, useMemo, useRef, useState } from 'react';
import { Sticker } from 'lucide-react';
import type { SpaceSticker } from '@enbox/shared';
import { IconButton, Modal, Popover, Spinner } from '@/components/ui';
import { useIsTouch } from '@/hooks/useMediaQuery';
import { useStickerGroups } from '@/stores/stickers';
import { loneEmoji, stickerPickerGroups, stickersForEmoji, type StickerChat } from './groups';
import { LazyStickerPicker } from './lazy';
import { StickerImage, useStickerPlayback } from './StickerImage';

export interface StickerButtonProps {
  chat: StickerChat;
  /** The composer's text (suggestions for a lone emoji). */
  text?: string;
  onPick: (sticker: SpaceSticker, fromText: boolean) => void;
  disabled?: boolean;
  className?: string;
}

const POPOVER_SIZE = 'h-[min(440px,60dvh)] w-[min(424px,calc(100vw-16px))]';
const SHEET_SIZE = 'h-[min(520px,70dvh)] w-full';

export function StickerButton({
  chat,
  text = '',
  onPick,
  disabled,
  className,
}: StickerButtonProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const touch = useIsTouch();
  const sheetFocus = useRef<HTMLDivElement>(null);
  const open = !!anchor && !disabled;
  const close = () => setAnchor(null);
  const picker = (size: string) => (
    <Suspense
      fallback={
        <div className={`flex items-center justify-center text-brand-ink ${size}`}>
          <Spinner />
        </div>
      }
    >
      {open ? (
        <LazyStickerPicker
          chat={chat}
          autoFocusSearch={!touch}
          className={size}
          onPick={(sticker) => {
            close();
            onPick(sticker, false);
          }}
        />
      ) : null}
    </Suspense>
  );
  return (
    <>
      <IconButton
        icon={Sticker}
        label="Stickers"
        aria-haspopup="dialog"
        aria-expanded={open}
        active={open}
        disabled={disabled}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
        className={className}
      />
      {touch ? (
        <Modal
          open={open}
          onClose={close}
          aria-label="Stickers"
          hideClose
          initialFocus={sheetFocus}
        >
          <div ref={sheetFocus} tabIndex={-1} className="outline-none">
            {picker(SHEET_SIZE)}
          </div>
        </Modal>
      ) : (
        <Popover
          open={open}
          anchor={anchor}
          onClose={close}
          placement="top"
          align="end"
          aria-label="Stickers"
          className="overflow-hidden"
        >
          {picker(POPOVER_SIZE)}
        </Popover>
      )}
      {!disabled && !anchor ? (
        <StickerSuggestions chat={chat} text={text} onPick={(s) => onPick(s, true)} />
      ) : null}
    </>
  );
}

/** Stickers whose related emoji is the lone emoji typed, in a strip above the composer. */
export function StickerSuggestions({
  chat,
  text,
  onPick,
}: {
  chat: StickerChat;
  text: string;
  onPick: (sticker: SpaceSticker) => void;
}) {
  const emoji = loneEmoji(text);
  const all = useStickerGroups(!!emoji);
  const matches = useMemo(
    () => (emoji ? stickersForEmoji(stickerPickerGroups(all, chat), emoji) : []),
    [all, chat, emoji],
  );
  if (matches.length === 0) return null;
  return (
    <div
      role="group"
      aria-label="Sticker suggestions"
      className="absolute inset-x-2 bottom-full z-10 mb-1 rounded-2xl border border-line bg-elevated px-2 pt-1.5 pb-2 shadow-elevated animate-slide-up sm:inset-x-3"
      data-testid="sticker-suggestions"
    >
      <p className="px-1 pb-1 text-[12px] font-bold tracking-wide text-muted uppercase">
        Sticker suggestions
      </p>
      <div className="flex gap-1 overflow-x-auto scrollbar-thin">
        {matches.map((s) => (
          <SuggestionCell key={s.id} sticker={s} onPick={onPick} />
        ))}
      </div>
    </div>
  );
}

function SuggestionCell({
  sticker,
  onPick,
}: {
  sticker: SpaceSticker;
  onPick: (sticker: SpaceSticker) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const playing = useStickerPlayback(ref, sticker.animated, 'self', 'sticker');
  return (
    <button
      ref={ref}
      type="button"
      title={sticker.name}
      aria-label={sticker.name}
      // Keep the composer's focus (and the keyboard up on phones).
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onPick(sticker)}
      className="flex size-[72px] shrink-0 items-center justify-center rounded-lg p-1 hover:bg-hover focus-visible:outline-2 focus-visible:outline-brand"
    >
      <StickerImage
        url={sticker.url}
        animated={sticker.animated}
        playing={playing}
        alt=""
        size={64}
      />
    </button>
  );
}
