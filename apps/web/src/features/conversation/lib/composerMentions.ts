/**
 * Composer mentions. The textarea keeps plain "@Name" text; picking a suggestion records a
 * `MentionRef` and `encodeMentions` maps those names back to `@{uuid}` tokens on send. A
 * reference whose "@Name" was edited no longer matches and is sent as plain text (never a
 * wrong mention). Drafts and edits store the tokenized text and restore it with
 * `decodeMentions`. Pure (unit-tested).
 */
import { mentionToken, parseMentions, type ID } from '@enbox/shared';

export interface MentionRef {
  userId: ID;
  name: string;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Replace "@Name" occurrences of recorded mentions with tokens (longest names first). */
export function encodeMentions(text: string, refs: MentionRef[]): string {
  if (!refs.length || !text.includes('@')) return text;
  const unique = new Map<string, MentionRef>();
  for (const r of refs) if (r.name && !unique.has(r.name)) unique.set(r.name, r);
  const sorted = [...unique.values()].sort((a, b) => b.name.length - a.name.length);
  const re = new RegExp(
    `(^|[^\\p{L}\\p{N}_@])@(${sorted.map((r) => escapeRe(r.name)).join('|')})(?![\\p{L}\\p{N}_])`,
    'gu',
  );
  return text.replace(re, (_, pre: string, name: string) => {
    const ref = unique.get(name);
    return ref ? `${pre}${mentionToken(ref.userId)}` : `${pre}@${name}`;
  });
}

/** Tokens → "@Name" text plus the refs needed to re-encode it. */
export function decodeMentions(
  text: string,
  nameOf: (id: ID) => string,
): { text: string; refs: MentionRef[] } {
  const refs: MentionRef[] = [];
  let out = '';
  for (const seg of parseMentions(text)) {
    if (seg.type === 'text') {
      out += seg.text;
      continue;
    }
    const name = nameOf(seg.userId);
    out += `@${name}`;
    if (!refs.some((r) => r.userId === seg.userId)) refs.push({ userId: seg.userId, name });
  }
  return { text: out, refs };
}

/** Refs still present in the text (drop ones whose "@Name" was deleted). */
export function pruneRefs(text: string, refs: MentionRef[]): MentionRef[] {
  return refs.filter((r) => text.includes(`@${r.name}`));
}

export interface MentionQuery {
  /** Index of the '@'. */
  start: number;
  /** Text typed after '@' (may be empty). */
  query: string;
}

/**
 * The mention being typed at the caret: an '@' at the start or after whitespace/punctuation,
 * followed by up to 40 chars without line breaks (one inner space allowed for "@First La").
 */
export function activeMentionQuery(text: string, caret: number): MentionQuery | null {
  const before = text.slice(0, caret);
  const m = /(^|[\s(["'])@([^\s@]{0,30}(?: [^\s@]{0,20})?)$/u.exec(before);
  if (!m) return null;
  const query = m[2]!;
  const start = before.length - query.length - 1;
  return { start, query };
}

/** Insert "@Name " for a picked suggestion, replacing the typed query. */
export function insertMention(
  text: string,
  q: MentionQuery,
  caret: number,
  name: string,
): { text: string; caret: number } {
  const insert = `@${name} `;
  const next = text.slice(0, q.start) + insert + text.slice(caret).replace(/^ /, '');
  return { text: next, caret: q.start + insert.length };
}

/** Case/diacritic-insensitive match of a mention query against a name. */
export function matchesMentionQuery(name: string, query: string): boolean {
  if (!query) return true;
  const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const n = norm(name);
  const q = norm(query);
  return n.startsWith(q) || n.split(/\s+/).some((w) => w.startsWith(q));
}
