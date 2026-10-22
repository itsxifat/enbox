/**
 * Renders message text as Discord markdown (lib/richText.ts): headers, subtext, quotes,
 * lists, code blocks, and inline **bold** *italic* __underline__ ~~strike~~ `code`
 * ||spoilers||, masked links, <t:…> timestamps, tappable @mentions and in-chat search
 * highlights. `inline` (descriptions inside a paragraph) skips the block syntax.
 */
import { memo, useMemo, useState } from 'react';
import type { ID } from '@enbox/shared';
import { cn } from '@/lib/cn';
import { openProfile } from '@/features/profile/open';
import { useAuth } from '@/stores/auth';
import { useUserName } from '@/stores/users';
import { useSpaces } from '@/stores/spaces';
import {
  formatTimestamp,
  parseMarkdown,
  parseRichText,
  splitHighlight,
  type Block,
  type Inline,
  type TimestampStyle,
} from '../lib/richText';

/** A tappable @mention: opens the profile card (Message lives inside it). */
function Mention({ userId }: { userId: ID }) {
  const me = useAuth((s) => s.user?.id);
  const name = useUserName(userId, { you: useAuth.getState().user?.displayName ?? 'You' });
  const cls = 'rounded-[3px] bg-brand/20 px-0.5 font-medium text-brand-ink';
  if (userId === me) return <span className={cls}>@{name}</span>;
  return (
    <button
      type="button"
      title={`Profile of ${name}`}
      aria-haspopup="dialog"
      className={cn(cls, 'hover:bg-brand hover:text-on-brand focus-visible:outline-2 focus-visible:outline-brand')}
      onClick={(e) => {
        e.stopPropagation();
        openProfile(userId, e.currentTarget);
      }}
    >
      @{name}
    </button>
  );
}

/** `@everyone` / `@here` in a space channel. */
function EveryonePill({ here }: { here: boolean }) {
  return <span className="rounded-[3px] bg-brand/20 px-0.5 font-medium text-brand-ink">{here ? '@here' : '@everyone'}</span>;
}

/** `@Role` in a space channel, in the role's colour. */
function RolePill({ roleId }: { roleId: ID }) {
  const role = useSpaces((s) => {
    for (const sp of Object.values(s.byId)) {
      const r = sp.roles.find((x) => x.id === roleId);
      if (r) return r;
    }
    return undefined;
  });
  const color = role?.color ?? undefined;
  return (
    <span
      className="rounded-[3px] bg-brand/20 px-0.5 font-medium text-brand-ink"
      style={color ? { color, background: `${color}26` } : undefined}
    >
      @{role?.name ?? 'role'}
    </span>
  );
}

/** ||spoiler||: hidden behind a dark pill until clicked. */
function Spoiler({ children }: { children: React.ReactNode }) {
  const [shown, setShown] = useState(false);
  return (
    <span
      role={shown ? undefined : 'button'}
      tabIndex={shown ? undefined : 0}
      aria-label={shown ? undefined : 'Spoiler, click to reveal'}
      onClick={(e) => {
        if (shown) return;
        e.stopPropagation();
        setShown(true);
      }}
      onKeyDown={(e) => {
        if (!shown && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          setShown(true);
        }
      }}
      className={cn(
        'rounded-[3px] px-0.5 transition-colors',
        shown ? 'bg-fg/10' : 'cursor-pointer bg-fg/85 text-transparent select-none [&_*]:invisible hover:bg-fg/75',
      )}
    >
      {children}
    </span>
  );
}

function Timestamp({ unix, style }: { unix: number; style: TimestampStyle }) {
  const full = formatTimestamp(unix, 'F');
  return (
    <time dateTime={new Date(unix * 1000).toISOString()} title={full} className="rounded-[3px] bg-fg/10 px-0.5">
      {formatTimestamp(unix, style)}
    </time>
  );
}

function Text({ text, highlight }: { text: string; highlight?: string | null }) {
  if (!highlight) return <>{text}</>;
  const parts = splitHighlight(text, highlight);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded-sm bg-warning/35 text-inherit">
            {p}
          </mark>
        ) : (
          p
        ),
      )}
    </>
  );
}

