/**
 * Renders message text as Discord markdown (lib/richText.ts): headers, subtext, quotes,
 * lists, code blocks, and inline **bold** *italic* __underline__ ~~strike~~ `code`
 * ||spoilers||, masked links, <t:…> timestamps, tappable @mentions, custom Space emoji and
 * in-chat search highlights. `inline` (descriptions inside a paragraph) skips the block
 * syntax; `jumbo` (emoji-only messages) draws custom emoji at 48 px instead of 22. Links to
 * this app open in-app (bubbles/cards/internalLinks.ts), others in a new tab. ```ansi code
 * blocks show Discord's colour codes (always as text, never markup).
 */
import { createContext, memo, useContext, useMemo, useState, type CSSProperties } from 'react';
import type { ID } from '@enbox/shared';
import { CustomEmoji, type CustomEmojiSize } from '@/components/emoji/CustomEmoji';
import { cn } from '@/lib/cn';
import { openProfile } from '@/features/profile/open';
import { useAuth } from '@/stores/auth';
import { useUserName } from '@/stores/users';
import { useSpaces } from '@/stores/spaces';
import {
  formatTimestamp,
  parseAnsi,
  parseMarkdown,
  parseRichText,
  splitHighlight,
  type AnsiSpan,
  type Block,
  type Inline,
  type TimestampStyle,
} from '../lib/richText';
import { internalLinkOf, isPlainClick, openInternalLink } from './cards/internalLinks';

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
      data-role-mention
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

/**
 * A link: one to this app (its origin or the public one) opens in-app — a message of the
 * open chat scrolls there — unless a modifier asks for a new tab; others open in a new tab.
 */
function MessageLink({ href, title, children }: { href: string; title?: string; children: React.ReactNode }) {
  const internal = internalLinkOf(href);
  return (
    <a
      href={href}
      target={internal ? undefined : '_blank'}
      rel={internal ? undefined : 'noopener noreferrer'}
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        if (!internal || !isPlainClick(e)) return;
        e.preventDefault();
        openInternalLink(internal);
      }}
      className="break-words text-link hover:underline"
    >
      {children}
    </a>
  );
}

/** Custom emoji size of the text being rendered (jumbo for emoji-only messages). */
const EmojiSize = createContext<CustomEmojiSize>(22);

function InlineEmoji({ id, name, animated }: { id: ID; name: string; animated: boolean }) {
  return <CustomEmoji id={id} name={name} animated={animated} size={useContext(EmojiSize)} />;
}

function Timestamp({ unix, style }: { unix: number; style: TimestampStyle }) {
  const full = formatTimestamp(unix, 'F');
  return (
    <time dateTime={new Date(unix * 1000).toISOString()} title={full} className="rounded-[3px] bg-fg/10 px-0.5">
      {formatTimestamp(unix, style)}
    </time>
  );
}

/**
 * ANSI text colours 30-37 (Discord's gray, red, green, yellow, blue, pink, cyan, white) as
 * [light theme, dark themes]: each reads on code blocks of every theme ("white" is the
 * strongest text, dark on light themes).
 */
const ANSI_FG: readonly [string, string][] = [
  ['#5f6672', '#a3a8b0'],
  ['#c4302b', '#f67c76'],
  ['#5a7300', '#a6bf2a'],
  ['#876500', '#e2b53c'],
  ['#1d6db5', '#5aaaf0'],
  ['#bd2a70', '#f57fb3'],
  ['#127b75', '#40c6b9'],
  ['#1c1d21', '#ffffff'],
];

/** ANSI backgrounds 40-47 (Discord's), and whether text on them is light. */
const ANSI_BG: readonly [string, boolean][] = [
  ['#002b36', true], // firefly dark blue
  ['#cb4b16', true], // orange
  ['#586e75', true], // marble blue
  ['#657b83', true], // greyish turquoise
  ['#839496', false], // gray
  ['#6c71c4', true], // indigo
  ['#93a1a1', false], // light gray
  ['#fdf6e3', false], // white
];

function ansiStyle(s: AnsiSpan): CSSProperties | undefined {
  const fg = s.fg === undefined ? undefined : ANSI_FG[s.fg];
  if (s.bg === undefined) return fg ? { color: `light-dark(${fg[0]}, ${fg[1]})` } : undefined;
  // A background is the same in every theme: so is the text on it.
  const [background, lightText] = ANSI_BG[s.bg]!;
  return {
    backgroundColor: background,
    color: fg ? fg[lightText ? 1 : 0] : lightText ? '#fdf6e3' : '#002b36',
  };
}

/** An ```ansi block's text in its colours (the escape codes themselves never show). */
function AnsiCode({ code }: { code: string }) {
  const spans = useMemo(() => parseAnsi(code), [code]);
  return (
    <code>
      {spans.map((s, i) => (
        <span
          key={i}
          style={ansiStyle(s)}
          className={cn(s.bold && 'font-bold', s.underline && 'underline')}
        >
          {s.text}
        </span>
      ))}
    </code>
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
              <MessageLink key={i} href={s.href} title={s.children ? s.href : undefined}>
                {s.children ? <Segments segments={s.children} highlight={highlight} /> : <Text text={s.text} highlight={highlight} />}
              </MessageLink>
            );
          case 'mention':
            return <Mention key={i} userId={s.userId} />;
          case 'everyone':
            return <EveryonePill key={i} here={s.here} />;
          case 'role':
            return <RolePill key={i} roleId={s.roleId} />;
          case 'emoji':
            return <InlineEmoji key={i} id={s.id} name={s.name} animated={s.animated} />;
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
                {b.lang === 'ansi' ? <AnsiCode code={b.code} /> : <code>{b.code}</code>}
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
  jumbo = false,
}: {
  text: string;
  highlight?: string | null;
  /** Inline syntax only (inside a paragraph or a one-line preview). */
  inline?: boolean;
  /** An emoji-only message: custom emoji at 48 px. */
  jumbo?: boolean;
}) {
  const blocks = useMemo(() => (inline ? null : parseMarkdown(text)), [text, inline]);
  const segments = useMemo(() => (inline ? parseRichText(text) : null), [text, inline]);
  let out: React.ReactNode;
  if (segments) out = <Segments segments={segments} highlight={highlight} />;
  // A single paragraph renders inline so the text keeps flowing next to "(edited)".
  else if (blocks!.length === 1 && blocks![0]!.b === 'p') out = <Segments segments={blocks![0]!.children} highlight={highlight} />;
  else out = <Blocks blocks={blocks!} highlight={highlight} />;
  return jumbo ? <EmojiSize.Provider value={48}>{out}</EmojiSize.Provider> : out;
});
