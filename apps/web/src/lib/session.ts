/**
 * Session-scoped cleanup registry. Every store that holds per-account data registers a
 * reset; `resetSessionState()` runs them all on logout (so the next account starts clean).
 *
 *   registerSessionReset(() => useMyStore.setState(initialState));
 */
const resets = new Set<() => void>();

export function registerSessionReset(fn: () => void): () => void {
  resets.add(fn);
  return () => {
    resets.delete(fn);
  };
}

export function resetSessionState(): void {
  for (const fn of [...resets]) {
    try {
      fn();
    } catch (e) {
      console.error('[session] reset failed', e);
    }
  }
}
