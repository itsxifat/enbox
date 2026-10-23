/**
 * My reaction changes in flight (reactionActions.ts), per message, emoji and kind (normal or
 * super). Kept apart from the actions so the realtime handlers can ask without loading the
 * conversation code: while any change of mine to an emoji's kind runs, my own delta echoes
 * for it are skipped (the optimistic state already shows my intent). Changes to one emoji's
 * kind run in order, so a quick add-remove-add ends as the server's last state.
 */
import type { ID } from '@enbox/shared';
import { reactionKey } from './model';

const pending = new Map<string, number>();
const queues = new Map<string, Promise<void>>();
const keyOf = (messageId: ID, emoji: string, burst: boolean) =>
  `${messageId}|${burst ? 'burst' : 'normal'}|${reactionKey(emoji)}`;

/** A change of mine to this emoji (`burst`: its super reaction) is queued or in flight. */
export function hasPendingReaction(messageId: ID, emoji: string, burst = false): boolean {
  return (pending.get(keyOf(messageId, emoji, burst)) ?? 0) > 0;
}

/**
 * Run `run` (which must not reject) now, or after the previous change to the same emoji and
 * kind (`burst`: the super reaction).
 */
export function enqueueReaction(
  messageId: ID,
  emoji: string,
  run: () => Promise<void>,
  burst = false,
): Promise<void> {
  const key = keyOf(messageId, emoji, burst);
  pending.set(key, (pending.get(key) ?? 0) + 1);
  const prev = queues.get(key);
  const p: Promise<void> = (prev ? prev.then(run) : run()).finally(() => {
    const n = (pending.get(key) ?? 1) - 1;
    if (n > 0) pending.set(key, n);
    else pending.delete(key);
    if (queues.get(key) === p) queues.delete(key);
  });
  queues.set(key, p);
  return p;
}
