/**
 * AutoMod (docs/design/discord-parity.md, community wave): the rules of a Space, checked on
 * every send and edit in its channels and threads (`enforceAutoMod`), Discord's four kinds:
 *
 * - `keyword`: words and phrases, case-insensitive, whole words by default; `*` at the start,
 *   the end or both matches any word ending, beginning or part (`*cat`, `cat*`, `*cat*`);
 *   plus up to 10 regular expressions (see "Regular expressions").
 * - `preset`: the built-in lists of services/automodPresets.ts, matched like keywords.
 * - `mention_spam`: more than `mentionLimit` unique user + role mentions, @everyone and @here
 *   counting one each, as the message would store them: users who are members of the Space,
 *   roles and @everyone only where the sender may ping them (services/spaceRules.ts).
 * - `spam_links` (a heuristic, there is no classifier): a link from a member who joined less
 *   than NEW_MEMBER_LINK_MS ago, or the same link (scheme and `www.` ignored) more than
 *   LINK_REPEAT_LIMIT times from one member within LINK_WINDOW_MS. The counters are in memory,
 *   per process (no cluster-wide counter helper exists; nginx keeps a client on one process,
 *   like the per-user rate limits), and count sends only.
 *
 * Text is matched as `normalizeText` makes it: mention tokens dropped (@everyone / @here read
 * as typed), custom emoji as `:name:`, NFKC-folded (fullwidth letters, ligatures), lowercase,
 * whitespace runs as one space. The allow list of a keyword or preset rule wins: a hit that
 * lies inside an allowed word or phrase does not count (`*` works there too).
 *
 * Exempt (Discord): the owner and members with MANAGE_SPACE or ADMINISTRATOR, members with
 * one of the rule's exempt roles, and the rule's exempt channels (a thread through its
 * parent). Disabled rules are skipped.
 *
 * Actions combine over every rule that fired: `block` refuses the send or edit (403
 * AUTOMOD_BLOCKED_CODE with the first blocking rule's custom message); `alert` posts an
 * `automod_alert` system message in the rule's alert channel (`action: 'blocked'` when the
 * message was blocked, else `'flagged'`: it went through); `timeout` times the member out for
 * the longest duration, with the writes and events of `PATCH /spaces/:id/members/:userId`.
 * Audit entries (actor null = AutoMod): `automod.block` or `automod.flag` per rule, and
 * `automod.timeout`. Those writes run in a transaction of their own AFTER the send's — after
 * its commit when the message went through, after its rollback when it was blocked — because
 * the send holds its channel's lock while the lock order is Space row → channels → the rest.
 * `autoModIdle()` waits for them (tests).
 *
 * Regular expressions: Node has no timeout for RegExp, so they are vetted when saved
 * (`regexProblem` → 400): they must compile with the `u` and `i` flags and may not use
 * backreferences, lookarounds, or repeat a group that itself repeats or alternates
 * (`(a+)+`, `(a|ab)*`, `(\w+\s?){5}`). When matching they see the first REGEX_SCAN_CHARS
 * characters only (keyword lists see everything) and run inside a `vm` script with a budget
 * of REGEX_TIMEOUT_MS per message: V8 interrupts a runaway match, which then counts as no
 * match and is logged.
 *
 * Cache: the compiled rules of a Space, per process, validated against `spaces.perm_version`
 * (`access.space.ctx.permVersion`). Every rule change bumps the version in its transaction and
 * every access check reads it anyway, so a change applies at once on every process, without
 * a bus message and without a query per send; `forgetAutoModRules` busts the local entry too.
 */
import vm from 'node:vm';
import { and, asc, eq } from 'drizzle-orm';
import {
  AUTOMOD_BLOCKED_CODE,
  PERM,
  extractMentionIds,
  extractSpaceMentions,
  hasPerm,
  isSpaceAdmin,
  type ApiErrorCode,
  type AutoModPreset,
  type AutoModRule,
  type AutoModTriggerMetadata,
  type SystemEvent,
} from '@enbox/shared';
import type { DbOrTx, Tx } from '../db/index.js';
import { automodRules, chats, spaceMembers, spaces, type SpaceRow } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { AUTOMOD_PRESET_WORDS } from './automodPresets.js';
import type { ChatAccess } from './chats.js';
import { transact, type Effects } from './effects.js';
import { createMessage, deriveMentions } from './messages.js';
import {
  baseBits,
  bumpPermVersion,
  loadSpaceMember,
  loadSpacePermCtx,
  lockSpace,
} from './spaceAccess.js';
import { allowedSpaceMentions } from './spaceRules.js';
import {
  audit,
  fxChannelsChanged,
  fxMemberChanged,
  fxMemberEvent,
  fxSpaceUpsert,
  toSpaceMembers,
} from './spaces.js';

