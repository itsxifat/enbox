/**
 * Unicode emoji in message text (Discord's clickable emoji): `splitEmoji` cuts a text into
 * plain runs and emoji (flags, keycaps, skin tones, ZWJ sequences; a character drawn as text
 * by default only with its emoji selector, so "©" and "™" stay text). `unicodeEmojiName` reads
 * the name from emoji-picker-react's data, loaded on first use. `splitEmoji` and `unifiedOf`
 * are pure (unit-tested).
 */

const PICTO = String.raw`(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}️)\p{Emoji_Modifier}?`;
const JOINED = String.raw`‍\p{Extended_Pictographic}️?\p{Emoji_Modifier}?`;
const TAGS = String.raw`(?:[\u{E0020}-\u{E007E}]+\u{E007F})?`;
const SEQUENCE = new RegExp(
  String.raw`\p{Regional_Indicator}{2}|[#*0-9]️?⃣|${PICTO}${TAGS}(?:${JOINED})*`,
  'gu',
);
const MAYBE_EMOJI = /[\p{Extended_Pictographic}\p{Regional_Indicator}⃣]/u;

/** One unicode emoji of a text. */
export interface EmojiPart {
  emoji: string;
}

/** `text` as plain runs and emoji, in order (`[text]` when it has none). */
export function splitEmoji(text: string): (string | EmojiPart)[] {
  if (!MAYBE_EMOJI.test(text)) return [text];
  const out: (string | EmojiPart)[] = [];
  let last = 0;
  for (const m of text.matchAll(SEQUENCE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    out.push({ emoji: m[0] });
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out.length ? out : [text];
}

/** An emoji's code points as emoji-picker-react keys them: "1f44d-1f3fd". */
export function unifiedOf(emoji: string): string {
  return Array.from(emoji, (c) => c.codePointAt(0)!.toString(16)).join('-');
}

type Lookup = (unified: string) => string | null;
let names: Promise<Lookup> | null = null;

function loadNames(): Promise<Lookup> {
  names ??= import('emoji-picker-react')
    .then(({ emojiByUnified }): Lookup => (unified) => {
      const n = (emojiByUnified(unified) as { n?: string[] } | undefined)?.n;
      return n?.length ? n[n.length - 1]! : null;
    })
    .catch((e: unknown) => {
      names = null;
      throw e;
    });
  return names;
}

/** `:thumbs_up:` for 👍 (null when unknown). */
export async function unicodeEmojiName(emoji: string): Promise<string | null> {
  const lookup = await loadNames();
  const unified = unifiedOf(emoji);
  const bare = unified.replace(/-fe0f/g, '');
  const name = lookup(unified) ?? lookup(bare) ?? lookup(bare.replace(/^([^-]+)/, '$1-fe0f'));
  return name ? `:${name.replace(/[\s:]+/g, '_')}:` : null;
}
