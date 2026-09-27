import { useEffect, useRef } from 'react';
import { bus } from '@/lib/bus';

/** Subscribe to a bus event for the lifetime of the component (handler may change freely). */
export function useBus(event, handler) {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => {
    const fn = (payload) => ref.current(payload);
    return bus.on(event, fn);
  }, [event]);
}
