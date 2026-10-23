/**
 * Message text → Discord markdown for rendering. Pure (unit-tested); the React renderer
 * lives in bubbles/RichText.tsx.
 *
 * Blocks (line based): ```lang code blocks```, `> ` quotes and `>>> ` (quote the rest),
 * `# ` / `## ` / `### ` headers, `-# ` subtext, `- ` / `* ` / `1. ` lists (indent to nest).
 * Inline: `code`, ||spoiler||, **bold**, __underline__, *italic* / _italic_, ~~strike~~,
 * [masked](https://links), <https://links>, <t:unix:style> timestamps, auto links
 * (http(s)://, www., e-mail), `\` escapes, and mention tokens (`@{uuid}`, `@{everyone}`,
 * `@{here}`, `@{role:uuid}`), channel mentions (`#{uuid}`) and custom emoji tokens
 * (`<:name:id>`, `<a:name:id>`) anywhere — also inside formatting. Code spans and blocks show
 * tokens raw; `\<:name:id>` and `\#{uuid}` are the raw token as text (Discord's escape).
 * ```ansi blocks take Discord's colour codes (`parseAnsi`).
 */
import {
  CHANNEL_MENTION_RE,
  CUSTOM_EMOJI_TOKEN_RE,
  channelMentionToken,
  customEmojiToken,
  parseRichMentions,
  type ID,
} from '@enbox/shared';

export type Inline =
  | { t: 'text'; text: string }
  | { t: 'link'; text: string; href: string; children?: Inline[] }
  | { t: 'mention'; userId: ID }
  /** Space channels: `@{everyone}` / `@{here}`. */
  | { t: 'everyone'; here: boolean }
  /** Space channels: `@{role:<uuid>}`. */
  | { t: 'role'; roleId: ID }
  /** A channel, thread or forum post: `#{<uuid>}`. */
  | { t: 'channel'; chatId: ID }
  /** A custom Space emoji: `<:name:id>`, `<a:name:id>` (animated). */
  | { t: 'emoji'; id: ID; name: string; animated: boolean }
  | { t: 'bold' | 'italic' | 'underline' | 'strike' | 'spoiler'; children: Inline[] }
  | { t: 'code'; children: [{ t: 'text'; text: string }] }
  /** `<t:unix:style>`; style one of t T d D f F R (default f). */
  | { t: 'timestamp'; unix: number; style: TimestampStyle };

export type TimestampStyle = 't' | 'T' | 'd' | 'D' | 'f' | 'F' | 'R';

export type Block =
  | { b: 'p'; children: Inline[] }
  | { b: 'h'; level: 1 | 2 | 3; children: Inline[] }
  | { b: 'sub'; children: Inline[] }
  | { b: 'quote'; children: Block[] }
  | { b: 'code'; lang: string | null; code: string }
  | { b: 'list'; ordered: boolean; start: number; items: Block[][] };

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

// ---------------------------------------------------------------------------
// Mention placeholders: tokens become private-use markers so formatting can wrap them.
// ---------------------------------------------------------------------------

const PH_OPEN = '';
const PH_CLOSE = '';
type Special = Extract<Inline, { t: 'mention' | 'everyone' | 'role' | 'channel' | 'emoji' }>;

/** A fresh copy of the shared global token regex (no shared `lastIndex`). */
const emojiTokenRe = () => new RegExp(CUSTOM_EMOJI_TOKEN_RE.source, 'g');
const channelTokenRe = () => new RegExp(CHANNEL_MENTION_RE.source, 'g');

/** Whether the char at `i` follows an odd run of backslashes (it is escaped). */
function escapedAt(text: string, i: number): boolean {
  let n = 0;
  while (i - n - 1 >= 0 && text[i - n - 1] === '\\') n++;
  return n % 2 === 1;
}

/** Custom emoji and channel tokens of plain text → placeholders (escaped tokens stay text). */
function protectTokens(text: string, specials: Special[]): string {
  const hold = (special: Special) => {
    specials.push(special);
    return `${PH_OPEN}${specials.length - 1}${PH_CLOSE}`;
  };
  let out = text;
  if (out.includes('<')) {
    const src = out;
    out = src.replace(emojiTokenRe(), (token: string, a: string, name: string, id: string, at: number) =>
      escapedAt(src, at) ? token : hold({ t: 'emoji', id, name, animated: a === 'a' }),
    );
  }
  if (out.includes('#{')) {
    const src = out;
    out = src.replace(channelTokenRe(), (token: string, chatId: string, at: number) =>
      escapedAt(src, at) ? token : hold({ t: 'channel', chatId }),
    );
  }
  return out;
}