export type AutoModRuleRow = typeof automodRules.$inferSelect;

export const DEFAULT_BLOCK_MESSAGE = "Your message was blocked by this Space's rules";
/** `mention_spam` without a limit (Discord's default). */
export const DEFAULT_MENTION_LIMIT = 20;
/** `spam_links`: links from members who joined less than this ago are suspicious. */
export const NEW_MEMBER_LINK_MS = 10 * 60_000;
/** `spam_links`: the same link more often than this within LINK_WINDOW_MS. */
export const LINK_REPEAT_LIMIT = 3;
export const LINK_WINDOW_MS = 5 * 60_000;
/** Regular expressions see this much of a message. */
export const REGEX_SCAN_CHARS = 4096;
/** Budget of all the patterns of one rule on one message. */
export const REGEX_TIMEOUT_MS = 25;
/** The copy of a message in an alert. */
export const ALERT_CONTENT_MAX = 4000;

/** The wire shape of a rule. */
export function toAutoModRule(row: AutoModRuleRow): AutoModRule {
  return {
    id: row.id,
    spaceId: row.spaceId,
    name: row.name,
    triggerType: row.triggerType,
    triggerMetadata: row.triggerMetadata ?? {},
    actions: row.actions ?? [],
    enabled: row.enabled,
    exemptRoleIds: row.exemptRoleIds,
    exemptChannelIds: row.exemptChannelIds,
    creatorId: row.creatorId,
    createdAt: row.createdAt.toISOString(),
  };
}

/** A Space's rules in creation order. */
export async function loadAutoModRules(dbx: DbOrTx, spaceId: string): Promise<AutoModRuleRow[]> {
  return dbx
    .select()
    .from(automodRules)
    .where(eq(automodRules.spaceId, spaceId))
    .orderBy(asc(automodRules.createdAt), asc(automodRules.id));
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const MENTION_TOKEN = new RegExp(`@\\{(?:(everyone|here)|(?:role:)?${UUID})\\}`, 'g');
const EMOJI_TOKEN = new RegExp(`<a?:([A-Za-z0-9_]{2,32}):${UUID}>`, 'g');
const WORD_CHAR = /^[\p{L}\p{N}\p{M}]$/u;
const WORDS = /[\p{L}\p{N}\p{M}]+/gu;
const ONE_WORD = /^[\p{L}\p{N}\p{M}]+$/u;

/** What rules see of a text (see the header). */
export function normalizeText(text: string): string {
  return text
    .replace(MENTION_TOKEN, (_m, special: string | undefined) => (special ? ` @${special} ` : ' '))
    .replace(EMOJI_TOKEN, ' :$1: ')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/gu, ' ');
}

interface Span {
  s: number;
  e: number;
}
interface Word extends Span {
  w: string;
}

function wordsOf(norm: string): Word[] {
  const out: Word[] = [];
  for (const m of norm.matchAll(WORDS)) out.push({ w: m[0], s: m.index, e: m.index + m[0].length });
  return out;
}

/** Start of the word character that ends at `i`, or -1 (surrogate pairs are one character). */
function wordCharBefore(s: string, i: number): number {
  if (i <= 0) return -1;
  let j = i - 1;
  const c = s.charCodeAt(j);
  if (c >= 0xdc00 && c <= 0xdfff && j > 0) {
    const h = s.charCodeAt(j - 1);
    if (h >= 0xd800 && h <= 0xdbff) j--;
  }
  return WORD_CHAR.test(s.slice(j, i)) ? j : -1;
}

/** End of the word character that starts at `i`, or -1. */
function wordCharAt(s: string, i: number): number {
  if (i >= s.length) return -1;
  const end = i + (s.codePointAt(i)! > 0xffff ? 2 : 1);
  return WORD_CHAR.test(s.slice(i, end)) ? end : -1;
}

function wordStart(s: string, i: number): number {
  for (let j = wordCharBefore(s, i); j >= 0; j = wordCharBefore(s, i)) i = j;
  return i;
}

function wordEnd(s: string, i: number): number {
  for (let j = wordCharAt(s, i); j >= 0; j = wordCharAt(s, i)) i = j;
  return i;
}

// ---------------------------------------------------------------------------
// Keyword lists
// ---------------------------------------------------------------------------

