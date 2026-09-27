/**
 * The phone's call audio route (earpiece / loudspeaker) and screen-on, driven by the active
 * call: voice calls start on the earpiece, video calls on the loudspeaker; the call screen's
 * speaker button toggles it (lib/webrtc → InCallManager).
 */
import { create } from 'zustand';
import { setSpeakerOn, startCallAudio, stopCallAudio } from '@/lib/webrtc';

export const useCallAudio = create((set) => ({
  speaker: false,
  running: false,
  start(video) {
    startCallAudio(video);
    set({ running: true, speaker: !!video });
  },
  stop() {
    stopCallAudio();
    set({ running: false, speaker: false });
  },
  setSpeaker(on) {
    setSpeakerOn(on);
    set({ speaker: !!on });
  },
}));
