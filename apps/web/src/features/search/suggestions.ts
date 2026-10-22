/**
 * What the header search's dropdown offers for the word at the caret (Discord):
 * - a plain word: the filter keys ("from: user", "has: link, embed or file" …), narrowed to
 *   those starting with it, and the recent searches while the box is empty;
 * - `from:` / `mentions:` people, `has:` the contents, `in:` channels (Spaces), `pinned:`
 *   true / false, `before:` / `during:` / `after:` today, yesterday, the typed date and a
 *   date picker.
 * Pure (the people and channels come in); SearchBox renders and navigates it.
 */
import type { ChannelCandidate, PersonCandidate } from './candidates';
import {
  FILTER_KEYS,
  HAS_VALUES,
  formatDay,
  parseDay,
  type ActiveWord,
  type FilterKey,
  type SearchToken,
} from './query';

export const KEY_HINTS: Record<FilterKey, string> = {
  from: 'user',
  mentions: 'user',
  has: 'link, embed or file',
  before: 'specific date',
  during: 'specific date',
  after: 'specific date',
  in: 'channel',
  pinned: 'true or false',
};

export type SuggestionItem =
  /** Inserts `key:` and keeps typing. */
  | { type: 'key'; id: string; key: FilterKey }
  /** Becomes a chip. */
  | { type: 'token'; id: string; token: SearchToken; label: string; detail?: string | null }
  /** Runs that search again. */
  | { type: 'recent'; id: string; query: string }
  /** A date input for `key`. */
  | { type: 'date-picker'; id: string; key: FilterKey };

export interface SuggestionSection {
  id: string;
  title: string;
  items: SuggestionItem[];
  /** History: offers "Clear". */
  clearable?: boolean;
}

export interface SuggestionInput {
  scopeKind: 'space' | 'chat';
  word: ActiveWord;
  /** No chips and no text: show the history. */
  empty: boolean;
  people: readonly PersonCandidate[];
  channels: readonly ChannelCandidate[];
  recents: readonly string[];
  today?: Date;
}

const SECTION_TITLES: Record<FilterKey, string> = {
  from: 'From User',
  mentions: 'Mentions User',
  has: 'Message Contains',
  before: 'Dates',
  during: 'Dates',
  after: 'Dates',
  in: 'In Channel',
  pinned: 'Pinned',
};

export function availableKeys(scopeKind: 'space' | 'chat'): FilterKey[] {
  return FILTER_KEYS.filter((k) => k !== 'in' || scopeKind === 'space');
}

export function buildSuggestions(input: SuggestionInput): SuggestionSection[] {
  const { word } = input;
  const partial = word.partial.toLowerCase();
  if (word.key === null || (word.key === 'in' && input.scopeKind !== 'space')) {
    const keys = availableKeys(input.scopeKind).filter((k) => !partial || k.startsWith(partial));
    const sections: SuggestionSection[] = [];
    if (keys.length)
      sections.push({
        id: 'options',
        title: 'Search Options',
        items: keys.map((key) => ({ type: 'key', id: `key-${key}`, key })),
      });
    if (input.empty && input.recents.length)
      sections.push({
        id: 'history',
        title: 'History',
        clearable: true,
        items: input.recents.map((query, i) => ({ type: 'recent', id: `recent-${i}`, query })),
      });
    return sections;
  }

  const key = word.key;
  const token = (value: string, label: string, detail?: string | null): SuggestionItem => ({
    type: 'token',
    id: `${key}-${value}`,
    token: { key, value },
    label,
    detail,
  });
  let items: SuggestionItem[];
  switch (key) {
    case 'from':
    case 'mentions':
      items = input.people.map((p) => token(p.id, p.name, p.username));
      break;
    case 'in':
      items = input.channels.map((c) => token(c.id, c.name));
      break;
    case 'has':
      items = HAS_VALUES.filter((v) => v.startsWith(partial)).map((v) => token(v, v));
      break;
    case 'pinned':
      items = ['true', 'false'].filter((v) => v.startsWith(partial)).map((v) => token(v, v));
      break;
    default: {
      const today = input.today ?? new Date();
      const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
      const typed = parseDay(word.partial);
      items = [];
      if (typed) items.push(token(formatDay(typed), formatDay(typed)));
      for (const [label, day] of [
        ['Today', today],
        ['Yesterday', yesterday],
      ] as const) {
        const value = formatDay(day);
        const wanted = !partial || label.toLowerCase().startsWith(partial) || value.startsWith(partial);
        if (wanted && value !== (typed && formatDay(typed))) items.push(token(value, label, value));
      }
      items.push({ type: 'date-picker', id: `${key}-picker`, key });
    }
  }
  return [{ id: key, title: SECTION_TITLES[key], items }];
}