interface Phrase {
  text: string;
  /** `*` before / after. */
  left: boolean;
  right: boolean;
  /** Its first / last character is a word character (only then does a boundary apply). */
  edgeLeft: boolean;
  edgeRight: boolean;
}

/** A compiled keyword list: single words in sets, everything else found with indexOf. */
export interface KeywordList {
  exact: Set<string>;
  /** `word*`, by length. */
  prefix: Map<number, Set<string>>;
  /** `*word`, by length. */
  suffix: Map<number, Set<string>>;
  /** `*word*`. */
  infix: string[];
  /** Phrases, symbols, emoji (anything that is not one word). */
  phrases: Phrase[];
  empty: boolean;
}

function addByLength(map: Map<number, Set<string>>, s: string): void {
  let set = map.get(s.length);
  if (!set) map.set(s.length, (set = new Set()));
  set.add(s);
}

export function compileKeywords(list: readonly string[] | undefined | null): KeywordList {
  const out: KeywordList = {
    exact: new Set(),
    prefix: new Map(),
    suffix: new Map(),
    infix: [],
    phrases: [],
    empty: true,
  };
  const infix = new Set<string>();
  const phrases = new Map<string, Phrase>();
  for (const raw of list ?? []) {
    let text = normalizeText(raw).trim();
    const left = text.startsWith('*');
    const right = text.endsWith('*');
    text = text.replace(/^\*+|\*+$/g, '').trim();
    if (!text) continue;
    out.empty = false;
    if (!ONE_WORD.test(text)) {
      phrases.set(`${left ? '*' : ''}${text}${right ? '*' : ''}`, {
        text,
        left,
        right,
        edgeLeft: wordCharAt(text, 0) >= 0,
        edgeRight: wordCharBefore(text, text.length) >= 0,
      });
    } else if (left && right) infix.add(text);
    else if (left) addByLength(out.suffix, text);
    else if (right) addByLength(out.prefix, text);
    else out.exact.add(text);
  }
  out.infix = [...infix];
  out.phrases = [...phrases.values()];
  return out;
}

/**
 * Visit every hit of `list` in `norm` until `visit` returns true. A hit's span covers the
 * whole word on a wildcard side (`cat*` in "catapult" → "catapult").
 */
function scan(
  list: KeywordList,
  norm: string,
  words: readonly Word[],
  visit: (span: Span) => boolean,
): boolean {
  if (list.exact.size || list.prefix.size || list.suffix.size) {
    for (const word of words) {
      const w = word.w;
      if (list.exact.has(w) && visit(word)) return true;
      for (const [len, set] of list.prefix)
        if (w.length >= len && set.has(w.slice(0, len)) && visit(word)) return true;
      for (const [len, set] of list.suffix)
        if (w.length >= len && set.has(w.slice(w.length - len)) && visit(word)) return true;
    }
  }
  for (const t of list.infix) {
    for (let i = norm.indexOf(t); i >= 0; ) {
      const span = { s: wordStart(norm, i), e: wordEnd(norm, i + t.length) };
      if (visit(span)) return true;
      // Every other occurrence inside this word has the same span.
      i = norm.indexOf(t, Math.max(i + 1, span.e));
    }
  }
  for (const p of list.phrases) {
    for (let i = norm.indexOf(p.text); i >= 0; i = norm.indexOf(p.text, i + 1)) {
      const end = i + p.text.length;
      if (!p.left && p.edgeLeft && wordCharBefore(norm, i) >= 0) continue;
      if (!p.right && p.edgeRight && wordCharAt(norm, end) >= 0) continue;
      const span = { s: p.left ? wordStart(norm, i) : i, e: p.right ? wordEnd(norm, end) : end };
      if (visit(span)) return true;
    }
  }
  return false;
}

/** The allowed spans of a text: `covers(span)` = some allowed span contains it. */
class Cover {
  private readonly starts: number[];
  private readonly maxEnd: number[];

  constructor(spans: Span[]) {
    spans.sort((a, b) => a.s - b.s);
    this.starts = spans.map((x) => x.s);
    let max = -1;
    this.maxEnd = spans.map((x) => (max = Math.max(max, x.e)));
  }

  covers(span: Span): boolean {
    let lo = 0;
    let hi = this.starts.length - 1;
    let k = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.starts[mid]! <= span.s) {
        k = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return k >= 0 && this.maxEnd[k]! >= span.e;
  }
}

