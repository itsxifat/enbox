/**
 * Local media helpers for calls: microphone/camera/screen capture with friendly errors,
 * device enumeration and output-device support detection. No state lives here.
 */

export type CaptureDevice = 'microphone' | 'camera' | 'screen';

export type MediaErrorKind =
  'permission' | 'not_found' | 'in_use' | 'insecure' | 'unsupported' | 'cancelled' | 'unknown';

/** A capture failure with a user-facing message. */
export class MediaAccessError extends Error {
  readonly kind: MediaErrorKind;
  readonly device: CaptureDevice;

  constructor(kind: MediaErrorKind, device: CaptureDevice, message: string) {
    super(message);
    this.name = 'MediaAccessError';
    this.kind = kind;
    this.device = device;
  }
}

const DEVICE_LABEL: Record<CaptureDevice, string> = {
  microphone: 'microphone',
  camera: 'camera',
  screen: 'screen',
};

/** Classify a DOMException from getUserMedia/getDisplayMedia. */
export function classifyMediaError(err: unknown): MediaErrorKind {
  const name = (err as { name?: string } | null)?.name ?? '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'permission';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return 'not_found';
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'in_use';
    case 'TypeError':
      return 'unsupported';
    default:
      return 'unknown';
  }
}

/** Human text for a capture failure, e.g. "Allow microphone access to make calls". */
export function mediaErrorMessage(kind: MediaErrorKind, device: CaptureDevice): string {
  const label = DEVICE_LABEL[device];
  switch (kind) {
    case 'permission':
      return device === 'screen'
        ? 'Screen sharing is blocked. Allow screen recording for your browser in your system settings.'
        : `Allow ${label} access in your browser settings to use calls`;
    case 'not_found':
      return device === 'microphone' ? 'No microphone found' : `No ${label} found`;
    case 'in_use':
      return `Your ${label} is being used by another app`;
    case 'insecure':
      return 'Calls need a secure (https) connection';
    case 'unsupported':
      return device === 'screen'
        ? 'Screen sharing is not supported in this browser'
        : 'Calls are not supported in this browser';
    case 'cancelled':
      return 'Cancelled';
    default:
      return `Couldn't access your ${label}`;
  }
}

/**
 * Screen capture: closing the picker surfaces as a plain `NotAllowedError` (cancelled, no
 * message). A block by the OS (macOS Screen Recording permission: "Permission denied by
 * system") or by a Permissions-Policy (`SecurityError`) must be reported, or the button
 * looks dead.
 */
function screenErrorKind(err: unknown, kind: MediaErrorKind): MediaErrorKind {
  if (kind !== 'permission') return kind;
  const e = err as { name?: string; message?: string } | null;
  if (e?.name === 'SecurityError') return 'permission';
  if (/system/i.test(e?.message ?? '')) return 'permission';
  return 'cancelled';
}

export function toMediaAccessError(err: unknown, device: CaptureDevice): MediaAccessError {
  if (err instanceof MediaAccessError) return err;
  const kind = classifyMediaError(err);
  const k = device === 'screen' ? screenErrorKind(err, kind) : kind;
  return new MediaAccessError(k, device, mediaErrorMessage(k, device));
}

function mediaDevices(): MediaDevices | null {
  if (typeof navigator === 'undefined') return null;
  return navigator.mediaDevices ?? null;
}

export function callsSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.RTCPeerConnection === 'function' &&
    typeof mediaDevices()?.getUserMedia === 'function'
  );
}

function assertCapture(device: CaptureDevice): MediaDevices {
  const md = mediaDevices();
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    throw new MediaAccessError('insecure', device, mediaErrorMessage('insecure', device));
  }
  if (!md?.getUserMedia) {
    throw new MediaAccessError('unsupported', device, mediaErrorMessage('unsupported', device));
  }
  return md;
}

export const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

export interface CameraOptions {
  facingMode?: 'user' | 'environment';
  deviceId?: string;
  /** Lower resolution for group (mesh) calls. */
  compact?: boolean;
}

export function videoConstraints(opts: CameraOptions = {}): MediaTrackConstraints {
  const size = opts.compact
    ? { width: { ideal: 640 }, height: { ideal: 480 } }
    : { width: { ideal: 1280 }, height: { ideal: 720 } };
  return {
    ...size,
    frameRate: { ideal: 24, max: 30 },
    ...(opts.deviceId
      ? { deviceId: { exact: opts.deviceId } }
      : { facingMode: opts.facingMode ?? 'user' }),
  };
}

/** Microphone stream (required for every call). */
export async function getMicrophoneStream(): Promise<MediaStream> {
  const md = assertCapture('microphone');
  try {
    return await md.getUserMedia({ audio: AUDIO_CONSTRAINTS, video: false });
  } catch (e) {
    throw toMediaAccessError(e, 'microphone');
  }
}

/** A single camera track. */
export async function getCameraTrack(opts: CameraOptions = {}): Promise<MediaStreamTrack> {
  const md = assertCapture('camera');
  try {
    const stream = await md.getUserMedia({ audio: false, video: videoConstraints(opts) });
    const track = stream.getVideoTracks()[0];
    if (!track)
      throw new MediaAccessError('not_found', 'camera', mediaErrorMessage('not_found', 'camera'));
    return track;
  } catch (e) {
    throw toMediaAccessError(e, 'camera');
  }
}

export function screenShareSupported(): boolean {
  const md = mediaDevices();
  return !!md && typeof md.getDisplayMedia === 'function';
}

/** A screen/window/tab capture track (user picks in the browser dialog). */
export async function getScreenTrack(): Promise<MediaStreamTrack> {
  const md = mediaDevices();
  if (!md?.getDisplayMedia) {
    throw new MediaAccessError('unsupported', 'screen', mediaErrorMessage('unsupported', 'screen'));
  }
  try {
    const stream = await md.getDisplayMedia({ video: { frameRate: { ideal: 15 } }, audio: false });
    const track = stream.getVideoTracks()[0];
    if (!track) throw new MediaAccessError('cancelled', 'screen', 'Cancelled');
    track.contentHint = 'detail';
    return track;
  } catch (e) {
    throw toMediaAccessError(e, 'screen');
  }
}

export async function listDevices(kind: MediaDeviceKind): Promise<MediaDeviceInfo[]> {
  const md = mediaDevices();
  if (!md?.enumerateDevices) return [];
  try {
    return (await md.enumerateDevices()).filter((d) => d.kind === kind);
  } catch {
    return [];
  }
}

/** Audio output selection (`HTMLMediaElement.setSinkId`) — Chromium desktop/Android. */
export function outputSelectionSupported(): boolean {
  return typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
}

export function stopStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((t) => t.stop());
}
