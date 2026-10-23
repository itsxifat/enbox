/**
 * Markdown formatting of the message box (pure, unit-tested): wrap the selection in a marker
 * (**bold**, *italic*, __underline__, ~~strike~~, ||spoiler||, `code`) or unwrap it when it
 * already wears it, quote its lines, make it a masked link. Each returns one `TextEdit` (a
 * range to replace and the selection after it) so the field applies it as a single insert.
 */

export interface TextEdit {
  /** Replace `value.slice(start, end)` with `insert`… */
  start: number;
  end: number;
  insert: string;
  /** …then select this range of the new value. */
  selStart: number;
  selEnd: number;
}

export type InlineFormat = 'bold' | 'italic' | 'underline' | 'strike' | 'spoiler' | 'code';

export const MARKERS: Record<InlineFormat, string> = {
  bold: '**',
  italic: '*',
  underline: '__',
  strike: '~~',
  spoiler: '||',
  code: '`',
};

/** How many `ch` end at `i` (no further back than `floor`). */
function runBefore(s: string, i: number, ch: string, floor = 0): number {
  let n = 0;
  while (i - n - 1 >= floor && s[i - n - 1] === ch) n++;
  return n;
}

/** How many `ch` start at `i` (no further than `ceil`). */
function runAfter(s: string, i: number, ch: string, ceil = s.length): number {
  let n = 0;
  while (i + n < ceil && s[i + n] === ch) n++;
  return n;
}

/**
 * Whether `n` marker characters on each side wear the format. `*` serves italic (odd runs:
 * `*x*`, `***x***`) and bold (two or more: `**x**`, `***x***`).
 */
function wears(format: InlineFormat, n: number): boolean {
  if (n <= 0) return false;
  return format === 'italic' ? n % 2 === 1 : n >= MARKERS[format].length;
}

/** The selection without the whitespace at its edges (markers around spaces don't render). */
function trimmed(value: string, start: number, end: number): [number, number] {
  let s = start;
  let e = end;
  while (s < e && /\s/.test(value[s]!)) s++;
  while (e > s && /\s/.test(value[e - 1]!)) e--;
  return s < e ? [s, e] : [start, end];
}

/** Whether the selection wears the format: its markers just inside or just outside it. */
export function isWrapped(
  value: string,
  start: number,
  end: number,
  format: InlineFormat,
): boolean {
  if (start === end) return false;
  const [s, e] = trimmed(value, start, end);
  const ch = MARKERS[format][0]!;
  const lead = runAfter(value, s, ch, e);
  const trail = runBefore(value, e, ch, s);
  if (lead + trail < e - s && wears(format, Math.min(lead, trail))) return true;
  return wears(format, Math.min(runBefore(value, s, ch), runAfter(value, e, ch)));
}

/**
 * Wrap or unwrap the selection (Ctrl/Cmd+B, I, U, Shift+X and the toolbar). A selection that
 * wears the format — its markers selected too, or just around it — loses them; otherwise they
 * go around it (whitespace at the edges stays outside). A caret gets an empty pair around it,
 * or loses the empty pair it sits in.
 */
export function toggleInline(
  value: string,
  start: number,
  end: number,
  format: InlineFormat,
): TextEdit {
  const marker = MARKERS[format];
  const ch = marker[0]!;
  const len = marker.length;
  if (start === end) {
    const n = Math.min(runBefore(value, start, ch), runAfter(value, start, ch));
    if (wears(format, n))
      return {
        start: start - len,
        end: start + len,
        insert: '',
        selStart: start - len,
        selEnd: start - len,
      };
    return { start, end, insert: marker + marker, selStart: start + len, selEnd: start + len };
  }
  const [s, e] = trimmed(value, start, end);
  const lead = runAfter(value, s, ch, e);
  const trail = runBefore(value, e, ch, s);
  if (lead + trail < e - s && wears(format, Math.min(lead, trail))) {
    const inner = value.slice(s + len, e - len);
    return { start: s, end: e, insert: inner, selStart: s, selEnd: s + inner.length };
  }
  if (wears(format, Math.min(runBefore(value, s, ch), runAfter(value, e, ch)))) {
    const inner = value.slice(s, e);
    return { start: s - len, end: e + len, insert: inner, selStart: s - len, selEnd: e - len };
  }
  return {
    start: s,
    end: e,
    insert: marker + value.slice(s, e) + marker,
    selStart: s + len,
    selEnd: e + len,
  };
}

/** The whole lines the selection touches (one ending right after a line break leaves the next). */
function linesOf(
  value: string,
  start: number,
  end: number,
): { from: number; to: number; lines: string[] } {
  const from = value.lastIndexOf('\n', start - 1) + 1;
  const nl = value.indexOf('\n', end > start && value[end - 1] === '\n' ? end - 1 : end);
  const to = nl === -1 ? value.length : nl;
  return { from, to, lines: value.slice(from, to).split('\n') };
}

const quotedLine = (l: string) => l.startsWith('> ') || l === '>';

/** Whether every line the selection touches is quoted. */
export function isQuoted(value: string, start: number, end: number): boolean {
  return linesOf(value, start, end).lines.every(quotedLine);
}

/** `> ` before every line the selection touches; taken away again when they all have it. */
export function toggleQuote(value: string, start: number, end: number): TextEdit {
  const { from, to, lines } = linesOf(value, start, end);
  const quoted = lines.every(quotedLine);
  const insert = lines.map((l) => (quoted ? l.replace(/^> ?/, '') : `> ${l}`)).join('\n');
  return { start: from, end: to, insert, selStart: from, selEnd: from + insert.length };
}

/** Masked links show one line of text without `]` (lib/richText.ts). */
export function canLink(value: string, start: number, end: number): boolean {
  return start < end && !/[\]\n]/.test(value.slice(start, end));
}

/**
 * The address a masked link may point to: http(s) only (a bare `example.com` gets
 * `https://`), parentheses encoded so the link syntax holds; null when it is no web address.
 */
export function normalizeLinkUrl(raw: string): string | null {
  const t = raw.trim();
  if (!t || /\s/.test(t)) return null;
  const bare = !/^[a-z][a-z\d+.-]*:\/\//i.test(t);
  let u: URL;
  try {
    u = new URL(bare ? `https://${t}` : t);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  // A bare word ("hello") is no address; typed with its scheme, localhost is.
  if (bare && !u.hostname.includes('.')) return null;
  return u.href.replace(/\(/g, '%28').replace(/\)/g, '%29');
}

/** `[selection](url)`, the caret after it. */
export function makeLink(value: string, start: number, end: number, url: string): TextEdit {
  const insert = `[${value.slice(start, end) || url}](${url})`;
  const caret = start + insert.length;
  return { start, end, insert, selStart: caret, selEnd: caret };
}