function protectMentions(text: string): { text: string; specials: Special[] } {
  const specials: Special[] = [];
  let out = '';
  for (const seg of parseRichMentions(text)) {
    if (seg.type === 'text') {
      out += protectTokens(seg.text, specials);
      continue;
    }
    specials.push(
      seg.type === 'mention'
        ? { t: 'mention', userId: seg.userId }
        : seg.type === 'everyone'
          ? { t: 'everyone', here: seg.here }
          : { t: 'role', roleId: seg.roleId },
    );
    out += `${PH_OPEN}${specials.length - 1}${PH_CLOSE}`;
  }
  return { text: out, specials };
}

/** Plain text (may contain placeholders) → text/link/mention segments. */
function textNodes(text: string, specials: Special[]): Inline[] {
  const out: Inline[] = [];
  const re = new RegExp(`${PH_OPEN}(\\d+)${PH_CLOSE}`, 'g');
  let last = 0;
  for (const m of text.matchAll(re)) {
    const start = m.index ?? 0;
    if (start > last) out.push(...linkify(text.slice(last, start)));
    const sp = specials[Number(m[1])];
    if (sp) out.push(sp);
    last = start + m[0].length;
  }
  if (last < text.length) out.push(...linkify(text.slice(last)));
  return out;
}

/** Placeholders back to readable text (code spans and code blocks show the raw token). */
function restoreRaw(text: string, specials: Special[]): string {
  return text.replace(new RegExp(`${PH_OPEN}(\\d+)${PH_CLOSE}`, 'g'), (_, i: string) => {
    const s = specials[Number(i)];
    if (!s) return '';
    if (s.t === 'emoji') return customEmojiToken(s);
    if (s.t === 'channel') return channelMentionToken(s.chatId);
    return s.t === 'mention' ? `@{${s.userId}}` : s.t === 'everyone' ? (s.here ? '@{here}' : '@{everyone}') : `@{role:${s.roleId}}`;
  });
}

// ---------------------------------------------------------------------------
// Inline
// ---------------------------------------------------------------------------

const isWordChar = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);

interface Rule {
  /** Sticky (`y`): matched at the current position. */
  re: RegExp;
  /** Return the node, or null to treat the match as text. `prev` is the char before. */
  node: (m: RegExpExecArray, prev: string | undefined, specials: Special[]) => Inline | null;
}

const wrap = (t: 'bold' | 'italic' | 'underline' | 'strike' | 'spoiler') =>
  (m: RegExpExecArray, _prev: string | undefined, specials: Special[]): Inline => ({
    t,
    children: parseInline(m[1]!, specials),
  });

const RULES: Rule[] = [
  // Escapes: \* \_ \~ \` \| \> \# \- \\ …
  { re: /\\([^\p{L}\p{N}\s])/uy, node: (m) => ({ t: 'text', text: m[1]! }) },
  // Inline code: any number of backticks, same count closes; no formatting inside.
  {
    re: /(`+)([\s\S]*?[^`])\1(?!`)/y,
    node: (m, _p, specials) => {
      let code = restoreRaw(m[2]!, specials);
      if (/^ .* $/s.test(code) && code.trim()) code = code.slice(1, -1);
      return { t: 'code', children: [{ t: 'text', text: code }] };
    },
  },
  { re: /\|\|([\s\S]+?)\|\|/y, node: wrap('spoiler') },
  // ***x*** is bold + italic: bold first, its content then matches italic.
  { re: /\*\*([\s\S]+?\**)\*\*(?!\*)/y, node: wrap('bold') },
  { re: /__([\s\S]+?_*)__(?!_)/y, node: wrap('underline') },
  { re: /~~([\s\S]+?)~~/y, node: wrap('strike') },
  {
    re: /\*(?=\S)((?:\*\*|\\[\s\S]|\s+(?:\\[\s\S]|[^\s*\\]|\*\*)|[^\s*\\])+?)\*(?!\*)/y,
    node: wrap('italic'),
  },
  {
    // _italic_ only at word boundaries (snake_case stays as is).
    re: /_((?:__|\\[\s\S]|[^\\_])+?)_(?![\p{L}\p{N}])/uy,
    node: (m, prev, specials) => (isWordChar(prev) ? null : { t: 'italic', children: parseInline(m[1]!, specials) }),
  },
  // [masked](https://link): http(s) only.
  {
    re: /\[([^\]\n]+)\]\(<?(https?:\/\/[^\s)>]+)>?\)/y,
    node: (m, _p, specials) => ({ t: 'link', text: m[1]!, href: m[2]!, children: parseInline(m[1]!, specials) }),
  },
  // <https://link> (no embed in Discord; here simply a link).
  { re: /<(https?:\/\/[^\s>]+)>/y, node: (m) => ({ t: 'link', text: m[1]!, href: m[1]! }) },
  {
    re: /<t:(-?\d{1,13})(?::([tTdDfFR]))?>/y,
    node: (m) => ({ t: 'timestamp', unix: Number(m[1]), style: (m[2] as TimestampStyle | undefined) ?? 'f' }),
  },
  // Bare URLs are consumed whole so markdown characters inside them stay literal. A token
  // placeholder ends them (a `<:emoji:id>` right after a link, like its `<` would).
  {
    re: /(?:https?:\/\/|www\.)[^\s<>"'`\uE000]+[^\s<>"'`.,;:!?)\]}\uE000]/iy,
    node: (m, prev) => {
      if (isWordChar(prev)) return null;
      const raw = m[0];
      return { t: 'link', text: raw, href: /^www\./i.test(raw) ? `https://${raw}` : raw };
    },
  },
];

