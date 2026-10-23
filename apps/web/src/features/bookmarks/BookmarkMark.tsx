/**
 * A small bookmark mark for message rows: shows only while the message is bookmarked (the
 * bookmarks store), e.g. next to the row's time.
 */
import { Bookmark } from 'lucide-react';
import type { ID } from '@enbox/shared';
import { cn } from '@/lib/cn';
import { useIsBookmarked } from './store';

export function BookmarkMark({ messageId, className }: { messageId: ID; className?: string }) {
  const saved = useIsBookmarked(messageId);
  if (!saved) return null;
  return (
    <span
      className={cn('inline-flex shrink-0 items-center text-brand-ink', className)}
      title="Bookmarked"
      data-testid="bookmark-mark"
    >
      <Bookmark size={12} className="fill-current" aria-hidden />
      <span className="sr-only">Bookmarked</span>
    </span>
  );
}
