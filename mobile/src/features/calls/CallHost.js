/**
 * Global call UI slot (web features/calls/CallOverlay.tsx), mounted once above the app:
 * incoming call (full screen, "silenced" and call-waiting variants), the active call (full
 * screen or the minimized floating window) and the participant picker. Plays the ringtone
 * (incoming, with vibration) and ringback (outgoing) tones, and holds the phone's call audio
 * session (earpiece / loudspeaker, screen on) while a call is in progress.
 */
import { useEffect } from 'react';
import { cancelVibration, startLoop, vibrate } from '@/lib/notify';
import { useCalls } from '@/stores/calls';
import { useCallAudio } from './ui/audio';
import { CallMiniWindow } from './ui/CallMiniWindow';
import { CallScreen } from './ui/CallScreen';
import { CallWaitingCard, IncomingCallScreen, SilencedCallCard } from './ui/IncomingCall';
import { ParticipantPicker } from './ui/ParticipantPicker';

export function CallHost() {
  const incoming = useCalls((s) => s.incoming);
  const active = useCalls((s) => s.active);
  const picker = useCalls((s) => s.picker);
  const inCall = !!active && active.phase !== 'ended';
  const ringing = !!incoming && !incoming.silent && !inCall;
  const ringback = active?.phase === 'calling' || active?.phase === 'ringing';
  const callKey = inCall ? active.call.id || 'starting' : null;
  const video = active?.call.type === 'video';

  useEffect(() => {
    if (!ringing) return;
    const stop = startLoop('ringtone');
    vibrate([0, 400, 200, 400, 200, 400]);
    const id = setInterval(() => vibrate([0, 400, 200, 400]), 2400);
    return () => {
      stop();
      clearInterval(id);
      cancelVibration();
    };
  }, [ringing, incoming?.call.id]);

  useEffect(() => {
    if (!ringback) return;
    return startLoop('ringback');
  }, [ringback]);

  // One audio session per call: earpiece for voice, loudspeaker for video.
  useEffect(() => {
    if (!callKey) return;
    useCallAudio.getState().start(video);
    return () => useCallAudio.getState().stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callKey]);

  return (
    <>
      {active ? (
        active.minimized && active.phase !== 'ended' ? (
          <CallMiniWindow active={active} />
        ) : (
          <CallScreen active={active} />
        )
      ) : null}
      {incoming ? (
        inCall ? (
          <CallWaitingCard payload={incoming} />
        ) : incoming.silent ? (
          <SilencedCallCard payload={incoming} />
        ) : (
          <IncomingCallScreen payload={incoming} />
        )
      ) : null}
      {picker ? <ParticipantPicker request={picker} /> : null}
    </>
  );
}
