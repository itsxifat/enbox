/**
 * Embed card for the first link of a text message (Discord-style: accent bar in the site's
 * theme colour, site, title, description, then a wide image below or a square one beside).
 * Renders nothing while loading, for links without a preview and when the device pref
 * `linkPreviews` is off (Settings → Chats).
 */
import { memo, useLayoutEffect, useRef, useState } from 'react';
import type { LinkPreview } from '@enbox/shared';
import { mediaUrl } from '@/lib/api';
import { bus } from '@/lib/bus';
import { cn } from '@/lib/cn';
import { useUi } from '@/stores/ui';
import { previewLink, useLinkPreview } from '../lib/linkPreview';

/** A theme colour that shows on both light and dark bubbles, else null (brand colour). */
function accentOf(hex: string | null): string | null {
  const m = hex ? /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex) : null;
  if (!m) return null;
  const [r, g, b] = m.slice(1).map((h) => {
    const c = Number.parseInt(h, 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.7 || luminance < 0.02 ? null : hex;
}

/** Wide images go full width under the text; small or squarish ones become a thumbnail. */
function isWide(image: NonNullable<LinkPreview['image']>): boolean {
  return image.width >= 400 && image.width / image.height >= 1.25;
}

function Card({ preview }: { preview: LinkPreview }) {
  const [imageFailed, setImageFailed] = useState(false);
  const image = imageFailed ? null : preview.image;
  const wide = image ? isWide(image) : false;
  const accent = accentOf(preview.themeColor);
  const img = image ? (
    <img
      src={mediaUrl(image.url)}
      alt=""
      width={image.width}
      height={image.height}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setImageFailed(true)}
      className={cn(
        'bg-black/5 object-cover dark:bg-white/5',
        wide ? 'mt-2 max-h-56 w-full rounded-md' : 'size-16 shrink-0 rounded-md',
      )}
      style={wide ? { aspectRatio: `${image.width} / ${image.height}` } : undefined}
    />
  ) : null;
  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      title={preview.url}
      className={cn(
        'mt-1.5 mb-0.5 block w-[min(340px,62vw)] rounded-md border-l-4 bg-black/[0.04] px-2.5 py-2 whitespace-normal no-underline transition-colors',
        'hover:bg-black/[0.07] focus-visible:outline-2 focus-visible:outline-brand dark:bg-white/[0.05] dark:hover:bg-white/[0.08]',
        !accent && 'border-brand',
      )}
      style={accent ? { borderLeftColor: accent } : undefined}
    >
      <span className="flex gap-2.5">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] text-muted">
            {preview.siteName ?? preview.domain}
          </span>
          {preview.title ? (
            <span className="mt-0.5 line-clamp-2 block text-[14px] leading-snug font-semibold text-brand-ink">
              {preview.title}
            </span>
          ) : null}
          {preview.description ? (
            <span className="mt-0.5 line-clamp-3 block text-[13px] leading-snug text-fg/80">
              {preview.description}
            </span>
          ) : null}
        </span>
        {img && !wide ? img : null}
      </span>
      {img && wide ? img : null}
    </a>
  );
}

/** The card for the first previewable link in `text`, when link previews are on. */
export const LinkPreviewCard = memo(function LinkPreviewCard({ text }: { text: string | null }) {
  const enabled = useUi((s) => s.prefs.linkPreviews);
  const url = enabled ? previewLink(text) : null;
  const preview = useLinkPreview(url);
  // A card that appears after the row was laid out grows it: let the message list follow.
  const knownAtMount = useRef(preview !== undefined);
  useLayoutEffect(() => {
    if (preview && !knownAtMount.current) bus.emit('conversation:row-grew');
  }, [preview]);
  return preview ? <Card preview={preview} /> : null;
});
