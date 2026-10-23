/**
 * Fullscreen and picture-in-picture for stream tiles: what the browser offers, toggles, and the
 * element each mode shows now (live, through the document's change events).
 */
import { useSyncExternalStore } from 'react';

export function fullscreenSupported(): boolean {
  return typeof document !== 'undefined' && !!document.fullscreenEnabled;
}

/** Video picture-in-picture (not in Firefox, which has its own button on videos). */
export function pictureInPictureSupported(): boolean {
  return (
    typeof document !== 'undefined' &&
    !!document.pictureInPictureEnabled &&
    typeof HTMLVideoElement !== 'undefined' &&
    'requestPictureInPicture' in HTMLVideoElement.prototype
  );
}

/** Fullscreen `el`, or leave fullscreen when it is the one shown. */
export async function toggleFullscreen(el: Element | null): Promise<void> {
  if (!el) return;
  try {
    if (document.fullscreenElement === el) await document.exitFullscreen();
    else await el.requestFullscreen();
  } catch {
    // Refused (no user gesture, an iframe without allow="fullscreen"): nothing to undo.
  }
}

/** Pop `video` out, or back in when it is the one popped out. */
export async function togglePictureInPicture(video: HTMLVideoElement | null): Promise<void> {
  if (!video) return;
  try {
    if (document.pictureInPictureElement === video) await document.exitPictureInPicture();
    else await video.requestPictureInPicture();
  } catch {
    // Not ready (no frames yet) or refused.
  }
}

function documentStore(event: string, read: () => Element | null) {
  return {
    subscribe(onChange: () => void) {
      document.addEventListener(event, onChange, true);
      return () => document.removeEventListener(event, onChange, true);
    },
    read,
  };
}

const fullscreen = documentStore('fullscreenchange', () => document.fullscreenElement);
// `enterpictureinpicture` / `leavepictureinpicture` fire on the video and do not bubble (the
// listeners capture them).
const pipEnter = documentStore(
  'enterpictureinpicture',
  () => document.pictureInPictureElement ?? null,
);
const pipLeave = documentStore('leavepictureinpicture', () => null);
function subscribePip(onChange: () => void): () => void {
  const a = pipEnter.subscribe(onChange);
  const b = pipLeave.subscribe(onChange);
  return () => {
    a();
    b();
  };
}
const noElement = () => null;

/** The element shown fullscreen now (null: none). */
export function useFullscreenElement(): Element | null {
  return useSyncExternalStore(fullscreen.subscribe, fullscreen.read, noElement);
}

/** The video in picture-in-picture now (null: none). */
export function usePictureInPictureElement(): Element | null {
  return useSyncExternalStore(subscribePip, pipEnter.read, noElement);
}
