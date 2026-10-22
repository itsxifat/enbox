/**
 * A custom Space emoji (`<:name:id>` / `<a:name:id>`, shared social.ts) as an image: 16 px
 * (reactions, compact places), 22 px (inline in text) or 48 px (jumbo: emoji-only messages).
 * Alt and title are `:name:`, so screen readers, copy and a failed image (a deleted emoji)
 * all read the name. Emoji of my Spaces load their file directly; any other id goes through
 * `GET /api/emojis/:id`, which serves every Space's emoji (cacheable redirect).
 *
 * Animated emoji show their still until hovered — the emoji itself or the closest
 * `[data-animate-avatars]` ancestor (message rows) — unless the device pref
 * `autoplayAnimatedMedia` is 'always' (they play) or 'never'. Reduced motion and a hidden or
 * unfocused app always show the still (the rules of animated avatars, components/ui/Avatar).
 */
import { memo, useEffect, useRef, useState, type RefObject } from 'react';
import { parseCustomEmoji, type ID } from '@enbox/shared';
import { useAppVisible } from '@/hooks/useAppVisible';
import { useReducedMotion } from '@/hooks/useMediaQuery';
import { mediaUrl } from '@/lib/api';
import { cn } from '@/lib/cn';
import { emojiImageUrl, useEmojis } from '@/stores/emojis';
import { useUi } from '@/stores/ui';

/** 16 reactions and compact rows, 22 inline in text, 32 lists (settings), 48 jumbo. */
export type CustomEmojiSize = 16 | 22 | 32 | 48;

export interface CustomEmojiProps {
  id: ID;
  /** The name from the token (alt text; renamed emoji keep the name they were sent with). */
  name: string;
  animated?: boolean;
  size?: CustomEmojiSize;
  className?: string;
}

/** Static emoji render without a single subscription beyond their store entry. */
export const CustomEmoji = memo(function CustomEmoji(props: CustomEmojiProps) {
  if (props.animated) return <AnimatedEmoji {...props} />;
  return <EmojiImage {...props} still={false} />;
});

function AnimatedEmoji(props: CustomEmojiProps) {
  const autoplay = useUi((s) => s.prefs.autoplayAnimatedMedia);
  const reduceMotion = useReducedMotion();
  const appVisible = useAppVisible();
  const canAnimate = autoplay !== 'never' && !reduceMotion && appVisible;
  const onHover = canAnimate && autoplay !== 'always';
  const ref = useRef<HTMLElement>(null);
  const [hot, setHot] = useState(false);
  useEffect(() => {
    if (!onHover) return;
    const self = ref.current;
    if (!self) return;
    const host = self.closest<HTMLElement>('[data-animate-avatars]') ?? self;
    const on = () => setHot(true);
    const off = () => setHot(false);
    host.addEventListener('pointerenter', on);
    host.addEventListener('pointerleave', off);
    host.addEventListener('focusin', on);
    host.addEventListener('focusout', off);
    return () => {
      host.removeEventListener('pointerenter', on);
      host.removeEventListener('pointerleave', off);
      host.removeEventListener('focusin', on);
      host.removeEventListener('focusout', off);
      setHot(false);
    };
  }, [onHover]);
  const playing = canAnimate && (!onHover || hot);
  return <EmojiImage {...props} still={!playing} elRef={ref} />;
}

function EmojiImage({
  id,
  name,
  animated = false,
  size = 22,
  className,
  still,
  elRef,
}: CustomEmojiProps & { still: boolean; elRef?: RefObject<HTMLElement | null> }) {
  const known = useEmojis((s) => s.byId[id]);
  const src = mediaUrl(emojiImageUrl({ id, animated }, { still, known }));
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const label = `:${name}:`;
  const state = animated ? (still ? 'still' : 'playing') : undefined;
  if (failed)
    return (
      <span ref={elRef as RefObject<HTMLSpanElement | null>} data-emoji-id={id} data-animated={state} className={className}>
        {label}
      </span>
    );
  return (
    <img
      ref={elRef as RefObject<HTMLImageElement | null>}
      src={src}
      alt={label}
      title={label}
      width={size}
      height={size}
      draggable={false}
      loading="lazy"
      decoding="async"
      data-emoji-id={id}
      data-animated={state}
      className={cn('inline-block shrink-0 object-contain align-bottom', className)}
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
    />
  );
}

/**
 * A unicode emoji or a custom emoji token, at `size` (reaction chips, pickers, previews):
 * tokens render as `CustomEmoji`, anything else as text.
 */
export function EmojiGlyph({ emoji, size = 16, className }: { emoji: string; size?: CustomEmojiSize; className?: string }) {
  const custom = parseCustomEmoji(emoji);
  if (custom) return <CustomEmoji {...custom} size={size} className={className} />;
  return <span className={className}>{emoji}</span>;
}
