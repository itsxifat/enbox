/**
 * A miniature conversation rendered with a resolved appearance (Settings → Chats and the
 * ChatThemeSheet): the same `.chat-wallpaper` root, `ChatBackground`, bubble variables and
 * `[data-bubble-style]` rules real rows use, so what you see is what the chat gets.
 */
import { DoubleTickIcon } from '@/components/icons';
import { cn } from '@/lib/cn';
import { ChatBackground } from './ChatBackground';
import type { ResolvedAppearance } from './presets';

export function ChatPreview({
  appearance,
  className,
}: {
  appearance: ResolvedAppearance;
  className?: string;
}) {
  const cozy = appearance.bubbleStyle === 'cozy';
  return (
    <div
      className={cn('chat-wallpaper relative overflow-hidden rounded-2xl', className)}
      style={appearance.style}
      {...appearance.data}
      aria-hidden
      data-testid="chat-preview"
    >
      <ChatBackground appearance={appearance} />
      <div className="relative flex flex-col gap-1.5 p-4">
        <div
          className={cn(
            'msg-bubble relative max-w-[78%] self-start rounded-lg rounded-tl-none bg-bubble-in px-3 py-1.5 text-chat leading-snug text-fg shadow-bubble',
            cozy && 'max-w-full',
          )}
        >
          {cozy ? <span className="mr-2 text-[12px] font-semibold text-brand-ink">Sam</span> : null}
          Did you see the new themes?
          <span className="ml-2 text-[11px] text-bubble-in-meta">10:41</span>
        </div>
        <div
          className={cn(
            'msg-bubble relative max-w-[78%] self-end rounded-lg rounded-tr-none bg-bubble-out px-3 py-1.5 text-chat leading-snug text-fg shadow-bubble',
            cozy && 'max-w-full self-start',
          )}
        >
          {cozy ? <span className="mr-2 text-[12px] font-semibold text-brand-ink">You</span> : null}
          Yes! This one looks great
          <span className="ml-2 inline-flex items-center gap-0.5 text-[11px] text-bubble-out-meta">
            10:42 <DoubleTickIcon size={14} className="text-tick-read" />
          </span>
        </div>
      </div>
    </div>
  );
}
