/** WebRTC in the web preview: the browser's own APIs; video renders in a <video> element. */
import { useEffect, useRef } from 'react';

export const isNativeWebRTC = false;

export function engineOptions() {
  return {};
}

export function startCallAudio() {}
export function stopCallAudio() {}
export function setSpeakerOn() {}
export const speakerToggleSupported = false;

/** `RTCView` look-alike: `stream` (a MediaStream) instead of a stream URL. */
export function RTCView({ stream, objectFit = 'cover', mirror, style }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream ?? null;
  }, [stream]);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted
      style={{
        width: '100%',
        height: '100%',
        objectFit,
        transform: mirror ? 'scaleX(-1)' : undefined,
        ...(Array.isArray(style) ? Object.assign({}, ...style) : style),
      }}
    />
  );
}
