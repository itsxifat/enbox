/** The Server Tag editor's draft and its checks (pure). */
import { SPACE_TAG_RE, type SpaceTag } from '@enbox/shared';

/** Badge colours offered first; mid tones that read on light and dark (any #rrggbb works). */
export const TAG_COLOR_PRESETS = [
  '#6d5dfc',
  '#3b82f6',
  '#0ea5e9',
  '#14b8a6',
  '#22c55e',
  '#84cc16',
  '#eab308',
  '#f97316',
  '#ef4444',
  '#ec4899',
  '#d946ef',
  '#64748b',
] as const;

export const TAG_MAX_LENGTH = 4;

/** The editor's starting point: the saved tag, or an empty one with the first badge and colour. */
export function tagDraftOf(tag: SpaceTag | null | undefined): SpaceTag {
  return tag ? { ...tag } : { tag: '', badge: 'leaf', color: TAG_COLOR_PRESETS[0] };
}

/** Letters and digits as the server counts them (code points, not UTF-16 units). */
export function tagLength(text: string): number {
  return [...text.trim()].length;
}

/** Why the tag's text cannot be saved (null = fine): the server's rule, `SPACE_TAG_RE`. */
export function tagProblem(text: string): string | null {
  const t = text.trim();
  if (!t) return 'Give the tag 2 to 4 letters or numbers';
  return SPACE_TAG_RE.test(t) ? null : 'Use 2 to 4 letters or numbers';
}

export function sameTag(a: SpaceTag | null | undefined, b: SpaceTag | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.tag.trim() === b.tag.trim() && a.badge === b.badge && a.color === b.color;
}
