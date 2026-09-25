/**
 * Typed in-process domain event bus for cross-cutting consumers (web push, call cleanup…).
 *
 * Producers emit AFTER commit (via `Effects.domain(...)`, which runs after the socket
 * emits of the same transaction); consumers subscribe at import time:
 *
 *   domainEvents.on('message.created', ({ message, chat, recipientIds }) => { ...push... });
 *
 * Listeners run synchronously in registration order; a throwing listener (or a rejected
 * promise returned by an async listener) is logged and never affects the producer or the
 * other listeners. Long work (web push) should be fire-and-forget inside the listener.
 * Per process: with several instances each instance only sees its own events (v1 assumes a
 * single instance, see docs/ARCHITECTURE.md).
 */
import type { CallParticipantStatus, CallStatus, CallType, RingStopReason } from '@enbox/shared';
import type { ChatRow, MessageRow } from '../db/schema.js';
import { logger } from '../lib/logger.js';

export interface DomainEventMap {
  /**
   * A message was created (never for idempotent retries). `recipientIds` = active members
   * other than the sender who can see it (withheld recipients excluded; always [] for
   * channels, which never push). Push rules (system/call messages, mutes, settings) are the
   * consumer's job.
   */
  'message.created': { message: MessageRow; chat: ChatRow; recipientIds: string[]; withheldUserIds: string[] };
  /** The user's read position changed (`clearedUnread`: unread messages or the marked-unread flag were cleared → dismiss push). */
  'chat.read': { userId: string; chatId: string; lastReadSeq: number; clearedUnread: boolean };
  /** A user stopped being an active member of a chat (left, removed, unfollowed, hidden announcement row). Calls: forced leave. */
  'member.left': { chatId: string; userId: string; reason: 'left' | 'removed' | 'unfollowed' };
  /** Calls module: invitees were rung (`silentUserIds` ring silently: log only, no push). */
  'call.ringing': { callId: string; chatId: string; callerId: string; callType: CallType; isGroup: boolean; userIds: string[]; silentUserIds: string[] };
  /** Calls module: a user's ringing stopped (push `call_cancel`; body "Missed call" when `finalStatus` is missed). */
  'call.ring-stopped': { callId: string; chatId: string; userId: string; reason: RingStopReason; finalStatus: CallParticipantStatus };
  /** Calls module: a call reached a terminal status. */
  'call.ended': { callId: string; chatId: string; status: CallStatus; participantIds: string[] };
}

export type DomainEventName = keyof DomainEventMap;
type Listener<E extends DomainEventName> = (payload: DomainEventMap[E]) => void | Promise<void>;

class DomainEventBus {
  private readonly listeners = new Map<DomainEventName, Listener<DomainEventName>[]>();

  on<E extends DomainEventName>(event: E, listener: Listener<E>): () => void {
    const list = this.listeners.get(event) ?? [];
    list.push(listener as Listener<DomainEventName>);
    this.listeners.set(event, list);
    return () => this.off(event, listener);
  }

  off<E extends DomainEventName>(event: E, listener: Listener<E>): void {
    const list = this.listeners.get(event);
    if (!list) return;
    const i = list.indexOf(listener as Listener<DomainEventName>);
    if (i >= 0) list.splice(i, 1);
  }

  emit<E extends DomainEventName>(event: E, payload: DomainEventMap[E]): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) {
      try {
        const r = listener(payload);
        if (r && typeof (r as Promise<void>).catch === 'function') {
          (r as Promise<void>).catch((err) => logger.error({ err, event }, 'domain event listener failed'));
        }
      } catch (err) {
        logger.error({ err, event }, 'domain event listener failed');
      }
    }
  }

  /** Remove every listener (tests). */
  clear(): void {
    this.listeners.clear();
  }
}

export const domainEvents = new DomainEventBus();
