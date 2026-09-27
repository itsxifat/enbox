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

function createBus() {
  const handlers = new Map();

  return {
    on(event, handler) {
      let set = handlers.get(event);
      if (!set) handlers.set(event, (set = new Set()));
      const h = handler;
      set.add(h);
      return () => {
        set.delete(h);
      };
    },
    once(event, handler) {
      const off = this.on(event, (payload) => {
        off();
        handler(payload);
      });
      return off;
    },
    emit(event, ...args) {
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
    clear() {
      handlers.clear();
    },
  };
}

export const bus = createBus();