// Characters that can start a rule; anything else is copied straight into the text buffer.
const TRIGGERS = new Set(['\\', '`', '|', '*', '_', '~', '[', '<', 'h', 'H', 'w', 'W']);

function parseInline(text: string, specials: Special[]): Inline[] {
  const out: Inline[] = [];
  let buf = '';
  const flush = () => {
    if (buf) out.push(...textNodes(buf, specials));
    buf = '';
  };
  let i = 0;
  outer: while (i < text.length) {
    const ch = text[i]!;
    if (TRIGGERS.has(ch)) {
      for (const rule of RULES) {
        // Sticky regexes match at `i` without slicing the rest of the text.
        rule.re.lastIndex = i;
        const m = rule.re.exec(text);
        if (!m) continue;
        const node = rule.node(m, i > 0 ? text[i - 1] : undefined, specials);
        if (!node) continue;
        if (node.t === 'text') buf += node.text;
        else {
          flush();
          out.push(node);
        }
        i += m[0].length;
        continue outer;
      }
    }
    buf += ch;
    i++;
  }
  flush();
  return mergeText(out);
}

function mergeText(nodes: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const n of nodes) {
    const prev = out[out.length - 1];
    if (n.t === 'text' && prev?.t === 'text') out[out.length - 1] = { t: 'text', text: prev.text + n.text };
    else if (n.t !== 'text' || n.text) out.push(n);
  }
  return out;
}

