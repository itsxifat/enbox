/**
 * The microphones, speakers and cameras of this device for the voice settings, refreshed when
 * one is plugged in or out — and when `refresh` changes (granting access reveals their names).
 * Choices are device ids; '' is the system default.
 */
import { useEffect, useState } from 'react';
import { listDevices } from '@/features/calls/engine/media';

export interface DeviceChoice {
  /** '' = the system default. */
  id: string;
  label: string;
}

const NOUN: Record<MediaDeviceKind, string> = {
  audioinput: 'Microphone',
  audiooutput: 'Speaker',
  videoinput: 'Camera',
};

/**
 * "Default" first (Chromium names the device it stands for), then each device. Chromium's own
 * 'default' and 'communications' entries are the system defaults, not devices of their own.
 * A chosen device that is gone stays listed, so the choice shows.
 */
export function deviceChoices(
  kind: MediaDeviceKind,
  devices: readonly MediaDeviceInfo[],
  chosen = '',
): DeviceChoice[] {
  const system = devices
    .find((d) => d.deviceId === 'default')
    ?.label.replace(/^Default\s*-\s*/, '');
  const out: DeviceChoice[] = [{ id: '', label: system ? `Default (${system})` : 'Default' }];
  let n = 0;
  for (const d of devices) {
    if (!d.deviceId || d.deviceId === 'default' || d.deviceId === 'communications') continue;
    n += 1;
    out.push({ id: d.deviceId, label: d.label || `${NOUN[kind]} ${n}` });
  }
  if (chosen && !out.some((c) => c.id === chosen))
    out.push({ id: chosen, label: `${NOUN[kind]} (not connected)` });
  return out;
}

export function useMediaDevices(kind: MediaDeviceKind, refresh: unknown = 0): MediaDeviceInfo[] {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () =>
      void listDevices(kind).then((d) => {
        if (alive) setDevices(d);
      });
    load();
    navigator.mediaDevices?.addEventListener?.('devicechange', load);
    return () => {
      alive = false;
      navigator.mediaDevices?.removeEventListener?.('devicechange', load);
    };
  }, [kind, refresh]);
  return devices;
}
