/**
 * One reaction emoji at `size` px: a custom emoji token renders as `CustomEmoji` (its image,
 * the animate-on-hover rules and the `:name:` fallback), a unicode emoji as text.
 */
import { parseCustomEmoji } from '@enbox/shared';
import { CustomEmoji, type CustomEmojiSize } from '@/components/emoji/CustomEmoji';
import { cn } from '@/lib/cn';

/** The nearest image size CustomEmoji draws. */
function imageSize(px: number): CustomEmojiSize {
  return px <= 16 ? 16 : px <= 22 ? 22 : px <= 32 ? 32 : 48;
}

export function ReactionEmoji({
  emoji,
  size = 16,
  className,
}: {
  emoji: string;
  /** Pixels (chips 16, lists 20, quick reactions 26, tooltip 32). */
  size?: number;
  className?: string;
}) {
  const custom = parseCustomEmoji(emoji);
  if (custom) return <CustomEmoji {...custom} size={imageSize(size)} className={className} />;
  return (
    <span
      aria-hidden
      className={cn('inline-block shrink-0 text-center leading-none', className)}
      style={{ fontSize: size, minWidth: size }}
    >
      {emoji}
    </span>
  );
}