function Segments({ segments, highlight }: { segments: Inline[]; highlight?: string | null }) {
  return (
    <>
      {segments.map((s, i) => {
        switch (s.t) {
          case 'text':
            return <Text key={i} text={s.text} highlight={highlight} />;
          case 'link':
            return (
              <a
                key={i}
                href={s.href}
                target="_blank"
                rel="noopener noreferrer"
                title={s.children ? s.href : undefined}
                onClick={(e) => e.stopPropagation()}
                className="break-words text-link hover:underline"
              >
                {s.children ? <Segments segments={s.children} highlight={highlight} /> : <Text text={s.text} highlight={highlight} />}
              </a>
            );
          case 'mention':
            return <Mention key={i} userId={s.userId} />;
          case 'everyone':
            return <EveryonePill key={i} here={s.here} />;
          case 'role':
            return <RolePill key={i} roleId={s.roleId} />;
          case 'timestamp':
            return <Timestamp key={i} unix={s.unix} style={s.style} />;
          case 'bold':
            return (
              <strong key={i} className="font-bold">
                <Segments segments={s.children} highlight={highlight} />
              </strong>
            );
          case 'italic':
            return (
              <em key={i}>
                <Segments segments={s.children} highlight={highlight} />
              </em>
            );
          case 'underline':
            return (
              <u key={i}>
                <Segments segments={s.children} highlight={highlight} />
              </u>
            );
          case 'strike':
            return (
              <s key={i}>
                <Segments segments={s.children} highlight={highlight} />
              </s>
            );
          case 'spoiler':
            return (
              <Spoiler key={i}>
                <Segments segments={s.children} highlight={highlight} />
              </Spoiler>
            );
          case 'code':
            return (
              <code key={i} className="rounded-[4px] bg-surface-2 px-1 py-px font-mono text-[0.85em] [overflow-wrap:anywhere]">
                <Segments segments={s.children} highlight={highlight} />
              </code>
            );
        }
      })}
    </>
  );
}

function Blocks({ blocks, highlight }: { blocks: Block[]; highlight?: string | null }) {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.b) {
          case 'p':
            return (
              <div key={i}>
                <Segments segments={b.children} highlight={highlight} />
              </div>
            );
          case 'h': {
            const size = b.level === 1 ? 'text-[1.5em]' : b.level === 2 ? 'text-[1.25em]' : 'text-[1em]';
            return (
              <div key={i} role="heading" aria-level={b.level} className={cn('mt-2 mb-1 leading-[1.375] font-bold first:mt-0', size)}>
                <Segments segments={b.children} highlight={highlight} />
              </div>
            );
          }
          case 'sub':
            return (
              <div key={i} className="text-[0.8125em] text-subtle">
                <Segments segments={b.children} highlight={highlight} />
              </div>
            );
          case 'quote':
            return (
              <blockquote key={i} className="relative pl-4 before:absolute before:inset-y-0 before:left-0 before:w-1 before:rounded before:bg-line-strong">
                <Blocks blocks={b.children} highlight={highlight} />
              </blockquote>
            );
          case 'code':
            return (
              <pre
                key={i}
                data-lang={b.lang ?? undefined}
                className="my-1 max-w-full overflow-x-auto rounded-md border border-line bg-surface-2 p-2 font-mono text-[0.875em] leading-[1.125rem] whitespace-pre scrollbar-thin"
              >
                <code>{b.code}</code>
              </pre>
            );
          case 'list': {
            const Tag = b.ordered ? 'ol' : 'ul';
            return (
              <Tag key={i} start={b.ordered ? b.start : undefined} className={cn('my-0.5 pl-6', b.ordered ? 'list-decimal' : 'list-disc')}>
                {b.items.map((item, j) => (
                  <li key={j}>
                    <Blocks blocks={item} highlight={highlight} />
                  </li>
                ))}
              </Tag>
            );
          }
        }
      })}
    </>
  );
}

export const RichText = memo(function RichText({
  text,
  highlight,
  inline = false,
}: {
  text: string;
  highlight?: string | null;
  /** Inline syntax only (inside a paragraph or a one-line preview). */
  inline?: boolean;
}) {
  const blocks = useMemo(() => (inline ? null : parseMarkdown(text)), [text, inline]);
  const segments = useMemo(() => (inline ? parseRichText(text) : null), [text, inline]);
  if (segments) return <Segments segments={segments} highlight={highlight} />;
  // A single paragraph renders inline so the text keeps flowing next to "(edited)".
  if (blocks!.length === 1 && blocks![0]!.b === 'p') return <Segments segments={blocks![0]!.children} highlight={highlight} />;
  return <Blocks blocks={blocks!} highlight={highlight} />;
});
