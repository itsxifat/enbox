/**
 * "N watching": viewers tell the room which streams they watch over LiveKit data messages
 * (topic STREAM_TOPIC, reliable; no server state). Each message is a full snapshot, so it is
 * idempotent and order-safe on the reliable channel:
 * - `{ type: 'watching', streams }` — broadcast whenever my watching set changes (also when it
 *   becomes empty), and sent to whoever asks;
 * - `{ type: 'sync' }` — "tell me what you watch", broadcast when I join a room with streams.
 * Anything malformed is ignored. Leaving the room drops a viewer from every stream (store).
 */
import { VOICE_MAX_PARTICIPANTS } from '@enbox/shared';

export const STREAM_TOPIC = 'enbox.stream';

export type StreamMessage = { type: 'watching'; streams: string[] } | { type: 'sync' };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encodeStreamMessage(msg: StreamMessage): Uint8Array<ArrayBuffer> {
  return encoder.encode(JSON.stringify(msg));
}

export function decodeStreamMessage(payload: Uint8Array): StreamMessage | null {
  let msg: unknown;
  try {
    msg = JSON.parse(decoder.decode(payload));
  } catch {
    return null;
  }
  if (!msg || typeof msg !== 'object') return null;
  const { type, streams } = msg as { type?: unknown; streams?: unknown };
  if (type === 'sync') return { type };
  if (
    type === 'watching' &&
    Array.isArray(streams) &&
    streams.length <= VOICE_MAX_PARTICIPANTS &&
    streams.every((s) => typeof s === 'string' && s.length <= 64)
  )
    return { type, streams: [...new Set(streams as string[])] };
  return null;
}
