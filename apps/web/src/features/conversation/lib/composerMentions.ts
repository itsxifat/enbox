/**
 * Composer mentions. The textarea keeps plain "@Name" text; picking a suggestion records a
 * `MentionRef` and `encodeMentions` maps those names back to `@{uuid}` tokens on send. A
 * reference whose "@Name" was edited no longer matches and is sent as plain text (never a
 * wrong mention). Drafts and edits store the tokenized text and restore it with
 * `decodeMentions`. Pure (unit-tested).
 *
 * Custom Space emoji ride the same refs: a picked one shows as ":name:" (`pickEmoji`) with a
 * ref whose `userId` is its token (`<:name:id>`), and encodes back to the token on send.
 */
import { CUSTOM_EMOJI_TOKEN_RE, mentionToken, parseCustomEmoji, parseRichMentions, type ID } from '@enbox/shared';

export interface MentionRef {
  /** A user id, `everyone` / `here` / `role:<uuid>`, or a custom emoji token. */
  userId: ID;
  name: string;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const isEmojiRef = (r: MentionRef) => r.userId.startsWith('<');
/** A raw token (left alone) or a ":name:" shortcode (group 1). */
const EMOJI_TEXT = /<a?:[A-Za-z0-9_]{2,32}:[0-9a-f-]{36}>|:([A-Za-z0-9_]{2,32}):/g;

/** Picked custom emoji ":name:" → their tokens. */
function encodeEmoji(text: string, refs: MentionRef[]): string {
  const byName = new Map(refs.filter(isEmojiRef).map((r) => [r.name, r.userId]));
  if (!byName.size || !text.includes(':')) return text;
  return text.replace(new RegExp(EMOJI_TEXT.source, 'g'), (m: string, name?: string) => (name && byName.get(name)) || m);
}

/**
 * What a picked emoji inserts: a unicode emoji as is, a custom emoji token as ":name:" with
 * the ref that encodes it back (the newest pick of a name wins).
 */
export function pickEmoji(emoji: string, refs: MentionRef[]): { insert: string; refs: MentionRef[] } {
  const custom = parseCustomEmoji(emoji);
  if (!custom) return { insert: emoji, refs };
  return {
    insert: `:${custom.name}:`,
    refs: [...refs.filter((r) => !(isEmojiRef(r) && r.name === custom.name)), { userId: emoji, name: custom.name }],
  };
}

/** Replace "@Name" occurrences of recorded mentions with tokens (longest names first). */
export function encodeMentions(text: string, input: MentionRef[]): string {
  text = encodeEmoji(text, input);
  const refs = input.filter((r) => !isEmojiRef(r));
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

/**
 * Tokens → "@Name" text plus the refs needed to re-encode it. Space tokens decode to
 * refs whose `userId` is `everyone`, `here` or `role:<uuid>` (`mentionToken` re-encodes them).
 */
export function decodeMentions(
  text: string,
  nameOf: (id: ID) => string,
  roleName: (id: ID) => string = () => 'role',
): { text: string; refs: MentionRef[] } {
  const refs: MentionRef[] = [];
  let out = '';
  for (const seg of parseRichMentions(text)) {
    if (seg.type === 'text') {
      out += seg.text.replace(new RegExp(CUSTOM_EMOJI_TOKEN_RE.source, 'g'), (token: string, _a: string, name: string) => {
        if (!refs.some((r) => r.userId === token)) refs.push({ userId: token, name });
        return `:${name}:`;
      });
      continue;
    }
    const [key, name] =
      seg.type === 'mention'
        ? [seg.userId, nameOf(seg.userId)]
        : seg.type === 'role'
          ? [`role:${seg.roleId}`, roleName(seg.roleId)]
          : seg.here
            ? ['here', 'here']
            : ['everyone', 'everyone'];
    out += `@${name}`;
    if (!refs.some((r) => r.userId === key)) refs.push({ userId: key, name });
  }
  return { text: out, refs };
}

/** Refs still present in the text (drop ones whose "@Name" or ":name:" was deleted). */
export function pruneRefs(text: string, refs: MentionRef[]): MentionRef[] {
  return refs.filter((r) => text.includes(isEmojiRef(r) ? `:${r.name}:` : `@${r.name}`));
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