function coverOf(allow: KeywordList | null, norm: string, words: readonly Word[]): Cover | null {
  if (!allow || allow.empty) return null;
  const spans: Span[] = [];
  scan(allow, norm, words, (span) => {
    spans.push(span);
    return false;
  });
  return spans.length ? new Cover(spans) : null;
}

/** The first hit of `list` outside the allowed spans, as matched (normalized), or null. */
function firstHit(list: KeywordList, cover: Cover | null, norm: string, words: readonly Word[]): string | null {
  let hit: string | null = null;
  scan(list, norm, words, (span) => {
    if (cover?.covers(span)) return false;
    hit = norm.slice(span.s, span.e);
    return true;
  });
  return hit;
}

/** Pure keyword matching with an allow list (tests and the editor's preview). */
export function matchKeywords(
  keywords: readonly string[],
  allowList: readonly string[],
  text: string,
): string | null {
  const norm = normalizeText(text);
  const words = wordsOf(norm);
  return firstHit(compileKeywords(keywords), coverOf(compileKeywords(allowList), norm, words), norm, words);
}

const presetCache = new Map<string, KeywordList>();

function presetList(presets: readonly AutoModPreset[] | undefined): KeywordList | null {
  const key = [...new Set(presets ?? [])].sort().join(',');
  if (!key) return null;
  let list = presetCache.get(key);
  if (!list) {
    list = compileKeywords(key.split(',').flatMap((p) => AUTOMOD_PRESET_WORDS[p as AutoModPreset] ?? []));
    presetCache.set(key, list);
  }
  return list;
}

// ---------------------------------------------------------------------------
// Regular expressions
// ---------------------------------------------------------------------------

/**
 * Why a pattern may not be used (null = fine): it must compile with the `u` and `i` flags;
 * no backreferences (`\1`, `\k<name>`), no lookarounds, and no repeated group (`*`, `+`,
 * `{n,}`, `{n,m}` with m > 1) that contains a quantifier (`?` too) or an alternation — the
 * shapes that backtrack exponentially. Character classes and escapes are skipped, not
 * interpreted.
 */
export function regexProblem(pattern: string): string | null {
  try {
    new RegExp(pattern, 'iu');
  } catch {
    return 'is not a valid regular expression';
  }
  interface Group {
    quantified: boolean;
    alternates: boolean;
  }
  const stack: Group[] = [{ quantified: false, alternates: false }];
  /** The group that just closed (a quantifier right after it applies to it). */
  let closed: Group | null = null;
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i]!;
    if (c === '\\') {
      const n = pattern[i + 1] ?? '';
      if (/[1-9]/.test(n) || (n === 'k' && pattern[i + 2] === '<')) return 'uses a backreference';
      if (n && 'pPu'.includes(n) && pattern[i + 2] === '{') {
        const close = pattern.indexOf('}', i + 3);
        i = close < 0 ? pattern.length : close + 1;
      } else i += 2;
      closed = null;
      continue;
    }
    if (c === '[') {
      i++;
      while (i < pattern.length && pattern[i] !== ']') i += pattern[i] === '\\' ? 2 : 1;
      i++;
      closed = null;
      continue;
    }
    if (c === '(') {
      if (/^\(\?<?[=!]/.test(pattern.slice(i, i + 4))) return 'uses a lookaround';
      stack.push({ quantified: false, alternates: false });
      if (pattern[i + 1] === '?') {
        if (pattern[i + 2] === '<') {
          const close = pattern.indexOf('>', i + 3);
          i = close < 0 ? pattern.length : close + 1;
        } else i += 3;
      } else i++;
      closed = null;
      continue;
    }
    if (c === ')') {
      const g = stack.length > 1 ? stack.pop()! : { quantified: false, alternates: false };
      const parent = stack[stack.length - 1]!;
      parent.quantified ||= g.quantified;
      parent.alternates ||= g.alternates;
      closed = g;
      i++;
      continue;
    }
    if (c === '|') {
      stack[stack.length - 1]!.alternates = true;
      closed = null;
      i++;
      continue;
    }
    if (c === '*' || c === '+' || c === '?' || c === '{') {
      let len = 1;
      let repeats = c !== '?';
      if (c === '{') {
        const m = /^\{(\d+)(,(\d*))?\}/.exec(pattern.slice(i));
        if (!m) {
          closed = null;
          i++;
          continue;
        }
        len = m[0].length;
        repeats = m[2] === undefined ? Number(m[1]) > 1 : m[3] === '' || Number(m[3]) > 1;
      }
      if (pattern[i + len] === '?') len++;
      if (repeats && closed && (closed.quantified || closed.alternates))
        return 'repeats a group that already repeats or alternates (nested quantifiers)';
      stack[stack.length - 1]!.quantified = true;
      closed = null;
      i += len;
      continue;
    }
    closed = null;
    i++;
  }
  return null;
}