/** Inline-only parse (descriptions, one-line previews): no headers, lists, quotes or blocks. */
export function parseRichText(text: string): Inline[] {
  const { text: safe, specials } = protectMentions(text);
  return parseInline(safe, specials);
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

const LIST_RE = /^(\s*)([-*]|\d{1,9}\.)\s+(.*)$/;

function parseBlocks(text: string, specials: Special[], inQuote = false): Block[] {
  const lines = text.split('\n');
  const out: Block[] = [];
  let para: string[] = [];
  const flushPara = () => {
    if (!para.length) return;
    // Blank lines around blocks are spacing only; keep inner blank lines.
    while (para.length && para[0]!.trim() === '') para.shift();
    while (para.length && para[para.length - 1]!.trim() === '') para.pop();
    if (para.length) out.push({ b: 'p', children: parseInline(para.join('\n'), specials) });
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // ```lang\ncode\n``` (also on one line: ```code```).
    if (line.trimStart().startsWith('```')) {
      const start = line.indexOf('```');
      const restOfText = [line.slice(start + 3), ...lines.slice(i + 1)].join('\n');
      const close = restOfText.indexOf('```');
      if (close !== -1) {
        flushPara();
        let body = restOfText.slice(0, close);
        let lang: string | null = null;
        const firstNl = body.indexOf('\n');
        if (firstNl > 0 && /^[\w+#.-]{1,20}$/.test(body.slice(0, firstNl).trim())) {
          lang = body.slice(0, firstNl).trim().toLowerCase();
          body = body.slice(firstNl + 1);
        } else if (firstNl === 0) body = body.slice(1);
        out.push({ b: 'code', lang, code: restoreRaw(body.replace(/\n$/, ''), specials) });
        // Continue after the closing fence (text after it on the same line becomes a paragraph).
        const consumed = restOfText.slice(0, close + 3);
        const consumedLines = consumed.split('\n').length - 1;
        const tail = restOfText.slice(close + 3).split('\n')[0]!;
        i += consumedLines;
        if (tail.trim()) para.push(tail);
        continue;
      }
    }

    if (!inQuote && line.startsWith('>>> ')) {
      flushPara();
      const rest = [line.slice(4), ...lines.slice(i + 1)].join('\n');
      out.push({ b: 'quote', children: parseBlocks(rest, specials, true) });
      break;
    }
    if (!inQuote && (line.startsWith('> ') || line === '>')) {
      flushPara();
      const quoted: string[] = [];
      while (i < lines.length && (lines[i]!.startsWith('> ') || lines[i] === '>')) {
        quoted.push(lines[i]!.slice(2));
        i++;
      }
      i--;
      out.push({ b: 'quote', children: parseBlocks(quoted.join('\n'), specials, true) });
      continue;
    }

    const h = /^(#{1,3}) (.+)$/.exec(line);
    if (h) {
      flushPara();
      out.push({ b: 'h', level: h[1]!.length as 1 | 2 | 3, children: parseInline(h[2]!, specials) });
      continue;
    }
    const sub = /^-# (.+)$/.exec(line);
    if (sub) {
      flushPara();
      out.push({ b: 'sub', children: parseInline(sub[1]!, specials) });
      continue;
    }

    const li = LIST_RE.exec(line);
    if (li) {
      flushPara();
      const listLines: string[] = [];
      const baseIndent = li[1]!.length;
      const ordered = /\d/.test(li[2]!);
      while (i < lines.length) {
        const m = LIST_RE.exec(lines[i]!);
        const nested = /^\s{2,}\S/.test(lines[i]!) && listLines.length > 0;
        if (!m && !nested) break;
        // A top-level item of the other kind (bullets ↔ numbers) starts a new list.
        if (m && m[1]!.length <= baseIndent && /\d/.test(m[2]!) !== ordered) break;
        listLines.push(lines[i]!);
        i++;
      }
      i--;
      out.push(parseList(listLines, specials));
      continue;
    }

    para.push(line);
  }
  flushPara();
  return out;
}

function parseList(lines: string[], specials: Special[]): Block {
  const first = LIST_RE.exec(lines[0]!)!;
  const baseIndent = first[1]!.length;
  const ordered = /\d/.test(first[2]!);
  const start = ordered ? Number.parseInt(first[2]!, 10) || 1 : 1;
  const items: string[][] = [];
  for (const line of lines) {
    const m = LIST_RE.exec(line);
    if (m && m[1]!.length <= baseIndent) items.push([m[3]!]);
    else if (items.length) items[items.length - 1]!.push(line.slice(Math.min(baseIndent + 2, line.length - line.trimStart().length)));
  }
  return {
    b: 'list',
    ordered,
    start,
    items: items.map(([head, ...rest]) => {
      const blocks: Block[] = [{ b: 'p', children: parseInline(head!, specials) }];
      if (rest.length) blocks.push(...parseBlocks(rest.join('\n'), specials, true));
      return blocks;
    }),
  };
}

/** Full Discord markdown parse of a message. */
export function parseMarkdown(text: string): Block[] {
  const { text: safe, specials } = protectMentions(text);
  return parseBlocks(safe, specials);
}

// ---------------------------------------------------------------------------
// ANSI code blocks
// ---------------------------------------------------------------------------

/** A run of an ```ansi block in one style; colours are 0-7 (codes 30-37 and 40-47). */
export interface AnsiSpan {
  text: string;
  bold?: boolean;
  underline?: boolean;
  fg?: number;
  bg?: number;
}

/** An escape sequence (`ESC [ params intermediates final`), or a lone ESC. */
// eslint-disable-next-line no-control-regex -- matching ESC is the point
const ANSI_SEQUENCE_RE = /\u001b(?:\[([\x30-\x3f]*)[\x20-\x2f]*([\x40-\x7e]))?/g;

/**
 * Discord's ANSI subset: `ESC[…m` with 0 reset, 1 bold, 4 underline, 30-37 text and 40-47
 * background colours (several codes per sequence: `ESC[1;31m`). Unknown codes and other
 * sequences are dropped; the text itself is never interpreted (it renders as text).
 */
export function parseAnsi(code: string): AnsiSpan[] {
  const out: AnsiSpan[] = [];
  let style: Omit<AnsiSpan, 'text'> = {};
  let last = 0;
  const push = (text: string) => {
    if (!text) return;
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.bold === style.bold &&
      prev.underline === style.underline &&
      prev.fg === style.fg &&
      prev.bg === style.bg
    )
      prev.text += text;
    else out.push({ text, ...style });
  };
  for (const m of code.matchAll(ANSI_SEQUENCE_RE)) {
    const at = m.index ?? 0;
    push(code.slice(last, at));
    last = at + m[0].length;
    if (m[2] !== 'm') continue;
    const next = { ...style };
    for (const p of (m[1] ?? '').split(';')) {
      const n = p === '' ? 0 : Number(p);
      if (n === 0) {
        delete next.bold;
        delete next.underline;
        delete next.fg;
        delete next.bg;
      } else if (n === 1) next.bold = true;
      else if (n === 4) next.underline = true;
      else if (n >= 30 && n <= 37) next.fg = n - 30;
      else if (n >= 40 && n <= 47) next.bg = n - 40;
    }
    style = next;
  }
  push(code.slice(last));
  return out;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Plain-text rendering of segments (tests, copy). `channelName`: a channel mention's name
 * (default "channel", as `renderMentions`).
 */
export function inlineToPlain(
  segments: Inline[],
  nameOf: (id: ID) => string,
  channelName: (id: ID) => string = () => 'channel',
): string {
  return segments
    .map((s) => {
      switch (s.t) {
        case 'text':
          return s.text;
        case 'link':
          return s.children ? inlineToPlain(s.children, nameOf, channelName) : s.text;
        case 'mention':
          return `@${nameOf(s.userId)}`;
        case 'everyone':
          return s.here ? '@here' : '@everyone';
        case 'role':
          return '@role';
        case 'channel':
          return `#${channelName(s.chatId)}`;
        case 'emoji':
          return `:${s.name}:`;
        case 'timestamp':
          return new Date(s.unix * 1000).toISOString();
        default:
          return inlineToPlain(s.children, nameOf, channelName);
      }
    })
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

/** Discord's `<t:…>` formats. */
export function formatTimestamp(unix: number, style: TimestampStyle, now = Date.now()): string {
  const d = new Date(unix * 1000);
  if (Number.isNaN(d.getTime())) return 'Invalid Date';
  switch (style) {
    case 't':
      return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    case 'T':
      return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
    case 'd':
      return d.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' });
    case 'D':
      return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
    case 'F':
      return d.toLocaleString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    case 'R': {
      const diff = (unix * 1000 - now) / 1000;
      const abs = Math.abs(diff);
      const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
      const units: [Intl.RelativeTimeFormatUnit, number][] = [
        ['year', 31536000],
        ['month', 2592000],
        ['day', 86400],
        ['hour', 3600],
        ['minute', 60],
        ['second', 1],
      ];
      for (const [unit, secs] of units) if (abs >= secs || unit === 'second') return rtf.format(Math.round(diff / secs), unit);
      return '';
    }
    default:
      return d.toLocaleString(undefined, { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
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

/**
 * Number of emoji when `text` consists only of 1..max emoji (whitespace allowed), else 0.
 * Custom emoji tokens count as one each (an escaped one is text).
 */
export function emojiOnlyCount(text: string | null | undefined, max = 3): number {
  if (!text) return 0;
  let custom = 0;
  const rest = text.includes('<')
    ? text.replace(emojiTokenRe(), (token: string, _a: string, _n: string, _id: string, at: number) => {
        if (escapedAt(text, at)) return token;
        custom++;
        return ' ';
      })
    : text;
  if (custom > max) return 0;
  const compact = rest.replace(/\s+/g, '');
  if (!compact) return custom;
  if (compact.length > (max - custom) * 16) return 0;
  const gs = graphemes(compact);
  if (custom + gs.length > max) return 0;
  for (const g of gs) if (!EMOJI_GRAPHEME.test(g) || !HAS_PICTO.test(g)) return 0;
  return custom + gs.length;
}

/** Custom emoji tokens → `:name:` (plain-text previews, labels, copy). */
export function plainCustomEmoji(text: string): string {
  if (!text.includes('<')) return text;
  return text.replace(emojiTokenRe(), (token: string, _a: string, name: string, _id: string, at: number) =>
    escapedAt(text, at) ? token : `:${name}:`,
  );
}

/** First URL in a text (link previews / "open link" actions). */
export function firstUrl(text: string | null | undefined): string | null {
  if (!text) return null;
  for (const s of linkify(text)) if (s.t === 'link' && !s.href.startsWith('mailto:')) return s.href;
  return null;
}
