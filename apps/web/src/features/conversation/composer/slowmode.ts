/**
 * Slowmode in the composer: in a Space chat with `slowmodeSeconds`, unless I have
 * MANAGE_MESSAGES or MANAGE_CHANNELS (the server's bypass), each message I send starts a
 * countdown until I may send the next one. It mirrors the server's timing — from my last
 * message there, or the moment I sent — and a refusal (429 "Slowmode is on: wait 12s…" from
 * another device or a skewed clock) starts it from the server's wait instead.
 */
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { PERM, hasAnyPerm, type ChatSummary, type ID, type Message } from '@enbox/shared';
import { ApiError } from '@/lib/api';
import { newClientId } from '@/lib/ids';
import { registerSessionReset } from '@/lib/session';
import { handleAutoModBlock } from '@/features/spaces/automod/blocked';
import { useMessages, type ClientMessage, type SendInput } from '@/stores/messages';
import { toast } from '@/stores/ui';
import { holdForReconnect, isOfflineError } from '../lib/outbox';

/** chatId → when I may send there again (ms), from my own sends and the server's refusals. */
export const useSlowmode = create<{ until: Record<ID, number> }>(() => ({ until: {} }));

registerSessionReset(() => useSlowmode.setState({ until: {} }));

function holdUntil(chatId: ID, until: number): void {
  useSlowmode.setState((s) =>
    (s.until[chatId] ?? 0) >= until ? s : { until: { ...s.until, [chatId]: until } },
  );
}

/** I just sent in a slowmode chat: wait `seconds` from now. */
export function noteSlowmodeSend(chatId: ID, seconds: number, now = Date.now()): void {
  holdUntil(chatId, now + seconds * 1000);
}

/** Seconds a slowmode refusal asks to wait (429 "Slowmode is on: wait 12s…"), else null. */
export function slowmodeWait(e: unknown): number | null {
  if (!(e instanceof ApiError) || e.status !== 429) return null;
  const m = /^Slowmode\b.*?\bwait (\d+)s/i.exec(e.message);
  return m ? Number(m[1]) : null;
}

/** "0:42", "12:00", "1:00:00". */
export function formatCooldown(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Whether slowmode applies to me in this chat (seconds, 0 = it doesn't). */
export function slowmodeSecondsFor(chat: Pick<ChatSummary, 'space' | 'spacePermissions'>): number {
  const seconds = chat.space?.slowmodeSeconds ?? 0;
  if (seconds <= 0) return 0;
  return hasAnyPerm(chat.spacePermissions, PERM.MANAGE_MESSAGES | PERM.MANAGE_CHANNELS)
    ? 0
    : seconds;
}

/** When my latest confirmed message in the list was sent (ms; 0 = none loaded). */
export function lastSentAt(
  items: readonly ClientMessage[] | undefined,
  meId: ID | undefined,
): number {
  if (!items || !meId) return 0;
  for (let i = items.length - 1; i >= 0; i--) {
    const m = items[i]!;
    if (m.senderId === meId && !m.pending && !m.failed && m.type !== 'system')
      return Date.parse(m.createdAt) || 0;
  }
  return 0;
}

/**
 * The chat's slowmode for me: `seconds` (0 = none) and `left`, the seconds until I may send
 * again (0 = now), ticking every second while it counts down.
 */
export function useChatSlowmode(
  chat: ChatSummary,
  meId: ID | undefined,
): { seconds: number; left: number } {
  const seconds = slowmodeSecondsFor(chat);
  const last = useMessages((s) => (seconds ? lastSentAt(s.byChat[chat.id]?.items, meId) : 0));
  const held = useSlowmode((s) => (seconds ? (s.until[chat.id] ?? 0) : 0));
  const until = Math.max(held, last ? last + seconds * 1000 : 0);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until <= Date.now()) return;
    setNow(Date.now());
    const timer = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= until) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [until]);
  return { seconds, left: until > now ? Math.ceil((until - now) / 1000) : 0 };
}

/**
 * A send in a slowmode chat: `sendQueued` (lib/outbox), except that a slowmode refusal drops
 * the optimistic copy, starts the countdown from the server's wait and resolves 'slowmode'
 * (the composer gives the text back).
 */
export async function sendSlowmoded(
  chatId: ID,
  input: SendInput,
  opts: { optimistic?: Partial<ClientMessage> } = {},
): Promise<Message | null | 'slowmode'> {
  const clientId = input.clientId ?? newClientId();
  try {
    return await useMessages.getState().sendMessage(chatId, { ...input, clientId }, opts);
  } catch (e) {
    const wait = slowmodeWait(e);
    if (wait !== null) {
      useMessages.getState().removeOptimistic(chatId, clientId);
      holdUntil(chatId, Date.now() + wait * 1000);
      toast.error(e, { id: 'slowmode' });
      return 'slowmode';
    }
    if (isOfflineError(e))
      holdForReconnect(chatId, clientId, () =>
        useMessages.getState().retryMessage(chatId, clientId),
      );
    else if (!handleAutoModBlock(chatId, clientId, e)) toast.error(e);
    return null;
  }
}
