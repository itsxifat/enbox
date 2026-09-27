/**
 * Emoji data for the panel: the web picker's dataset (data.js), filtered to what this
 * Android version can draw, plus recents and the preferred skin tone (both per device,
 * like the web picker's localStorage).
 */
import { Platform } from 'react-native';
import { create } from 'zustand';
import { storage } from '@/lib/storage';
import { CATEGORIES } from './data';

/** Highest emoji version each Android release draws natively (older ones show tofu). */
function maxEmojiVersion() {
  if (Platform.OS !== 'android') return 16;
  const api = Number(Platform.Version) || 0;
  if (api >= 36) return 16;
  if (api >= 35) return 15.1;
  if (api >= 34) return 15;
  if (api >= 33) return 14;
  if (api >= 31) return 13.1;
  if (api >= 30) return 13;
  if (api >= 29) return 12;
  if (api >= 28) return 11;
  return 5;
}

export function unifiedToChar(u) {
  return String.fromCodePoint(...u.split('-').map((h) => parseInt(h, 16)));
}

const SUPPORTED = maxEmojiVersion();

/** `{ id, name, emojis: [{ u, char, keywords, variations }] }` per category. */
export const EMOJI_CATEGORIES = CATEGORIES.map((c) => ({
  id: c.id,
  name: c.name,
  emojis: c.emojis
    .filter((row) => row[2] <= SUPPORTED)
    .map(([u, keywords, , variations]) => ({
      u,
      char: unifiedToChar(u),
      keywords,
      variations: variations ?? null,
    })),
}));

const ALL = EMOJI_CATEGORIES.flatMap((c) => c.emojis);
const BY_CHAR = new Map(ALL.map((e) => [e.char, e]));

/** Skin tones: neutral, light, medium-light, medium, medium-dark, dark. */
export const SKIN_TONES = ['', '1f3fb', '1f3fc', '1f3fd', '1f3fe', '1f3ff'];
export const SKIN_TONE_SWATCHES = [
  '#ffc93a',
  '#f7dece',
  '#f3d2a2',
  '#d5ab88',
  '#af7e57',
  '#7c533e',
];

/** The emoji as drawn with a skin tone (the base emoji when it has no variations). */
export function withTone(e, tone) {
  if (!tone || !e.variations) return e.char;
  const v = e.variations.find((x) => x.split('-').includes(tone));
  return v ? unifiedToChar(v) : e.char;
}

export function variationsOf(e) {
  if (!e.variations) return [];
  return [e.char, ...e.variations.map(unifiedToChar)];
}

/** Keyword search across every category (the web picker's search). */
export function searchEmoji(query, limit = 120) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const exact = [];
  const partial = [];
  for (const e of ALL) {
    const words = e.keywords.split(',');
    if (words.some((w) => w.startsWith(q))) exact.push(e);
    else if (e.keywords.includes(q)) partial.push(e);
    if (exact.length >= limit) break;
  }
  return [...exact, ...partial].slice(0, limit);
}

// ---------------------------------------------------------------------------
// Recents & skin tone (device prefs)
// ---------------------------------------------------------------------------

const RECENT_KEY = 'enbox.emoji.recent';
const TONE_KEY = 'enbox.emoji.skinTone';
const MAX_RECENT = 32;

export const useEmojiPrefs = create(() => ({
  recent: null,
  tone: null,
}));

function loadPrefs() {
  const s = useEmojiPrefs.getState();
  if (s.recent !== null) return;
  const recent = storage.getJSON(RECENT_KEY);
  const tone = storage.get(TONE_KEY);
  useEmojiPrefs.setState({
    recent: Array.isArray(recent) ? recent.filter((x) => typeof x === 'string') : [],
    tone: SKIN_TONES.includes(tone) ? tone : '',
  });
}

export function useRecentEmoji() {
  loadPrefs();
  return useEmojiPrefs((s) => s.recent ?? []);
}

export function useSkinTone() {
  loadPrefs();
  return useEmojiPrefs((s) => s.tone ?? '');
}

export function setSkinTone(tone) {
  storage.set(TONE_KEY, tone);
  useEmojiPrefs.setState({ tone });
}

/** Remember a picked emoji (most recent first). */
export function rememberEmoji(char) {
  loadPrefs();
  const next = [char, ...(useEmojiPrefs.getState().recent ?? []).filter((x) => x !== char)].slice(
    0,
    MAX_RECENT,
  );
  storage.setJSON(RECENT_KEY, next);
  useEmojiPrefs.setState({ recent: next });
}

/** Recents as panel entries (tone variants keep their base emoji's variations). */
export function recentEntries(recent) {
  return recent.map(
    (char) => BY_CHAR.get(char) ?? { u: char, char, keywords: '', variations: null, recent: true },
  );
}
