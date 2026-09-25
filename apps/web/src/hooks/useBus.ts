import { useEffect, useRef } from 'react';
import { bus, type BusEventName, type BusEvents } from '@/lib/bus';

type Handler<K extends BusEventName> = BusEvents[K] extends void
  ? () => void
  : (payload: BusEvents[K]) => void;

/** Subscribe to a bus event for the lifetime of the component (handler may change freely). */
export function useBus<K extends BusEventName>(event: K, handler: Handler<K>): void {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => {
    const fn = ((payload?: unknown) =>
      (ref.current as (p?: unknown) => void)(payload)) as Handler<K>;
    return bus.on(event, fn);
  }, [event]);
}
