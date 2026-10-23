/**
 * What the sticker picker and the composer's suggestions offer from my groups
 * (stores/stickers.ts): in a Space channel its Space comes first, and other Spaces' stickers
 * only where USE_EXTERNAL_EMOJI is allowed (it stands in for "Use External Stickers"; the
 * server refuses them otherwise). Search matches the name, the related emoji and the
 * description, ignoring case, accents and emoji variation selectors.
 */
import {
  PERM,
  hasPerm,
  type ChatSummary,
  type SpaceSticker,
  type SpaceStickerGroup,
} from '@enbox/shared';
import { emojiOnlyCount } from '@/features/conversation/lib/richText';

export type StickerChat = Pick<ChatSummary, 'space' | 'spacePermissions'>;

/** The groups a chat offers: its Space first; only it where external stickers are denied. */
export function stickerPickerGroups(
  groups: SpaceStickerGroup[] | null,
  chat: StickerChat | null,
): SpaceStickerGroup[] {
  if (!groups) return [];
  const here = chat?.space?.spaceId;
  if (!here) return groups;
  const mine = groups.filter((g) => g.spaceId === here);
  if (!hasPerm(chat.spacePermissions, PERM.USE_EXTERNAL_EMOJI)) return mine;
  return [...mine, ...groups.filter((g) => g.spaceId !== here)];
}

/** Code points search ignores: combining accents (U+0300–U+036F), text/emoji selectors. */
const ignored = (cp: number) => (cp >= 0x300 && cp <= 0x36f) || cp === 0xfe0e || cp === 0xfe0f;

/** Lowercase, with accents and emoji variation selectors folded away. */
export function foldSearch(s: string): string {
  let out = '';
  for (const ch of s.normalize('NFKD')) if (!ignored(ch.codePointAt(0)!)) out += ch;
  return out.toLowerCase().trim();
}

export function stickerMatches(sticker: SpaceSticker, folded: string): boolean {
  if (!folded) return true;
  return (
    foldSearch(sticker.name).includes(folded) ||
    (!!sticker.emoji && foldSearch(sticker.emoji).includes(folded)) ||
    (!!sticker.description && foldSearch(sticker.description).includes(folded))
  );
}

/** The groups with only their stickers matching `query` (empty groups left out). */
export function searchStickerGroups(
  groups: SpaceStickerGroup[],
  query: string,
): SpaceStickerGroup[] {
  const folded = foldSearch(query);
  if (!folded) return groups;
  return groups
    .map((g) => ({ ...g, stickers: g.stickers.filter((s) => stickerMatches(s, folded)) }))
    .filter((g) => g.stickers.length > 0);
}

/** The single unicode emoji `text` holds (spaces around allowed), else null. */
export function loneEmoji(text: string): string | null {
  const t = text.trim();
  if (!t || t.length > 16 || t.includes('<') || emojiOnlyCount(t, 1) !== 1) return null;
  return t;
}

/** Stickers whose related emoji includes `emoji`, at most `max`, in group order. */
export function stickersForEmoji(
  groups: SpaceStickerGroup[],
  emoji: string,
  max = 12,
): SpaceSticker[] {
  const folded = foldSearch(emoji);
  if (!folded) return [];
  const out: SpaceSticker[] = [];
  for (const g of groups)
    for (const s of g.stickers) {
      if (s.emoji && foldSearch(s.emoji).includes(folded)) out.push(s);
      if (out.length >= max) return out;
    }
  return out;
}
