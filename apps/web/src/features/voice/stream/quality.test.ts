/**
 * Screen share quality → capture and publish options: Auto keeps the media library's defaults
 * (tab audio only), each preset caps the capture and the encoding at its size, frame rate and
 * bitrate (60 FPS keeps the frame rate); the choice is kept on this device.
 */
import { describe, expect, it } from 'vitest';
import { STREAM_PRESETS } from '@enbox/shared';
import { STREAM_QUALITIES, isStreamQuality, screenShareOptions, useStreamQuality } from './quality';

describe('screen share quality', () => {
  it('Auto: tab audio, default capture and encoding', () => {
    expect(screenShareOptions('auto')).toEqual({ capture: { audio: true } });
  });

  it('720p30 and 1080p30: the preset caps the capture and the encoding', () => {
    expect(screenShareOptions('720p30')).toEqual({
      capture: { audio: true, resolution: { width: 1280, height: 720, frameRate: 30 } },
      publish: {
        screenShareEncoding: { maxBitrate: STREAM_PRESETS['720p30'].maxBitrate, maxFramerate: 30 },
      },
    });
    expect(screenShareOptions('1080p30')).toEqual({
      capture: { audio: true, resolution: { width: 1920, height: 1080, frameRate: 30 } },
      publish: {
        screenShareEncoding: { maxBitrate: STREAM_PRESETS['1080p30'].maxBitrate, maxFramerate: 30 },
      },
    });
  });

  it('1080p60: motion content that keeps its frame rate', () => {
    expect(screenShareOptions('1080p60')).toEqual({
      capture: {
        audio: true,
        resolution: { width: 1920, height: 1080, frameRate: 60 },
        contentHint: 'motion',
      },
      publish: {
        screenShareEncoding: { maxBitrate: STREAM_PRESETS['1080p60'].maxBitrate, maxFramerate: 60 },
        degradationPreference: 'maintain-framerate',
      },
    });
  });

  it('offers Auto and every preset, and remembers the choice', () => {
    expect(STREAM_QUALITIES.map((q) => q.value)).toEqual(['auto', ...Object.keys(STREAM_PRESETS)]);
    expect(isStreamQuality('1080p60')).toBe(true);
    expect(isStreamQuality('4k')).toBe(false);
    useStreamQuality.getState().setQuality('1080p60');
    expect(useStreamQuality.getState().quality).toBe('1080p60');
    expect(localStorage.getItem('enbox.stream.quality')).toBe('1080p60');
  });
});
