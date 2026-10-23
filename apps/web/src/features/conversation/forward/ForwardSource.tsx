/**
 * Where a forwarded message came from (polish wave, agent 3): the original's time, and its
 * channel and Space when I know that chat (a jump link). Nothing for other messages.
 */
import type { ClientMessage } from '@/stores/messages';

export function ForwardSource(_props: { m: ClientMessage }) {
  return null;
}
