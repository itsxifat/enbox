/**
 * A `#{id}` channel mention as plain text, for the places that render messages as text
 * (reply quotes, search snippets, copy, screen reader labels): pass it as `renderMentions`'
 * `channelName` (or `inlineToPlain`'s) to get "#general", "#unknown" for a channel I can't see.
 */
import type { ID } from '@enbox/shared';
import { useChats } from '@/stores/chats';
import { channelMentionTarget } from './target';

export function channelMentionName(id: ID): string {
  return channelMentionTarget(useChats.getState().byId[id])?.name ?? 'unknown';
}
