/**
 * The search query model (Discord's header search): filter tokens plus free text.
 *
 * The side panel carries a query as ONE canonical string, filters first and then the words:
 *
 *   from:<userId> has:link in:<channelId> before:2026-10-01 hello world
 *
 * People and channels are ids, so the string never depends on names (chips resolve labels
 * from the stores). `parseQuery` reads it back (anything that is not a valid filter is a
 * word), `toApiQuery` turns it into `MessageSearchQuery`. Dates are calendar days in the
 * viewer's time zone (Discord): `before:D` is before D's first moment, `after:D` from the day
 * after D, `during:D` that day; several date filters intersect.
 */
import type { MessageSearchQuery, SearchHas } from '@enbox/shared';

export const FILTER_KEYS = ['from', 'mentions', 'has', 'before', 'during', 'after', 'in', 'pinned'] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];

/** `has:` values offered (Discord's list). An embed comes from a link: it searches links. */
export const HAS_VALUES = ['link', 'embed', 'file', 'video', 'image', 'sound', 'poll'] as const;
export type HasValue = (typeof HAS_VALUES)[number];

export const DATE_KEYS: readonly FilterKey[] = ['before', 'during', 'after'];

export interface SearchToken {
  key: FilterKey;
  /** from / mentions: a user id; in: a channel id; has: a HasValue; dates: YYYY-MM-DD; pinned: true | false. */
  value: string;
}

export interface ParsedQuery {
  tokens: SearchToken[];
  /** The words (whitespace collapsed). */
  text: string;
}

export const EMPTY_QUERY: ParsedQuery = { tokens: [], text: '' };

/** The server's limit on `q`. */
export const MAX_QUERY_TEXT = 200;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isFilterKey(key: string): key is FilterKey {
  return (FILTER_KEYS as readonly string[]).includes(key);
}

/** Local midnight of a `YYYY-MM-DD` day, or null when it is not a real date. */
export function parseDay(value: string): Date | null {
  const m = DAY_RE.exec(value);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  const date = new Date(y, mo, d);
  return date.getFullYear() === y && date.getMonth() === mo && date.getDate() === d ? date : null;
}

/** `YYYY-MM-DD` of a local date. */
export function formatDay(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

function nextDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
}

/** Whether `value` is valid for `key` (values are compared lower-case except dates). */
export function isValidValue(key: FilterKey, value: string): boolean {
  switch (key) {
    case 'from':
    case 'mentions':
    case 'in':
      return UUID_RE.test(value);
    case 'has':
      return (HAS_VALUES as readonly string[]).includes(value);
    case 'pinned':
      return value === 'true' || value === 'false';
    default:
      return parseDay(value) !== null;
  }
}

/**
 * Add a filter: `has` may repeat (once per value); every other key holds one value, so a new
 * one replaces the old (Discord keeps the last `from:` you picked).
 */
export function addToken(tokens: readonly SearchToken[], token: SearchToken): SearchToken[] {
  if (token.key === 'has') {
    if (tokens.some((t) => t.key === 'has' && t.value === token.value)) return [...tokens];
    return [...tokens, token];
  }
  return [...tokens.filter((t) => t.key !== token.key), token];
}

export function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

/** The canonical string of a query (the side panel's `query`). */
export function serializeQuery(q: ParsedQuery): string {
  return [...q.tokens.map((t) => `${t.key}:${t.value}`), normalizeText(q.text)]
    .filter(Boolean)
    .join(' ');
}

/** Read a canonical (or hand-typed) query string back: valid filters become tokens. */
export function parseQuery(s: string): ParsedQuery {
  let tokens: SearchToken[] = [];
  const words: string[] = [];
  for (const part of s.split(/\s+/)) {
    if (!part) continue;
    const m = /^([a-z]+):(\S+)$/i.exec(part);
    const key = m?.[1]!.toLowerCase() ?? '';
    if (m && isFilterKey(key)) {
      const value = DATE_KEYS.includes(key) ? m[2]! : m[2]!.toLowerCase();
      if (isValidValue(key, value)) {
        tokens = addToken(tokens, { key, value });
        continue;
      }
    }
    words.push(part);
  }
  return { tokens, text: words.join(' ') };
}

export function isEmptyQuery(q: ParsedQuery): boolean {
  return q.tokens.length === 0 && !normalizeText(q.text);
}

/** The words to highlight in results: unique case-insensitively, longest first. */
export function searchWords(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of text.split(/\s+/)) {
    const key = w.toLowerCase();
    if (!w || seen.has(key)) continue;
    seen.add(key);
    out.push(w);
  }
  return out.sort((a, b) => b.length - a.length);
}

/**
 * The API query of a parsed query (without `sort` / `offset`). `in:` only means something in a
 * Space; `embed` searches links.
 */
export function toApiQuery(q: ParsedQuery, scopeKind: 'space' | 'chat'): MessageSearchQuery {
  const out: MessageSearchQuery = {};
  const text = normalizeText(q.text).slice(0, MAX_QUERY_TEXT).trim();
  if (text) out.q = text;
  const has = new Set<SearchHas>();
  let after: Date | null = null;
  let before: Date | null = null;
  const later = (a: Date | null, b: Date) => (a && a > b ? a : b);
  const earlier = (a: Date | null, b: Date) => (a && a < b ? a : b);
  for (const t of q.tokens) {
    switch (t.key) {
      case 'from':
        out.authorId = t.value;
        break;
      case 'mentions':
        out.mentions = t.value;
        break;
      case 'in':
        if (scopeKind === 'space') out.channelId = t.value;
        break;
      case 'has':
        has.add(t.value === 'embed' ? 'link' : (t.value as SearchHas));
        break;
      case 'pinned':
        out.pinned = t.value as 'true' | 'false';
        break;
      default: {
        const day = parseDay(t.value);
        if (!day) break;
        if (t.key === 'before') before = earlier(before, day);
        else if (t.key === 'after') after = later(after, nextDay(day));
        else {
          after = later(after, day);
          before = earlier(before, nextDay(day));
        }
      }
    }
  }
  if (has.size) out.has = [...has];
  if (after) out.after = (after as Date).toISOString();
  if (before) out.before = (before as Date).toISOString();
  return out;
}

/** The filter being typed at the caret: `from:al` → key 'from', partial 'al'. */
export interface ActiveWord {
  /** The filter key typed before a colon, or null while typing a plain word. */
  key: FilterKey | null;
  /** The value typed after the colon (key set), or the whole word. */
  partial: string;
  /** The word's range in the text. */
  start: number;
  end: number;
}

export function activeWord(text: string, caret: number): ActiveWord {
  const at = Math.max(0, Math.min(caret, text.length));
  let start = at;
  while (start > 0 && !/\s/.test(text[start - 1]!)) start--;
  let end = at;
  while (end < text.length && !/\s/.test(text[end]!)) end++;
  const word = text.slice(start, end);
  const m = /^([a-z]+):(.*)$/i.exec(word);
  const key = m?.[1]!.toLowerCase() ?? '';
  if (m && isFilterKey(key)) return { key, partial: m[2]!, start, end };
  return { key: null, partial: word, start, end };
}

/**
 * Replace the active word with `insert` (a picked filter key such as `from:`), or remove it
 * (`insert` empty: its value became a chip). Returns the new text and caret.
 */
export function replaceWord(text: string, word: ActiveWord, insert: string): { text: string; caret: number } {
  const before = text.slice(0, word.start);
  const after = text.slice(word.end).replace(/^\s+/, '');
  if (!insert) return { text: before + after, caret: before.length };
  return { text: before + insert + (after ? ` ${after}` : ''), caret: before.length + insert.length };
}
