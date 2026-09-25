/**
 * MediaStreams of the current call, kept OUT of zustand (not serializable). React reads them
 * with `useCallStream(id)` (useSyncExternalStore). Ids: `LOCAL_STREAM` for my preview, else
 * the remote participant's userId.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';

export const LOCAL_STREAM = 'local';

const streams = new Map<string, MediaStream>();
const listeners = new Set<() => void>();
let version = 0;

function emit(): void {
  version++;
  for (const l of [...listeners]) l();
}

export function setCallStream(id: string, stream: MediaStream | null): void {
  if (stream) streams.set(id, stream);
  else streams.delete(id);
  emit();
}

/** Tell subscribers that a stream's tracks changed (same object, new tracks). */
export function touchCallStreams(): void {
  emit();
}

export function getCallStream(id: string): MediaStream | null {
  return streams.get(id) ?? null;
}

export function clearCallStreams(): void {
  if (!streams.size) return;
  streams.clear();
  emit();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** The stream for `id`, re-rendering when streams (or their tracks) change. */
export function useCallStream(id: string | null | undefined): MediaStream | null {
  useSyncExternalStore(
    subscribe,
    () => version,
    () => version,
  );
  return id ? (streams.get(id) ?? null) : null;
}

/**
 * Whether `stream` currently carries a live, unmuted track of `kind` (remote video tracks
 * go `muted` when the sender stops sending, e.g. camera off via replaceTrack(null)).
 */
export function useTrackLive(stream: MediaStream | null, kind: 'audio' | 'video'): boolean {
  const compute = () => {
    const t = stream?.getTracks().find((x) => x.kind === kind);
    return !!t && t.readyState === 'live' && !t.muted;
  };
  const [live, setLive] = useState(compute);
  useEffect(() => {
    const update = () => setLive(compute());
    update();
    if (!stream) return;
    const tracks = new Set<MediaStreamTrack>();
    const bind = () => {
      for (const t of stream.getTracks()) {
        if (tracks.has(t)) continue;
        tracks.add(t);
        t.addEventListener('mute', update);
        t.addEventListener('unmute', update);
        t.addEventListener('ended', update);
      }
      update();
    };
    bind();
    stream.addEventListener('addtrack', bind);
    stream.addEventListener('removetrack', update);
    const unsubscribe = subscribe(bind);
    return () => {
      unsubscribe();
      stream.removeEventListener('addtrack', bind);
      stream.removeEventListener('removetrack', update);
      for (const t of tracks) {
        t.removeEventListener('mute', update);
        t.removeEventListener('unmute', update);
        t.removeEventListener('ended', update);
      }
    };
    // `compute` only reads `stream` and `kind`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream, kind]);
  return live;
}