/** Compiled patterns (`giu`); stored ones were vetted when saved, re-checked here anyway. */
function compileRegexes(patterns: readonly string[] | undefined): RegExp[] {
  const out: RegExp[] = [];
  for (const p of patterns ?? []) {
    if (regexProblem(p)) {
      logger.warn({ pattern: p }, 'automod: skipping an unsafe pattern');
      continue;
    }
    out.push(new RegExp(p, 'giu'));
  }
  return out;
}

const regexContext = vm.createContext({
  list: [] as RegExp[],
  text: '',
  covered: (_s: number, _e: number) => false,
});
const regexScript = new vm.Script(`(() => {
  for (const r of list) {
    r.lastIndex = 0;
    for (let n = 0, m; n < 1000 && (m = r.exec(text)) !== null; n++) {
      if (m[0].length === 0) { r.lastIndex++; continue; }
      if (!covered(m.index, m.index + m[0].length)) return m[0];
    }
  }
  return null;
})()`);

/** The first match of the patterns outside the allowed spans, or null (also on timeout). */
function regexHit(list: RegExp[], norm: string, cover: Cover | null): string | null {
  if (list.length === 0) return null;
  const text = norm.slice(0, REGEX_SCAN_CHARS);
  Object.assign(regexContext, {
    list,
    text,
    covered: (s: number, e: number) => !!cover?.covers({ s, e }),
  });
  try {
    return regexScript.runInContext(regexContext, { timeout: REGEX_TIMEOUT_MS }) as string | null;
  } catch (err) {
    logger.warn({ err, patterns: list.map((r) => r.source) }, 'automod: pattern timed out');
    return null;
  } finally {
    Object.assign(regexContext, { list: [], text: '' });
  }
}

// ---------------------------------------------------------------------------
// Links (spam_links)
// ---------------------------------------------------------------------------

const LINK = /(?:https?:\/\/|www\.)[^\s<>"'`]+/giu;
const LINK_KEYS_MAX = 50_000;
/** `${spaceId}\0${userId}\0${link}` → recent post times. */
const linkLog = new Map<string, number[]>();
let linkSweepAt = 0;

/** The links of a (normalized) text: scheme, `www.` and trailing punctuation dropped. */
export function linksOf(norm: string): string[] {
  const out: string[] = [];
  for (const m of norm.matchAll(LINK)) {
    const link = m[0]
      .replace(/[.,;:!?)\]}>'"]+$/u, '')
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/+$/, '');
    if (link) out.push(link);
  }
  return out;
}

function recentLinkPosts(key: string, now: number): number {
  const times = linkLog.get(key);
  if (!times) return 0;
  const fresh = times.filter((t) => now - t < LINK_WINDOW_MS);
  if (fresh.length) linkLog.set(key, fresh);
  else linkLog.delete(key);
  return fresh.length;
}

function recordLinkPosts(keys: string[], now: number): void {
  if (now - linkSweepAt > 60_000) {
    linkSweepAt = now;
    for (const [k, times] of linkLog) if (now - times[times.length - 1]! >= LINK_WINDOW_MS) linkLog.delete(k);
  }
  for (const k of keys) {
    const times = linkLog.get(k);
    if (times) times.push(now);
    else {
      if (linkLog.size >= LINK_KEYS_MAX) linkLog.delete(linkLog.keys().next().value!);
      linkLog.set(k, [now]);
    }
  }
}

/** Forget the link counters (tests). */
export function resetAutoModLinks(): void {
  linkLog.clear();
  linkSweepAt = 0;
}

// ---------------------------------------------------------------------------
// Compiled rules (cached per Space and perm_version)
// ---------------------------------------------------------------------------

interface CompiledRule {
  row: AutoModRuleRow;
  keywords: KeywordList | null;
  allow: KeywordList | null;
  regexes: RegExp[];
}

function compileRule(row: AutoModRuleRow): CompiledRule {
  const md: AutoModTriggerMetadata = row.triggerMetadata ?? {};
  if (row.triggerType === 'keyword')
    return {
      row,
      keywords: compileKeywords(md.keywords),
      allow: compileKeywords(md.allowList),
      regexes: compileRegexes(md.regexPatterns),
    };
  if (row.triggerType === 'preset')
    return { row, keywords: presetList(md.presets), allow: compileKeywords(md.allowList), regexes: [] };
  return { row, keywords: null, allow: null, regexes: [] };
}

