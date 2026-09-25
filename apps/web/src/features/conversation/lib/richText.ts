/**
 * Message text → inline segments for rendering: mention tokens (`@{uuid}`), links
 * (http(s)://, www., e-mail addresses) and WhatsApp-style formatting (*bold*, _italic_,
 * ~strike~, ```mono```). Pure (unit-tested); the React renderer lives in bubbles/RichText.tsx.
 */
import { parseMentions, type ID } from '@enbox/shared';

export type Inline =
  | { t: 'text'; text: string }
  | { t: 'link'; text: string; href: string }
  | { t: 'mention'; userId: ID }
  | { t: 'bold' | 'italic' | 'strike' | 'code'; children: Inline[] };

// URL: scheme or www. prefix; trailing punctuation that usually ends a sentence is excluded.
const URL_RE =
  /\b(?:https?:\/\/|www\.)[^\s<>"'`]+[^\s<>"'`.,;:!?)\]}]|[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}\b/gi;

/** Split plain text into text/link segments. */
export function linkify(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const raw = m[0];
    const start = m.index ?? 0;
    if (start > last) out.push({ t: 'text', text: text.slice(last, start) });
    const isEmail = !/^(?:https?:\/\/|www\.)/i.test(raw) && raw.includes('@');
    const href = isEmail ? `mailto:${raw}` : /^www\./i.test(raw) ? `https://${raw}` : raw;
    out.push({ t: 'link', text: raw, href });
    last = start + raw.length;
  }
  if (last < text.length) out.push({ t: 'text', text: text.slice(last) });
  return out;
}

const MARKERS: Record<string, 'bold' | 'italic' | 'strike'> = {
  '*': 'bold',
  _: 'italic',
  '~': 'strike',
};

// A formatting span: marker, non-space start, …, non-space end, same marker; must not cross lines.
const FORMAT_RE = /([*_~])(\S(?:[^\n]*?\S)?)\1/g;
const CODE_RE = /```([\s\S]+?)```/g;

function isBoundary(ch: string | undefined): boolean {
  return ch === undefined || !/[\p{L}\p{N}]/u.test(ch);
}

function formatText(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  // A fresh regex per call: the recursion below would otherwise clobber `lastIndex`.
  const re = new RegExp(FORMAT_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const start = m.index;
    const end = start + m[0].length;
    if (!isBoundary(text[start - 1]) || !isBoundary(text[end])) {
      re.lastIndex = start + 1;
      continue;
    }
    if (start > last) out.push(...linkify(text.slice(last, start)));
    out.push({ t: MARKERS[m[1]!]!, children: formatText(m[2]!) });
    last = end;
  }
  if (last < text.length) out.push(...linkify(text.slice(last)));
  return out;
}

function formatWithCode(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of text.matchAll(CODE_RE)) {
    const start = m.index ?? 0;
    if (start > last) out.push(...formatText(text.slice(last, start)));
    out.push({ t: 'code', children: [{ t: 'text', text: m[1]! }] });
    last = start + m[0].length;
  }
  if (last < text.length) out.push(...formatText(text.slice(last)));
  return out;
}

/** Full parse: mentions first (tokens are never formatted), then code, formatting and links. */
export function parseRichText(text: string): Inline[] {
  const out: Inline[] = [];
  for (const seg of parseMentions(text)) {
    if (seg.type === 'mention') out.push({ t: 'mention', userId: seg.userId });
    else out.push(...formatWithCode(seg.text));
  }
  return out;
}

/** Plain-text rendering of segments (tests, copy). */
export function inlineToPlain(segments: Inline[], nameOf: (id: ID) => string): string {
  return segments
    .map((s) =>
      s.t === 'text' || s.t === 'link'
        ? s.text
        : s.t === 'mention'
          ? `@${nameOf(s.userId)}`
          : inlineToPlain(s.children, nameOf),
    )
    .join('');
}

/** Split `text` into [plain, match, plain, match…] parts for case-insensitive `query` highlighting. */
export function splitHighlight(text: string, query: string | null | undefined): string[] {
  const q = query?.trim();
  if (!q) return [text];
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const parts: string[] = [];
  let from = 0;
  for (;;) {
    const i = lower.indexOf(needle, from);
    if (i === -1) break;
    parts.push(text.slice(from, i), text.slice(i, i + needle.length));
    from = i + needle.length;
  }
  parts.push(text.slice(from));
  return parts;
}

// ---------------------------------------------------------------------------
// Emoji-only messages (rendered large, without a bubble)
// ---------------------------------------------------------------------------

const EMOJI_GRAPHEME =
  /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Component}|‍|️|⃣)+$/u;
const HAS_PICTO = /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u;

function graphemes(text: string): string[] {
  const Seg = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (Seg)
    return Array.from(
      new Seg(undefined, { granularity: 'grapheme' }).segment(text),
      (s) => s.segment,
    );
  return Array.from(text);
}

/** Number of emoji when `text` consists only of 1..max emoji (whitespace allowed), else 0. */
export function emojiOnlyCount(text: string | null | undefined, max = 3): number {
  if (!text) return 0;
  const compact = text.replace(/\s+/g, '');
  if (!compact || compact.length > max * 16) return 0;
  const gs = graphemes(compact);
  if (gs.length > max) return 0;
  for (const g of gs) if (!EMOJI_GRAPHEME.test(g) || !HAS_PICTO.test(g)) return 0;
  return gs.length;
}

/** First URL in a text (link previews / "open link" actions). */
export function firstUrl(text: string | null | undefined): string | null {
  if (!text) return null;
  for (const s of linkify(text)) if (s.t === 'link' && !s.href.startsWith('mailto:')) return s.href;
  return null;
}
