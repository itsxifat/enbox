/**
 * What the composer's suggestion lists (@mentions, #channels, :emoji:) share: putting the
 * picked item in place of the typed query, and telling whether the query at the caret really
 * changed (arrow keys and caret moves inside it keep the highlighted row). Pure.
 */
import type { MentionQuery } from '../lib/composerMentions';

/** `insert` in place of the query (its trigger character up to the caret), one space merged. */
export function replaceQuery(
  text: string,
  q: MentionQuery,
  caret: number,
  insert: string,
): { text: string; caret: number } {
  const next = text.slice(0, q.start) + insert + text.slice(caret).replace(/^ /, '');
  return { text: next, caret: q.start + insert.length };
}

export function sameQuery(a: MentionQuery | null, b: MentionQuery | null): boolean {
  return a === b || (!!a && !!b && a.start === b.start && a.query === b.query);
}
