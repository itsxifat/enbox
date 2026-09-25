/**
 * One shared <audio> element for voice notes and audio files: starting one pauses the
 * other (WhatsApp behaviour); playback speed cycles 1× → 1.5× → 2×.
 */
import { create } from 'zustand';
import { registerSessionReset } from '@/lib/session';

export type PlaybackRate = 1 | 1.5 | 2;

interface PlayerState {
  id: string | null;
  playing: boolean;
  /** Seconds. */
  position: number;
  duration: number;
  rate: PlaybackRate;
  error: string | null;
}

export const usePlayer = create<PlayerState>(() => ({
  id: null,
  playing: false,
  position: 0,
  duration: 0,
  rate: 1,
  error: null,
}));

let audio: HTMLAudioElement | null = null;
let currentSrc: string | null = null;

function el(): HTMLAudioElement {
  if (audio) return audio;
  const a = new Audio();
  a.preload = 'metadata';
  a.addEventListener('timeupdate', () => usePlayer.setState({ position: a.currentTime }));
  a.addEventListener('loadedmetadata', () => {
    if (Number.isFinite(a.duration)) usePlayer.setState({ duration: a.duration });
  });
  a.addEventListener('durationchange', () => {
    if (Number.isFinite(a.duration)) usePlayer.setState({ duration: a.duration });
  });
  a.addEventListener('play', () => usePlayer.setState({ playing: true, error: null }));
  a.addEventListener('pause', () => usePlayer.setState({ playing: false }));
  a.addEventListener('ended', () => usePlayer.setState({ playing: false, position: 0 }));
  a.addEventListener('error', () =>
    usePlayer.setState({ playing: false, error: 'Could not play audio' }),
  );
  audio = a;
  return a;
}

/** Play/pause `id` (loading `src` when switching tracks). */
export function togglePlay(id: string, src: string, durationHintMs?: number | null): void {
  const a = el();
  const st = usePlayer.getState();
  if (st.id === id && currentSrc === src) {
    if (a.paused) void a.play().catch(() => usePlayer.setState({ playing: false }));
    else a.pause();
    return;
  }
  a.pause();
  currentSrc = src;
  a.src = src;
  a.playbackRate = st.rate;
  usePlayer.setState({
    id,
    position: 0,
    duration: durationHintMs ? durationHintMs / 1000 : 0,
    playing: false,
    error: null,
  });
  void a.play().catch(() => usePlayer.setState({ playing: false }));
}

/** Seek the active track (or start `id` at that point). `fraction` 0..1. */
export function seekTo(
  id: string,
  src: string,
  fraction: number,
  durationHintMs?: number | null,
): void {
  const a = el();
  if (usePlayer.getState().id !== id || currentSrc !== src) togglePlay(id, src, durationHintMs);
  const duration =
    Number.isFinite(a.duration) && a.duration > 0 ? a.duration : (durationHintMs ?? 0) / 1000;
  if (!duration) return;
  a.currentTime = Math.max(0, Math.min(duration, fraction * duration));
  usePlayer.setState({ position: a.currentTime });
}

export function cycleRate(): void {
  const next: PlaybackRate = ({ 1: 1.5, 1.5: 2, 2: 1 } as const)[usePlayer.getState().rate];
  if (audio) audio.playbackRate = next;
  usePlayer.setState({ rate: next });
}

export function stopPlayback(): void {
  audio?.pause();
  usePlayer.setState({ id: null, playing: false, position: 0 });
}

registerSessionReset(() => {
  stopPlayback();
  if (audio) audio.removeAttribute('src');
  currentSrc = null;
});