const RULE_CACHE_MAX = 5_000;
const ruleCache = new Map<string, { version: number; rules: CompiledRule[] }>();

/** The enabled rules of a Space, compiled (one statement on a miss: version and rules together). */
async function enabledRules(dbx: DbOrTx, spaceId: string, version: number): Promise<CompiledRule[]> {
  const cached = ruleCache.get(spaceId);
  // Versions only grow: a newer entry (loaded by a later request) is valid too.
  if (cached && cached.version >= version) return cached.rules;
  const rows = await dbx
    .select({ version: spaces.permVersion, rule: automodRules })
    .from(spaces)
    .leftJoin(automodRules, and(eq(automodRules.spaceId, spaces.id), eq(automodRules.enabled, true)))
    .where(eq(spaces.id, spaceId))
    .orderBy(asc(automodRules.createdAt), asc(automodRules.id));
  if (rows.length === 0) return [];
  const entry = {
    version: rows[0]!.version,
    rules: rows.filter((r) => r.rule).map((r) => compileRule(r.rule!)),
  };
  if (ruleCache.size >= RULE_CACHE_MAX) ruleCache.delete(ruleCache.keys().next().value!);
  ruleCache.delete(spaceId);
  ruleCache.set(spaceId, entry);
  return entry.rules;
}

/** Drop the cached rules of a Space (or all: tests). */
export function forgetAutoModRules(spaceId?: string): void {
  if (spaceId) ruleCache.delete(spaceId);
  else ruleCache.clear();
}

// ---------------------------------------------------------------------------
// Enforcement
// ---------------------------------------------------------------------------

/** What a message carries for AutoMod: its text or caption, and a poll's texts. */
export interface AutoModInput {
  text?: string | null;
  metadata?: { poll?: { question: string; options: readonly { text: string }[] } } | null;
}

interface Hit {
  rule: AutoModRuleRow;
  /** The matched word, phrase, pattern match or link (normalized); null for mention spam. */
  matched: string | null;
}

/** One message's evaluation context (normalized text and mention count computed once). */
class Subject {
  private normCache: { norm: string; words: Word[] } | null = null;
  private quickMentions: number | null = null;
  private mentions: number | null = null;

  constructor(
    readonly access: ChatAccess,
    readonly userId: string,
    readonly content: string,
    readonly text: string | null,
  ) {}

  get prepared(): { norm: string; words: Word[] } {
    if (!this.normCache) {
      const norm = normalizeText(this.content);
      this.normCache = { norm, words: wordsOf(norm) };
    }
    return this.normCache;
  }

  /** Unique user + role mentions and @everyone / @here, as the message would store them. */
  async mentionCount(dbx: DbOrTx, limit: number): Promise<number> {
    if (this.mentions !== null) return this.mentions;
    const text = this.text;
    if (!text) return (this.mentions = 0);
    const raw = extractSpaceMentions(text);
    const allowed = allowedSpaceMentions(this.access, text);
    const others = (allowed.everyone ? Number(raw.everyone) + Number(raw.here) : 0) + allowed.roleIds.length;
    this.quickMentions ??=
      others + extractMentionIds(text, Number.MAX_SAFE_INTEGER).filter((id) => id !== this.userId).length;
    // Not even the raw tokens exceed it: no need to check who is a member.
    if (this.quickMentions <= limit) return this.quickMentions;
    const users = await deriveMentions(dbx, this.access.chat.id, this.userId, text, undefined, {
      spaceId: this.access.chat.spaceId,
    });
    return (this.mentions = users.length + others);
  }
}

