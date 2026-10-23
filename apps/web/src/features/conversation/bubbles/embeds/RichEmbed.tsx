/**
 * A rich embed under a message (webhooks; docs/design/discord-parity.md W10-E), laid out like
 * Discord's: a left colour bar (`color`, else the theme's line colour) on a soft card; the
 * author with its icon and link; the title (a link with `url`); the description in message
 * markdown; the fields grid — inline fields up to three a row on wide screens (two beside a
 * thumbnail), one column on phones; the thumbnail top right (80 px); the image under it all
 * (within 400×300, opens full size in a new tab); the footer with its icon and time.
 *
 * Images are the server's copies (`/uploads/…`) and links https only — anything else is left
 * out, so a malformed embed can never make the client reach a third-party host.
 */
import { memo } from 'react';
import type { MessageEmbed } from '@enbox/shared';
import { mediaUrl } from '@/lib/api';
import { bus } from '@/lib/bus';
import { cn } from '@/lib/cn';
import { RichText } from '../RichText';
import { embedColor, formatEmbedTimestamp, layoutFields, safeImage, safeLink } from './layout';

/** Images load after the row was laid out: let the message list follow the growth. */
const grew = () => bus.emit('conversation:row-grew');

function ExternalLink({
  href,
  className,
  children,
}: {
  href: string | null;
  className?: string;
  children: React.ReactNode;
}) {
  if (!href) return <span className={className}>{children}</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={cn(
        'hover:underline focus-visible:outline-2 focus-visible:outline-brand',
        className,
      )}
    >
      {children}
    </a>
  );
}

export const RichEmbed = memo(function RichEmbed({ embed }: { embed: MessageEmbed }) {
  const color = embedColor(embed.color);
  const thumbnail = safeImage(embed.thumbnail?.url);
  const image = safeImage(embed.image?.url);
  const authorIcon = safeImage(embed.author?.iconUrl);
  const footerIcon = safeImage(embed.footer?.iconUrl);
  const cells = layoutFields(embed.fields ?? [], thumbnail ? 2 : 3);
  const time = embed.timestamp ? formatEmbedTimestamp(embed.timestamp) : '';

  return (
    <article
      data-testid="rich-embed"
      aria-label={embed.title ?? embed.author?.name ?? 'Embed'}
      className="mt-1.5 mb-0.5 w-fit max-w-[min(100%,520px)] min-w-0 rounded-[4px] border-l-4 bg-surface-2 px-3 pt-2 pb-3 text-[14px] leading-[1.375] whitespace-normal text-fg"
      style={{ borderLeftColor: color ?? 'var(--line-strong)' }}
    >
      <div className="flex gap-4">
        <div className="flex min-w-0 flex-1 flex-col">
          {embed.author ? (
            <div className="mt-1 flex min-w-0 items-center gap-2">
              {authorIcon ? (
                <img
                  src={mediaUrl(authorIcon)}
                  alt=""
                  width={24}
                  height={24}
                  loading="lazy"
                  className="size-6 shrink-0 rounded-full object-cover"
                />
              ) : null}
              <ExternalLink
                href={safeLink(embed.author.url)}
                className="min-w-0 truncate text-[14px] font-semibold"
              >
                {embed.author.name}
              </ExternalLink>
            </div>
          ) : null}
          {embed.title ? (
            <ExternalLink
              href={safeLink(embed.url)}
              className={cn(
                'mt-2 text-[16px] font-semibold break-words',
                safeLink(embed.url) && 'text-link',
              )}
            >
              {embed.title}
            </ExternalLink>
          ) : null}
          {embed.description ? (
            <div className="mt-2 break-words whitespace-pre-wrap" data-testid="embed-description">
              <RichText text={embed.description} />
            </div>
          ) : null}
          {cells.length ? (
            <dl className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-12" data-testid="embed-fields">
              {cells.map(({ field, column }, i) => (
                <div
                  key={i}
                  data-testid="embed-field"
                  data-column={column}
                  className="col-span-full min-w-0 sm:[grid-column:var(--embed-column)]"
                  style={{ '--embed-column': column } as React.CSSProperties}
                >
                  <dt className="mb-0.5 text-[14px] font-semibold break-words">{field.name}</dt>
                  <dd className="break-words whitespace-pre-wrap text-fg/90">
                    <RichText text={field.value} />
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
        {thumbnail ? (
          <a
            href={mediaUrl(thumbnail)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="mt-2 shrink-0 self-start"
            aria-label="Open thumbnail"
          >
            <img
              src={mediaUrl(thumbnail)}
              alt=""
              data-testid="embed-thumbnail"
              loading="lazy"
              onLoad={grew}
              className="max-h-20 max-w-20 rounded-[4px] object-contain"
            />
          </a>
        ) : null}
      </div>
      {image ? (
        <a
          href={mediaUrl(image)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="mt-4 block w-fit max-w-full"
          aria-label="Open image"
        >
          <img
            src={mediaUrl(image)}
            alt=""
            data-testid="embed-image"
            loading="lazy"
            onLoad={grew}
            className="block max-h-[300px] w-auto max-w-[min(100%,400px)] rounded-[4px] object-contain"
          />
        </a>
      ) : null}
      {embed.footer || time ? (
        <div
          className="mt-2 flex min-w-0 items-center gap-2 text-[12px] text-muted"
          data-testid="embed-footer"
        >
          {footerIcon ? (
            <img
              src={mediaUrl(footerIcon)}
              alt=""
              width={20}
              height={20}
              loading="lazy"
              className="size-5 shrink-0 rounded-full object-cover"
            />
          ) : null}
          <span className="min-w-0 break-words">
            {embed.footer?.text}
            {embed.footer && time ? <span aria-hidden> • </span> : null}
            {time ? <time dateTime={embed.timestamp ?? undefined}>{time}</time> : null}
          </span>
        </div>
      ) : null}
    </article>
  );
});
