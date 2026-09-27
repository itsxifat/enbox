import { useEffect, useState } from 'react';

/** `value` after it stopped changing for `delayMs` (search inputs). */
export function useDebouncedValue(value, delayMs = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}