async function evaluate(
  dbx: DbOrTx,
  subject: Subject,
  rules: readonly CompiledRule[],
  edit: boolean,
): Promise<Hit[]> {
  const hits: Hit[] = [];
  const now = Date.now();
  for (const r of rules) {
    const md = r.row.triggerMetadata ?? {};
    if (r.row.triggerType === 'keyword' || r.row.triggerType === 'preset') {
      if (!subject.content) continue;
      const { norm, words } = subject.prepared;
      const cover = coverOf(r.allow, norm, words);
      const matched =
        (r.keywords && !r.keywords.empty ? firstHit(r.keywords, cover, norm, words) : null) ??
        regexHit(r.regexes, norm, cover);
      if (matched) hits.push({ rule: r.row, matched });
    } else if (r.row.triggerType === 'mention_spam') {
      const limit = md.mentionLimit ?? DEFAULT_MENTION_LIMIT;
      if ((await subject.mentionCount(dbx, limit)) > limit) hits.push({ rule: r.row, matched: null });
    } else if (r.row.triggerType === 'spam_links') {
      if (!subject.content) continue;
      const links = linksOf(subject.prepared.norm);
      if (links.length === 0) continue;
      const space = subject.access.space!;
      const key = (link: string) => `${space.ctx.spaceId}\u0000${subject.userId}\u0000${link}`;
      let matched: string | null = null;
      if (now - space.me.member.joinedAt.getTime() < NEW_MEMBER_LINK_MS) matched = links[0]!;
      else {
        const counts = new Map<string, number>();
        for (const l of links) counts.set(l, (counts.get(l) ?? 0) + 1);
        for (const [l, n] of counts)
          if (recentLinkPosts(key(l), now) + n > LINK_REPEAT_LIMIT) {
            matched = l;
            break;
          }
      }
      if (!edit) recordLinkPosts(links.map(key), now);
      if (matched) hits.push({ rule: r.row, matched });
    }
  }
  return hits;
}

/** The writes after the send's transaction (see the header). */
interface Outcome {
  spaceId: string;
  userId: string;
  channelId: string;
  content: string;
  blocked: boolean;
  hits: Hit[];
}

function contentOf(input: AutoModInput): string {
  const parts: string[] = [];
  if (input.text) parts.push(input.text);
  const poll = input.metadata?.poll;
  if (poll) parts.push(poll.question, ...poll.options.map((o) => o.text));
  return parts.join('\n');
}

const pending = new Set<Promise<void>>();

/** Run the follow-up once the current transaction is over (commit or rollback). */
function schedule(outcome: Outcome): void {
  const p = new Promise<void>((resolve) => setImmediate(resolve))
    .then(() => applyOutcome(outcome))
    .catch((err: unknown) => logger.error({ err, spaceId: outcome.spaceId }, 'automod: follow-up failed'));
  pending.add(p);
  void p.finally(() => pending.delete(p));
}

/** Wait until every scheduled alert / timeout / audit write is done (tests). */
export async function autoModIdle(): Promise<void> {
  while (pending.size) await Promise.allSettled([...pending]);
}

/**
 * Check a message about to be created (or an edit about to be saved) in a Space channel
 * against the Space's rules, inside the send's transaction (call it after the other send
 * checks, right before the insert / update). Blocked → throws 403 AUTOMOD_BLOCKED_CODE; the
 * alerts, timeout and audit entries follow after the transaction either way.
 */
export async function enforceAutoMod(
  tx: Tx,
  fx: Effects,
  access: ChatAccess,
  userId: string,
  input: AutoModInput,
  opts: { edit?: boolean } = {},
): Promise<void> {
  const space = access.space;
  if (!space) return;
  // Discord: the owner, administrators and MANAGE_SPACE are exempt (owner/admin have every bit).
  if (hasPerm(space.base, PERM.MANAGE_SPACE)) return;
  const all = await enabledRules(tx, space.ctx.spaceId, space.ctx.permVersion);
  if (all.length === 0) return;
  const channels = [access.chat.id, access.chat.parentId].filter((id): id is string => !!id);
  const rules = all.filter(
    (r) =>
      !r.row.exemptChannelIds.some((id) => channels.includes(id)) &&
      !r.row.exemptRoleIds.some((id) => space.me.roleIds.includes(id)),
  );
  if (rules.length === 0) return;
  const content = contentOf(input);
  const hits = await evaluate(tx, new Subject(access, userId, content, input.text ?? null), rules, !!opts.edit);
  if (hits.length === 0) return;
  const blocker = hits.find((h) => h.rule.actions.some((a) => a.type === 'block'));
  const outcome: Outcome = {
    spaceId: space.ctx.spaceId,
    userId,
    channelId: access.chat.id,
    content: content.length > ALERT_CONTENT_MAX ? `${content.slice(0, ALERT_CONTENT_MAX - 1)}…` : content,
    blocked: !!blocker,
    hits,
  };
  if (!blocker) {
    // Went through: the alerts and the timeout follow the commit.
    fx.add(() => schedule(outcome));
    return;
  }
  schedule(outcome);
  const block = blocker.rule.actions.find((a) => a.type === 'block');
  const custom = block?.type === 'block' ? block.customMessage?.trim() : null;
  throw new HttpError(403, AUTOMOD_BLOCKED_CODE as ApiErrorCode, custom || DEFAULT_BLOCK_MESSAGE);
}

