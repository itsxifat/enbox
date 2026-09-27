/**
 * Offline outbox: sends that fail because the network is down stay "pending" (clock icon,
 * like WhatsApp) instead of failing, and are re-sent automatically when the connection is
 * back (`realtime:ready`) — matching the offline banner's "Messages will send when you
 * reconnect". Other errors mark the message failed (tap to retry) and show a toast.
 */

import { ApiError } from '@/lib/api';
import { bus } from '@/lib/bus';
import { newClientId } from '@/lib/ids';
import { registerSessionReset } from '@/lib/session';
import { useMessages } from '@/stores/messages';
import { toast } from '@/stores/ui';

export function isOfflineError(e) {
  return e instanceof ApiError && (e.code === 'network_error' || e.code === 'timeout');
}

const queue = new Map();
let timer = null;

/** Keep an optimistic message pending and re-run `run` after the next reconnect. */
export function holdForReconnect(chatId, clientId, run) {
  queue.set(clientId, { chatId, run });
  useMessages.getState().patchOptimistic(chatId, clientId, { pending: true, failed: false });
  // A transient HTTP failure without a socket reconnect: also retry periodically when online.
  timer ??= setInterval(() => {
    if (!queue.size) {
      if (timer) clearInterval(timer);
      timer = null;
    } else void flushOutbox();
  }, 15_000);
}

export function isQueued(clientId) {
  return queue.has(clientId);
}

export async function flushOutbox() {
  const jobs = [...queue.entries()];
  queue.clear();
  for (const [clientId, job] of jobs) {
    try {
      await job.run();
    } catch (e) {
      if (isOfflineError(e)) holdForReconnect(job.chatId, clientId, job.run);
      else {
        useMessages.getState().markFailed(job.chatId, clientId);
        toast.error(e);
      }
    }
  }
}

/**
 * `useMessages().sendMessage` with offline queueing and error toasts. Resolves with the
 * message, or null when it was queued/failed.
 */
export async function sendQueued(chatId, input, opts = {}) {
  const clientId = input.clientId ?? newClientId();
  try {
    return await useMessages.getState().sendMessage(chatId, { ...input, clientId }, opts);
  } catch (e) {
    if (isOfflineError(e))
      holdForReconnect(chatId, clientId, () =>
        useMessages.getState().retryMessage(chatId, clientId),
      );
    else toast.error(e);
    return null;
  }
}

bus.on('realtime:ready', () => void flushOutbox());

registerSessionReset(() => {
  queue.clear();
  if (timer) clearInterval(timer);
  timer = null;
});
