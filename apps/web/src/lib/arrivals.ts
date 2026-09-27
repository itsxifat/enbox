/**
 * Which message rows arrived live (README "Chat themes & animations" → enter animations).
 * `addOptimistic` and `handleNewMessage` mark a row key when a message is created or comes
 * in over the socket; a row reads `isFreshArrival` once when it mounts and animates only
 * when the mark is younger than the window. History loads, scroll-back, resyncs and list
 * remounts never mark anything (a window replacement clears the marks), so they never
 * animate. The map is bounded: a burst of arrivals evicts the oldest marks.
 */

/** Maximum age of a mark for a row to count as a live arrival. */
export const ARRIVAL_WINDOW_MS = 1500;
const MAX_MARKS = 64;

const marks = new Map<string, number>();

/** The row key of a message (must match `rowKey` in features/conversation/lib/rows.ts). */
export function arrivalKey(m: { id: string; clientId?: string | null }): string {
  return m.clientId ? `c:${m.clientId}` : m.id;
}

export function markArrival(key: string, now = Date.now()): void {
  marks.delete(key);
  marks.set(key, now);
  while (marks.size > MAX_MARKS) {
    const oldest = marks.keys().next().value;
    if (oldest === undefined) break;
    marks.delete(oldest);
  }
}

export function isFreshArrival(key: string, now = Date.now()): boolean {
  const at = marks.get(key);
  if (at === undefined) return false;
  if (now - at > ARRIVAL_WINDOW_MS) {
    marks.delete(key);
    return false;
  }
  return true;
}

/** Forget every mark (a list window replacement: nothing in the new window arrived live). */
export function clearArrivals(): void {
  marks.clear();
}
