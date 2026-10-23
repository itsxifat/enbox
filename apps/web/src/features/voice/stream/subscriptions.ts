/**
 * Watch to subscribe: the voice room connects without auto-subscribe, and the engine asks for
 * each remote publication as it appears. Microphones and cameras (and anything else) are
 * always wanted, as before; a stream — screen video and its tab audio — only while I watch it.
 * Written against the few publication fields it uses, so it runs on fakes in tests.
 */
import { Track } from 'livekit-client';

export interface WatchablePublication {
  source: Track.Source;
  /** I asked for it (or nothing was asked yet under auto-subscribe). */
  isDesired: boolean;
  setSubscribed(subscribed: boolean): void;
}

export interface WatchableParticipant {
  identity: string;
  trackPublications: ReadonlyMap<string, WatchablePublication>;
}

/** A stream's tracks: the shared screen and the tab audio that goes with it. */
export function isStreamSource(source: Track.Source): boolean {
  return source === Track.Source.ScreenShare || source === Track.Source.ScreenShareAudio;
}

/** Whether I want this publication: everything but a stream, and a stream while I watch it. */
export function wantsPublication(
  pub: Pick<WatchablePublication, 'source'>,
  watching: boolean,
): boolean {
  return watching || !isStreamSource(pub.source);
}

/** Subscribe to (or drop) one publication as wanted; nothing when it already is. */
export function syncPublication(pub: WatchablePublication, watching: boolean): void {
  const want = wantsPublication(pub, watching);
  if (pub.isDesired !== want) pub.setSubscribed(want);
}

/** Every publication of a participant, `watching` their stream or not. */
export function syncParticipant(p: WatchableParticipant, watching: boolean): void {
  for (const pub of p.trackPublications.values()) syncPublication(pub, watching);
}

/** Someone shares their screen (a remote screen publication, subscribed or not). */
export function isStreaming(p: {
  trackPublications?: ReadonlyMap<string, { source: Track.Source }>;
}): boolean {
  for (const pub of p.trackPublications?.values() ?? [])
    if (pub.source === Track.Source.ScreenShare) return true;
  return false;
}
