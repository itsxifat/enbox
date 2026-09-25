/**
 * Reaction popover for channel posts: QUICK_REACTIONS, plus the full emoji picker (lazy)
 * when the channel allows any emoji. Positioned next to an anchor element.
 */
import { Suspense, lazy, useLayoutEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { QUICK_REACTIONS } from '@enbox/shared';
import { Portal, Spinner } from '@/components/ui';
import { useOverlay } from '@/components/ui/overlay';
import { cn } from '@/lib/cn';
import { useUi } from '@/stores/ui';

const EmojiPicker = lazy(() => import('emoji-picker-react'));

export function ReactionPicker({
  anchor,
  mode,
  current,
  onPick,
  onClose,
}: {
  anchor: HTMLElement | null;
  mode: 'all' | 'quick';
  current: string | null;
  onPick: (emoji: string | null) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const theme = useUi((s) => s.resolvedTheme);
  useOverlay(!!anchor, onClose);

  useLayoutEffect(() => {
    if (!anchor || !ref.current) return;
    const a = anchor.getBoundingClientRect();
    const r = ref.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let top = a.top - r.height - 8;
    if (top < 8) top = Math.min(vh - r.height - 8, a.bottom + 8);
    const left = Math.max(8, Math.min(vw - r.width - 8, a.left));
    setPos({ top, left });
  }, [anchor, full]);

  useLayoutEffect(() => {
    if (!anchor) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [anchor, onClose]);

  if (!anchor) return null;
  const pick = (emoji: string) => {
    onPick(emoji === current ? null : emoji);
    onClose();
  };
  return (
    <Portal>
      <div
        ref={ref}
        role="dialog"
        aria-label="React"
        className={cn(
          'fixed z-[60] rounded-3xl border border-line bg-elevated shadow-elevated',
          pos ? 'animate-scale-in' : 'invisible',
        )}
        style={{ top: pos?.top ?? 0, left: pos?.left ?? 0 }}
      >
        {full ? (
          <Suspense
            fallback={
              <div className="flex h-[360px] w-[320px] items-center justify-center text-brand-ink">
                <Spinner />
              </div>
            }
          >
            <EmojiPicker
              onEmojiClick={(d) => pick(d.emoji)}
              theme={theme as never}
              // Native emoji (EmojiStyle.NATIVE): the default style loads images from a CDN,
              // which the production CSP (first-party images only) blocks.
              emojiStyle={'native' as never}
              lazyLoadEmojis
              width={320}
              height={380}
              previewConfig={{ showPreview: false }}
            />
          </Suspense>
        ) : (
          <div className="flex items-center gap-0.5 p-1.5">
            {QUICK_REACTIONS.map((e) => (
              <button
                key={e}
                type="button"
                aria-label={`React ${e}`}
                aria-pressed={current === e}
                onClick={() => pick(e)}
                className={cn(
                  'flex size-10 items-center justify-center rounded-full text-[24px] transition-transform hover:scale-125 focus-visible:outline-2 focus-visible:outline-brand',
                  current === e && 'bg-brand-soft',
                )}
              >
                {e}
              </button>
            ))}
            {mode === 'all' ? (
              <button
                type="button"
                aria-label="More reactions"
                onClick={() => setFull(true)}
                className="flex size-10 items-center justify-center rounded-full bg-surface-2 text-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-brand"
              >
                <Plus size={20} aria-hidden />
              </button>
            ) : null}
          </div>
        )}
      </div>
    </Portal>
  );
}
