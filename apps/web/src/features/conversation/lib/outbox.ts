/**
 * Offline outbox: sends that fail because the network is down stay "pending" (clock icon,
 * like WhatsApp) instead of failing, and are re-sent automatically when the connection is
 * back (`realtime:ready`) — matching the offline banner's "Messages will send when you
 * reconnect". Other errors mark the message failed (tap to retry) and show a toast.
 */
import type { ID, Message } from '@enbox/shared';
import { ApiError } from '@/lib/api';
import { bus } from '@/lib/bus';
import { newClientId } from '@/lib/ids';
import { registerSessionReset } from '@/lib/session';
import { handleAutoModBlock } from '@/features/spaces/automod/blocked';
import { useMessages, type ClientMessage, type SendInput } from '@/stores/messages';
import { toast } from '@/stores/ui';

export function isOfflineError(e: unknown): boolean {
  return e instanceof ApiError && (e.code === 'network_error' || e.code === 'timeout');
}

const queue = new Map<string, { chatId: ID; run: () => Promise<unknown> }>();
let timer: ReturnType<typeof setInterval> | null = null;

/** Keep an optimistic message pending and re-run `run` after the next reconnect. */
export function holdForReconnect(chatId: ID, clientId: string, run: () => Promise<unknown>): void {
  queue.set(clientId, { chatId, run });
  useMessages.getState().patchOptimistic(chatId, clientId, { pending: true, failed: false });
  // A transient HTTP failure without a socket reconnect: also retry periodically when online.
  timer ??= setInterval(() => {
    if (!queue.size) {
      if (timer) clearInterval(timer);
      timer = null;
    } else if (navigator.onLine) void flushOutbox();
  }, 15_000);
}

export function isQueued(clientId: string): boolean {
  return queue.has(clientId);
}

export async function flushOutbox(): Promise<void> {
  const jobs = [...queue.entries()];
  queue.clear();
  for (const [clientId, job] of jobs) {
    try {
      await job.run();
    } catch (e) {
      if (isOfflineError(e)) holdForReconnect(job.chatId, clientId, job.run);
      else if (!handleAutoModBlock(job.chatId, clientId, e)) {
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
export async function sendQueued(
  chatId: ID,
  input: SendInput,
  opts: { optimistic?: Partial<ClientMessage> } = {},
): Promise<Message | null> {
  const clientId = input.clientId ?? newClientId();
  try {
    return await useMessages.getState().sendMessage(chatId, { ...input, clientId }, opts);
  } catch (e) {
    if (isOfflineError(e))
      holdForReconnect(chatId, clientId, () =>
        useMessages.getState().retryMessage(chatId, clientId),
      );
    // AutoMod refused it: no failed bubble, the composer explains (features/spaces/automod).
    else if (!handleAutoModBlock(chatId, clientId, e)) toast.error(e);
    return null;
  }
}

bus.on('realtime:ready', () => void flushOutbox());

registerSessionReset(() => {
  queue.clear();
  if (timer) clearInterval(timer);
  timer = null;
});
