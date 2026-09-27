/**
 * One shared player for voice notes and audio files (web lib/audioPlayer.ts): starting one
 * pauses the other (WhatsApp behaviour); playback speed cycles 1× → 1.5× → 2×.
 * Backed by expo-audio.
 */
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { create } from 'zustand';
import { registerSessionReset } from '@/lib/session';

export const usePlayer = create(() => ({
  id: null,
  playing: false,
  /** Seconds. */
  position: 0,
  duration: 0,
  rate: 1,
  error: null,
}));

let player = null;
let sub = null;
let currentSrc = null;
let modeSet = false;

function ensure() {
  if (!modeSet) {
    modeSet = true;
    void setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: false }).catch(
      () => undefined,
    );
  }
  if (player) return player;
  player = createAudioPlayer(null, { updateInterval: 100 });
  sub = player.addListener('playbackStatusUpdate', (s) => {
    const patch = { playing: !!s.playing };
    if (Number.isFinite(s.currentTime)) patch.position = s.currentTime;
    if (Number.isFinite(s.duration) && s.duration > 0) patch.duration = s.duration;
    if (s.didJustFinish) {
      patch.playing = false;
      patch.position = 0;
      void player.seekTo(0).catch(() => undefined);
      player.pause();
    }
    usePlayer.setState(patch);
  });
  return player;
}

function load(id, src, durationHintMs) {
  const p = ensure();
  p.pause();
  currentSrc = src;
  p.replace({ uri: src });
  const { rate } = usePlayer.getState();
  try {
    p.setPlaybackRate(rate, 'high');
  } catch {
    /* rate unsupported */
  }
  usePlayer.setState({
    id,
    position: 0,
    duration: durationHintMs ? durationHintMs / 1000 : 0,
    playing: false,
    error: null,
  });
  return p;
}

/** Play/pause `id` (loading `src` when switching tracks). */
export function togglePlay(id, src, durationHintMs) {
  const st = usePlayer.getState();
  if (player && st.id === id && currentSrc === src) {
    if (player.playing) player.pause();
    else player.play();
    return;
  }
  load(id, src, durationHintMs).play();
}

/** Seek the active track (or start `id` at that point). `fraction` 0..1. */
export function seekTo(id, src, fraction, durationHintMs) {
  const st = usePlayer.getState();
  let p = player;
  if (!p || st.id !== id || currentSrc !== src) {
    p = load(id, src, durationHintMs);
    p.play();
  }
  const duration = usePlayer.getState().duration || (durationHintMs ?? 0) / 1000;
  if (!duration) return;
  const at = Math.max(0, Math.min(duration, fraction * duration));
  usePlayer.setState({ position: at });
  void p.seekTo(at).catch(() => undefined);
}

export function cycleRate() {
  const next = { 1: 1.5, 1.5: 2, 2: 1 }[usePlayer.getState().rate] ?? 1;
  usePlayer.setState({ rate: next });
  try {
    player?.setPlaybackRate(next, 'high');
  } catch {
    /* rate unsupported */
  }
}

export function stopPlayback() {
  player?.pause();
  usePlayer.setState({ id: null, playing: false, position: 0, duration: 0 });
}

registerSessionReset(() => {
  stopPlayback();
  sub?.remove();
  sub = null;
  player?.remove();
  player = null;
  currentSrc = null;
});
