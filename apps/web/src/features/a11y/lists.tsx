/**
 * List semantics for virtualised lists (react-virtuoso `components`) and the message list's
 * name. MessageList makes its scroller the list (each row inside is an article,
 * messageRowA11y.ts); the Home sidebar uses `VirtualList`, named by its "Direct Messages" label.
 */
import { forwardRef } from 'react';
import type { ItemProps, ListProps } from 'react-virtuoso';
import type { ChatSummary } from '@enbox/shared';

/** "Messages in #general", "Messages in Weekend plans", "Messages with Ann". */
export function messageListLabel(chat: Pick<ChatSummary, 'type'>, title: string): string {
  if (chat.type === 'direct') return `Messages with ${title}`;
  return `Messages in ${chat.type === 'space_text' ? `#${title}` : title}`;
}

/** Virtuoso's item wrapper as a list item. */
export function VirtualListItem({
  item: _item,
  context: _context,
  ...props
}: ItemProps<unknown> & { context?: unknown }) {
  return <div {...props} role="listitem" />;
}

/** Virtuoso's items wrapper as a list, named by the element `context.listLabelId`. */
export const VirtualList = forwardRef<
  HTMLDivElement,
  ListProps & { context?: { listLabelId?: string } }
>(function VirtualList({ context, ...props }, ref) {
  return <div {...props} ref={ref} role="list" aria-labelledby={context?.listLabelId} />;
});
