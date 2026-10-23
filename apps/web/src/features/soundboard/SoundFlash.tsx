import { AudioLines } from 'lucide-react';
import { EmojiGlyph } from '@/components/emoji/CustomEmoji';
import { cn } from '@/lib/cn';
import { useSoundFlash } from '@/stores/soundboard';

/**
 * The emoji of the sound `userId` just played, popping over their tile for a moment (voice
 * and Stage views). Nothing when they are not playing one.
 */
export function SoundFlash({ userId, className }: { userId: string; className?: string }) {
  const flash = useSoundFlash(userId);
  if (!flash) return null;
  return (
    <span
      key={flash.key}
      role="status"
      aria-label={`Played ${flash.name}`}
      title={flash.name}
      className={cn(
        'pointer-events-none absolute z-10 flex size-10 items-center justify-center rounded-full bg-elevated text-[24px] shadow-elevated motion-safe:animate-bounce',
        className ?? 'top-2 right-2',
      )}
      data-testid="sound-flash"
    >
      {flash.emoji ? <EmojiGlyph emoji={flash.emoji} size={32} /> : <AudioLines size={22} className="text-brand-ink" aria-hidden />}
    </span>
  );
}
