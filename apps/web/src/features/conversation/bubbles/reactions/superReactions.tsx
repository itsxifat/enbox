/**
 * Super reactions (polish wave, agent 1): the message menu's "Add Super Reaction", the hover
 * toolbar's button, and (with ReactionChips) the burst chips and their animation.
 */
import type { ChatSummary } from '@enbox/shared';
import type { MenuItem } from '@/components/ui';
import type { ClientMessage } from '@/stores/messages';

/** The message menu's "Add Super Reaction" (opens the picker in super mode), or null. */
export function superReactionMenuItem(
  _chat: ChatSummary,
  _m: ClientMessage,
  _openPicker: () => void,
): MenuItem | null {
  return null;
}

/** The hover toolbar's "Add Super Reaction" button (next to Add Reaction), or nothing. */
export function SuperReactToolButton(_props: { chat: ChatSummary; m: ClientMessage }) {
  return null;
}
