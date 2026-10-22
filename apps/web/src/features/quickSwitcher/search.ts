/**
 * Quick Switcher ranking (pure): every place you can jump to — DMs, groups, Space text and
 * voice channels, Spaces, contacts without a DM — scored against the query. A leading
 * `@` narrows to people, `#` to text channels, `!` to voice channels, `*` to Spaces. With no
 * query, the recently visited places come first, then unread ones.
 */
import type { ID } from '@enbox/shared';

export type SwitcherKind = 'dm' | 'group' | 'text' | 'voice' | 'space' | 'user';

export interface SwitcherItem {
  /** Stable key, also the recents key (`chat:<id>`, `space:<id>`, `user:<id>`). */
  key: string;
  kind: SwitcherKind;
  title: string;
  /** Right-hand context: the Space of a channel, the @username of a person. */
  subtitle: string | null;
  /** Where Enter goes; null for a contact without a DM yet (opened through `userId`). */
  path: string | null;
  userId?: ID;
  chatId?: ID;
  spaceId?: ID;
  unread: boolean;
  mentions: number;
}

export interface ParsedQuery {
  text: string;
  only: readonly SwitcherKind[] | null;
}

const PREFIXES: Record<string, readonly SwitcherKind[]> = {
  '@': ['dm', 'user'],
  '#': ['text'],
  '!': ['voice'],
  '*': ['space'],
};

export function parseQuery(query: string): ParsedQuery {
  const q = query.trimStart();
  const only = PREFIXES[q[0] ?? ''];
  return only ? { text: normalize(q.slice(1)), only } : { text: normalize(q), only: null };
}

export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/** 0 = no match; higher is better (exact > prefix > word prefix > substring > in-order letters). */
export function scoreMatch(title: string, text: string): number {
  if (!text) return 1;
  const t = normalize(title);
  if (t === text) return 100;
  if (t.startsWith(text)) return 80;
  if (t.split(/[\s\-_.·]+/).some((w) => w.startsWith(text))) return 60;
  if (t.includes(text)) return 40;
  // Letters in order ("gnrl" → "general"); tighter spreads score higher.
  let from = 0;
  let first = -1;
  for (const ch of text) {
    const at = t.indexOf(ch, from);
    if (at < 0) return 0;
    if (first < 0) first = at;
    from = at + 1;
  }
  const spread = from - first - text.length;
  return Math.max(5, 25 - spread);
}

/**
 * Best matches first. `recents` lists keys, most recent first (they get a boost and lead
 * the empty-query list).
 */
export function rankItems(
  items: readonly SwitcherItem[],
  query: string,
  recents: readonly string[],
  limit = 30,
): SwitcherItem[] {
  const { text, only } = parseQuery(query);
  const recentRank = new Map(recents.map((k, i) => [k, i]));
  const pool = only ? items.filter((i) => only.includes(i.kind)) : items;
  if (!text) {
    const recent = pool
      .filter((i) => recentRank.has(i.key))
      .sort((a, b) => recentRank.get(a.key)! - recentRank.get(b.key)!);
    const seen = new Set(recent.map((i) => i.key));
    const unread = pool
      .filter((i) => !seen.has(i.key) && (i.unread || i.mentions > 0))
      .sort((a, b) => b.mentions - a.mentions);
    const rest = only ? pool.filter((i) => !seen.has(i.key) && !i.unread && !i.mentions) : [];
    return [...recent, ...unread, ...rest].slice(0, limit);
  }
  const scored: { item: SwitcherItem; score: number }[] = [];
  for (const item of pool) {
    let score = scoreMatch(item.title, text);
    if (!score && item.kind === 'user' && item.subtitle) score = scoreMatch(item.subtitle.replace(/^@/, ''), text) * 0.9;
    if (!score) continue;
    const r = recentRank.get(item.key);
    if (r !== undefined) score += Math.max(3, 15 - r);
    if (item.mentions) score += 5;
    else if (item.unread) score += 2;
    scored.push({ item, score });
  }
  scored.sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title));
  return scored.slice(0, limit).map((s) => s.item);
}
