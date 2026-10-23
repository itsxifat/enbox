/**
 * Emoticon conversion on send (device pref `emoticonConversion`): typed emoticons such as
 * ":)" or "<3" become emoji, from Discord's list. Only standalone ones — at the start or after
 * a space, and at the end or before one — and never inside inline code, code blocks, links or
 * tokens (mentions, channels, custom emoji). Pure.
 */

/** Emoticon → emoji. */
export const EMOTICONS: Readonly<Record<string, string>> = {
  ':)': '🙂',
  ':-)': '🙂',
  '=)': '🙂',
  '=-)': '🙂',
  ':D': '😄',
  ':-D': '😄',
  '=D': '😄',
  '=-D': '😄',
  ';)': '😉',
  ';-)': '😉',
  ':(': '🙁',
  ':-(': '🙁',
  '=(': '🙁',
  '=-(': '🙁',
  ':P': '😛',
  ':-P': '😛',
  ':p': '😛',
  ':-p': '😛',
  '=P': '😛',
  '=p': '😛',
  ';P': '😜',
  ';-P': '😜',
  ';p': '😜',
  ';-p': '😜',
  ':O': '😮',
  ':-O': '😮',
  ':o': '😮',
  ':-o': '😮',
  '<3': '❤️',
  '♡': '❤️',
  '</3': '💔',
  '<\\3': '💔',
  ":'(": '😢',
  ":'-(": '😢',
  ':,(': '😢',
  ':,-(': '😢',
  ":')": '😂',
  ":'-)": '😂',
  ':,)': '😂',
  ':,-)': '😂',
  ':|': '😐',
  ':-|': '😐',
  '=|': '😐',
  xD: '😆',
  XD: '😆',
  'B)': '😎',
  'B-)': '😎',
  '8-)': '😎',
  ':*': '😗',
  ':-*': '😗',
  '=*': '😗',
  ':$': '😳',
  '=$': '😳',
  ':/': '😕',
  ':-/': '😕',
  ':\\': '😕',
  ':-\\': '😕',
  '>:(': '😠',
  '>:-(': '😠',
  ':@': '😠',
  ':-@': '😠',
  ']:)': '😈',
  ']:-)': '😈',
  '>:)': '😈',
  'O:)': '😇',
  'O:-)': '😇',
  '0:)': '😇',
  '0:-)': '😇',
  "':)": '😅',
  "':-)": '😅',
  "':D": '😅',
  "':(": '😓',
  "':-(": '😓',
  '-_-': '😑',
  '-__-': '😑',
};

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A standalone emoticon (group 2) and what precedes it (group 1); longest first. */
const EMOTICON_RE = new RegExp(
  `(^|\\s)(${Object.keys(EMOTICONS)
    .sort((a, b) => b.length - a.length)
    .map(escapeRe)
    .join('|')})(?=\\s|$)`,
  'g',
);

/**
 * Left as typed: fenced code (to its closing fence, or the end), inline code, markdown links,
 * bare and <angled> links, custom emoji and mention / channel / role tokens.
 */
const PROTECTED =
  /```[\s\S]*?(?:```|$)|`[^`\n]*`|\[[^\]\n]*\]\([^)\s]*\)|<?(?:https?:\/\/|www\.)\S+|<a?:\w+:[0-9a-f-]{36}>|[@#]\{[^}\s]+\}/gi;

export function convertEmoticons(text: string): string {
  if (!text) return text;
  const spans: [number, number][] = [];
  for (const m of text.matchAll(PROTECTED)) spans.push([m.index!, m.index! + m[0].length]);
  const inside = (i: number) => spans.some(([s, e]) => i >= s && i < e);
  return text.replace(EMOTICON_RE, (all: string, pre: string, emoticon: string, offset: number) =>
    inside(offset + pre.length) ? all : pre + EMOTICONS[emoticon]!,
  );
}
