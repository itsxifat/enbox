/**
 * Go Live quality (Settings → Voice & Video → Screen share quality), per device: Auto or one
 * of the shared STREAM_PRESETS. A preset caps the capture (`getDisplayMedia` resolution and
 * frame rate) and the published encoding (bitrate, frame rate); 60 FPS asks the encoder to keep
 * the frame rate (games) rather than the detail (text). Auto keeps the media library's defaults.
 */
import { create } from 'zustand';
import type { ScreenShareCaptureOptions, TrackPublishOptions } from 'livekit-client';
import { STREAM_PRESETS, type StreamPreset } from '@enbox/shared';
import { storage } from '@/lib/storage';

export type StreamQuality = 'auto' | StreamPreset;

export const STREAM_QUALITIES: readonly { value: StreamQuality; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: '720p30', label: '720p 30 FPS' },
  { value: '1080p30', label: '1080p 30 FPS' },
  { value: '1080p60', label: '1080p 60 FPS' },
];

export function isStreamQuality(v: unknown): v is StreamQuality {
  return STREAM_QUALITIES.some((q) => q.value === v);
}

export interface ScreenShareOptions {
  capture: ScreenShareCaptureOptions;
  /** None: the room's publish defaults. */
  publish?: TrackPublishOptions;
}

/** What `setScreenShareEnabled(true, capture, publish)` gets for a quality. Tab audio always. */
export function screenShareOptions(quality: StreamQuality): ScreenShareOptions {
  if (quality === 'auto') return { capture: { audio: true } };
  const p = STREAM_PRESETS[quality];
  const motion = p.fps >= 60;
  return {
    capture: {
      audio: true,
      resolution: { width: p.width, height: p.height, frameRate: p.fps },
      ...(motion ? { contentHint: 'motion' as const } : {}),
    },
    publish: {
      screenShareEncoding: { maxBitrate: p.maxBitrate, maxFramerate: p.fps },
      ...(motion ? { degradationPreference: 'maintain-framerate' as const } : {}),
    },
  };
}

const KEY = 'enbox.stream.quality';

interface StreamQualityState {
  quality: StreamQuality;
  setQuality(quality: StreamQuality): void;
}

function saved(): StreamQuality {
  const v = storage.get(KEY);
  return isStreamQuality(v) ? v : 'auto';
}

/** The chosen quality (localStorage `enbox.stream.quality`; it survives logout like the device prefs). */
export const useStreamQuality = create<StreamQualityState>((set) => ({
  quality: saved(),
  setQuality(quality) {
    storage.set(KEY, quality);
    set({ quality });
  },
}));
