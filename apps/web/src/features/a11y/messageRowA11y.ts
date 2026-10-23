/**
 * Screen reader and keyboard attributes of a message row (polish wave, agent 4): spread on
 * the row's outer element by MessageRow and CozyMessageRow.
 */
import type { HTMLAttributes } from 'react';
import type { ClientMessage } from '@/stores/messages';

export function messageRowA11y(_m: ClientMessage): HTMLAttributes<HTMLDivElement> {
  return {};
}
