/**
 * ":name" emoji suggestions (Discord: two characters after a colon open them): my Spaces'
 * custom emoji — the chat's Space first, other Spaces' only with USE_EXTERNAL_EMOJI, as in the
 * picker — then unicode emoji by name and keyword, from emoji-picker-react's data file (loaded
 * the first time, in its own chunk). Picking inserts the emoji, or a custom one as ":name:"
 * (`pickEmoji`, lib/composerMentions).
 */
import { useEffect, useMemo, useState } from 'react';
import {
  PERM,
  customEmojiToken,
  hasPerm,
  type ChatSummary,
  type SpaceEmoji,
  type SpaceEmojiGroup,
} from '@enbox/shared';
import { useEmojis } from '@/stores/emojis';
import type { MentionQuery } from '../lib/composerMentions';

export interface UnicodeEmoji {
  emoji: string;
  /** Shortcode-style name: "grinning_face_with_big_eyes". */
  name: string;
  /** Keywords ("smile", "happy", "+1"…), lower case. */
  words: readonly string[];
}

export interface EmojiSuggestion {
  key: string;
  /** What picking inserts: the emoji, or a custom emoji's token. */
  emoji: string;
  /** Without colons. */
  name: string;
  custom?: SpaceEmoji;
  /** A custom emoji's Space. */
  spaceName?: string;
}

const MAX_EMOJI_SUGGESTIONS = 10;

/** ":query" at the caret: a colon at the start or after a space or bracket, then 2+ name characters. */
export function activeEmojiQuery(text: string, caret: number): MentionQuery | null {
  const before = text.slice(0, caret);
  const m = /(^|[\s(["']):([\p{L}\p{N}_+-]{2,32})$/u.exec(before);
  if (!m) return null;
  const query = m[2]!;
  return { start: before.length - query.length - 1, query };
}

type PickerData = { emojis: Record<string, readonly { n: readonly string[]; u: string }[]> };

const shortcode = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+]+/gu, '_')
    .replace(/^_+|_+$/g, '');

/** emoji-picker-react's data as a search list, in its order (smileys first). */
export function buildEmojiIndex(data: PickerData): UnicodeEmoji[] {
  const out: UnicodeEmoji[] = [];
  for (const [category, list] of Object.entries(data.emojis)) {
    if (category === 'custom' || category.startsWith('suggested')) continue;
    for (const e of list) {
      const full = e.n[e.n.length - 1];
      if (!full) continue;
      const emoji = String.fromCodePoint(...e.u.split('-').map((h) => parseInt(h, 16)));
      out.push({ emoji, name: shortcode(full), words: e.n.map((w) => w.toLowerCase()) });
    }
  }
  return out;
}

let unicode: UnicodeEmoji[] | null = null;
let loading: Promise<UnicodeEmoji[]> | null = null;

/** The unicode list, loaded once (null until then). */
export function loadedUnicodeEmoji(): UnicodeEmoji[] | null {
  return unicode;
}

export function loadUnicodeEmoji(): Promise<UnicodeEmoji[]> {
  loading ??= import('emoji-picker-react/dist/data/emojis.json')
    .then((m) => (unicode = buildEmojiIndex(m.default as unknown as PickerData)))
    .catch((e: unknown) => {
      loading = null;
      throw e;
    });
  return loading;
}

/** The custom emoji a chat may use, in suggestion order (see the header). */
export function usableCustomEmoji(
  groups: readonly SpaceEmojiGroup[] | null,
  chat: Pick<ChatSummary, 'space' | 'spacePermissions'>,
): { emoji: SpaceEmoji; spaceName: string }[] {
  if (!groups) return [];
  const here = chat.space?.spaceId;
  const external = !here || hasPerm(chat.spacePermissions, PERM.USE_EXTERNAL_EMOJI);
  const ordered = here
    ? [
        ...groups.filter((g) => g.spaceId === here),
        ...(external ? groups.filter((g) => g.spaceId !== here) : []),
      ]
    : groups;
  return ordered.flatMap((g) => g.emojis.map((emoji) => ({ emoji, spaceName: g.spaceName })));
}

/**
 * Matches for ":query": custom emoji whose name starts with (then contains) it first, then
 * unicode ones by name (exact, prefix), keyword (exact, prefix) and a later word of the name.
 */
export function matchEmoji(
  query: string,
  unicodeList: readonly UnicodeEmoji[],
  custom: readonly { emoji: SpaceEmoji; spaceName: string }[] = [],
  limit = MAX_EMOJI_SUGGESTIONS,
): EmojiSuggestion[] {
  const q = shortcode(query);
  if (!q) return [];
  const ranked: { rank: number; s: EmojiSuggestion }[] = [];
  for (const { emoji: e, spaceName } of custom) {
    const n = e.name.toLowerCase();
    const rank = n === q ? 0 : n.startsWith(q) ? 1 : n.includes(q) ? 2 : -1;
    if (rank >= 0)
      ranked.push({
        rank,
        s: { key: `c:${e.id}`, emoji: customEmojiToken(e), name: e.name, custom: e, spaceName },
      });
  }
  for (const u of unicodeList) {
    const rank =
      u.name === q
        ? 3
        : u.name.startsWith(q) || u.words.includes(q)
          ? 4
          : u.words.some((w) => w.startsWith(q))
            ? 5
            : u.name.includes(`_${q}`)
              ? 6
              : -1;
    if (rank >= 0) ranked.push({ rank, s: { key: `u:${u.emoji}`, emoji: u.emoji, name: u.name } });
  }
  // Stable: equal ranks keep the custom groups' and the data's order.
  return ranked
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit)
    .map((r) => r.s);
}

/** The ":query" list of the composer (loads the unicode data and my Spaces' emoji on first use). */
export function useEmojiSuggestions(chat: ChatSummary, query: string | null): EmojiSuggestion[] {
  const open = query !== null;
  const [list, setList] = useState(loadedUnicodeEmoji);
  const groups = useEmojis((s) => (open ? s.groups : null));
  useEffect(() => {
    if (open)
      void useEmojis
        .getState()
        .loadMine()
        .catch(() => undefined);
  }, [open]);
  useEffect(() => {
    if (query === null || list) return;
    let live = true;
    void loadUnicodeEmoji()
      .then((l) => {
        if (live) setList(l);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [query, list]);
  return useMemo(
    () => (query === null ? [] : matchEmoji(query, list ?? [], usableCustomEmoji(groups, chat))),
    [query, list, groups, chat],
  );
}
