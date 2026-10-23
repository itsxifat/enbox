import { useEffect, useState } from 'react';

/** The time, refreshed every `ms` (pauses and timeouts that run out while shown). */
export function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
