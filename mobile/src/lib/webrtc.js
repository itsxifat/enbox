/**
 * WebRTC on Android (react-native-webrtc): installs the W3C globals (RTCPeerConnection,
 * MediaStream, navigator.mediaDevices…) the web client's call engine is written against,
 * plus the native bits the browser does for free — remote audio playback is automatic, the
 * audio route (earpiece / speaker / Bluetooth) and screen-on come from InCallManager.
 * The web preview uses lib/webrtc.web.js.
 */
import InCallManager from 'react-native-incall-manager';
import { RTCView, registerGlobals } from 'react-native-webrtc';

registerGlobals();

export { RTCView };
export const isNativeWebRTC = true;

/** A stand-in for the web engine's hidden <audio> elements: native tracks play by themselves. */
function nativeAudioSink() {
  return {
    autoplay: true,
    hidden: true,
    dataset: {},
    srcObject: null,
    muted: false,
    volume: 1,
    play: () => Promise.resolve(),
    pause() {},
    remove() {},
    setSinkId: () => Promise.resolve(),
  };
}

/** Active-speaker detection needs WebAudio; natively the highlight follows mute state only. */
const noMonitor = { add() {}, remove() {}, stop() {} };

/** Extra `CallEngine` options for this platform. */
export function engineOptions() {
  return { createAudioSink: nativeAudioSink, monitor: noMonitor };
}

let audioSession = false;

/** Route call audio (earpiece for voice, speaker for video) and keep the screen on. */
export function startCallAudio(video) {
  try {
    if (!audioSession) InCallManager.start({ media: video ? 'video' : 'audio', auto: true });
    audioSession = true;
    InCallManager.setKeepScreenOn(true);
    InCallManager.setForceSpeakerphoneOn(!!video);
  } catch {
    /* audio session unavailable */
  }
}

export function stopCallAudio() {
  if (!audioSession) return;
  audioSession = false;
  try {
    InCallManager.setKeepScreenOn(false);
    InCallManager.stop();
  } catch {
    /* already stopped */
  }
}

/** Loudspeaker on/off (the call screen's speaker button). */
export function setSpeakerOn(on) {
  try {
    InCallManager.setForceSpeakerphoneOn(!!on);
  } catch {
    /* unsupported */
  }
}

export const speakerToggleSupported = true;
