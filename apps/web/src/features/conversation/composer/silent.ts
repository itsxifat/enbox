/**
 * @silent: a message starting with "@silent " goes without its prefix and with `silent: true`
 * (MESSAGE_FLAGS.SILENT: no push or desktop notification for anyone; unreads and mentions
 * still count). The @ list offers it at the start of the box. Pure.
 */
import type { MentionCandidate } from '@/features/spaces/mentions';
import type { MentionQuery, MentionRef } from '../lib/composerMentions';

export const SILENT_KEY = 'silent';
export const SILENT_HINT = 'Silent message: no one gets notified';

const SILENT_PREFIX = /^@silent(?:\s+|$)/i;

/**
 * The text after a leading "@silent", or null: no prefix, or "@silent" is someone picked from
 * the @ list (a member or role really named "silent" is mentioned instead).
 */
export function silentRest(text: string, refs: readonly MentionRef[] = []): string | null {
  const m = SILENT_PREFIX.exec(text);
  if (!m) return null;
  if (refs.some((r) => !r.userId.startsWith('<') && r.name.toLowerCase() === SILENT_KEY))
    return null;
  return text.slice(m[0].length);
}

/** "@silent" in the @ list while the box starts with "@" and a beginning of it. */
export function silentCandidate(q: MentionQuery | null): MentionCandidate | null {
  if (!q || q.start !== 0 || !SILENT_KEY.startsWith(q.query.toLowerCase())) return null;
  return {
    key: SILENT_KEY,
    token: SILENT_KEY,
    name: SILENT_KEY,
    sub: 'Send without notifying anyone',
  };
}
