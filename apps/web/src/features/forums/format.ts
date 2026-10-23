/** Wording and small pure helpers of the forum views. */
import type { ForumInfo, ForumTag } from '@enbox/shared';
import { formatShortDate } from '@/lib/format';

/** Discord's post-card age: "now", "5m", "3h", "6d", then the short date. */
export function shortAgo(iso: string, now = Date.now()): string {
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 60_000) return 'now';
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return formatShortDate(iso);
}

/** The tags a post wears, in the forum's order (ids of deleted tags are skipped). */
export function postTags(forum: ForumInfo, ids: readonly string[] | undefined): ForumTag[] {
  if (!ids?.length) return [];
  const worn = new Set(ids);
  return forum.tags.filter((t) => worn.has(t.id));
}

/** A short id for a new tag, unique among `taken` (tag ids are made by the client). */
export function newTagId(taken: Iterable<string>): string {
  const used = new Set(taken);
  for (;;) {
    const id = Math.random().toString(36).slice(2, 10);
    if (id.length >= 6 && !used.has(id)) return id;
  }
}

/** Most tags one post may wear (the server's limit). */
export const MAX_POST_TAGS = 5;
