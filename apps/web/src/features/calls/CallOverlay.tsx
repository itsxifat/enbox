/**
 * Global call UI slot (rendered once by AppShell above everything): incoming call (full
 * screen on phones, floating card on desktop, "silenced" and call-waiting variants), the
 * active call (full screen or minimized floating window) and the participant picker.
 * Also plays the ringtone (incoming) and ringback (outgoing) tones.
 */
import { useEffect } from 'react';
import { startLoop, vibrate } from '@/lib/notify';
import { useCalls } from '@/stores/calls';
import { CallMiniWindow } from './ui/CallMiniWindow';
import { CallScreen } from './ui/CallScreen';
import { CallWaitingCard, IncomingCallScreen, SilencedCallCard } from './ui/IncomingCall';
import { ParticipantPicker } from './ui/ParticipantPicker';

export function CallOverlay() {
  const incoming = useCalls((s) => s.incoming);
  const active = useCalls((s) => s.active);
  const picker = useCalls((s) => s.picker);
  const inCall = !!active && active.phase !== 'ended';
  const ringing = !!incoming && !incoming.silent && !inCall;
  const ringback = active?.phase === 'calling' || active?.phase === 'ringing';

  useEffect(() => {
    if (!ringing) return;
    const stop = startLoop('ringtone');
    vibrate([400, 200, 400, 200, 400]);
    const id = setInterval(() => vibrate([400, 200, 400]), 2400);
    return () => {
      stop();
      clearInterval(id);
      vibrate(0);
    };
  }, [ringing, incoming?.call.id]);

  useEffect(() => {
    if (!ringback) return;
    return startLoop('ringback');
  }, [ringback]);

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
