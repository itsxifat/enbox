/**
 * The bubble-style side of a chat's resolved appearance for the rows: the conversation root
 * (ConversationPane / ChannelPane) provides it, rows read it instead of taking props, so
 * `MessageRow`'s props stay unchanged and the Virtuoso items never re-key on a theme change.
 */
import { createContext, useContext, useState } from 'react';
import type { BubbleStyle, MessageAnimation } from '@enbox/shared';
import { useReducedMotion } from '@/hooks/useMediaQuery';
import { isFreshArrival } from '@/lib/arrivals';

export interface RowAppearance {
  bubbleStyle: BubbleStyle;
  messageAnimation: MessageAnimation;
}

export const DEFAULT_ROW_APPEARANCE: RowAppearance = {
  bubbleStyle: 'classic',
  messageAnimation: 'fade',
};

export const RowAppearanceContext = createContext<RowAppearance>(DEFAULT_ROW_APPEARANCE);

export function useRowAppearance(): RowAppearance {
  return useContext(RowAppearanceContext);
}

const ENTER_CLASS: Record<MessageAnimation, string | undefined> = {
  none: undefined,
  fade: 'animate-msg-fade',
  slide: 'animate-msg-slide',
  pop: 'animate-msg-pop',
};

/**
 * The enter-animation class for a row, decided once when it mounts: only for a live arrival
 * (`lib/arrivals.ts`), never under reduced motion. Goes on an inner wrapper — never on the
 * Virtuoso item (it measures it) nor on the swipe-transform div.
 */
export function useEnterAnimation(rowKey: string): string | undefined {
  const { messageAnimation } = useRowAppearance();
  const reduced = useReducedMotion();
  const [cls] = useState(() =>
    !reduced && isFreshArrival(rowKey) ? ENTER_CLASS[messageAnimation] : undefined,
  );
  return cls;
}
