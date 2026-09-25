/**
 * Tiny typed in-app event bus for UI signals that don't belong in a store
 * ("refetch the member list if it's open", "contacts changed", call signaling fan-out...).
 *
 *   const off = bus.on('chat:members-changed', ({ chatId }) => { ... });
 *   bus.emit('chat:members-changed', { chatId });
 *   useBus('contacts:changed', () => refetch());   // hook: src/hooks/useBus.ts
 *
 * Add new events to `BusEvents` (append-only; keep payloads small and serializable).
 */
import type {
  Call,
  CallMediaStatePayload,
  CallSignal,
  CallStatus,
  ID,
  IncomingCallPayload,
  RingStopReason,
  Status,
  StatusViewer,
  UserPublic,
} from '@enbox/shared';

export interface BusEvents {
  // --- Realtime lifecycle ---
  /** Socket authenticated & rooms joined; core resync (chats, open chat) has been triggered. */
  'realtime:ready': { userId: ID; sessionId: ID; reconnect: boolean };

  // --- Chats / users ---
  'chat:members-changed': { chatId: ID };
  'user:changed': { userId: ID };
  'contacts:changed': void;
  'blocks:changed': void;

  // --- Status (forwarded socket events; the status store also applies them) ---
  'status:new': { status: Status; user: UserPublic };
  'status:deleted': { statusId: ID; userId: ID };
  'status:viewed': { statusId: ID; viewer: StatusViewer };

  // --- Calls (forwarded socket events; see realtime/calls.ts) ---
  'call:incoming': IncomingCallPayload;
  'call:updated': { call: Call };
  'call:participant-joined': { callId: ID; userId: ID };
  'call:participant-left': { callId: ID; userId: ID };
  'call:signal': { callId: ID; fromUserId: ID; signal: CallSignal };
  'call:media': CallMediaStatePayload & { userId: ID };
  'call:ended': { callId: ID; status: CallStatus; call: Call };
  /** Stop ringing on this device (answered/declined elsewhere, timeout, cancelled, ended). */
  'call:ring-stop': { callId: ID; reason: RingStopReason };

  // --- Navigation ---
  /** Ask the router to navigate (used by notifications / service worker clicks). */
  navigate: { to: string; replace?: boolean };
}

export type BusEventName = keyof BusEvents;
type Handler<K extends BusEventName> = BusEvents[K] extends void
  ? () => void
  : (payload: BusEvents[K]) => void;
type EmitArgs<K extends BusEventName> = BusEvents[K] extends void ? [] : [payload: BusEvents[K]];

function createBus() {
  const handlers = new Map<BusEventName, Set<(payload?: unknown) => void>>();

  return {
    on<K extends BusEventName>(event: K, handler: Handler<K>): () => void {
      let set = handlers.get(event);
      if (!set) handlers.set(event, (set = new Set()));
      const h = handler as (payload?: unknown) => void;
      set.add(h);
      return () => {
        set.delete(h);
      };
    },
    once<K extends BusEventName>(event: K, handler: Handler<K>): () => void {
      const off = this.on(event, ((payload?: unknown) => {
        off();
        (handler as (payload?: unknown) => void)(payload);
      }) as Handler<K>);
      return off;
    },
    emit<K extends BusEventName>(event: K, ...args: EmitArgs<K>): void {
      const set = handlers.get(event);
      if (!set) return;
      for (const h of [...set]) {
        try {
          h(args[0]);
        } catch (e) {
          console.error(`[bus] handler for "${event}" failed`, e);
        }
      }
    },
    /** Remove every handler (tests). */
    clear(): void {
      handlers.clear();
    },
  };
}

export const bus = createBus();
