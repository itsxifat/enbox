/**
 * Channel feed jumps (search results, starred messages link to `?m=<seq>&mid=<id>`). Pure
 * (unit-tested).
 */

/** A post to scroll to. */

export function jumpFromParams(params) {
  const seq = Number(params.get('m'));
  if (!Number.isInteger(seq) || seq <= 0) return null;
  return { seq, messageId: params.get('mid') ?? undefined };
}

/** Index of the jump target in the loaded posts (by id, else the first post at/after its seq). */
export function findPostIndex(items, t) {
  if (t.messageId) {
    const i = items.findIndex((m) => m.id === t.messageId);
    if (i >= 0) return i;
  }
  return items.findIndex((m) => m.seq > 0 && m.seq >= t.seq);
}
