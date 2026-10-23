/**
 * Channel mentions in the composer (`#{<uuid>}` tokens, shared everyday.ts). "#" lists the
 * current Space's channels I can see; a picked one shows as "#name" with a `ChannelRef`, and
 * `encodeChannels` turns those names back into tokens on send (an edited name goes as plain
 * text, like user mentions in lib/composerMentions). Drafts and edits keep the tokens and come
 * back through `decodeChannels`. The helpers are pure; `useChannelSuggestions` reads the
 * stores when the query changes (no subscription to every chat update).
 */
import { useMemo } from 'react';
import {
  CHANNEL_MENTION_RE,
  PERM,
  channelMentionToken,
  hasPerm,
  isVoiceChannelType,
  type ChatSummary,
  type ID,
  type SpaceCategory,
} from '@enbox/shared';
import { useChats } from '@/stores/chats';
import { useSpaces } from '@/stores/spaces';
import type { MentionQuery } from '../lib/composerMentions';

export interface ChannelRef {
  channelId: ID;
  name: string;
}

/** A channel in the "#" list, with its category's name (Discord shows it on the right). */
export interface ChannelSuggestion {
  chat: ChatSummary;
  category: string | null;
}

const MAX_CHANNEL_SUGGESTIONS = 10;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * The channel being typed at the caret: a "#" at the start or after a space or bracket, then
 * the name so far (one inner space allowed, for voice channels' names). "# " (a heading) and
 * "C#" are not.
 */
export function activeChannelQuery(text: string, caret: number): MentionQuery | null {
  const before = text.slice(0, caret);
  const m = /(^|[\s(["'])#((?:[^\s#]{1,30}(?: [^\s#]{0,20})?)?)$/u.exec(before);
  if (!m) return null;
  const query = m[2]!;
  return { start: before.length - query.length - 1, query };
}

/** Picked channels' "#name" → `#{id}` tokens (longest names first; an edited name stays text). */
export function encodeChannels(text: string, refs: readonly ChannelRef[]): string {
  if (!refs.length || !text.includes('#')) return text;
  const byName = new Map<string, ID>();
  for (const r of refs) if (r.name && !byName.has(r.name)) byName.set(r.name, r.channelId);
  const names = [...byName.keys()].sort((a, b) => b.length - a.length);
  const re = new RegExp(
    `(^|[^\\p{L}\\p{N}_#])#(${names.map(escapeRe).join('|')})(?![\\p{L}\\p{N}_-])`,
    'gu',
  );
  return text.replace(
    re,
    (_, pre: string, name: string) => `${pre}${channelMentionToken(byName.get(name)!)}`,
  );
}

/** `#{id}` tokens → "#name" for the channels `nameOf` knows (the others stay tokens), with refs. */
export function decodeChannels(
  text: string,
  nameOf: (id: ID) => string | null | undefined,
): { text: string; refs: ChannelRef[] } {
  const refs: ChannelRef[] = [];
  const out = text.replace(new RegExp(CHANNEL_MENTION_RE.source, 'g'), (token, id: string) => {
    const name = nameOf(id);
    if (!name) return token;
    if (!refs.some((r) => r.channelId === id)) refs.push({ channelId: id, name });
    return `#${name}`;
  });
  return { text: out, refs };
}

/** Refs whose "#name" is still in the text. */
export function pruneChannelRefs(text: string, refs: ChannelRef[]): ChannelRef[] {
  return refs.filter((r) => text.includes(`#${r.name}`));
}

/** "#query" matches: a name (or a word of it) starting with the query first, then the others containing it. */
export function matchChannels(
  channels: readonly ChatSummary[],
  query: string,
  limit = MAX_CHANNEL_SUGGESTIONS,
): ChatSummary[] {
  const q = fold(query.trim());
  if (!q) return channels.slice(0, limit);
  const first: ChatSummary[] = [];
  const rest: ChatSummary[] = [];
  for (const c of channels) {
    const name = fold(c.name ?? '');
    if (name.startsWith(q) || name.split(/[\s_-]+/).some((w) => w.startsWith(q))) first.push(c);
    else if (name.includes(q)) rest.push(c);
  }
  return [...first, ...rest].slice(0, limit);
}

/** The sidebar's order: uncategorised first, then by category; text before voice; by position. */
export function sidebarOrder(
  channels: readonly ChatSummary[],
  categories: readonly Pick<SpaceCategory, 'id' | 'position'>[],
): ChatSummary[] {
  const cats = new Map(categories.map((c) => [c.id, c.position]));
  const key = (c: ChatSummary) => [
    c.space?.categoryId ? (cats.get(c.space.categoryId) ?? 0) : -1,
    isVoiceChannelType(c.type) ? 1 : 0,
    c.space?.position ?? 0,
  ];
  return [...channels].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i]! - kb[i]!;
    return a.createdAt < b.createdAt ? -1 : 1;
  });
}

/** The "#" list of a Space chat: its Space's channels I can see (threads left out). */
export function useChannelSuggestions(
  chat: ChatSummary,
  query: string | null,
): ChannelSuggestion[] {
  const spaceId = chat.space?.spaceId;
  return useMemo(() => {
    if (query === null || !spaceId) return [];
    const space = useSpaces.getState().byId[spaceId];
    const channels = Object.values(useChats.getState().byId).filter(
      (c) =>
        c.space?.spaceId === spaceId &&
        c.type !== 'space_thread' &&
        !!c.name &&
        hasPerm(c.spacePermissions, PERM.VIEW_CHANNEL),
    );
    const categories = space?.categories ?? [];
    const names = new Map(categories.map((c) => [c.id, c.name]));
    return matchChannels(sidebarOrder(channels, categories), query).map((c) => ({
      chat: c,
      category: c.space?.categoryId ? (names.get(c.space.categoryId) ?? null) : null,
    }));
  }, [query, spaceId]);
}
