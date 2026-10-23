/**
 * A link straight to a video file (`.mp4`, `.webm`…): a card naming the file and its site
 * with "Open video". Nothing is fetched or proxied for it — videos are too large for the
 * preview cache — so the file only loads when someone opens it.
 */
import { ExternalLink, Film } from 'lucide-react';
import { cn } from '@/lib/cn';
import { EmbedFrame, cardClasses, type RemoveEmbeds } from './EmbedFrame';

function siteOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

export function VideoLinkCard({
  url,
  fileName,
  onRemove,
}: {
  url: string;
  fileName: string;
  onRemove?: RemoveEmbeds;
}) {
  return (
    <EmbedFrame onRemove={onRemove}>
      <div
        className={cardClasses(null, 'flex w-[min(340px,62vw)] max-w-full items-center gap-3')}
        data-testid="video-link-embed"
      >
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand-ink"
          aria-hidden
        >
          <Film size={20} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-semibold text-fg" title={fileName}>
            {fileName}
          </span>
          <span className="block truncate text-[12px] text-muted">{siteOf(url)}</span>
        </span>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className={cn(
            'inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-2 px-3 py-1.5 text-[13px] font-semibold text-fg no-underline',
            'hover:bg-line focus-visible:outline-2 focus-visible:outline-brand',
          )}
        >
          Open video
          <ExternalLink size={13} aria-hidden />
        </a>
      </div>
    </EmbedFrame>
  );
}
