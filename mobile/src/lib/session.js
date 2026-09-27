/**
 * Session-scoped cleanup registry. Every store that holds per-account data registers a
 * reset; `resetSessionState()` runs them all on logout (so the next account starts clean).
 *
 *   registerSessionReset(() => useMyStore.setState(initialState));
 *
 * `sessionEpoch()` changes on every reset. Async store actions capture it before awaiting a
 * request and drop the response when it changed, so a late response of the previous account
 * never lands in the next account's stores:
 *
 *   const epoch = sessionEpoch();
 *   const data = await api.get(...);
 *   if (epoch !== sessionEpoch()) return;
 */
const resets = new Set();
let epoch = 0;

export function registerSessionReset(fn) {
  resets.add(fn);
  return () => {
    resets.delete(fn);
  };
}

/** Changes whenever the session state is reset (logout, revoked or rejected token). */
export function sessionEpoch() {
  return epoch;
}

export function resetSessionState() {
  epoch++;
  for (const fn of [...resets]) {
    try {
      fn();
    } catch (e) {
      console.error('[session] reset failed', e);
    }
  }
}
