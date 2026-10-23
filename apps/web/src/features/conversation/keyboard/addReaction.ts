/**
 * Add Reaction of each row toolbar on screen, by message id: + on a focused message opens it
 * as the toolbar's button does (MessageRow `RowToolbar` registers it while mounted).
 */
import type { ID } from '@enbox/shared';

const openers = new Map<ID, () => void>();

/** Register a row's Add Reaction; returns the unregister. */
export function registerAddReaction(messageId: ID, open: () => void): () => void {
  openers.set(messageId, open);
  return () => {
    if (openers.get(messageId) === open) openers.delete(messageId);
  };
}

/** Open a message's Add Reaction; false when no toolbar of it offers one. */
export function openAddReaction(messageId: ID): boolean {
  const open = openers.get(messageId);
  open?.();
  return !!open;
}