/** Alerts, audit entries and the timeout of one triggered message (one transaction). */
async function applyOutcome(o: Outcome): Promise<void> {
  await transact(async (tx, fx) => {
    const space = await lockSpace(tx, o.spaceId);
    const action = o.blocked ? 'blocked' : 'flagged';
    const posted = new Set<string>();
    for (const { rule } of o.hits) {
      for (const a of rule.actions) {
        if (a.type !== 'alert' || posted.has(`${a.channelId}:${rule.id}`)) continue;
        posted.add(`${a.channelId}:${rule.id}`);
        const [chat] = await tx
          .select({ id: chats.id })
          .from(chats)
          .where(and(eq(chats.id, a.channelId), eq(chats.spaceId, o.spaceId), eq(chats.type, 'space_text')))
          .limit(1);
        if (!chat) continue; // the alert channel is gone
        const event: SystemEvent = {
          kind: 'automod_alert',
          ruleName: rule.name,
          userId: o.userId,
          channelId: o.channelId,
          content: o.content,
          action,
        };
        await createMessage(tx, fx, { chatId: chat.id, senderId: null, type: 'system', metadata: { system: event } });
      }
    }
    const entry = (rule: AutoModRuleRow, matched: string | null) => ({
      ruleId: rule.id,
      ruleName: rule.name,
      triggerType: rule.triggerType,
      channelId: o.channelId,
      ...(matched ? { matched: matched.slice(0, 100) } : {}),
    });
    if (o.blocked) {
      const h = o.hits.find((x) => x.rule.actions.some((a) => a.type === 'block'))!;
      await audit(tx, {
        spaceId: o.spaceId,
        actorId: null,
        action: 'automod.block',
        targetType: 'member',
        targetId: o.userId,
        changes: entry(h.rule, h.matched),
      });
    } else {
      for (const h of o.hits.filter((x) => x.rule.actions.some((a) => a.type === 'alert')))
        await audit(tx, {
          spaceId: o.spaceId,
          actorId: null,
          action: 'automod.flag',
          targetType: 'member',
          targetId: o.userId,
          changes: entry(h.rule, h.matched),
        });
    }
    let timeout: { seconds: number; rule: AutoModRuleRow } | null = null;
    for (const { rule } of o.hits)
      for (const a of rule.actions)
        if (a.type === 'timeout' && a.durationSeconds > (timeout?.seconds ?? 0))
          timeout = { seconds: a.durationSeconds, rule };
    if (timeout) await timeOut(tx, fx, space, o.userId, timeout.seconds, timeout.rule);
  });
}

/**
 * AutoMod's timeout: what `PATCH /spaces/:id/members/:userId { timedOutUntil }` writes and
 * emits (perm_version bump, audit, member-updated, space:upsert, registry reload, channel
 * refetch). Never the owner or an administrator; a longer timeout already running stays.
 */
async function timeOut(
  tx: Tx,
  fx: Effects,
  space: SpaceRow,
  userId: string,
  seconds: number,
  rule: AutoModRuleRow,
): Promise<void> {
  const target = await loadSpaceMember(tx, space.id, userId);
  const ctx = target ? await loadSpacePermCtx(tx, space.id) : null;
  if (!target || !ctx || space.ownerId === userId || isSpaceAdmin(baseBits(ctx, userId, target))) return;
  const until = new Date(Date.now() + seconds * 1000);
  if (target.member.timedOutUntil && target.member.timedOutUntil >= until) return;
  await tx
    .update(spaceMembers)
    .set({ timedOutUntil: until })
    .where(and(eq(spaceMembers.spaceId, space.id), eq(spaceMembers.userId, userId)));
  await bumpPermVersion(tx, space.id);
  await audit(tx, {
    spaceId: space.id,
    actorId: null,
    action: 'automod.timeout',
    targetType: 'member',
    targetId: userId,
    changes: { timedOutUntil: until.toISOString(), durationSeconds: seconds, ruleId: rule.id, ruleName: rule.name },
  });
  const fresh = (await loadSpaceMember(tx, space.id, userId))!;
  const [member] = await toSpaceMembers(tx, [fresh]);
  fxMemberEvent(fx, space, () => ({ event: 'space:member-updated', member: member! }));
  fxSpaceUpsert(fx, userId, space.id);
  fxMemberChanged(fx, space.id, userId);
  fxChannelsChanged(fx, space.id, userId);
}
